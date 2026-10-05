import { env, reset } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  deleteAccountData,
  finishOwnedUpload,
  requestDeletion,
} from "../accounts.ts";
import { handleRequest } from "../api.ts";
import initial from "../migrations/0001_initial.sql?raw";
import runtime from "../migrations/0002_audio_runtime.sql?raw";
import speakers from "../migrations/0003_speaker_profiles.sql?raw";
import { signedUrl } from "../security.ts";
import type { Env } from "../types.ts";
import { firebaseToken, mockFirebaseKeys } from "./auth-fixture.ts";
import { applyAccountSchema } from "./schema.ts";

let bindings: Env;
const deletedWorkflows: string[] = [];
beforeEach(async () => {
  await reset();
  deletedWorkflows.length = 0;
  bindings = {
    ...env,
    MEDIA_SERVICE_URL: "https://media.test",
    MEDIA_SERVICE_TOKEN: "m".repeat(64),
    MEDIA_SIGNING_SECRET: "s".repeat(64),
  } as unknown as Env;
  await bindings.DB.batch(
    `${initial}\n${runtime}\n${speakers}`
      .split(";")
      .map((sql) => sql.trim())
      .filter(Boolean)
      .map((sql) => bindings.DB.prepare(sql)),
  );
  await applyAccountSchema(bindings.DB);
  for (const uid of ["alice", "bob"]) {
    await bindings.DB.prepare("INSERT INTO accounts (uid) VALUES (?)")
      .bind(uid)
      .run();
    await bindings.DB.prepare(
      "INSERT INTO drafts (id, owner_id, title, created_at) VALUES (?, ?, '旅', '2026-10-05')",
    )
      .bind(`${uid}-draft`, uid)
      .run();
    await bindings.DB.prepare(
      "INSERT INTO jobs (id, owner_id, draft_id, kind, idempotency_key, fingerprint, status, created_at) VALUES (?, ?, ?, 'generate', 'key', 'hash', 'running', '2026-10-05')",
    )
      .bind(`${uid}-job`, uid, `${uid}-draft`)
      .run();
    await bindings.DB.prepare(
      "INSERT INTO provider_attempts (id, job_id, owner_id, stage, status, amount_micros, created_at) VALUES (?, ?, ?, 'music', 'needs_reconciliation', 80000, '2026-10-05')",
    )
      .bind(`${uid}-attempt`, `${uid}-job`, uid)
      .run();
    await bindings.DB.prepare(
      "INSERT INTO audio_objects (id, owner_id, draft_id, object_key, mime_type, size_bytes, duration_ms, kind) VALUES (?, ?, ?, ?, 'audio/mpeg', 3, 1000, 'song')",
    )
      .bind(`${uid}-audio`, uid, `${uid}-draft`, `songs/${uid}/song.mp3`)
      .run();
    await bindings.DB.prepare(
      "INSERT INTO lyric_revisions (draft_id, revision, blocks_json, created_at) VALUES (?, 1, '[]', '2026-10-05')",
    )
      .bind(`${uid}-draft`)
      .run();
    await bindings.DB.prepare(
      "INSERT INTO songs (id, owner_id, draft_id, title, created_at, lyric_revision, audio_id) VALUES (?, ?, ?, '旅', '2026-10-05', 1, ?)",
    )
      .bind(`${uid}-song`, uid, `${uid}-draft`, `${uid}-audio`)
      .run();
    await bindings.DB.prepare(
      "INSERT INTO speaker_profiles (id, owner_id, name, created_at) VALUES (?, ?, '声', '2026-10-05')",
    )
      .bind(`${uid}-speaker`, uid)
      .run();
    for (const category of [
      "originals",
      "processed",
      "voices",
      "songs",
      "results",
    ])
      await bindings.AUDIO.put(`${category}/${uid}/song.mp3`, "abc");
  }
  bindings.GENERATE = {
    get: async (id: string) => ({
      status: async () => ({
        status: deletedWorkflows.includes(id) ? "unknown" : "running",
      }),
      delete: async () => {
        deletedWorkflows.push(id);
      },
    }),
  } as unknown as Env["GENERATE"];
});
afterEach(() => vi.restoreAllMocks());
async function api(uid: string, path: string, method = "GET") {
  return handleRequest(
    new Request(`https://yoin.test${path}`, {
      method,
      headers: { Authorization: `Bearer ${await firebaseToken(uid)}` },
      ...(method === "POST" ? { body: "{}" } : {}),
    }),
    bindings,
  );
}
it("separates lists, ID access, speaker profiles and signed playback for two users", async () => {
  mockFirebaseKeys();
  expect(await (await api("alice", "/songs")).json()).toMatchObject([
    { id: "alice-song" },
  ]);
  expect(await (await api("bob", "/speakers")).json()).toMatchObject([
    { id: "bob-speaker" },
  ]);
  for (const path of [
    "/drafts/alice-draft",
    "/songs/alice-song",
    "/jobs/alice-job",
    "/speakers/alice-speaker",
    "/audio/alice-audio/url",
  ])
    expect(
      (await api("bob", path, path.endsWith("/url") ? "POST" : "GET")).status,
    ).toBe(404);
  const playback = await (
    await api("alice", "/audio/alice-audio/url", "POST")
  ).json<{ url: string }>();
  expect(
    (await handleRequest(new Request(playback.url), bindings)).status,
  ).toBe(200);
  await bindings.DB.prepare(
    "UPDATE accounts SET status = 'deleting' WHERE uid = 'alice'",
  ).run();
  expect(
    (await handleRequest(new Request(playback.url), bindings)).status,
  ).toBe(403);
});
it("deletion resumes after a service failure, removes only its owner, and keeps global reservations", async () => {
  await bindings.DB.prepare(
    "UPDATE accounts SET status = 'deleting' WHERE uid = 'alice'",
  ).run();
  const service = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValueOnce(new Error("offline"))
    .mockImplementation(async () => Response.json({ deleted: true }));
  await expect(deleteAccountData(bindings, "alice")).rejects.toBeDefined();
  expect(
    await bindings.DB.prepare(
      "SELECT status FROM accounts WHERE uid = 'alice'",
    ).first(),
  ).toEqual({ status: "deleting" });
  await deleteAccountData(bindings, "alice");
  await deleteAccountData(bindings, "alice");
  expect(service).toHaveBeenCalledTimes(3);
  expect(
    await bindings.DB.prepare(
      "SELECT status FROM accounts WHERE uid = 'alice'",
    ).first(),
  ).toEqual({ status: "deleted" });
  for (const table of [
    "drafts",
    "jobs",
    "provider_attempts",
    "audio_objects",
    "songs",
    "speaker_profiles",
  ])
    expect(
      (await bindings.DB.prepare(`SELECT owner_id FROM ${table}`).all())
        .results,
    ).toEqual([{ owner_id: "bob" }]);
  expect(
    (
      await bindings.DB.prepare(
        "SELECT SUM(amount_micros) AS total FROM budget_ledger",
      ).first()
    )?.total,
  ).toBe(160000);
  for (const category of [
    "originals",
    "processed",
    "voices",
    "songs",
    "results",
  ]) {
    expect(await bindings.AUDIO.head(`${category}/alice/song.mp3`)).toBeNull();
    expect(
      await bindings.AUDIO.head(`${category}/bob/song.mp3`),
    ).not.toBeNull();
  }
  const callback = await signedUrl(
    bindings,
    "/internal/attempts/alice-attempt/song",
    "PUT",
  );
  expect(
    (
      await handleRequest(
        new Request(callback.url, {
          method: "PUT",
          headers: { "Content-Length": "3" },
          body: "abc",
        }),
        bindings,
      )
    ).status,
  ).toBe(409);
  await bindings.AUDIO.put("songs/alice/late.mp3", "late");
  await expect(
    finishOwnedUpload(bindings, "alice", "songs/alice/late.mp3"),
  ).rejects.toMatchObject({ status: 403 });
  expect(await bindings.AUDIO.head("songs/alice/late.mp3")).toBeNull();
});
it("requires recent Google authentication and refuses to report an undispatched deletion as accepted", async () => {
  const identity = {
    uid: "alice",
    email: "tester@example.com",
    name: "A",
    authTime: Math.floor(Date.now() / 1000) - 600,
  };
  await expect(requestDeletion(bindings, identity)).rejects.toMatchObject({
    code: "recent_login_required",
  });
  bindings.DELETE_ACCOUNT = {
    create: async () => {
      throw new Error("dispatch unavailable");
    },
    get: async () => ({ status: async () => ({ status: "unknown" }) }),
  } as unknown as Env["DELETE_ACCOUNT"];
  await expect(
    requestDeletion(bindings, {
      ...identity,
      authTime: Math.floor(Date.now() / 1000),
    }),
  ).rejects.toBeDefined();
  expect(
    await bindings.DB.prepare(
      "SELECT status FROM accounts WHERE uid = 'alice'",
    ).first(),
  ).toEqual({ status: "deleting" });
});

it("can finish deletion after multipart completion lost its D1 acknowledgement", async () => {
  await bindings.DB.prepare(
    "UPDATE accounts SET status = 'deleting' WHERE uid = 'alice'",
  ).run();
  const key = "originals/alice/completed";
  const upload = await bindings.AUDIO.createMultipartUpload(key);
  const part = await upload.uploadPart(1, "abc");
  await upload.complete([part]);
  await bindings.DB.prepare(
    "INSERT INTO clips (id, draft_id, owner_id, mime_type, size_bytes, duration_ms, timezone, object_key, upload_id) VALUES ('completed', 'alice-draft', 'alice', 'audio/mp4', 3, 1000, 'Asia/Tokyo', ?, ?)",
  )
    .bind(key, upload.uploadId)
    .run();
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    Response.json({ deleted: true }),
  );
  await deleteAccountData(bindings, "alice");
  expect(await bindings.AUDIO.head(key)).toBeNull();
});
