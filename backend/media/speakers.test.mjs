import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  chooseSpeaker,
  enrollSpeaker,
  identifySpeakers,
  speakerIntervals,
  speakerUtteranceIntervals,
} from "./speakers.mjs";

const execFile = promisify(execFileCallback);

test("matching requires both a sufficient score and a margin over the runner-up", () => {
  assert.equal(
    chooseSpeaker(
      [1, 0],
      [
        { id: "a", embedding: [0.9, Math.sqrt(0.19)] },
        { id: "b", embedding: [0, 1] },
      ],
    ),
    "a",
  );
  assert.equal(
    chooseSpeaker([1, 0], [{ id: "a", embedding: [0.6, 0.8] }]),
    null,
  );
  assert.equal(
    chooseSpeaker(
      [1, 0],
      [
        { id: "a", embedding: [0.9, Math.sqrt(0.19)] },
        { id: "b", embedding: [0.85, Math.sqrt(1 - 0.85 ** 2)] },
      ],
    ),
    null,
  );
  assert.equal(chooseSpeaker([1, 0], []), null);
});

test("speaker intervals use chunk-relative timestamps and exclude competing voices", () => {
  const intervals = speakerIntervals(
    [
      { speaker: "spk_1", startMs: 1500000, endMs: 1508000 },
      { speaker: "spk_2", startMs: 1503000, endMs: 1505000 },
    ],
    1500000,
    10000,
  );
  assert.deepEqual(intervals.get("spk_1"), [
    [0, 3000],
    [5000, 8000],
  ]);
  assert.deepEqual(intervals.get("spk_2"), []);
});

test("short utterances are excluded from speaker matching", () => {
  const intervals = speakerIntervals(
    [{ speaker: "spk_1", startMs: 0, endMs: 2_999 }],
    0,
    5_000,
  );
  assert.deepEqual(intervals.get("spk_1"), []);
});

test("unlabelled speech cannot be matched as a diarized speaker by default", () => {
  const intervals = speakerIntervals(
    [{ speaker: "unknown", startMs: 0, endMs: 6000 }],
    0,
    10000,
  );

  assert.equal(intervals.has("unknown"), false);
});

test("unlabelled speech keeps separate utterance intervals for voice matching", () => {
  assert.deepEqual(
    speakerUtteranceIntervals(
      [
        { id: "u1", speaker: "unknown", startMs: 1000, endMs: 5000 },
        { id: "u2", speaker: "unknown", startMs: 6000, endMs: 10000 },
      ],
      0,
      12000,
    ),
    [
      { utteranceId: "u1", ranges: [[1000, 5000]] },
      { utteranceId: "u2", ranges: [[6000, 10000]] },
    ],
  );
});

test("unlabelled speech does not remove labelled speech from matching", () => {
  const intervals = speakerIntervals(
    [
      { speaker: "spk_1", startMs: 0, endMs: 6000 },
      { speaker: "unknown", startMs: 2000, endMs: 4000 },
    ],
    0,
    10000,
  );

  assert.deepEqual(intervals.get("spk_1"), [[0, 6000]]);
});

test("unlabelled speech can be checked against one selected profile", () => {
  const intervals = speakerIntervals(
    [{ speaker: "unknown", startMs: 0, endMs: 6000 }],
    0,
    10000,
    { includeUnknown: true },
  );

  assert.deepEqual(intervals.get("unknown"), [[0, 6000]]);
});

test("unlabelled speech is excluded when multiple profiles are selected", () => {
  const intervals = speakerIntervals(
    [{ speaker: "unknown", startMs: 0, endMs: 6000 }],
    0,
    10000,
  );

  assert.equal(intervals.has("unknown"), false);
});

test("the same temporary label in another chunk is compared independently", () => {
  const first = speakerIntervals(
    [{ speaker: "spk_1", startMs: 0, endMs: 6000 }],
    0,
    10000,
  );
  const next = speakerIntervals(
    [{ speaker: "spk_1", startMs: 1500000, endMs: 1506000 }],
    1500000,
    10000,
  );
  assert.deepEqual(first.get("spk_1"), next.get("spk_1"));
  const profiles = [
    { id: "a", embedding: [1, 0] },
    { id: "b", embedding: [0, 1] },
  ];
  assert.equal(chooseSpeaker([1, 0], profiles), "a");
  assert.equal(chooseSpeaker([0, 1], profiles), "b");
});

test("a three-minute recording keeps temporary labels when the extracted voice is shorter than its timestamps", {
  skip: !process.env.FFMPEG_BIN || !process.env.FFPROBE_BIN,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "yoin-speaker-test-"));
  const source = join(directory, "recording.wav");
  try {
    await execFile(process.env.FFMPEG_BIN, [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=16000",
      "-t",
      "185",
      source,
    ]);
    const durationMs = 185_064;
    const bytes = await readFile(source);
    const body = {
      chunkUrl: "https://yoin.test/internal/chunks/job/clip/0?signature=test",
      offsetMs: 0,
      durationMs,
      utterances: [
        // Simulate a reported chunk end slightly beyond the decoded samples.
        { speaker: "spk_1", startMs: durationMs - 10_000, endMs: durationMs },
        { speaker: "spk_2", startMs: 1_000, endMs: 5_000 },
        {
          id: "unlabelled-1",
          speaker: "unknown",
          startMs: 10_000,
          endMs: 15_000,
        },
      ],
      profiles: [
        {
          id: "registered-person",
          embedding: Array.from({ length: 256 }, (_, index) =>
            index === 0 ? 1 : 0,
          ),
        },
      ],
    };
    const options = {
      origin: "https://yoin.test",
      ffmpeg: process.env.FFMPEG_BIN,
      ffprobe: process.env.FFPROBE_BIN,
      fetch: async () => new Response(bytes),
    };
    const result = await identifySpeakers(body, options);
    assert.deepEqual(result.matches, [
      { speaker: "spk_1", speakerProfileId: null },
      { speaker: "spk_2", speakerProfileId: null },
      {
        speaker: "unknown",
        utteranceId: "unlabelled-1",
        speakerProfileId: null,
      },
    ]);
    await assert.rejects(
      identifySpeakers(body, {
        ...options,
        ffprobe: join(directory, "missing-ffprobe"),
      }),
      /ENOENT/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("voice enrollment still rejects a sample shorter than ten seconds", {
  skip: !process.env.FFMPEG_BIN || !process.env.FFPROBE_BIN,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "yoin-speaker-test-"));
  const source = join(directory, "sample.wav");
  try {
    await execFile(process.env.FFMPEG_BIN, [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=16000",
      "-t",
      "9.936",
      source,
    ]);
    const bytes = await readFile(source);
    await assert.rejects(
      enrollSpeaker(
        {
          sourceUrl:
            "https://yoin.test/internal/speakers/person/samples/sample?signature=test",
        },
        {
          origin: "https://yoin.test",
          ffmpeg: process.env.FFMPEG_BIN,
          ffprobe: process.env.FFPROBE_BIN,
          fetch: async () => new Response(bytes),
        },
      ),
      /speaker_sample_too_short/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("insufficient voiced audio is an unmatched utterance rather than a fatal job error", {
  skip:
    !process.env.FFMPEG_BIN ||
    !process.env.FFPROBE_BIN ||
    !process.env.SPEAKER_MODEL_PATH,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "yoin-silent-test-"));
  try {
    const file = join(directory, "silent.wav");
    await execFile(process.env.FFMPEG_BIN, [
      "-nostdin",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=16000:cl=mono",
      "-t",
      "4",
      file,
    ]);
    const bytes = await readFile(file);
    const result = await identifySpeakers(
      {
        chunkUrl: "https://yoin.test/internal/chunks/job/clip/0?signature=test",
        offsetMs: 0,
        durationMs: 4000,
        utterances: [
          { id: "silent", speaker: "unknown", startMs: 0, endMs: 4000 },
        ],
        profiles: [],
      },
      {
        origin: "https://yoin.test",
        ffmpeg: process.env.FFMPEG_BIN,
        ffprobe: process.env.FFPROBE_BIN,
        fetch: async () => new Response(bytes),
      },
    );
    assert.deepEqual(result.matches, [
      { speaker: "unknown", utteranceId: "silent", speakerProfileId: null },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("diarization aggregates same-voice short intervals and rejects mixed or overlapping utterances", async () => {
  const { diarizedSpeakerIntervals, utteranceCluster } = await import(
    "./speakers.mjs"
  );
  const segments = [
    { start: 0, end: 1, speaker: 0 },
    { start: 2, end: 3, speaker: 1 },
    { start: 4, end: 5, speaker: 0 },
    { start: 6, end: 17, speaker: 0 },
  ];
  assert.deepEqual(diarizedSpeakerIntervals(segments, 20000).get(0), [
    [0, 1000],
    [4000, 5000],
    [6000, 17000],
  ]);
  assert.equal(
    utteranceCluster({ startMs: 0, endMs: 900 }, segments, 0, 0.9),
    0,
  );
  assert.equal(
    utteranceCluster({ startMs: 0, endMs: 3000 }, segments, 0, 0.9),
    null,
  );
  assert.equal(
    utteranceCluster({ startMs: 17000, endMs: 18000 }, segments, 0, 0.9),
    null,
  );
  assert.equal(
    utteranceCluster(
      { startMs: 0, endMs: 900 },
      [...segments, { start: 0.3, end: 0.4, speaker: 1 }],
      0,
      0.9,
    ),
    null,
  );
});

test("the quantized diarization model processes a quiet chunk without forcing selected profile count", {
  skip:
    !process.env.FFMPEG_BIN ||
    !process.env.FFPROBE_BIN ||
    !process.env.SPEAKER_MODEL_PATH ||
    !process.env.SPEAKER_SEGMENTATION_MODEL_PATH,
}, async () => {
  const { SPEAKER_MATCHING_CONFIG } = await import(
    "../../shared/speaker-matching.ts"
  );
  const directory = await mkdtemp(join(tmpdir(), "yoin-diarization-test-"));
  try {
    const file = join(directory, "silent.wav");
    await execFile(process.env.FFMPEG_BIN, [
      "-nostdin",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=16000:cl=mono",
      "-t",
      "4",
      file,
    ]);
    const bytes = await readFile(file);
    const result = await identifySpeakers(
      {
        chunkUrl: "https://yoin.test/internal/chunks/job/clip/0?signature=test",
        offsetMs: 0,
        durationMs: 4000,
        utterances: [{ id: "u", speaker: "unknown", startMs: 0, endMs: 300 }],
        profiles: [],
        matchingConfig: SPEAKER_MATCHING_CONFIG,
      },
      {
        origin: "https://yoin.test",
        ffmpeg: process.env.FFMPEG_BIN,
        ffprobe: process.env.FFPROBE_BIN,
        fetch: async () => new Response(bytes),
      },
    );
    assert.deepEqual(result.matches, [
      { speaker: "unknown", utteranceId: "u", speakerProfileId: null },
    ]);
    assert.deepEqual(result.matchingConfig, SPEAKER_MATCHING_CONFIG);
    const changedConfig = {
      ...SPEAKER_MATCHING_CONFIG,
      clusteringThreshold: 0.4,
    };
    const again = await identifySpeakers(
      {
        chunkUrl: "https://yoin.test/internal/chunks/job/clip/0?signature=test",
        offsetMs: 0,
        durationMs: 4000,
        utterances: [{ id: "u", speaker: "unknown", startMs: 0, endMs: 300 }],
        profiles: [],
        matchingConfig: changedConfig,
      },
      {
        origin: "https://yoin.test",
        ffmpeg: process.env.FFMPEG_BIN,
        ffprobe: process.env.FFPROBE_BIN,
        fetch: async () => new Response(bytes),
      },
    );
    assert.deepEqual(again.matches, result.matches);
    assert.deepEqual(again.matchingConfig, changedConfig);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("overlapping transcript intervals remain unidentified even when segmentation reports one voice", async () => {
  const { utteranceCluster } = await import("./speakers.mjs");
  const utterance = { id: "a", startMs: 0, endMs: 900 };
  assert.equal(
    utteranceCluster(utterance, [{ start: 0, end: 1, speaker: 0 }], 0, 0.9, [
      utterance,
      { id: "b", startMs: 400, endMs: 500 },
    ]),
    null,
  );
});

test("new labelled-voice pools aggregate short intervals without adding excluded overlap back", () => {
  const utterances = Array.from({ length: 6 }, (_, i) => ({
    speaker: "spk_1",
    startMs: i * 3000,
    endMs: i * 3000 + 2000,
  }));
  const intervals = speakerIntervals(utterances, 0, 20000, {
    minimumIntervalMs: 200,
    maximumGapMs: 0,
    excludeUnknownOverlap: true,
  });
  assert.equal(
    intervals.get("spk_1").reduce((sum, [a, b]) => sum + b - a, 0),
    12000,
  );
  assert.deepEqual(
    speakerIntervals(
      [
        { speaker: "spk_1", startMs: 0, endMs: 1000 },
        { speaker: "unknown", startMs: 400, endMs: 600 },
      ],
      0,
      2000,
      { minimumIntervalMs: 200, maximumGapMs: 0, excludeUnknownOverlap: true },
    ).get("spk_1"),
    [
      [0, 400],
      [600, 1000],
    ],
  );
});
