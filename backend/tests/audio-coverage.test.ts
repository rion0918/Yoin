import { expect, it } from "vitest";
import {
  analyzeTranscriptCoverage,
  hasContinuousCoverage,
} from "../audio-coverage.ts";

it("accepts a continuous chunk manifest with the existing one-second tolerance", () => {
  expect(
    hasContinuousCoverage(180_000, [
      { offsetMs: 0, durationMs: 89_500 },
      { offsetMs: 90_000, durationMs: 89_500 },
    ]),
  ).toBe(true);
});

it("rejects missing audio at the beginning, between chunks, or at the end", () => {
  expect(
    hasContinuousCoverage(180_000, [{ offsetMs: 2_000, durationMs: 178_000 }]),
  ).toBe(false);
  expect(
    hasContinuousCoverage(180_000, [
      { offsetMs: 0, durationMs: 70_000 },
      { offsetMs: 80_000, durationMs: 100_000 },
    ]),
  ).toBe(false);
  expect(
    hasContinuousCoverage(180_000, [{ offsetMs: 0, durationMs: 170_000 }]),
  ).toBe(false);
});

it("flags a short transcript when a long uncovered region still has speech activity", () => {
  const result = analyzeTranscriptCoverage({
    durationMs: 180_000,
    activityRanges: [
      { startMs: 0, endMs: 3_000 },
      { startMs: 30_000, endMs: 50_000 },
      { startMs: 175_000, endMs: 180_000 },
    ],
    utterances: [
      { startMs: 0, endMs: 3_000 },
      { startMs: 175_000, endMs: 180_000 },
    ],
  });

  expect(result).toMatchObject({
    needsReview: true,
    speechActivityMs: 28_000,
    transcribedMs: 8_000,
    unrecognizedActivityMs: 20_000,
  });
});

it("does not flag long silence or recognized speech", () => {
  const result = analyzeTranscriptCoverage({
    durationMs: 180_000,
    activityRanges: [
      { startMs: 1_000, endMs: 3_000 },
      { startMs: 175_000, endMs: 179_000 },
    ],
    utterances: [
      { startMs: 1_000, endMs: 3_000 },
      { startMs: 175_000, endMs: 179_000 },
    ],
  });

  expect(result.needsReview).toBe(false);
  expect(result.unrecognizedActivityMs).toBe(0);
});
