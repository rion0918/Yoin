import { env, reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GOOGLE_MODELS } from "../../pipeline/google.ts";
import { handleRequest } from "../api.ts";
import initialSchema from "../migrations/0001_initial.sql?raw";
import runtimeSchema from "../migrations/0002_audio_runtime.sql?raw";
import speakerSchema from "../migrations/0003_speaker_profiles.sql?raw";
import draftSpeakersSchema from "../migrations/0005_draft_speaker_profiles.sql?raw";
import * as providerAdapters from "../providers.ts";
import { sha256 } from "../security.ts";
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
  it("serves the privacy policy without account or storage configuration", async () => {
    const response = await handleRequest(
      new Request("https://yoin.test/privacy"),
      {} as Env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    const text = await response.text();
    expect(text).toContain("Yoin プライバシーポリシー");
    expect(text).toContain("rion.developer.apps@gmail.com");
    expect(text).toContain("画面ロック");
    expect(text).toContain("アカウントを削除");
    expect(text).toContain("ダウンロード（MP3）");
    expect(text).toContain(
      "書き出した曲は、Yoin の思い出・アカウント・アプリを削除しても端末に残ります。",
    );
    const head = await handleRequest(
      new Request("https://yoin.test/privacy", { method: "HEAD" }),
      {} as Env,
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("keeps data routes and non-read privacy requests authenticated", async () => {
    for (const path of [
      "/account",
      "/songs",
      "/drafts/private-draft",
      "/memory-deletions",
    ]) {
      expect((await request(path, "GET", undefined, "wrong")).status).toBe(401);
    }
    expect((await request("/privacy", "POST", {}, "wrong")).status).toBe(401);
  });

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
  it("removes a generation workflow created after memory deletion starts during dispatch", async () => {
    await seedReview({
      id: "block",
      text: "秋の風",
      sourceUtteranceIds: ["clip:u:0:1"],
    });
    let allowCreate!: () => void;
    let signalCreate!: () => void;
    const createStarted = new Promise<void>((resolve) => {
      signalCreate = resolve;
    });
    const createGate = new Promise<void>((resolve) => {
      allowCreate = resolve;
    });
    const remove = vi.fn(async () => {});
    bindings.GENERATE = {
      create: async () => {
        signalCreate();
        await createGate;
        return { delete: remove };
      },
    } as unknown as Env["GENERATE"];
    bindings.DELETE_MEMORY = {
      create: vi.fn(async () => ({ id: "memory-deletion" })),
    } as unknown as Env["DELETE_MEMORY"];

    const generating = request(`/drafts/${draftId}/generate`, "POST", {
      revision: 1,
      idempotencyKey: "memory-deletion-race",
    });
    await createStarted;
    expect((await request(`/drafts/${draftId}`, "DELETE")).status).toBe(202);
    allowCreate();
    await generating;

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

  it("accepts the current owned transcript once and makes duplicate approval idempotent", async () => {
    await request("/drafts", "POST", {
      id: draftId,
      title: "旅",
      createdAt: "2026-10-04T01:00:00Z",
    });
    await bindings.DB.prepare(
      "INSERT INTO clips (id, draft_id, owner_id, mime_type, size_bytes, duration_ms, recorded_at, timezone, object_key, status) VALUES ('clip-review', ?, 'private-tester', 'audio/mp4', 10, 180000, '2026-10-04T01:00:00Z', 'Asia/Tokyo', 'originals/private-tester/clip-review', 'uploaded')",
    )
      .bind(draftId)
      .run();
    const transcript = [
      {
        id: "clip-review:u:100:1",
        clipId: "clip-review",
        startMs: 100,
        endMs: 500,
        speaker: "spk_1",
        text: "出発しよう",
      },
    ];
    await bindings.DB.prepare(
      "INSERT INTO utterances (id, clip_id, start_ms, end_ms, speaker, text) VALUES (?, 'clip-review', 100, 500, 'spk_1', '出発しよう')",
    )
      .bind(transcript[0].id)
      .run();
    const fingerprint = await sha256(JSON.stringify(transcript));
    await bindings.DB.prepare(
      "INSERT INTO jobs (id, owner_id, draft_id, kind, idempotency_key, fingerprint, status, stage, transcript_fingerprint, created_at) VALUES ('prepare-review', 'private-tester', ?, 'prepare', 'review-key', 'input', 'needs_audio_review', 'review_audio', ?, '2026-10-04')",
    )
      .bind(draftId, fingerprint)
      .run();
    await bindings.DB.prepare(
      "UPDATE drafts SET status = 'needs_audio_review', job_id = 'prepare-review' WHERE id = ?",
    )
      .bind(draftId)
      .run();
    const sendEvent = vi.fn(async () => {});
    bindings.PREPARE = {
      get: vi.fn(async () => ({ sendEvent })),
    } as unknown as Env["PREPARE"];

    const first = await request(
      `/drafts/${draftId}/transcript-review`,
      "POST",
      {
        jobId: "prepare-review",
        transcriptFingerprint: fingerprint,
      },
    );
    await bindings.DB.prepare(
      "UPDATE jobs SET status = 'running' WHERE id = 'prepare-review'",
    ).run();
    const duplicate = await request(
      `/drafts/${draftId}/transcript-review`,
      "POST",
      { jobId: "prepare-review", transcriptFingerprint: fingerprint },
    );

    expect(first.status).toBe(202);
    expect(duplicate.status).toBe(200);
    expect(sendEvent).toHaveBeenCalledOnce();
    expect(sendEvent).toHaveBeenCalledWith({
      type: "audio-transcript-review",
      payload: { transcriptFingerprint: fingerprint },
    });
  });

  it("saves selected speaker assignments before approving the transcript", async () => {
    const profiles = [
      { id: "speaker-a", name: "あおい" },
      { id: "speaker-b", name: "れん" },
      { id: "speaker-c", name: "みな" },
    ];
    for (const profile of profiles)
      await bindings.DB.prepare(
        "INSERT INTO speaker_profiles (id, owner_id, name, sample_id, model_version, embedding_json, created_at) VALUES (?, 'private-tester', ?, ?, 'model-v1', ?, '2026-10-13')",
      )
        .bind(
          profile.id,
          profile.name,
          `${profile.id}-sample`,
          JSON.stringify([1]),
        )
        .run();
    await request("/drafts", "POST", {
      id: draftId,
      title: "旅",
      createdAt: "2026-10-04T01:00:00Z",
      speakerProfileIds: ["speaker-a", "speaker-b"],
    });
    await bindings.DB.prepare(
      "INSERT INTO clips (id, draft_id, owner_id, mime_type, size_bytes, duration_ms, recorded_at, timezone, object_key, status) VALUES ('clip-review', ?, 'private-tester', 'audio/mp4', 10, 180000, '2026-10-04T01:00:00Z', 'Asia/Tokyo', 'originals/private-tester/clip-review', 'uploaded')",
    )
      .bind(draftId)
      .run();
    const transcript = Array.from({ length: 60 }, (_, index) => {
      const startMs = 100 + index * 2000;
      return {
        id: `clip-review:u:${startMs}:1`,
        clipId: "clip-review",
        startMs,
        endMs: startMs + 1000,
        speaker: index % 2 ? "unknown" : "話者 1",
        text: `発話${index + 1}`,
      };
    });
    for (const item of transcript)
      await bindings.DB.prepare(
        "INSERT INTO utterances (id, clip_id, start_ms, end_ms, speaker, text) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind(
          item.id,
          item.clipId,
          item.startMs,
          item.endMs,
          item.speaker,
          item.text,
        )
        .run();
    const originalFingerprint = await sha256(JSON.stringify(transcript));
    const snapshot = profiles.slice(0, 2).map((profile) => ({
      ...profile,
      modelVersion: "model-v1",
      embedding: [1],
    }));
    await bindings.DB.prepare(
      "INSERT INTO jobs (id, owner_id, draft_id, kind, idempotency_key, fingerprint, status, stage, transcript_fingerprint, speaker_snapshot_json, created_at) VALUES ('prepare-review', 'private-tester', ?, 'prepare', 'review-key', 'input', 'needs_audio_review', 'review_audio', ?, ?, '2026-10-04')",
    )
      .bind(draftId, originalFingerprint, JSON.stringify(snapshot))
      .run();
    await bindings.DB.prepare(
      "UPDATE drafts SET status = 'needs_audio_review', job_id = 'prepare-review' WHERE id = ?",
    )
      .bind(draftId)
      .run();
    const sendEvent = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary workflow dispatch failure"))
      .mockResolvedValue(undefined);
    bindings.PREPARE = {
      get: vi.fn(async () => ({ sendEvent })),
    } as unknown as Env["PREPARE"];
    const assignments = transcript.map((item, index) => ({
      utteranceId: item.id,
      speakerProfileId: index % 2 ? "speaker-b" : "speaker-a",
    }));
    const batch = vi.spyOn(bindings.DB, "batch");

    const response = await request(
      `/drafts/${draftId}/transcript-review`,
      "POST",
      {
        jobId: "prepare-review",
        transcriptFingerprint: originalFingerprint,
        assignments,
      },
    );
    expect(response.status).toBe(500);
    const reviewed = await (await request(`/drafts/${draftId}`)).json<{
      utterances: Array<Record<string, unknown>>;
    }>();
    const reviewedFingerprint = await sha256(
      JSON.stringify(reviewed.utterances),
    );
    const savedJob = await bindings.DB.prepare(
      "SELECT transcript_fingerprint AS fingerprint FROM jobs WHERE id = 'prepare-review'",
    ).first<{ fingerprint: string }>();

    expect(reviewed.utterances).toEqual(
      transcript.map((item, index) => ({
        ...item,
        speakerProfileId: index % 2 ? "speaker-b" : "speaker-a",
        speakerName: index % 2 ? "れん" : "あおい",
      })),
    );
    expect(savedJob?.fingerprint).toBe(reviewedFingerprint);

    const retry = await request(
      `/drafts/${draftId}/transcript-review`,
      "POST",
      {
        jobId: "prepare-review",
        transcriptFingerprint: reviewedFingerprint,
        assignments,
      },
    );
    expect(retry.status).toBe(200);
    expect(sendEvent).toHaveBeenCalledTimes(2);
    expect(sendEvent).toHaveBeenLastCalledWith({
      type: "audio-transcript-review",
      payload: { transcriptFingerprint: reviewedFingerprint },
    });
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0]?.[0]).toHaveLength(2);

    await bindings.DB.prepare(
      "UPDATE jobs SET status = 'running' WHERE id = 'prepare-review'",
    ).run();
    const duplicate = await request(
      `/drafts/${draftId}/transcript-review`,
      "POST",
      {
        jobId: "prepare-review",
        transcriptFingerprint: originalFingerprint,
        assignments,
      },
    );
    expect(duplicate.status).toBe(200);
    expect(sendEvent).toHaveBeenCalledTimes(2);
  });

  it("rejects stale transcript review and assignments outside the selected participants", async () => {
    for (const [id, name] of [
      ["speaker-a", "あおい"],
      ["speaker-b", "れん"],
    ])
      await bindings.DB.prepare(
        "INSERT INTO speaker_profiles (id, owner_id, name, sample_id, model_version, embedding_json, created_at) VALUES (?, 'private-tester', ?, ?, 'model-v1', ?, '2026-10-13')",
      )
        .bind(id, name, `${id}-sample`, JSON.stringify([1]))
        .run();
    await request("/drafts", "POST", {
      id: draftId,
      title: "旅",
      createdAt: "2026-10-04T01:00:00Z",
      speakerProfileIds: ["speaker-a"],
    });
    await bindings.DB.prepare(
      "INSERT INTO clips (id, draft_id, owner_id, mime_type, size_bytes, duration_ms, recorded_at, timezone, object_key, status) VALUES ('clip-review', ?, 'private-tester', 'audio/mp4', 10, 180000, '2026-10-04T01:00:00Z', 'Asia/Tokyo', 'originals/private-tester/clip-review', 'uploaded')",
    )
      .bind(draftId)
      .run();
    const transcript = [
      {
        id: "clip-review:u:100:1",
        clipId: "clip-review",
        startMs: 100,
        endMs: 1200,
        speaker: "unknown",
        text: "駅に着いたよ",
      },
    ];
    await bindings.DB.prepare(
      "INSERT INTO utterances (id, clip_id, start_ms, end_ms, speaker, text) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(
        transcript[0].id,
        transcript[0].clipId,
        transcript[0].startMs,
        transcript[0].endMs,
        transcript[0].speaker,
        transcript[0].text,
      )
      .run();
    const fingerprint = await sha256(JSON.stringify(transcript));
    await bindings.DB.prepare(
      "INSERT INTO jobs (id, owner_id, draft_id, kind, idempotency_key, fingerprint, status, stage, transcript_fingerprint, speaker_snapshot_json, created_at) VALUES ('prepare-review', 'private-tester', ?, 'prepare', 'review-key', 'input', 'needs_audio_review', 'review_audio', ?, ?, '2026-10-04')",
    )
      .bind(
        draftId,
        fingerprint,
        JSON.stringify([
          {
            id: "speaker-a",
            name: "あおい",
            modelVersion: "model-v1",
            embedding: [1],
          },
        ]),
      )
      .run();
    await bindings.DB.prepare(
      "UPDATE drafts SET status = 'needs_audio_review', job_id = 'prepare-review' WHERE id = ?",
    )
      .bind(draftId)
      .run();
    const sendEvent = vi.fn(async () => {});
    bindings.PREPARE = {
      get: vi.fn(async () => ({ sendEvent })),
    } as unknown as Env["PREPARE"];

    const unselected = await request(
      `/drafts/${draftId}/transcript-review`,
      "POST",
      {
        jobId: "prepare-review",
        transcriptFingerprint: fingerprint,
        assignments: [
          { utteranceId: transcript[0].id, speakerProfileId: "speaker-b" },
        ],
      },
    );
    expect(unselected.status).toBe(422);
    await bindings.DB.prepare(
      "UPDATE utterances SET text = '時刻のあとで変更された発話' WHERE id = ?",
    )
      .bind(transcript[0].id)
      .run();
    const stale = await request(
      `/drafts/${draftId}/transcript-review`,
      "POST",
      {
        jobId: "prepare-review",
        transcriptFingerprint: fingerprint,
        assignments: [
          { utteranceId: transcript[0].id, speakerProfileId: "speaker-a" },
        ],
      },
    );

    expect(stale.status).toBe(409);
    expect(sendEvent).not.toHaveBeenCalled();
    expect(
      await bindings.DB.prepare(
        "SELECT speaker_profile_id AS profileId, speaker_name AS name FROM utterances WHERE id = ?",
      )
        .bind(transcript[0].id)
        .first(),
    ).toEqual({ profileId: null, name: null });
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
      songTitle: "夜明け前",
    });
    const retry = await request(`/drafts/${draftId}/generate`, "POST", {
      revision: 1,
      idempotencyKey: "generation-key",
      songTitle: "夜明け前",
    });
    expect(first.status).toBe(202);
    const submitted = await first.json<{ jobId: string }>();
    expect(await retry.json()).toEqual(submitted);
    expect(
      (
        await request(`/drafts/${draftId}/generate`, "POST", {
          revision: 1,
          idempotencyKey: "generation-key",
          songTitle: "別の曲名",
        })
      ).status,
    ).toBe(409);
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
      "SELECT lyric_revision, blocks_json, song_title FROM jobs WHERE id = ?",
    )
      .bind(submitted.jobId)
      .first();
    expect(frozen).toEqual({
      lyric_revision: 1,
      blocks_json: JSON.stringify([block]),
      song_title: "夜明け前",
    });
  });

  it("reuses a submitted generation job created before song titles were stored", async () => {
    const block = {
      id: "verse-1",
      text: "秋の風",
      sourceUtteranceIds: ["clip:u:0:1"],
    };
    await seedReview(block);
    const blocks = JSON.stringify([block]);
    const legacyFingerprint = await sha256(
      JSON.stringify({ draftId, revision: 1, blocks }),
    );
    await bindings.DB.prepare(
      "INSERT INTO jobs (id, owner_id, draft_id, kind, idempotency_key, fingerprint, status, stage, lyric_revision, blocks_json, created_at) VALUES ('legacy-job', 'private-tester', ?, 'generate', 'legacy-key', ?, 'running', 'generate_music', 1, ?, '2026-10-04')",
    )
      .bind(draftId, legacyFingerprint, blocks)
      .run();
    const response = await request(`/drafts/${draftId}/generate`, "POST", {
      revision: 1,
      idempotencyKey: "legacy-key",
      songTitle: "旅",
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ jobId: "legacy-job" });
    expect(
      (await bindings.DB.prepare("SELECT id FROM jobs").all()).results,
    ).toEqual([{ id: "legacy-job" }]);
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

describe("saved transcription recovery", () => {
  async function seedSavedResponse(withRaw = true) {
    const key = "processed/private-tester/recover-job/recover-clip/0.m4a";
    await bindings.AUDIO.put(
      "originals/private-tester/recover-clip",
      new Uint8Array([1, 2, 3]),
    );
    await bindings.AUDIO.put(key, new Uint8Array([4, 5, 6]));
    const source = await bindings.AUDIO.head(
      "originals/private-tester/recover-clip",
    );
    const chunk = await bindings.AUDIO.head(key);
    const inspection = {
      durationMs: 90000,
      sizeBytes: 3,
      sourceEtag: source?.httpEtag,
      transformVersion: 1,
      chunks: [{ key, offsetMs: 0, durationMs: 90000, mimeType: "audio/mp4" }],
    };
    const fingerprint = await sha256(
      JSON.stringify({
        sourceEtag: inspection.sourceEtag,
        sourceSizeBytes: 3,
        transformVersion: 1,
        chunkEtag: chunk?.etag,
        chunkSizeBytes: chunk?.size,
        offsetMs: 0,
        durationMs: 90000,
        model: GOOGLE_MODELS.transcribe,
        language: "ja-JP",
        timestampGranularities: ["WORD"],
      }),
    );
    const attemptId = `stt-recover-clip-0-${fingerprint.slice(0, 24)}`;
    await bindings.DB.prepare(
      "INSERT INTO drafts (id, owner_id, title, created_at, status, job_id) VALUES (?, 'private-tester', '公開音声', '2026-10-12', 'needs_reconciliation', 'recover-job')",
    )
      .bind(draftId)
      .run();
    await bindings.DB.prepare(
      "INSERT INTO clips (id, draft_id, owner_id, mime_type, size_bytes, duration_ms, timezone, object_key, status, inspection_json) VALUES ('recover-clip', ?, 'private-tester', 'audio/mp4', 3, 90000, 'Asia/Tokyo', 'originals/private-tester/recover-clip', 'uploaded', ?)",
    )
      .bind(draftId, JSON.stringify(inspection))
      .run();
    await bindings.DB.prepare(
      "INSERT INTO jobs (id, owner_id, draft_id, kind, idempotency_key, fingerprint, status, stage, created_at) VALUES ('recover-job', 'private-tester', ?, 'prepare', 'recover-key', 'input', 'needs_reconciliation', 'stopped', '2026-10-12')",
    )
      .bind(draftId)
      .run();
    await bindings.DB.prepare(
      "INSERT INTO provider_attempts (id, job_id, owner_id, stage, status, amount_micros, runtime_claimed_at, created_at) VALUES (?, 'recover-job', 'private-tester', 'transcribe', 'needs_reconciliation', 600000, '2026-10-12', '2026-10-12')",
    )
      .bind(attemptId)
      .run();
    if (withRaw)
      await bindings.AUDIO.put(
        `results/private-tester/${attemptId}.raw.json`,
        JSON.stringify({ status: "completed" }),
      );
    const restart = vi.fn(async () => {});
    bindings.PREPARE = {
      get: async () => ({ restart }),
    } as unknown as Env["PREPARE"];
    const recover = vi
      .spyOn(providerAdapters, "recoverTranscription")
      .mockImplementation(async (runtime, attempt, input) => {
        const output = {
          value: [
            {
              id: "recover-clip:unverified:0",
              clipId: input.clipId,
              startMs: 0,
              endMs: input.durationMs,
              speaker: "話者未確認",
              text: "全文",
              timingIssues: [
                {
                  text: "へ",
                  startOffset: "3.900s",
                  endOffset: "1.100s",
                  chunkOffsetMs: 0,
                },
              ],
            },
          ],
          costUsd: 0.008036,
          usage: {},
        };
        await runtime.AUDIO.put(
          `results/private-tester/${attempt}.json`,
          JSON.stringify({ version: 1, ...output }),
        );
        return output;
      });
    return { attemptId, recover, restart };
  }
  it("reuses the original claimed attempt and reservation before restarting preparation", async () => {
    const { attemptId, recover, restart } = await seedSavedResponse();
    const result = await request(
      `/drafts/${draftId}/recover-transcription`,
      "POST",
    );
    expect(result.status).toBe(202);
    expect(recover).toHaveBeenCalledWith(bindings, attemptId, {
      clipId: "recover-clip",
      offsetMs: 0,
      durationMs: 90000,
    });
    expect(restart).toHaveBeenCalledOnce();
    expect(
      await bindings.DB.prepare(
        "SELECT status, amount_micros FROM provider_attempts WHERE id = ?",
      )
        .bind(attemptId)
        .first(),
    ).toMatchObject({ status: "needs_reconciliation", amount_micros: 600000 });
    expect(
      await bindings.DB.prepare(
        "SELECT COUNT(*) AS count FROM provider_attempts",
      ).first(),
    ).toMatchObject({ count: 1 });
    expect(
      await bindings.DB.prepare(
        "SELECT status FROM jobs WHERE id = 'recover-job'",
      ).first(),
    ).toMatchObject({ status: "queued" });
  });

  it("offers recovery only for a claimed transcription with a saved response", async () => {
    const { attemptId } = await seedSavedResponse();
    expect(await (await request(`/drafts/${draftId}`)).json()).toMatchObject({
      transcriptRecoveryAvailable: true,
    });
    await bindings.DB.prepare(
      "UPDATE provider_attempts SET stage = 'lyrics' WHERE id = ?",
    )
      .bind(attemptId)
      .run();
    expect(await (await request(`/drafts/${draftId}`)).json()).toMatchObject({
      transcriptRecoveryAvailable: false,
    });
    await bindings.DB.prepare(
      "UPDATE provider_attempts SET stage = 'transcribe' WHERE id = ?",
    )
      .bind(attemptId)
      .run();
    await bindings.AUDIO.delete(`results/private-tester/${attemptId}.raw.json`);
    expect(await (await request(`/drafts/${draftId}`)).json()).toMatchObject({
      transcriptRecoveryAvailable: false,
    });
  });
  it("rejects another account's draft without reading or recovering its response", async () => {
    const { recover, restart } = await seedSavedResponse();
    const alice = await firebaseToken("alice");
    expect(
      (
        await request(
          `/drafts/${draftId}/recover-transcription`,
          "POST",
          undefined,
          alice,
        )
      ).status,
    ).toBe(404);
    expect(recover).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });
  it("reuses a recovered result after a failed workflow restart", async () => {
    const { recover, restart } = await seedSavedResponse();
    restart.mockRejectedValueOnce(new Error("temporary dispatch failure"));
    expect(
      (await request(`/drafts/${draftId}/recover-transcription`, "POST"))
        .status,
    ).toBe(500);
    expect(
      await bindings.DB.prepare(
        "SELECT status FROM jobs WHERE id = 'recover-job'",
      ).first(),
    ).toMatchObject({ status: "needs_reconciliation" });
    expect(
      (await request(`/drafts/${draftId}/recover-transcription`, "POST"))
        .status,
    ).toBe(202);
    expect(recover).toHaveBeenCalledOnce();
    expect(restart).toHaveBeenCalledTimes(2);
  });
  it("does not restart if account deletion begins during recovery", async () => {
    const { recover, restart } = await seedSavedResponse();
    recover.mockImplementationOnce(async () => {
      await bindings.DB.prepare(
        "INSERT INTO accounts (uid, status) VALUES ('private-tester', 'deleting')",
      ).run();
      return { value: [], costUsd: 0.008036, usage: {} };
    });
    expect(
      (await request(`/drafts/${draftId}/recover-transcription`, "POST"))
        .status,
    ).toBe(403);
    expect(restart).not.toHaveBeenCalled();
    expect(
      await bindings.DB.prepare(
        "SELECT amount_micros FROM budget_ledger",
      ).first(),
    ).toMatchObject({ amount_micros: 600000 });
  });
  it("keeps the reservation when the saved response is missing", async () => {
    const { recover, restart } = await seedSavedResponse(false);
    expect(
      (await request(`/drafts/${draftId}/recover-transcription`, "POST"))
        .status,
    ).toBe(409);
    expect(recover).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
    expect(
      await bindings.DB.prepare(
        "SELECT status, amount_micros FROM budget_ledger",
      ).first(),
    ).toMatchObject({ status: "needs_reconciliation", amount_micros: 600000 });
  });
  it("rejects recovery after the original source has changed", async () => {
    const { recover, restart } = await seedSavedResponse();
    await bindings.AUDIO.put(
      "originals/private-tester/recover-clip",
      new Uint8Array([9, 9, 9]),
    );
    expect(
      (await request(`/drafts/${draftId}/recover-transcription`, "POST"))
        .status,
    ).toBe(409);
    expect(recover).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });
  it("does not restart a preparation that another request is already recovering", async () => {
    const { recover, restart } = await seedSavedResponse();
    await bindings.DB.prepare(
      "UPDATE jobs SET status = 'running', stage = 'recovering_transcription' WHERE id = 'recover-job'",
    ).run();
    expect(
      (await request(`/drafts/${draftId}/recover-transcription`, "POST"))
        .status,
    ).toBe(409);
    expect(recover).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });
});

it("freezes readings and musical settings and deduplicates reading jobs", async () => {
  const block = {
    id: "verse",
    text: "三宮",
    section: "verse",
    sourceUtteranceIds: ["clip:u:0:1"],
  };
  await seedReview(block);
  await bindings.DB.prepare(
    "UPDATE lyric_revisions SET generation_version = 2, music_preferences_json = ?",
  )
    .bind(JSON.stringify({ genre: "jpop", vocal: "female" }))
    .run();
  const dispatch = vi.fn(async (_input: { id: string }) => ({
    delete: async () => {},
  }));
  bindings.PREPARE = { create: dispatch } as unknown as Env["PREPARE"];
  const first = await request(`/drafts/${draftId}/readings`, "POST", {
    revision: 1,
    idempotencyKey: "read-key",
  });
  expect(first.status).toBe(202);
  const retry = await request(`/drafts/${draftId}/readings`, "POST", {
    revision: 1,
    idempotencyKey: "read-key",
  });
  expect(await retry.json()).toEqual(await first.json());
  const job = await bindings.DB.prepare(
    "SELECT kind, blocks_json, generation_version, music_preferences_json FROM jobs WHERE idempotency_key = 'read-key'",
  ).first();
  expect(job).toMatchObject({
    kind: "readings",
    generation_version: 2,
    music_preferences_json: JSON.stringify({ genre: "jpop", vocal: "female" }),
  });
  expect(JSON.parse(String(job?.blocks_json))).toEqual([block]);
  expect(
    new Set(dispatch.mock.calls.map((call) => (call[0] as { id: string }).id))
      .size,
  ).toBe(1);
  expect(
    (
      await request(`/drafts/${draftId}/lyrics`, "PATCH", {
        revision: 1,
        blocks: [block],
      })
    ).status,
  ).toBe(409);
});
it("rejects new generation with missing readings before dispatch or spending", async () => {
  await seedReview({
    id: "verse",
    text: "三宮",
    sourceUtteranceIds: ["clip:u:0:1"],
  });
  await bindings.DB.prepare(
    "UPDATE lyric_revisions SET generation_version = 2, music_preferences_json = ?",
  )
    .bind(JSON.stringify({ genre: "acoustic", vocal: "auto" }))
    .run();
  expect(
    (
      await request(`/drafts/${draftId}/generate`, "POST", {
        revision: 1,
        idempotencyKey: "generate-new",
      })
    ).status,
  ).toBe(422);
  expect(
    (await bindings.DB.prepare("SELECT COUNT(*) AS n FROM jobs").first())?.n,
  ).toBe(0);
  expect(
    (
      await bindings.DB.prepare(
        "SELECT COUNT(*) AS n FROM budget_ledger",
      ).first()
    )?.n,
  ).toBe(0);
});
it("retains music settings while accepting a manual reading correction", async () => {
  const block = {
    id: "verse",
    text: "三宮",
    section: "verse",
    singingText: "さんのみや",
    sourceUtteranceIds: ["clip:u:0:1"],
  };
  await seedReview(block);
  await bindings.DB.prepare(
    "UPDATE lyric_revisions SET generation_version = 2, music_preferences_json = ?",
  )
    .bind(JSON.stringify({ genre: "bossa", vocal: "male" }))
    .run();
  const saved = await request(`/drafts/${draftId}/lyrics`, "PATCH", {
    revision: 1,
    blocks: [{ ...block, singingText: "サンノミヤ" }],
  });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({
    revision: 2,
    generationVersion: 2,
    musicPreferences: { genre: "bossa", vocal: "male" },
    blocks: [{ ...block, singingText: "サンノミヤ" }],
  });
  bindings.GENERATE = { create: vi.fn() } as unknown as Env["GENERATE"];
  expect(
    (
      await request(`/drafts/${draftId}/generate`, "POST", {
        revision: 2,
        idempotencyKey: "manual-ready",
      })
    ).status,
  ).toBe(202);
  expect(
    await bindings.DB.prepare(
      "SELECT generation_version, music_preferences_json FROM jobs WHERE idempotency_key = 'manual-ready'",
    ).first(),
  ).toEqual({
    generation_version: 2,
    music_preferences_json: JSON.stringify({ genre: "bossa", vocal: "male" }),
  });
});
it("freezes preparation settings and rejects a changed retry without a second job", async () => {
  await seedReview({
    id: "v",
    text: "三宮",
    sourceUtteranceIds: ["clip:u:0:1"],
  });
  await bindings.DB.prepare(
    "UPDATE drafts SET status = 'uploading', lyric_revision = 0 WHERE id = ?",
  )
    .bind(draftId)
    .run();
  bindings.PREPARE = { create: vi.fn() } as unknown as Env["PREPARE"];
  const body = {
    idempotencyKey: "prepare-modern",
    musicPreferences: { genre: "rock", vocal: "male" },
  };
  expect(
    (await request(`/drafts/${draftId}/prepare`, "POST", body)).status,
  ).toBe(202);
  expect(
    (
      await request(`/drafts/${draftId}/prepare`, "POST", {
        ...body,
        musicPreferences: { genre: "piano", vocal: "female" },
      })
    ).status,
  ).toBe(409);
  expect(
    await bindings.DB.prepare(
      "SELECT generation_version, music_preferences_json, speaker_matching_config_json FROM jobs WHERE idempotency_key = 'prepare-modern'",
    ).first(),
  ).toEqual({
    generation_version: 2,
    music_preferences_json: JSON.stringify(body.musicPreferences),
    speaker_matching_config_json: JSON.stringify(
      (await import("../../shared/speaker-matching.ts"))
        .SPEAKER_MATCHING_CONFIG,
    ),
  });
});

it("recovers a lost completed reading acknowledgement using the original revision and key", async () => {
  const block = {
    id: "verse",
    text: "三宮",
    section: "verse",
    sourceUtteranceIds: ["clip:u:0:1"],
  };
  await seedReview(block);
  const preferences = JSON.stringify({ genre: "acoustic", vocal: "auto" });
  await bindings.DB.prepare(
    "UPDATE lyric_revisions SET generation_version = 2, music_preferences_json = ?",
  )
    .bind(preferences)
    .run();
  bindings.PREPARE = { create: vi.fn() } as unknown as Env["PREPARE"];
  const body = { revision: 1, idempotencyKey: "lost-reading-ack" };
  const first = await request(`/drafts/${draftId}/readings`, "POST", body);
  const result = await first.json<{ jobId: string }>();
  await bindings.DB.prepare(
    "INSERT INTO lyric_revisions (draft_id, revision, blocks_json, created_at, generation_version, music_preferences_json) VALUES (?, 2, ?, '2026-10-12', 2, ?)",
  )
    .bind(
      draftId,
      JSON.stringify([{ ...block, singingText: "さんのみや" }]),
      preferences,
    )
    .run();
  await bindings.DB.prepare(
    "UPDATE drafts SET lyric_revision = 2, status = 'waiting_review' WHERE id = ?",
  )
    .bind(draftId)
    .run();
  await bindings.DB.prepare(
    "UPDATE jobs SET status = 'waiting_review' WHERE id = ?",
  )
    .bind(result.jobId)
    .run();
  const recovered = await request(`/drafts/${draftId}/readings`, "POST", body);
  expect(recovered.status).toBe(202);
  expect(await recovered.json()).toEqual(result);
  expect(
    (
      await request(`/drafts/${draftId}/readings`, "POST", {
        ...body,
        idempotencyKey: "different-key",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await bindings.DB.prepare(
        "SELECT COUNT(*) AS n FROM jobs WHERE kind = 'readings'",
      ).first()
    )?.n,
  ).toBe(1);
});

it("corrects and clears automatic speaker candidates atomically and rejects a competing review", async () => {
  await request("/drafts", "POST", {
    id: draftId,
    title: "会話",
    createdAt: "2026-10-13T00:00:00Z",
  });
  await bindings.DB.prepare(
    "INSERT INTO clips (id,draft_id,owner_id,mime_type,size_bytes,duration_ms,timezone,object_key,status) VALUES ('review-clip',?,'private-tester','audio/mp4',10,10000,'Asia/Tokyo','originals/private-tester/review-clip','uploaded')",
  )
    .bind(draftId)
    .run();
  for (const id of ["u1", "u2"])
    await bindings.DB.prepare(
      "INSERT INTO utterances (id,clip_id,start_ms,end_ms,speaker,text,speaker_profile_id,speaker_name) VALUES (?,'review-clip',100,500,'unknown','こんにちは','a','あおい')",
    )
      .bind(id)
      .run();
  const { utterances } = await import("../database.ts");
  const fingerprint = await sha256(
    JSON.stringify(await utterances(bindings, draftId, "private-tester")),
  );
  const snapshot = [
    { id: "a", name: "あおい", modelVersion: "model", embedding: [1] },
    { id: "b", name: "れん", modelVersion: "model", embedding: [1] },
  ];
  await bindings.DB.prepare(
    "INSERT INTO jobs (id,owner_id,draft_id,kind,idempotency_key,fingerprint,status,stage,transcript_fingerprint,speaker_snapshot_json,created_at) VALUES ('review-job','private-tester',?,'prepare','review','input','needs_audio_review','review_audio',?,?,'2026-10-13')",
  )
    .bind(draftId, fingerprint, JSON.stringify(snapshot))
    .run();
  await bindings.DB.prepare(
    "UPDATE drafts SET job_id='review-job',status='needs_audio_review' WHERE id=?",
  )
    .bind(draftId)
    .run();
  const sendEvent = vi.fn(async () => {});
  bindings.PREPARE = {
    get: vi.fn(async () => ({ sendEvent })),
  } as unknown as Env["PREPARE"];
  const body = {
    jobId: "review-job",
    transcriptFingerprint: fingerprint,
    assignments: [
      { utteranceId: "u1", speakerProfileId: "b" },
      { utteranceId: "u2", speakerProfileId: null },
    ],
  };
  expect(
    (await request(`/drafts/${draftId}/transcript-review`, "POST", body))
      .status,
  ).toBe(202);
  const result = await utterances(bindings, draftId, "private-tester");
  expect(result[0]?.speakerProfileId).toBe("b");
  expect(result[1]?.speakerProfileId).toBeUndefined();
  expect(
    (await request(`/drafts/${draftId}/transcript-review`, "POST", body))
      .status,
  ).toBe(200);
  expect(
    (
      await request(`/drafts/${draftId}/transcript-review`, "POST", {
        ...body,
        assignments: [{ utteranceId: "u1", speakerProfileId: "a" }],
      })
    ).status,
  ).toBe(409);
  await bindings.DB.prepare(
    "UPDATE utterances SET speaker='話者未確認',timing_issues_json=? WHERE id='u2'",
  )
    .bind(
      JSON.stringify([
        {
          text: "語",
          startOffset: "3.9s",
          endOffset: "1.1s",
          chunkOffsetMs: 0,
        },
      ]),
    )
    .run();
  const nextFingerprint = await sha256(
    JSON.stringify(await utterances(bindings, draftId, "private-tester")),
  );
  await bindings.DB.prepare(
    "UPDATE jobs SET transcript_reviewed_at=NULL,transcript_fingerprint=? WHERE id='review-job'",
  )
    .bind(nextFingerprint)
    .run();
  for (const profile of ["a", null])
    expect(
      (
        await request(`/drafts/${draftId}/transcript-review`, "POST", {
          jobId: "review-job",
          transcriptFingerprint: nextFingerprint,
          assignments: [{ utteranceId: "u2", speakerProfileId: profile }],
        })
      ).status,
    ).toBe(422);
  const competing = await Promise.all(
    ["a", "b"].map((profile) =>
      request(`/drafts/${draftId}/transcript-review`, "POST", {
        jobId: "review-job",
        transcriptFingerprint: nextFingerprint,
        assignments: [{ utteranceId: "u1", speakerProfileId: profile }],
      }),
    ),
  );
  expect(competing.map((response) => response.status).sort()).toEqual([
    202, 409,
  ]);
});

it("exposes recovery and restarts only the same settled music job through the owned API", async () => {
  const block = {
    id: "verse",
    text: "朝の道",
    sourceUtteranceIds: ["clip:u:0:1"],
    section: "verse",
    singingText: "あさのみち",
  };
  await seedReview(block);
  const preferences = JSON.stringify({ genre: "acoustic", vocal: "auto" });
  await bindings.DB.prepare(
    "UPDATE lyric_revisions SET generation_version=2,music_preferences_json=?",
  )
    .bind(preferences)
    .run();
  await bindings.DB.prepare(
    "INSERT INTO jobs (id,owner_id,draft_id,kind,idempotency_key,fingerprint,status,stage,error,lyric_revision,blocks_json,generation_version,music_preferences_json,created_at) VALUES ('music-recover','private-tester',?,'generate','key','approved','needs_reconciliation','check_generated_lyrics','generated_lyrics_differ',1,?,2,?,'2026-10-13')",
  )
    .bind(draftId, JSON.stringify([block]), preferences)
    .run();
  await bindings.DB.prepare(
    "UPDATE drafts SET job_id='music-recover',status='needs_reconciliation' WHERE id=?",
  )
    .bind(draftId)
    .run();
  const saved = {
    audioId: "music-audio",
    key: "songs/private-tester/music-recover.mp3",
    mimeType: "audio/mpeg",
    sizeBytes: 3,
    returnedLyrics: "[[A0]]あさのみち",
  };
  await bindings.AUDIO.put(saved.key, new Uint8Array([1, 2, 3]));
  await bindings.DB.prepare(
    "INSERT INTO audio_objects (id,owner_id,draft_id,object_key,mime_type,size_bytes,duration_ms,kind) VALUES ('music-audio','private-tester',?,?,'audio/mpeg',3,0,'song')",
  )
    .bind(draftId, saved.key)
    .run();
  await bindings.DB.prepare(
    "INSERT INTO provider_attempts (id,job_id,owner_id,stage,status,amount_micros,created_at) VALUES ('music-music-recover','music-recover','private-tester','music','succeeded',80000,'2026-10-13')",
  ).run();
  await bindings.AUDIO.put(
    "results/private-tester/music-music-recover.json",
    JSON.stringify({ version: 1, value: saved, costUsd: 0.08 }),
  );
  const restart = vi.fn(async () => {});
  bindings.GENERATE = {
    get: vi.fn(async () => ({ restart })),
  } as unknown as Env["GENERATE"];
  expect(await (await request(`/drafts/${draftId}`)).json()).toMatchObject({
    jobKind: "generate",
    jobStage: "check_generated_lyrics",
    musicRecoveryAvailable: true,
  });
  for (let i = 0; i < 2; i++)
    expect(
      (
        await request(`/drafts/${draftId}/recover-music`, "POST", {
          jobId: "music-recover",
        })
      ).status,
    ).toBe(202);
  expect(restart).toHaveBeenCalledOnce();
  expect(
    (
      await request(`/drafts/${draftId}/recover-music`, "POST", {
        jobId: "other-job",
      })
    ).status,
  ).toBe(404);
  await bindings.DB.prepare(
    "UPDATE jobs SET status='needs_reconciliation' WHERE id='music-recover'",
  ).run();
  await bindings.DB.prepare(
    "UPDATE provider_attempts SET status='needs_reconciliation' WHERE id='music-music-recover'",
  ).run();
  expect(
    (
      await request(`/drafts/${draftId}/recover-music`, "POST", {
        jobId: "music-recover",
      })
    ).status,
  ).toBe(409);
  expect(restart).toHaveBeenCalledOnce();
});
