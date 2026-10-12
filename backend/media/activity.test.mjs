import assert from "node:assert/strict";
import test from "node:test";
import { activityRangesFromSilenceLog } from "./activity.mjs";

test("silence detection returns the active spans while preserving long quiet gaps", () => {
  const ranges = activityRangesFromSilenceLog(
    "silence_start: 3.0\nsilence_end: 30.0 | silence_duration: 27.0\nsilence_start: 50.0",
    60_000,
  );
  assert.deepEqual(ranges, [
    { startMs: 0, endMs: 3000 },
    { startMs: 30_000, endMs: 50_000 },
  ]);
});

test("an all-silence input produces no active span", () => {
  assert.deepEqual(
    activityRangesFromSilenceLog(
      "silence_start: 0.0\nsilence_end: 180.0 | silence_duration: 180.0",
      180_000,
    ),
    [],
  );
});

test("a negative silence start is clamped to the beginning of the recording", () => {
  assert.deepEqual(
    activityRangesFromSilenceLog(
      "silence_start: -0.0013\nsilence_end: 30.0 | silence_duration: 30.0013",
      60_000,
    ),
    [{ startMs: 30_000, endMs: 60_000 }],
  );
});
