import { env, reset } from "cloudflare:test";
import type { WorkflowStep } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { draftDocument, ownedJob, songDocument } from "../database.ts";
import { identifySpeakersInChunk, inspectClip, probeSong } from "../media.ts";
import initialSchema from "../migrations/0001_initial.sql?raw";
import runtimeSchema from "../migrations/0002_audio_runtime.sql?raw";
import speakerSchema from "../migrations/0003_speaker_profiles.sql?raw";
import draftSpeakersSchema from "../migrations/0005_draft_speaker_profiles.sql?raw";
import {
  createLyrics,
  createReadings,
  generateMusic,
  transcribeAudio,
} from "../providers.ts";
import { applyAccountSchema } from "./schema.ts";

const schema = `${initialSchema}\n${runtimeSchema}\n${speakerSchema}\n${draftSpeakersSchema}`;

import type { Env } from "../types.ts";
import * as workflows from "../workflows.ts";
import { generateSong, prepareDraft } from "../workflows.ts";

vi.mock("../providers.ts", async (original) => ({
  ...(await original<typeof import("../providers.ts")>()),
  transcribeAudio: vi.fn(),
  createLyrics: vi.fn(),
  createReadings: vi.fn(),
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
    AI_BUDGET_USD: "10",
  } as unknown as Env;
  await bindings.DB.batch(
    schema
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => bindings.DB.prepare(statement)),
  );
  await applyAccountSchema(bindings.DB);
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

async function freezeSpeakerSnapshot(profileCount = 2) {
  const profiles = [
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
  ];
  await bindings.DB.prepare(
    "UPDATE jobs SET speaker_snapshot_json = ? WHERE id = 'prepare-job'",
  )
    .bind(JSON.stringify(profiles.slice(0, profileCount)))
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

it("uses the lyric-review song title without renaming its source memory", async () => {
  await prepareDraft(bindings, "prepare-job", step);
  await bindings.DB.prepare(
    "INSERT INTO jobs (id, owner_id, draft_id, kind, idempotency_key, fingerprint, lyric_revision, blocks_json, song_title, created_at) VALUES ('generate-job', 'private-tester', 'draft', 'generate', 'generate-key', 'approved', 1, ?, '夜明け前', '2026-10-04')",
  )
    .bind(JSON.stringify(blocks))
    .run();
  await bindings.DB.prepare(
    "UPDATE drafts SET status = 'generating', job_id = 'generate-job' WHERE id = 'draft'",
  ).run();
  await generateSong(bindings, "generate-job", step);
  expect(
    await bindings.DB.prepare(
      "SELECT title FROM drafts WHERE id = 'draft'",
    ).first(),
  ).toEqual({ title: "秋の京都" });
  expect(
    await bindings.DB.prepare(
      "SELECT title FROM songs WHERE id = 'song-generate-job'",
    ).first(),
  ).toEqual({ title: "夜明け前" });
});

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

it("resumes an approved audio review on replay without repeating transcription", async () => {
  await bindings.DB.prepare(
    "UPDATE clips SET duration_ms = 180000, client_duration_ms = 180000 WHERE id = 'clip'",
  ).run();
  const chunks = [
    {
      key: "processed/clip/0.m4a",
      offsetMs: 0,
      durationMs: 180000,
      mimeType: "audio/mp4",
      activityRanges: [
        { startMs: 0, endMs: 3000 },
        { startMs: 30000, endMs: 50000 },
        { startMs: 175000, endMs: 180000 },
      ],
    },
  ];
  vi.mocked(inspectClip).mockResolvedValue({
    durationMs: 180000,
    sizeBytes: 10,
    chunks,
    sourceEtag: "source-etag",
    transformVersion: 1,
  });
  const transcript = [
    {
      id: "clip:u:100:1",
      clipId: "clip",
      startMs: 100,
      endMs: 2500,
      speaker: "話者 1",
      text: "朝の出発",
    },
  ];
  vi.mocked(transcribeAudio).mockResolvedValue({
    value: transcript,
    costUsd: 0.1,
    usage: { model: "gemini-test" },
  });
  vi.mocked(createLyrics).mockResolvedValue({
    value: [
      { id: "verse", text: "朝の出発", sourceUtteranceIds: [transcript[0].id] },
    ],
    costUsd: 0.02,
    usage: { model: "gemini-test" },
  });
  let signalWait!: () => void;
  const waiting = new Promise<void>((resolve) => {
    signalWait = resolve;
  });
  const savedSteps = new Map<string, unknown>();
  let approval: { payload: { transcriptFingerprint: string } } | null = null;
  const waitForEvent = vi.fn(() => {
    if (approval) return Promise.resolve(approval);
    signalWait();
    return new Promise(() => {});
  });
  const workflowStep = {
    do: async (
      name: string,
      options: unknown,
      callback?: () => Promise<unknown>,
    ) => {
      if (savedSteps.has(name)) return savedSteps.get(name);
      const result =
        typeof options === "function" ? await options() : await callback?.();
      savedSteps.set(name, result);
      return result;
    },
    waitForEvent,
  } as unknown as WorkflowStep;

  void prepareDraft(bindings, "prepare-job", workflowStep);
  await waiting;
  const pending = await ownedJob(bindings, "prepare-job", "private-tester");
  expect(pending).toMatchObject({
    status: "needs_audio_review",
    stage: "review_audio",
  });
  expect(pending.completed_chunks).toBe(1);
  expect(createLyrics).not.toHaveBeenCalled();
  expect(
    (await draftDocument(bindings, "draft", "private-tester")).utterances,
  ).toEqual(transcript);
  const clip = await bindings.DB.prepare(
    "SELECT processing_json FROM clips WHERE id = 'clip'",
  ).first<{ processing_json: string }>();
  expect(JSON.parse(clip?.processing_json ?? "{}")).toMatchObject({
    status: "needs_review",
    speechActivityMs: 28000,
    transcribedMs: 2400,
    unrecognizedActivityMs: 25000,
  });

  approval = {
    payload: { transcriptFingerprint: pending.transcript_fingerprint ?? "" },
  };
  await prepareDraft(bindings, "prepare-job", workflowStep);
  expect(waitForEvent).toHaveBeenCalledTimes(2);
  expect(createLyrics).toHaveBeenCalledOnce();
  expect(
    (await ownedJob(bindings, "prepare-job", "private-tester")).status,
  ).toBe("waiting_review");
  expect(transcribeAudio).toHaveBeenCalledOnce();
});

it("keeps opening, middle and ending utterances attached to their lyric sources", async () => {
  await bindings.DB.prepare(
    "UPDATE clips SET duration_ms = 180000, client_duration_ms = 180000 WHERE id = 'clip'",
  ).run();
  const chunks = [
    {
      key: "processed/clip/0.m4a",
      offsetMs: 0,
      durationMs: 180000,
      mimeType: "audio/mp4",
      activityRanges: [
        { startMs: 0, endMs: 2500 },
        { startMs: 89000, endMs: 92000 },
        { startMs: 176000, endMs: 180000 },
      ],
    },
  ];
  vi.mocked(inspectClip).mockResolvedValue({
    durationMs: 180000,
    sizeBytes: 10,
    chunks,
    sourceEtag: "source-etag",
    transformVersion: 1,
  });
  const transcript = [
    {
      id: "clip:u:100:1",
      clipId: "clip",
      startMs: 100,
      endMs: 2000,
      speaker: "話者 1",
      text: "朝に出発",
    },
    {
      id: "clip:u:90000:1",
      clipId: "clip",
      startMs: 90000,
      endMs: 91000,
      speaker: "話者 1",
      text: "川辺で休憩",
    },
    {
      id: "clip:u:177000:1",
      clipId: "clip",
      startMs: 177000,
      endMs: 179000,
      speaker: "話者 1",
      text: "また来よう",
    },
  ];
  vi.mocked(transcribeAudio).mockResolvedValue({
    value: transcript,
    costUsd: 0.1,
    usage: { model: "gemini-test" },
  });
  const lyric = {
    id: "story",
    text: "朝に出発 川辺で休憩 また来よう",
    sourceUtteranceIds: transcript.map((item) => item.id),
  };
  vi.mocked(createLyrics).mockResolvedValue({
    value: [lyric],
    costUsd: 0.02,
    usage: { model: "gemini-test" },
  });

  await prepareDraft(bindings, "prepare-job", step);

  const saved = await draftDocument(bindings, "draft", "private-tester");
  expect(saved.utterances.map((item) => item.text)).toEqual([
    "朝に出発",
    "川辺で休憩",
    "また来よう",
  ]);
  expect(saved.lyrics?.blocks[0]?.sourceUtteranceIds).toEqual(
    transcript.map((item) => item.id),
  );
  expect(saved.status).toBe("waiting_review");
});

it("reuses the same completed transcription and lyrics in a new preparation job", async () => {
  await prepareDraft(bindings, "prepare-job", step);
  const attemptsBefore = await bindings.DB.prepare(
    "SELECT COUNT(*) AS count FROM provider_attempts WHERE owner_id = 'private-tester'",
  ).first<{ count: number }>();
  expect(transcribeAudio).toHaveBeenCalledTimes(2);
  expect(createLyrics).toHaveBeenCalledOnce();

  await bindings.DB.prepare(
    "INSERT INTO jobs (id, owner_id, draft_id, kind, idempotency_key, fingerprint, created_at) VALUES ('prepare-job-retry', 'private-tester', 'draft', 'prepare', 'prepare-retry', 'same-input', '2026-10-04')",
  ).run();
  await bindings.DB.prepare(
    "UPDATE drafts SET status = 'failed', job_id = 'prepare-job-retry' WHERE id = 'draft'",
  ).run();

  await prepareDraft(bindings, "prepare-job-retry", step);

  const attemptsAfter = await bindings.DB.prepare(
    "SELECT COUNT(*) AS count FROM provider_attempts WHERE owner_id = 'private-tester'",
  ).first<{ count: number }>();
  expect(attemptsAfter?.count).toBe(attemptsBefore?.count);
  expect(transcribeAudio).toHaveBeenCalledTimes(2);
  expect(createLyrics).toHaveBeenCalledOnce();
  expect(
    (await ownedJob(bindings, "prepare-job-retry", "private-tester")).status,
  ).toBe("waiting_review");
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
  await bindings.DB.prepare(
    "UPDATE drafts SET speaker_profile_ids_json = ? WHERE id = 'draft'",
  )
    .bind(JSON.stringify(["speaker-a"]))
    .run();
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
    speakerProfileIds: ["speaker-a"],
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

it("preserves the full unverified transcript and waits for review without naming a speaker", async () => {
  await bindings.DB.prepare(
    "UPDATE clips SET duration_ms = 90000, client_duration_ms = 90000 WHERE id = 'clip'",
  ).run();
  await freezeSpeakerSnapshot();
  vi.mocked(inspectClip).mockResolvedValue({
    durationMs: 90000,
    sizeBytes: 10,
    chunks: [
      {
        key: "processed/clip/0.m4a",
        offsetMs: 0,
        durationMs: 90000,
        mimeType: "audio/mp4",
        activityRanges: [{ startMs: 0, endMs: 90000 }],
      },
    ],
  });
  const timingIssues = [
    {
      text: "へ",
      startOffset: "3.900s",
      endOffset: "1.100s",
      chunkOffsetMs: 0,
    },
  ];
  const transcript = [
    {
      id: "clip:unverified:0",
      clipId: "clip",
      startMs: 0,
      endMs: 90000,
      speaker: "話者未確認",
      text: "駅へ向かおう。全文を残そう。",
      timingIssues,
    },
  ];
  vi.mocked(transcribeAudio).mockResolvedValue({
    value: transcript,
    costUsd: 0.008036,
    usage: { model: "gemini-test" },
  });
  vi.mocked(createLyrics).mockResolvedValue({
    value: [
      {
        id: "verse",
        text: "駅へ向かおう",
        sourceUtteranceIds: [transcript[0].id],
      },
    ],
    costUsd: 0.02,
    usage: {},
  });
  const waitForEvent = vi.fn(async () => {
    expect(createLyrics).not.toHaveBeenCalled();
    const pending = await ownedJob(bindings, "prepare-job", "private-tester");
    expect(pending.status).toBe("needs_audio_review");
    const draft = await draftDocument(bindings, "draft", "private-tester");
    expect(draft.utterances).toEqual(transcript);
    expect(draft.clips[0].processing).toMatchObject({
      timingIssues,
      transcribedMs: 0,
      unrecognizedActivityMs: 90000,
    });
    return {
      payload: { transcriptFingerprint: pending.transcript_fingerprint },
    };
  });
  await prepareDraft(bindings, "prepare-job", {
    ...step,
    waitForEvent,
  } as unknown as WorkflowStep);
  expect(waitForEvent).toHaveBeenCalledOnce();
  expect(identifySpeakersInChunk).not.toHaveBeenCalled();
  expect(createLyrics).toHaveBeenCalledOnce();
  expect(transcribeAudio).toHaveBeenCalledOnce();
});

it("pauses recovered transcripts for speaker and text review before creating lyrics", async () => {
  await freezeSpeakerSnapshot();
  await bindings.DB.prepare(
    "UPDATE jobs SET status = 'queued', stage = 'recovering_transcription' WHERE id = 'prepare-job'",
  ).run();
  vi.mocked(transcribeAudio).mockImplementation(
    async (_env, _job, _attempt, { clipId, offsetMs }) => ({
      value: [
        {
          id: `${clipId}:u:${offsetMs + 100}:1`,
          clipId,
          startMs: offsetMs + 100,
          endMs: offsetMs + 500,
          speaker: "unknown",
          text: "また歩こう。",
        },
      ],
      costUsd: 0.1,
      usage: { model: "gemini-test" },
    }),
  );
  const waitForEvent = vi.fn(async () => {
    expect(createLyrics).not.toHaveBeenCalled();
    const pending = await ownedJob(bindings, "prepare-job", "private-tester");
    expect(pending).toMatchObject({
      status: "needs_audio_review",
      stage: "review_audio",
    });
    const draft = await draftDocument(bindings, "draft", "private-tester");
    expect(draft.utterances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ speaker: "unknown", text: "また歩こう。" }),
      ]),
    );
    return {
      payload: { transcriptFingerprint: pending.transcript_fingerprint },
    };
  });

  await prepareDraft(bindings, "prepare-job", {
    ...step,
    waitForEvent,
  } as unknown as WorkflowStep);

  expect(waitForEvent).toHaveBeenCalledOnce();
  expect(identifySpeakersInChunk).not.toHaveBeenCalled();
  expect(createLyrics).toHaveBeenCalledOnce();
  expect(
    await ownedJob(bindings, "prepare-job", "private-tester"),
  ).toMatchObject({ status: "waiting_review", stage: "review_lyrics" });
});

it("checks unidentified speech against one selected voice but still requires review", async () => {
  await freezeSpeakerSnapshot(1);
  vi.mocked(transcribeAudio).mockImplementation(
    async (_env, _job, _attempt, { clipId, offsetMs }) => ({
      value: [
        {
          id: `${clipId}:u:${offsetMs + 100}:1`,
          clipId,
          startMs: offsetMs + 100,
          endMs: offsetMs + 500,
          speaker: "unknown",
          text: "また歩こう。",
        },
      ],
      costUsd: 0.1,
      usage: { model: "gemini-test" },
    }),
  );
  vi.mocked(identifySpeakersInChunk).mockImplementation(
    async (_env, _job, _clip, input) =>
      input.utterances.map(({ speaker }) => ({
        speaker,
        speakerProfileId: "speaker-a",
      })),
  );
  const waitForEvent = vi.fn(async () => {
    expect(createLyrics).not.toHaveBeenCalled();
    const pending = await ownedJob(bindings, "prepare-job", "private-tester");
    expect(pending.status).toBe("needs_audio_review");
    const draft = await draftDocument(bindings, "draft", "private-tester");
    expect(draft.utterances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          speaker: "unknown",
          speakerName: "あおい",
          text: "また歩こう。",
        }),
      ]),
    );
    return {
      payload: { transcriptFingerprint: pending.transcript_fingerprint },
    };
  });

  await prepareDraft(bindings, "prepare-job", {
    ...step,
    waitForEvent,
  } as unknown as WorkflowStep);

  expect(identifySpeakersInChunk).toHaveBeenCalledTimes(2);
  for (const call of vi.mocked(identifySpeakersInChunk).mock.calls) {
    const input = call[3];
    expect(input.profiles).toHaveLength(1);
    expect(input.utterances).toEqual([
      expect.objectContaining({ speaker: "unknown" }),
    ]);
  }
  expect(waitForEvent).toHaveBeenCalledOnce();
  expect(createLyrics).toHaveBeenCalledOnce();
});

async function seedReadingJob() {
  const input = [
    {
      id: "verse",
      text: "三宮",
      section: "verse" as const,
      sourceUtteranceIds: ["clip:u:100:1"],
    },
  ];
  await bindings.DB.prepare(
    "INSERT INTO utterances (id, clip_id, start_ms, end_ms, speaker, text) VALUES ('clip:u:100:1', 'clip', 100, 500, 'spk_1', '三宮に行こう')",
  ).run();
  await bindings.DB.prepare(
    "INSERT INTO lyric_revisions (draft_id, revision, blocks_json, created_at, generation_version, music_preferences_json) VALUES ('draft', 1, ?, '2026-10-12', 2, ?)",
  )
    .bind(
      JSON.stringify(input),
      JSON.stringify({ genre: "jpop", vocal: "female" }),
    )
    .run();
  await bindings.DB.prepare(
    "INSERT INTO jobs (id, owner_id, draft_id, kind, idempotency_key, fingerprint, lyric_revision, blocks_json, created_at, generation_version, music_preferences_json) VALUES ('read-job', 'private-tester', 'draft', 'readings', 'read-key', 'frozen', 1, ?, '2026-10-12', 2, ?)",
  )
    .bind(
      JSON.stringify(input),
      JSON.stringify({ genre: "jpop", vocal: "female" }),
    )
    .run();
  await bindings.DB.prepare(
    "UPDATE drafts SET lyric_revision = 1, status = 'updating_readings', job_id = 'read-job' WHERE id = 'draft'",
  ).run();
  return input;
}
it("updates only frozen readings and returns to review without repeat spending", async () => {
  const input = await seedReadingJob();
  vi.mocked(createReadings).mockResolvedValue({
    value: [{ ...input[0], singingText: "さんのみや" }],
    costUsd: 0.01,
    usage: { model: "read-test" },
  });
  await workflows.updateLyricReadings(bindings, "read-job", step);
  const draft = await draftDocument(bindings, "draft", "private-tester");
  expect(draft.status).toBe("waiting_review");
  expect(draft.lyrics).toMatchObject({
    revision: 2,
    generationVersion: 2,
    musicPreferences: { genre: "jpop", vocal: "female" },
    blocks: [{ ...input[0], singingText: "さんのみや" }],
  });
  await workflows.updateLyricReadings(bindings, "read-job", step);
  expect(createReadings).toHaveBeenCalledOnce();
});
it("does not accept provider rewriting the display lyrics during reading update", async () => {
  const input = await seedReadingJob();
  vi.mocked(createReadings).mockResolvedValue({
    value: [{ ...input[0], text: "京都", singingText: "きょうと" }],
    costUsd: 0.01,
    usage: {},
  });
  await workflows.updateLyricReadings(bindings, "read-job", step);
  expect(
    (await draftDocument(bindings, "draft", "private-tester")).lyrics?.revision,
  ).toBe(1);
  expect((await ownedJob(bindings, "read-job", "private-tester")).status).toBe(
    "failed",
  );
});
it("retains unknown reading reservations and does not submit twice", async () => {
  await seedReadingJob();
  vi.mocked(createReadings).mockRejectedValue(new Error("connection lost"));
  await workflows.updateLyricReadings(bindings, "read-job", step);
  await workflows.updateLyricReadings(bindings, "read-job", step);
  expect(createReadings).toHaveBeenCalledOnce();
  expect((await ownedJob(bindings, "read-job", "private-tester")).status).toBe(
    "needs_reconciliation",
  );
  expect(
    (
      await bindings.DB.prepare(
        "SELECT SUM(amount_micros) AS n FROM budget_ledger",
      ).first()
    )?.n,
  ).toBe(500000);
});

it("changed musical settings create new lyrics without retranscribing cached audio", async () => {
  const modernBlocks = [
    {
      ...blocks[0],
      section: "verse" as const,
      singingText: "あのさかみちを またあるこう",
    },
  ];
  const rock = JSON.stringify({ genre: "rock", vocal: "male" });
  const bossa = JSON.stringify({ genre: "bossa", vocal: "male" });
  await bindings.DB.prepare(
    "UPDATE jobs SET generation_version = 2, music_preferences_json = ? WHERE id = 'prepare-job'",
  )
    .bind(rock)
    .run();
  vi.mocked(createLyrics).mockResolvedValue({
    value: modernBlocks,
    costUsd: 0.01,
    usage: {},
  });
  await prepareDraft(bindings, "prepare-job", step);
  await bindings.DB.prepare(
    "INSERT INTO jobs (id, owner_id, draft_id, kind, idempotency_key, fingerprint, created_at, generation_version, music_preferences_json) VALUES ('new-style', 'private-tester', 'draft', 'prepare', 'new-style', 'different-style', '2026-10-12', 2, ?)",
  )
    .bind(bossa)
    .run();
  await bindings.DB.prepare(
    "UPDATE drafts SET job_id = 'new-style', status = 'preparing' WHERE id = 'draft'",
  ).run();
  await prepareDraft(bindings, "new-style", step);
  expect(transcribeAudio).toHaveBeenCalledTimes(2);
  expect(createLyrics).toHaveBeenCalledTimes(2);
  expect(
    (await draftDocument(bindings, "draft", "private-tester")).lyrics,
  ).toMatchObject({
    revision: 2,
    generationVersion: 2,
    musicPreferences: { genre: "bossa", vocal: "male" },
  });
});

it("new songs compare sung readings while preserving display lyrics and settings", async () => {
  const modernBlocks = [
    {
      ...blocks[0],
      section: "verse" as const,
      singingText: "あのさかみちを またあるこう",
    },
  ];
  const preferences = JSON.stringify({ genre: "piano", vocal: "female" });
  await bindings.DB.prepare(
    "UPDATE jobs SET generation_version = 2, music_preferences_json = ? WHERE id = 'prepare-job'",
  )
    .bind(preferences)
    .run();
  vi.mocked(createLyrics).mockResolvedValue({
    value: modernBlocks,
    costUsd: 0.01,
    usage: {},
  });
  await prepareDraft(bindings, "prepare-job", step);
  await bindings.DB.prepare(
    "INSERT INTO jobs (id, owner_id, draft_id, kind, idempotency_key, fingerprint, lyric_revision, blocks_json, created_at, generation_version, music_preferences_json) VALUES ('modern-song', 'private-tester', 'draft', 'generate', 'modern-song', 'approved', 1, ?, '2026-10-12', 2, ?)",
  )
    .bind(JSON.stringify(modernBlocks), preferences)
    .run();
  await bindings.DB.prepare(
    "UPDATE drafts SET status = 'generating', job_id = 'modern-song' WHERE id = 'draft'",
  ).run();
  const original = vi.mocked(generateMusic).getMockImplementation();
  if (!original) throw new Error("missing mock");
  vi.mocked(generateMusic).mockImplementation(async (...args) => {
    const result = await original(...args);
    result.value.returnedLyrics = "[Verse 1]\nアノサカミチヲ マタアルコウ";
    return result;
  });
  await generateSong(bindings, "modern-song", step);
  const job = await ownedJob(bindings, "modern-song", "private-tester");
  expect(job.status).toBe("ready");
  expect(
    (await songDocument(bindings, "song-modern-song", "private-tester")).lyrics,
  ).toMatchObject({
    generationVersion: 2,
    musicPreferences: { genre: "piano", vocal: "female" },
    blocks: modernBlocks,
  });
});
