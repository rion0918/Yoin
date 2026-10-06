import { env, reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleRequest } from "../api.ts";
import initialSchema from "../migrations/0001_initial.sql?raw";
import runtimeSchema from "../migrations/0002_audio_runtime.sql?raw";
import speakerSchema from "../migrations/0003_speaker_profiles.sql?raw";
import draftSpeakersSchema from "../migrations/0005_draft_speaker_profiles.sql?raw";
import { applyAccountSchema } from "./schema.ts";

const schema = `${initialSchema}\n${runtimeSchema}\n${speakerSchema}\n${draftSpeakersSchema}`;

import { firebaseToken, mockFirebaseKeys } from "./auth-fixture.ts";

afterEach(() => vi.restoreAllMocks());

import type { Env } from "../types.ts";

let testerToken = "";
const draftId = "e22a50aa-1d25-4dd0-bfba-f6ee2c101911";
let bindings: Env;

beforeEach(async () => {
  await reset();
  mockFirebaseKeys();
  testerToken = await firebaseToken();
  bindings = {
    ...env,
    MEDIA_SIGNING_SECRET: "test-signing-secret-with-at-least-thirty-two-bytes",
  } as unknown as Env;
  await bindings.DB.batch(
    schema
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => bindings.DB.prepare(statement)),
  );
  await applyAccountSchema(bindings.DB);
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
  it("accepts account deletion as a durable operation", async () => {
    bindings.DELETE_ACCOUNT = {
      create: vi.fn(async () => ({ id: "deletion" })),
    } as unknown as Env["DELETE_ACCOUNT"];
    const response = await request("/account/deletion", "POST", {});
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: "deleting" });
    expect((await request("/songs")).status).toBe(403);
  });
  it("removes a workflow created after deletion started during dispatch", async () => {
    await seedReview({
      id: "block",
      text: "秋の風",
      sourceUtteranceIds: ["clip:u:0:1"],
    });
    const remove = vi.fn(async () => {});
    bindings.GENERATE = {
      create: async () => {
        await bindings.DB.prepare(
          "INSERT INTO accounts (uid, status) VALUES ('private-tester', 'deleting')",
        ).run();
        return { delete: remove };
      },
    } as unknown as Env["GENERATE"];
    await request(`/drafts/${draftId}/generate`, "POST", {
      revision: 1,
      idempotencyKey: "deletion-race",
    });
    expect(remove).toHaveBeenCalledOnce();
  });
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

  it("stores a bounded owner-scoped location route once and returns its summary", async () => {
    await request("/drafts", "POST", {
      id: draftId,
      title: "大阪の記録",
      createdAt: "2026-10-06T00:00:00.000Z",
    });
    const clipId = "location-clip";
    const recordedAt = "2026-10-06T00:00:00.000Z";
    await bindings.DB.prepare(
      "INSERT INTO clips (id, draft_id, owner_id, mime_type, size_bytes, duration_ms, recorded_at, timezone, object_key, status) VALUES (?, ?, 'private-tester', 'audio/mp4', 10, 1000, ?, 'Asia/Tokyo', 'originals/private-tester/location-clip', 'uploaded')",
    )
      .bind(clipId, draftId, recordedAt)
      .run();
    const timestamp = Date.parse(recordedAt);
    const body = {
      route: {
        version: 1,
        draftId,
        clipId,
        recordedAt,
        endedAt: new Date(timestamp + 60_000).toISOString(),
        segments: [
          {
            startedAt: timestamp,
            endedAt: timestamp + 60_000,
            samples: [
              {
                latitude: 34.66871,
                longitude: 135.50131,
                accuracy: 24,
                timestamp,
              },
            ],
          },
        ],
      },
      representativeTimestamps: [timestamp],
      places: [{ timestamp, name: "大阪市中央区" }],
    };
    const competingBody = {
      ...body,
      places: [{ timestamp, name: "大阪市北区" }],
    };
    const routeWrite = vi.spyOn(bindings.AUDIO, "put");
    const [first, competing] = await Promise.all([
      request(`/clips/${clipId}/location`, "PUT", body),
      request(`/clips/${clipId}/location`, "PUT", competingBody),
    ]);
    expect([first.status, competing.status].sort()).toEqual([200, 409]);
    const accepted = first.status === 200 ? first : competing;
    const acceptedBody = first.status === 200 ? body : competingBody;
    const rejected = first.status === 409 ? first : competing;
    expect(await rejected.json()).toMatchObject({
      error: "location_route_conflict",
    });
    const summary = await accepted.json<{
      summary: { places: { name: string }[]; routeObjectKey: string };
    }>();
    expect(summary.summary).toMatchObject({
      routeObjectKey: `locations/private-tester/${draftId}/${clipId}/location.json`,
    });
    const stored = await bindings.AUDIO.get(summary.summary.routeObjectKey);
    expect(await stored?.json()).toMatchObject({ route: body.route });

    const writesAfterFirstSave = routeWrite.mock.calls.length;
    const retry = await request(
      `/clips/${clipId}/location`,
      "PUT",
      acceptedBody,
    );
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(summary);
    expect(routeWrite).toHaveBeenCalledTimes(writesAfterFirstSave);
    const draft = await (await request(`/drafts/${draftId}`)).json<{
      clips: { locationSummary?: unknown }[];
    }>();
    expect(draft.clips[0].locationSummary).toEqual(summary.summary);
    expect(
      (
        await request(
          `/clips/${clipId}/location`,
          "GET",
          undefined,
          await firebaseToken("other-owner"),
        )
      ).status,
    ).toBe(404);
  });

  it("rejects location routes larger than 128 KiB", async () => {
    const large = "x".repeat(128 * 1024);
    const response = await handleRequest(
      new Request("https://yoin.test/clips/missing/location", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${testerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ large }),
      }),
      bindings,
    );
    expect(response.status).toBe(413);
  });

  it("stores each memory's selected speakers and freezes only that selection for matching", async () => {
    for (const [id, name] of [
      ["speaker-a", "あおい"],
      ["speaker-b", "れん"],
    ]) {
      await bindings.DB.prepare(
        "INSERT INTO speaker_profiles (id, owner_id, name, sample_id, model_version, embedding_json, created_at) VALUES (?, 'private-tester', ?, ?, 'model-v1', ?, '2026-10-06')",
      )
        .bind(id, name, `${id}-sample`, JSON.stringify([1]))
        .run();
    }

    const selected = await request("/drafts", "POST", {
      id: draftId,
      title: "あおいとの記録",
      createdAt: "2026-10-06T01:00:00Z",
      speakerProfileIds: ["speaker-a"],
    });
    expect(selected.status).toBe(201);
    expect(await selected.json()).toMatchObject({
      speakerProfileIds: ["speaker-a"],
    });
    expect(
      (
        await request("/drafts", "POST", {
          id: "other-memory",
          title: "れんとの記録",
          createdAt: "2026-10-06T02:00:00Z",
          speakerProfileIds: ["speaker-b"],
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await request("/drafts", "POST", {
          id: "invalid-memory",
          title: "未登録の話者",
          createdAt: "2026-10-06T03:00:00Z",
          speakerProfileIds: ["other-owner-speaker"],
        })
      ).status,
    ).toBe(422);

    await bindings.DB.prepare(
      "INSERT INTO clips (id, draft_id, owner_id, mime_type, size_bytes, duration_ms, timezone, object_key, status) VALUES ('selected-clip', ?, 'private-tester', 'audio/mp4', 10, 1000, 'Asia/Tokyo', 'clips/selected', 'uploaded')",
    )
      .bind(draftId)
      .run();
    const prepared = await request(`/drafts/${draftId}/prepare`, "POST", {
      idempotencyKey: "prepare-selected-speaker",
    });
    expect(prepared.status).toBe(202);
    const job = await bindings.DB.prepare(
      "SELECT speaker_snapshot_json AS snapshot FROM jobs WHERE draft_id = ?",
    )
      .bind(draftId)
      .first<{ snapshot: string }>();
    expect(
      JSON.parse(job?.snapshot ?? "[]").map(
        (speaker: { id: string }) => speaker.id,
      ),
    ).toEqual(["speaker-a"]);
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
