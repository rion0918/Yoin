import assert from "node:assert/strict";
import test from "node:test";
import { chooseSpeaker, speakerIntervals } from "./speakers.mjs";

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
