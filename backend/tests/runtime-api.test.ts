import { env, reset } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import { handleRequest } from "../api.ts";
import schema from "../migrations/0001_initial.sql?raw";
import migration from "../migrations/0002_audio_runtime.sql?raw";
import speakerMigration from "../migrations/0003_speaker_profiles.sql?raw";
import { signedUrl } from "../security.ts";
import type { Env } from "../types.ts";
import { applyAccountSchema } from "./schema.ts";

let bindings: Env;
beforeEach(async () => {
  await reset();
  bindings = {
    ...env,
    MEDIA_SIGNING_SECRET: "s".repeat(64),
    PUBLIC_API_URL: "https://yoin.test",
  } as unknown as Env;
  await bindings.DB.batch(
    `${schema}\n${migration}\n${speakerMigration}`
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => bindings.DB.prepare(s)),
  );
  await applyAccountSchema(bindings.DB);
  await bindings.DB.prepare(
    "INSERT INTO drafts (id, owner_id, title, created_at) VALUES ('draft', 'private-tester', '旅', '2026-10-04')",
  ).run();
  await bindings.DB.prepare(
    "INSERT INTO jobs (id, owner_id, draft_id, kind, idempotency_key, fingerprint, status, created_at) VALUES ('job', 'private-tester', 'draft', 'generate', 'key', 'hash', 'running', '2026-10-04')",
  ).run();
  await bindings.DB.prepare(
    "INSERT INTO provider_attempts (id, job_id, owner_id, stage, status, amount_micros, created_at) VALUES ('music-job', 'job', 'private-tester', 'music', 'submitted', 80000, '2026-10-04')",
  ).run();
});
async function request(action: string, method: string, body?: string) {
  const signed = await signedUrl(
    bindings,
    `/internal/attempts/music-job/${action}`,
    method,
  );
  return handleRequest(
    new Request(signed.url, {
      method,
      body,
      headers: body
        ? { "Content-Length": String(new TextEncoder().encode(body).length) }
        : {},
    }),
    bindings,
  );
}
it("claims a reserved provider attempt only once across runtime requests", async () => {
  const results = await Promise.all([
    request("claim", "POST"),
    request("claim", "POST"),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
});

it("resolves callback ownership from the attempt instead of a fixed environment owner", async () => {
  await bindings.DB.prepare("UPDATE drafts SET owner_id = 'alice'").run();
  await bindings.DB.prepare("UPDATE jobs SET owner_id = 'alice'").run();
  await bindings.DB.prepare(
    "UPDATE provider_attempts SET owner_id = 'alice'",
  ).run();
  expect((await request("claim", "POST")).status).toBe(200);
  expect((await request("song", "PUT", "ID3audio")).status).toBe(200);
  expect(await bindings.AUDIO.head("songs/alice/job.mp3")).not.toBeNull();
});
it("streams a generated song and persists the result before workflow settlement", async () => {
  expect((await request("song", "PUT", "ID3audio")).status).toBe(409);
  await request("claim", "POST");
  const uploaded = await request("song", "PUT", "ID3audio");
  expect(uploaded.status).toBe(200);
  expect(await uploaded.json()).toMatchObject({
    audioId: "song-audio-job",
    key: "songs/private-tester/job.mp3",
    sizeBytes: 8,
  });
  expect(
    (
      await request(
        "result",
        "PUT",
        JSON.stringify({ version: 1, value: {}, costUsd: 0.08, usage: {} }),
      )
    ).status,
  ).toBe(200);
  expect(
    await bindings.AUDIO.head("results/private-tester/music-job.json"),
  ).not.toBeNull();
});
it("rejects unsigned callbacks and attempts whose owning job has stopped", async () => {
  expect(
    (
      await handleRequest(
        new Request("https://yoin.test/internal/attempts/music-job/claim", {
          method: "POST",
        }),
        bindings,
      )
    ).status,
  ).toBe(403);
  await bindings.DB.prepare(
    "UPDATE jobs SET status = 'failed' WHERE id = 'job'",
  ).run();
  expect((await request("claim", "POST")).status).toBe(409);
});
