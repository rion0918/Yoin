import { env, reset } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  deleteAccountData,
  finishOwnedUpload,
  requestDeletion,
} from "../accounts.ts";
import { handleRequest } from "../api.ts";
import { deleteMemoryData } from "../memory-deletion.ts";
import initial from "../migrations/0001_initial.sql?raw";
import runtime from "../migrations/0002_audio_runtime.sql?raw";
import speakers from "../migrations/0003_speaker_profiles.sql?raw";
import draftSpeakers from "../migrations/0005_draft_speaker_profiles.sql?raw";
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
    `${initial}\n${runtime}\n${speakers}\n${draftSpeakers}`
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
      "locations",
    ])
      await bindings.AUDIO.put(`${category}/${uid}/song.mp3`, "abc");
  }
  bindings.GENERATE = {
    get: async (id: string) => {
      if (deletedWorkflows.includes(id)) throw new Error("instance.not_found");
      return {
        status: async () => ({ status: "running" }),
        delete: async () => {
          deletedWorkflows.push(id);
        },
      };
    },
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
it("accepts owner-scoped memory deletion, hides the song, and rejects other owners", async () => {
  mockFirebaseKeys();
  const createCalls: string[] = [];
  const created = new Set<string>();
  bindings.DELETE_MEMORY = {
    create: async ({ id }: { id: string }) => {
      if (created.has(id)) throw new Error("instance already exists");
      created.add(id);
      createCalls.push(id);
    },
    get: async () => ({ status: async () => ({ status: "running" }) }),
  } as unknown as Env["DELETE_MEMORY"];

  const deleted = await api("alice", "/drafts/alice-draft", "DELETE");
  expect(deleted.status).toBe(202);
  expect(await deleted.json()).toEqual({ status: "deleting" });
  expect((await api("alice", "/drafts/alice-draft/deletion")).status).toBe(200);
  expect(await (await api("alice", "/songs")).json()).toEqual([]);
  expect((await api("bob", "/drafts/alice-draft", "DELETE")).status).toBe(404);
  expect((await api("alice", "/drafts/alice-draft", "DELETE")).status).toBe(
    202,
  );
  expect(createCalls).toHaveLength(1);
  expect(
    await bindings.DB.prepare("SELECT status FROM memory_deletions").first(),
  ).toEqual({ status: "deleting" });
  const firstWorkflow = (
    await bindings.DB.prepare(
      "SELECT workflow_id FROM memory_deletions WHERE owner_id = 'alice'",
    ).first<{ workflow_id: string }>()
  )?.workflow_id;
  await bindings.DB.prepare(
    "UPDATE memory_deletions SET status = 'failed' WHERE owner_id = 'alice'",
  ).run();
  expect((await api("alice", "/drafts/alice-draft", "DELETE")).status).toBe(
    202,
  );
  const retriedWorkflow = await bindings.DB.prepare(
    "SELECT workflow_id, status FROM memory_deletions WHERE owner_id = 'alice'",
  ).first<{ workflow_id: string; status: string }>();
  expect(retriedWorkflow?.workflow_id).not.toBe(firstWorkflow);
  expect(retriedWorkflow?.status).toBe("deleting");
  expect(createCalls).toHaveLength(2);
});
it("deletes only one memory's objects and rows while retaining its budget ledger", async () => {
  await bindings.DB.prepare(
    "INSERT INTO clips (id, draft_id, owner_id, mime_type, size_bytes, duration_ms, timezone, object_key, status) VALUES ('alice-clip', 'alice-draft', 'alice', 'audio/mp4', 3, 1000, 'Asia/Tokyo', 'originals/alice/alice-clip', 'uploaded')",
  ).run();
  const pendingUpload = await bindings.AUDIO.createMultipartUpload(
    "originals/alice/alice-pending",
  );
  await bindings.DB.prepare(
    "INSERT INTO clips (id, draft_id, owner_id, mime_type, size_bytes, duration_ms, timezone, object_key, upload_id, status) VALUES ('alice-pending', 'alice-draft', 'alice', 'audio/mp4', 3, 1000, 'Asia/Tokyo', 'originals/alice/alice-pending', ?, 'uploading')",
  )
    .bind(pendingUpload.uploadId)
    .run();
  await bindings.DB.prepare(
    "UPDATE provider_attempts SET output_key = 'results/alice/alice-attempt.json' WHERE id = 'alice-attempt'",
  ).run();
  await bindings.AUDIO.put("originals/alice/alice-clip", "clip");
  await bindings.AUDIO.put(
    "processed/alice/alice-job/alice-clip/0.m4a",
    "clip",
  );
  await bindings.AUDIO.put("songs/alice/alice-job.mp3", "song");
  await bindings.AUDIO.put("results/alice/alice-attempt.json", "response");
  await bindings.AUDIO.put("results/alice/alice-attempt-other.json", "keep");
  await bindings.AUDIO.put(
    "locations/alice/alice-draft/alice-clip/location.json",
    "location",
  );
  await bindings.DB.prepare(
    "INSERT INTO memory_deletions (owner_id, draft_id, workflow_id, status, requested_at) VALUES ('alice', 'alice-draft', 'memory-alice', 'deleting', '2026-10-13')",
  ).run();

  const ledgerBefore = (
    await bindings.DB.prepare("SELECT * FROM budget_ledger ORDER BY id").all()
  ).results;
  await deleteMemoryData(bindings, { uid: "alice", draftId: "alice-draft" });
  await deleteMemoryData(bindings, { uid: "alice", draftId: "alice-draft" });

  expect(deletedWorkflows).toContain("alice-job");
  expect(deletedWorkflows).not.toContain("bob-job");
  expect(
    await bindings.DB.prepare(
      "SELECT * FROM drafts WHERE owner_id = 'alice'",
    ).all(),
  ).toMatchObject({ results: [] });
  expect(
    await bindings.DB.prepare(
      "SELECT * FROM drafts WHERE owner_id = 'bob'",
    ).all(),
  ).toMatchObject({ results: [{ id: "bob-draft" }] });
  expect(
    await bindings.DB.prepare(
      "SELECT * FROM songs WHERE owner_id = 'alice'",
    ).all(),
  ).toMatchObject({ results: [] });
  expect(
    await bindings.DB.prepare(
      "SELECT * FROM songs WHERE owner_id = 'bob'",
    ).all(),
  ).toMatchObject({ results: [{ id: "bob-song" }] });
  for (const [table, query] of [
    ["clips", "SELECT id FROM clips WHERE owner_id = 'alice'"],
    ["jobs", "SELECT id FROM jobs WHERE owner_id = 'alice'"],
    [
      "provider_attempts",
      "SELECT id FROM provider_attempts WHERE owner_id = 'alice'",
    ],
    ["audio_objects", "SELECT id FROM audio_objects WHERE owner_id = 'alice'"],
    [
      "lyric_revisions",
      "SELECT draft_id FROM lyric_revisions WHERE draft_id = 'alice-draft'",
    ],
  ]) {
    expect(await bindings.DB.prepare(query).all(), table).toMatchObject({
      results: [],
    });
  }
  expect(
    await bindings.DB.prepare(
      "SELECT id FROM speaker_profiles WHERE owner_id = 'alice'",
    ).all(),
  ).toMatchObject({ results: [{ id: "alice-speaker" }] });
  expect(
    await bindings.DB.prepare(
      "SELECT status FROM memory_deletions WHERE owner_id = 'alice'",
    ).first(),
  ).toEqual({ status: "deleted" });
  expect(
    (await bindings.DB.prepare("SELECT * FROM budget_ledger ORDER BY id").all())
      .results,
  ).toEqual(ledgerBefore);
  for (const key of [
    "originals/alice/alice-clip",
    "processed/alice/alice-job/alice-clip/0.m4a",
    "songs/alice/song.mp3",
    "songs/alice/alice-job.mp3",
    "results/alice/alice-attempt.json",
    "locations/alice/alice-draft/alice-clip/location.json",
  ])
    expect(await bindings.AUDIO.head(key)).toBeNull();
  expect(
    await bindings.AUDIO.head("results/alice/alice-attempt-other.json"),
  ).not.toBeNull();
  expect(await bindings.AUDIO.head("voices/alice/song.mp3")).not.toBeNull();
  expect(await bindings.AUDIO.head("songs/bob/song.mp3")).not.toBeNull();
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
  const ledger = (
    await bindings.DB.prepare("SELECT * FROM budget_ledger").all()
  ).results;
  expect(ledger).toHaveLength(2);
  expect(
    ledger.every(({ id }) => id !== "alice-attempt" && id !== "bob-attempt"),
  ).toBe(true);
  for (const category of [
    "originals",
    "processed",
    "voices",
    "songs",
    "results",
    "locations",
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
it("deletes preparation and reading workflow results from their owning binding", async () => {
  for (const [id, owner, kind] of [
    ["alice-prepare", "alice", "prepare"],
    ["alice-readings", "alice", "readings"],
    ["bob-readings", "bob", "readings"],
  ])
    await bindings.DB.prepare(
      "INSERT INTO jobs (id, owner_id, draft_id, kind, idempotency_key, fingerprint, status, created_at) VALUES (?, ?, ?, ?, ?, 'hash', 'waiting_review', '2026-10-13')",
    )
      .bind(id, owner, `${owner}-draft`, kind, id)
      .run();
  const preparationResults = new Set([
    "alice-prepare",
    "alice-readings",
    "bob-readings",
  ]);
  const generationResults = new Set(["alice-job", "bob-job"]);
  bindings.PREPARE = {
    get: async (id: string) => {
      if (!preparationResults.has(id)) throw new Error("instance.not_found");
      return {
        status: async () => ({ status: "complete" }),
        delete: async () => preparationResults.delete(id),
      };
    },
  } as unknown as Env["PREPARE"];
  bindings.GENERATE = {
    get: async (id: string) => {
      if (!generationResults.has(id)) throw new Error("instance.not_found");
      return {
        status: async () => ({ status: "complete" }),
        delete: async () => generationResults.delete(id),
      };
    },
  } as unknown as Env["GENERATE"];
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ deleted: true }),
  );

  await deleteAccountData(bindings, "alice");

  expect([...preparationResults]).toEqual(["bob-readings"]);
  expect([...generationResults]).toEqual(["bob-job"]);
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

it("skips undispatched workflows but preserves lookup failures for retry", async () => {
  await bindings.DB.prepare(
    "UPDATE accounts SET status = 'deleting' WHERE uid = 'alice'",
  ).run();
  const lookup = vi
    .fn()
    .mockRejectedValueOnce(new Error("workflow service unavailable"))
    .mockRejectedValue(new Error("instance.not_found"));
  bindings.GENERATE = { get: lookup } as unknown as Env["GENERATE"];
  const service = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => Response.json({ deleted: true }));
  await expect(deleteAccountData(bindings, "alice")).rejects.toThrow(
    "workflow service unavailable",
  );
  expect(service).not.toHaveBeenCalled();
  expect(
    await bindings.DB.prepare(
      "SELECT status FROM accounts WHERE uid = 'alice'",
    ).first(),
  ).toEqual({ status: "deleting" });
  await deleteAccountData(bindings, "alice");
  expect(
    await bindings.DB.prepare(
      "SELECT status FROM accounts WHERE uid = 'alice'",
    ).first(),
  ).toEqual({ status: "deleted" });
  expect(
    await bindings.DB.prepare("SELECT owner_id FROM jobs").all(),
  ).toMatchObject({ results: [{ owner_id: "bob" }] });
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
