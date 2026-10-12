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
