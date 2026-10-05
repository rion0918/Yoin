import { env, reset } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleRequest } from "../api.ts";
import initialSchema from "../migrations/0001_initial.sql?raw";
import runtimeSchema from "../migrations/0002_audio_runtime.sql?raw";
import speakerSchema from "../migrations/0003_speaker_profiles.sql?raw";

const schema = `${initialSchema}\n${runtimeSchema}\n${speakerSchema}`;

import { sha256 } from "../security.ts";
import type { Env } from "../types.ts";

const testerToken = "test-credential-with-at-least-thirty-two-bytes";
const draftId = "e22a50aa-1d25-4dd0-bfba-f6ee2c101911";
let bindings: Env;

beforeEach(async () => {
  await reset();
  bindings = {
    ...env,
    TESTER_TOKEN_SHA256: await sha256(testerToken),
    MEDIA_SIGNING_SECRET: "test-signing-secret-with-at-least-thirty-two-bytes",
  } as unknown as Env;
  await bindings.DB.batch(
    schema
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => bindings.DB.prepare(statement)),
  );
});

function request(
  path: string,
  method = "GET",
  body?: unknown,
  token = testerToken,
) {
  return handleRequest(
    new Request(`https://yoin.test${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    bindings,
  );
}

describe("private API", () => {
  it("offers authenticated speaker registration instead of anonymous labels only", async () => {
    const created = await request("/speakers", "POST", {
      id: "speaker-a",
      name: "あおい",
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      id: "speaker-a",
      name: "あおい",
      status: "pending",
    });
    const listed = await request("/speakers");
    expect(listed.status).toBe(200);
    expect(await listed.json()).toHaveLength(1);
  });
  it("rejects a wrong credential before accessing storage", async () => {
    expect((await request("/songs", "GET", undefined, "wrong")).status).toBe(
      401,
    );
  });

  it("returns the same owned draft when a create is retried", async () => {
    const body = {
      id: draftId,
      title: "秋の旅",
      createdAt: "2026-10-04T01:00:00Z",
    };
    const first = await request("/drafts", "POST", body);
    const retry = await request("/drafts", "POST", body);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({
      id: draftId,
      title: "秋の旅",
      clips: [],
    });
  });

  it("rejects source references that do not belong to the draft", async () => {
    await request("/drafts", "POST", {
      id: draftId,
      title: "旅",
      createdAt: "2026-10-04T01:00:00Z",
    });
    await bindings.DB.prepare(
      "UPDATE drafts SET status = 'waiting_review', lyric_revision = 1 WHERE id = ?",
    )
      .bind(draftId)
      .run();
    const response = await request(`/drafts/${draftId}/lyrics`, "PATCH", {
      revision: 1,
      blocks: [
        { id: "verse-1", text: "秋の風", sourceUtteranceIds: ["other-owner"] },
      ],
    });
    expect(response.status).toBe(422);
  });

  it("uses actual D1 and R2 bindings for an upload and range playback", async () => {
    await request("/drafts", "POST", {
      id: draftId,
      title: "旅",
      createdAt: "2026-10-04T01:00:00Z",
    });
    const clipId = "clip-test";
    const created = await request(`/drafts/${draftId}/clips`, "POST", {
      id: clipId,
      mimeType: "audio/mp4",
      sizeBytes: 10,
      durationMs: 1000,
      recordedAt: "2026-10-04T01:00:00Z",
      importedAt: null,
      timezone: "Asia/Tokyo",
      place: "鴨川",
    });
    expect(created.status).toBe(200);
    const upload = (await created.json()) as { uploadId: string };
    const partResponse = await handleRequest(
      new Request(
        `https://yoin.test/clips/${clipId}/parts/1?uploadId=${upload.uploadId}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${testerToken}`,
            "Content-Length": "10",
          },
          body: "0123456789",
        },
      ),
      bindings,
    );
    expect(partResponse.status).toBe(200);
    const part = await partResponse.json<{
      partNumber: number;
      etag: string;
    }>();
    expect(
      (
        await request(`/clips/${clipId}/complete`, "POST", {
          uploadId: upload.uploadId,
          parts: [{ etag: part.etag, partNumber: part.partNumber }],
        })
      ).status,
    ).toBe(200);
    const urlResponse = await request(`/audio/${clipId}/url`, "POST");
    const audioUrl = (await urlResponse.json()) as { url: string };
    const result = await handleRequest(
      new Request(audioUrl.url, { headers: { Range: "bytes=3-5" } }),
      bindings,
    );
    expect(result.status).toBe(206);
    expect(result.headers.get("content-range")).toBe("bytes 3-5/10");
    expect(new TextDecoder().decode(await result.arrayBuffer())).toBe("345");
    const metadata = await bindings.DB.prepare(
      "SELECT place, status FROM clips WHERE id = ?",
    )
      .bind(clipId)
      .first();
    expect(metadata).toEqual({ place: "鴨川", status: "uploaded" });
    expect(
      (await bindings.AUDIO.head(`originals/private-tester/${clipId}`))?.size,
    ).toBe(10);
    const tampered = new URL(audioUrl.url);
    tampered.pathname = "/media/other-owner";
    expect((await handleRequest(new Request(tampered), bindings)).status).toBe(
      403,
    );
  });

  it("returns 404 for an object owned by somebody else", async () => {
    await bindings.DB.prepare(
      "INSERT INTO drafts (id, owner_id, title, created_at) VALUES ('other-draft', 'other-owner', 'private', '2026-10-04')",
    ).run();
    expect((await request("/drafts/other-draft")).status).toBe(404);
  });

  it("keeps a single generation job and freezes the approved revision on retry", async () => {
    const block = {
      id: "verse-1",
      text: "秋の風",
      sourceUtteranceIds: ["clip:u:0:1"],
    };
    await seedReview(block);
    const create = vi.fn(async () => {
      throw new Error("dispatch interrupted");
    });
    bindings.GENERATE = { create } as unknown as Env["GENERATE"];
    const first = await request(`/drafts/${draftId}/generate`, "POST", {
      revision: 1,
      idempotencyKey: "generation-key",
    });
    const retry = await request(`/drafts/${draftId}/generate`, "POST", {
      revision: 1,
      idempotencyKey: "generation-key",
    });
    expect(first.status).toBe(202);
    const submitted = await first.json<{ jobId: string }>();
    expect(await retry.json()).toEqual(submitted);
    expect((await request(`/jobs/${submitted.jobId}`)).status).toBe(200);
    expect(create).toHaveBeenCalledTimes(3);
    expect(
      (await bindings.DB.prepare("SELECT id FROM jobs").all()).results,
    ).toHaveLength(1);
    expect(
      (
        await request(`/drafts/${draftId}/lyrics`, "PATCH", {
          revision: 1,
          blocks: [block],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(`/drafts/${draftId}/generate`, "POST", {
          revision: 1,
          idempotencyKey: "different-key",
        })
      ).status,
    ).toBe(409);
    const frozen = await bindings.DB.prepare(
      "SELECT lyric_revision, blocks_json FROM jobs WHERE id = ?",
    )
      .bind(submitted.jobId)
      .first();
    expect(frozen).toEqual({
      lyric_revision: 1,
      blocks_json: JSON.stringify([block]),
    });
  });

  it("rejects a stale lyric edit without changing the current revision", async () => {
    const block = {
      id: "verse-1",
      text: "秋の風",
      sourceUtteranceIds: ["clip:u:0:1"],
    };
    await seedReview(block);
    const edited = { ...block, text: "また歩こう" };
    expect(
      (
        await request(`/drafts/${draftId}/lyrics`, "PATCH", {
          revision: 1,
          blocks: [edited],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(`/drafts/${draftId}/lyrics`, "PATCH", {
          revision: 1,
          blocks: [block],
        })
      ).status,
    ).toBe(409);
    expect((await request(`/drafts/${draftId}`)).status).toBe(200);
    expect(
      (
        await bindings.DB.prepare(
          "SELECT revision FROM lyric_revisions ORDER BY revision",
        ).all()
      ).results,
    ).toEqual([{ revision: 1 }, { revision: 2 }]);
  });

  it("allows a known failed generation to be edited and submitted as a new job", async () => {
    const block = {
      id: "verse-1",
      text: "秋の風",
      sourceUtteranceIds: ["clip:u:0:1"],
    };
    await seedReview(block);
    await bindings.DB.prepare(
      "INSERT INTO jobs (id, owner_id, draft_id, kind, idempotency_key, fingerprint, lyric_revision, blocks_json, status, error, created_at) VALUES ('failed-job', 'private-tester', ?, 'generate', 'failed-key', 'previous', 1, ?, 'failed', 'media_inspection_failed', '2026-10-04')",
    )
      .bind(draftId, JSON.stringify([block]))
      .run();
    await bindings.DB.prepare(
      "UPDATE drafts SET status = 'failed', job_id = 'failed-job', error = 'media_inspection_failed' WHERE id = ?",
    )
      .bind(draftId)
      .run();
    const edited = { ...block, text: "また歩こう" };
    const revision = await request(`/drafts/${draftId}/lyrics`, "PATCH", {
      revision: 1,
      blocks: [edited],
    });
    expect(revision.status).toBe(200);
    expect(await revision.json()).toEqual({ revision: 2, blocks: [edited] });
    const draft = await (await request(`/drafts/${draftId}`)).json();
    expect(draft).toMatchObject({ status: "waiting_review", error: null });
    bindings.GENERATE = {
      create: vi.fn(async () => ({ id: "submitted" })),
    } as unknown as Env["GENERATE"];
    const submitted = await request(`/drafts/${draftId}/generate`, "POST", {
      revision: 2,
      idempotencyKey: "replacement-key",
    });
    expect(submitted.status).toBe(202);
    const newJob = await submitted.json<{ jobId: string }>();
    expect(newJob.jobId).not.toBe("failed-job");
    const old = await bindings.DB.prepare(
      "SELECT blocks_json, lyric_revision, status FROM jobs WHERE id = 'failed-job'",
    ).first();
    expect(old).toEqual({
      blocks_json: JSON.stringify([block]),
      lyric_revision: 1,
      status: "failed",
    });
  });

  it("does not reopen an ambiguous provider outcome for paid regeneration", async () => {
    const block = {
      id: "verse-1",
      text: "秋の風",
      sourceUtteranceIds: ["clip:u:0:1"],
    };
    await seedReview(block);
    await bindings.DB.prepare(
      "UPDATE drafts SET status = 'needs_reconciliation', error = 'provider_outcome_unconfirmed' WHERE id = ?",
    )
      .bind(draftId)
      .run();
    expect(
      (
        await request(`/drafts/${draftId}/lyrics`, "PATCH", {
          revision: 1,
          blocks: [block],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(`/drafts/${draftId}/generate`, "POST", {
          revision: 1,
          idempotencyKey: "ambiguous-retry",
        })
      ).status,
    ).toBe(409);
    expect(
      (await bindings.DB.prepare("SELECT id FROM jobs").all()).results,
    ).toHaveLength(0);
  });
});

async function seedReview(block: {
  id: string;
  text: string;
  sourceUtteranceIds: string[];
}) {
  await request("/drafts", "POST", {
    id: draftId,
    title: "旅",
    createdAt: "2026-10-04T01:00:00Z",
  });
  await bindings.DB.prepare(
    "INSERT INTO clips (id, draft_id, owner_id, mime_type, size_bytes, duration_ms, timezone, object_key, status) VALUES ('clip', ?, 'private-tester', 'audio/mp4', 10, 1000, 'Asia/Tokyo', 'originals/private-tester/clip', 'uploaded')",
  )
    .bind(draftId)
    .run();
  await bindings.DB.prepare(
    "INSERT INTO utterances (id, clip_id, start_ms, end_ms, speaker, text) VALUES ('clip:u:0:1', 'clip', 0, 100, '話者 1', '秋の会話')",
  ).run();
  await bindings.DB.prepare(
    "INSERT INTO lyric_revisions (draft_id, revision, blocks_json, created_at) VALUES (?, 1, ?, '2026-10-04')",
  )
    .bind(draftId, JSON.stringify([block]))
    .run();
  await bindings.DB.prepare(
    "UPDATE drafts SET status = 'waiting_review', lyric_revision = 1 WHERE id = ?",
  )
    .bind(draftId)
    .run();
}
