import { env, reset } from "cloudflare:test";
import type { WorkflowStep } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { draftDocument, ownedJob, songDocument } from "../database.ts";
import { identifySpeakersInChunk, inspectClip, probeSong } from "../media.ts";
import initialSchema from "../migrations/0001_initial.sql?raw";
import runtimeSchema from "../migrations/0002_audio_runtime.sql?raw";
import speakerSchema from "../migrations/0003_speaker_profiles.sql?raw";
import { createLyrics, generateMusic, transcribeAudio } from "../providers.ts";

const schema = `${initialSchema}\n${runtimeSchema}\n${speakerSchema}`;

import type { Env } from "../types.ts";
import { generateSong, prepareDraft } from "../workflows.ts";

vi.mock("../providers.ts", async (original) => ({
  ...(await original<typeof import("../providers.ts")>()),
  transcribeAudio: vi.fn(),
  createLyrics: vi.fn(),
  generateMusic: vi.fn(),
}));
vi.mock("../media.ts", () => ({
  identifySpeakersInChunk: vi.fn(),
  inspectClip: vi.fn(),
  probeSong: vi.fn(),
}));

afterEach(() => vi.restoreAllMocks());

let bindings: Env;
const blocks = [
  {
    id: "verse-1",
    text: "あの坂道を また歩こう",
    sourceUtteranceIds: ["clip:u:100:1", "clip:u:1500100:1"],
  },
];
const step = {
  do: async (
    _name: string,
    options: unknown,
    callback?: () => Promise<unknown>,
  ) => (typeof options === "function" ? await options() : await callback?.()),
} as unknown as WorkflowStep;

beforeEach(async () => {
  await reset();
  vi.resetAllMocks();
  bindings = {
    ...env,
    OWNER_ID: "private-tester",
    AI_BUDGET_USD: "10",
  } as unknown as Env;
  await bindings.DB.batch(
    schema
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => bindings.DB.prepare(statement)),
  );
  await bindings.DB.prepare(
    "INSERT INTO drafts (id, owner_id, title, created_at, status, job_id) VALUES ('draft', 'private-tester', '秋の京都', '2026-10-04', 'preparing', 'prepare-job')",
  ).run();
  await bindings.DB.prepare(
    "INSERT INTO clips (id, draft_id, owner_id, mime_type, size_bytes, duration_ms, recorded_at, timezone, place, object_key, status) VALUES ('clip', 'draft', 'private-tester', 'audio/mp4', 10, 1800000, '2026-10-04T01:00:00Z', 'Asia/Tokyo', '京都', 'originals/private-tester/clip', 'uploaded')",
  ).run();
  await bindings.DB.prepare(
    "INSERT INTO jobs (id, owner_id, draft_id, kind, idempotency_key, fingerprint, created_at) VALUES ('prepare-job', 'private-tester', 'draft', 'prepare', 'prepare-key', 'source', '2026-10-04')",
  ).run();
  const chunks = [
    {
      key: "processed/clip/0.m4a",
      offsetMs: 0,
      durationMs: 1500000,
      mimeType: "audio/mp4",
    },
    {
      key: "processed/clip/1.m4a",
      offsetMs: 1500000,
      durationMs: 300000,
      mimeType: "audio/mp4",
    },
  ];
  for (const chunk of chunks)
    await bindings.AUDIO.put(chunk.key, new Uint8Array([1, 2, 3]));
  vi.mocked(inspectClip).mockResolvedValue({
    durationMs: 1800000,
    sizeBytes: 10,
    chunks,
  });
  vi.mocked(transcribeAudio).mockImplementation(
    async (_env, _job, _attempt, { clipId, offsetMs }) => ({
      value: [
        {
          id: `${clipId}:u:${offsetMs + 100}:1`,
          clipId,
          startMs: offsetMs + 100,
          endMs: offsetMs + 500,
          speaker: "話者 1",
          text: "また歩こう。",
        },
      ],
      costUsd: 0.1,
      usage: { model: "gemini-test" },
    }),
  );
  vi.mocked(createLyrics).mockResolvedValue({
    value: blocks,
    costUsd: 0.02,
    usage: { model: "gemini-test" },
  });
  vi.mocked(generateMusic).mockImplementation(async (runtimeEnv, job) => {
    const audioId = `song-audio-${job.id}`;
    const key = `songs/${job.owner_id}/${job.id}.mp3`;
    await runtimeEnv.AUDIO.put(key, new Uint8Array([73, 68, 51, 1, 2]));
    await runtimeEnv.DB.prepare(
      "INSERT OR IGNORE INTO audio_objects (id, owner_id, draft_id, object_key, mime_type, size_bytes, duration_ms, kind) VALUES (?, ?, ?, ?, 'audio/mpeg', 5, 0, 'song')",
    )
      .bind(audioId, job.owner_id, job.draft_id, key)
      .run();
    return {
      value: {
        audioId,
        key,
        sizeBytes: 5,
        mimeType: "audio/mpeg",
        returnedLyrics: blocks[0].text,
      },
      costUsd: 0.08,
      usage: { model: "lyria-test" },
    };
  });
  vi.mocked(probeSong).mockResolvedValue({
    durationMs: 123456,
    sizeBytes: 5,
    chunks: [],
  });
  vi.mocked(identifySpeakersInChunk).mockImplementation(
    async (_env, _job, _clip, input) =>
      input.utterances.map(({ speaker }) => ({
        speaker,
        speakerProfileId: null,
      })),
  );
});

async function freezeSpeakerSnapshot() {
  await bindings.DB.prepare(
    "UPDATE jobs SET speaker_snapshot_json = ? WHERE id = 'prepare-job'",
  )
    .bind(
      JSON.stringify([
        {
          id: "speaker-a",
          name: "あおい",
          modelVersion: "weSpeakerResNet34Lm:1",
          embedding: Array.from({ length: 256 }, (_, index) =>
            index === 0 ? 1 : 0,
          ),
        },
        {
          id: "speaker-b",
          name: "れん",
          modelVersion: "weSpeakerResNet34Lm:1",
          embedding: Array.from({ length: 256 }, (_, index) =>
            index === 1 ? 1 : 0,
          ),
        },
      ]),
    )
    .run();
}

async function approveAndGenerate() {
  await prepareDraft(bindings, "prepare-job", step);
  await bindings.DB.prepare(
    "INSERT INTO jobs (id, owner_id, draft_id, kind, idempotency_key, fingerprint, lyric_revision, blocks_json, created_at) VALUES ('generate-job', 'private-tester', 'draft', 'generate', 'generate-key', 'approved', 1, ?, '2026-10-04')",
  )
    .bind(JSON.stringify(blocks))
    .run();
  await bindings.DB.prepare(
    "UPDATE drafts SET status = 'generating', job_id = 'generate-job' WHERE id = 'draft'",
  ).run();
  await generateSong(bindings, "generate-job", step);
}

it("preserves original chunk offsets and source IDs through lyric review", async () => {
  await prepareDraft(bindings, "prepare-job", step);
  const draft = await draftDocument(bindings, "draft", "private-tester");
  expect(draft.status).toBe("waiting_review");
  expect(draft.clips[0]).toMatchObject({
    recordedAt: "2026-10-04T01:00:00Z",
    timezone: "Asia/Tokyo",
    place: "京都",
  });
  expect(draft.utterances.map((utterance) => utterance.startMs)).toEqual([
    100, 1500100,
  ]);
  expect(draft.lyrics).toEqual({ revision: 1, blocks });
  expect(transcribeAudio).toHaveBeenCalledTimes(2);
  expect(generateMusic).not.toHaveBeenCalled();
});

it("matches temporary speaker labels independently within each chunk and passes names to lyrics", async () => {
  await freezeSpeakerSnapshot();
  vi.mocked(identifySpeakersInChunk).mockImplementation(
    async (_env, _job, _clip, input) =>
      input.utterances.map(({ speaker }) => ({
        speaker,
        speakerProfileId: input.offsetMs === 0 ? "speaker-a" : "speaker-b",
      })),
  );

  await prepareDraft(bindings, "prepare-job", step);

  expect(identifySpeakersInChunk).toHaveBeenCalledTimes(2);
  expect(
    vi
      .mocked(identifySpeakersInChunk)
      .mock.calls.map((call) => call[3].offsetMs),
  ).toEqual([0, 1500000]);
  expect(vi.mocked(createLyrics).mock.calls[0]?.[3]).toMatchObject({
    utterances: [
      {
        speaker: "話者 1",
        speakerProfileId: "speaker-a",
        speakerName: "あおい",
      },
      { speaker: "話者 1", speakerProfileId: "speaker-b", speakerName: "れん" },
    ],
  });
  expect(
    (await draftDocument(bindings, "draft", "private-tester")).utterances.map(
      ({ speakerName }) => speakerName,
    ),
  ).toEqual(["あおい", "れん"]);
});

it("keeps temporary labels for unknown voices", async () => {
  await freezeSpeakerSnapshot();
  await prepareDraft(bindings, "prepare-job", step);

  const source = vi.mocked(createLyrics).mock.calls[0]?.[3].utterances ?? [];
  expect(
    source.map(({ speaker, speakerProfileId, speakerName }) => [
      speaker,
      speakerProfileId ?? null,
      speakerName ?? null,
    ]),
  ).toEqual([
    ["話者 1", null, null],
    ["話者 1", null, null],
  ]);
});

it("retries failed speaker matching from cached transcripts without another paid transcription", async () => {
  await freezeSpeakerSnapshot();
  vi.mocked(identifySpeakersInChunk)
    .mockRejectedValueOnce(new Error("speaker_identification_failed"))
    .mockImplementation(async (_env, _job, _clip, input) =>
      input.utterances.map(({ speaker }) => ({
        speaker,
        speakerProfileId: null,
      })),
    );

  await prepareDraft(bindings, "prepare-job", step);
  expect(
    await ownedJob(bindings, "prepare-job", "private-tester"),
  ).toMatchObject({ status: "failed", error: "speaker_identification_failed" });
  expect(transcribeAudio).toHaveBeenCalledTimes(2);

  await prepareDraft(bindings, "prepare-job", step);

  expect(transcribeAudio).toHaveBeenCalledTimes(2);
  expect(identifySpeakersInChunk).toHaveBeenCalledTimes(3);
  expect(
    (await ownedJob(bindings, "prepare-job", "private-tester")).status,
  ).toBe("waiting_review");
});

it("persists an approved song with its measured duration and immutable source revision", async () => {
  await approveAndGenerate();
  const job = await ownedJob(bindings, "generate-job", "private-tester");
  expect(job.status).toBe("ready");
  const song = await songDocument(
    bindings,
    "song-generate-job",
    "private-tester",
  );
  expect(song).toMatchObject({
    title: "秋の京都",
    durationMs: 123456,
    audioId: "song-audio-generate-job",
    lyrics: { revision: 1, blocks },
  });
  const bytes = await bindings.AUDIO.get(
    "songs/private-tester/generate-job.mp3",
  );
  if (!bytes) throw new Error("Generated audio missing");
  expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(
    new Uint8Array([73, 68, 51, 1, 2]),
  );
  const cache = await bindings.AUDIO.get(
    "results/private-tester/music-generate-job.json",
  );
  expect(await cache?.json()).toMatchObject({
    version: 1,
    value: { audioId: "song-audio-generate-job", sizeBytes: 5 },
    costUsd: 0.08,
  });
  await generateSong(bindings, "generate-job", step);
  expect(generateMusic).toHaveBeenCalledTimes(1);
});

it("retains audio for reconciliation when the provider changes approved lyrics", async () => {
  const original = vi.mocked(generateMusic).getMockImplementation();
  if (!original) throw new Error("Missing runtime fixture");
  vi.mocked(generateMusic).mockImplementation(async (...args) => {
    const result = await original(...args);
    return {
      ...result,
      value: { ...result.value, returnedLyrics: "別の歌詞" },
    };
  });
  await approveAndGenerate();
  expect(
    await ownedJob(bindings, "generate-job", "private-tester"),
  ).toMatchObject({
    status: "needs_reconciliation",
    error: "generated_lyrics_differ",
  });
  expect(
    await bindings.AUDIO.head("songs/private-tester/generate-job.mp3"),
  ).not.toBeNull();
  expect(
    (await bindings.DB.prepare("SELECT id FROM songs").all()).results,
  ).toHaveLength(0);
  expect(probeSong).not.toHaveBeenCalled();
});

it("stops an ambiguous music job without submitting it again", async () => {
  vi.mocked(generateMusic).mockRejectedValue(
    new Error("request accepted before connection dropped"),
  );
  await approveAndGenerate();
  expect(
    await ownedJob(bindings, "generate-job", "private-tester"),
  ).toMatchObject({
    status: "needs_reconciliation",
    error: "provider_outcome_unconfirmed",
  });
  await generateSong(bindings, "generate-job", step);
  expect(generateMusic).toHaveBeenCalledTimes(1);
});

it("preserves a safe failure code across Workflow error serialization", async () => {
  bindings.AI_BUDGET_USD = "0";
  const transportedStep = {
    do: async (
      _name: string,
      options: unknown,
      callback?: () => Promise<unknown>,
    ) => {
      try {
        return typeof options === "function"
          ? await options()
          : await callback?.();
      } catch (error) {
        throw { message: error instanceof Error ? error.message : "unknown" };
      }
    },
  } as unknown as WorkflowStep;
  await prepareDraft(bindings, "prepare-job", transportedStep);
  expect(
    await ownedJob(bindings, "prepare-job", "private-tester"),
  ).toMatchObject({ status: "failed", error: "ai_budget_exhausted" });
  expect(transcribeAudio).not.toHaveBeenCalled();
});

it("saves long transcripts without one D1 query per utterance on Workers Free", async () => {
  const batch = bindings.DB.batch.bind(bindings.DB);
  vi.spyOn(bindings.DB, "batch").mockImplementation(async (statements) => {
    if (statements.length > 50) throw new Error("free_d1_query_limit");
    return batch(statements);
  });
  vi.mocked(transcribeAudio).mockImplementation(
    async (_env, _job, _attempt, { clipId, offsetMs }) => ({
      value: Array.from({ length: 100 }, (_, index) => ({
        id: `${clipId}:u:${offsetMs + 100 + index * 600}:${index + 1}`,
        clipId,
        startMs: offsetMs + 100 + index * 600,
        endMs: offsetMs + 500 + index * 600,
        speaker: "話者 1",
        text: "また歩こう。",
      })),
      costUsd: 0.1,
      usage: {},
    }),
  );
  await prepareDraft(bindings, "prepare-job", step);
  const draft = await draftDocument(bindings, "draft", "private-tester");
  expect(draft.status).toBe("waiting_review");
  expect(draft.utterances).toHaveLength(200);
});
