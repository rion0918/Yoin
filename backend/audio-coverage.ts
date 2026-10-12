import type { AudioActivityRange, Utterance } from "../shared/contracts.ts";

const BOUNDARY_TOLERANCE_MS = 1000;
const UTTERANCE_PADDING_MS = 2000;
const MIN_UNRECOGNIZED_GAP_MS = 15_000;
const MIN_UNRECOGNIZED_ACTIVITY_MS = 5000;

type TimedRange = { startMs: number; endMs: number };

function mergeRanges(ranges: TimedRange[]): TimedRange[] {
  const sorted = ranges
    .filter(
      ({ startMs, endMs }) =>
        Number.isSafeInteger(startMs) &&
        Number.isSafeInteger(endMs) &&
        startMs >= 0 &&
        endMs > startMs,
    )
    .sort((left, right) => left.startMs - right.startMs);
  const merged: TimedRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.startMs <= previous.endMs) {
      previous.endMs = Math.max(previous.endMs, range.endMs);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function duration(ranges: TimedRange[]) {
  return ranges.reduce(
    (total, range) => total + range.endMs - range.startMs,
    0,
  );
}

function subtractRanges(
  ranges: TimedRange[],
  covered: TimedRange[],
): TimedRange[] {
  const remaining: TimedRange[] = [];
  for (const range of ranges) {
    let cursor = range.startMs;
    for (const cover of covered) {
      if (cover.endMs <= cursor) continue;
      if (cover.startMs >= range.endMs) break;
      if (cover.startMs > cursor)
        remaining.push({
          startMs: cursor,
          endMs: Math.min(cover.startMs, range.endMs),
        });
      cursor = Math.max(cursor, cover.endMs);
      if (cursor >= range.endMs) break;
    }
    if (cursor < range.endMs)
      remaining.push({ startMs: cursor, endMs: range.endMs });
  }
  return remaining;
}

export function hasContinuousCoverage(
  durationMs: number,
  chunks: Array<{ offsetMs: number; durationMs: number }>,
) {
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs < 1 ||
    !chunks.length ||
    chunks.length > 3
  )
    return false;
  let cursor = 0;
  for (const chunk of chunks) {
    if (
      !Number.isSafeInteger(chunk.offsetMs) ||
      !Number.isSafeInteger(chunk.durationMs) ||
      chunk.durationMs < 1 ||
      Math.abs(chunk.offsetMs - cursor) > BOUNDARY_TOLERANCE_MS
    )
      return false;
    cursor = chunk.offsetMs + chunk.durationMs;
  }
  return Math.abs(durationMs - cursor) <= BOUNDARY_TOLERANCE_MS;
}

export function analyzeTranscriptCoverage(input: {
  durationMs: number;
  activityRanges: AudioActivityRange[];
  utterances: Array<Pick<Utterance, "startMs" | "endMs">>;
}) {
  const activityRanges = mergeRanges(
    input.activityRanges.map(({ startMs, endMs }) => ({
      startMs: Math.max(0, startMs),
      endMs: Math.min(input.durationMs, endMs),
    })),
  );
  const transcriptRanges = mergeRanges(
    input.utterances.map(({ startMs, endMs }) => ({
      startMs: Math.max(0, startMs),
      endMs: Math.min(input.durationMs, endMs),
    })),
  );
  const paddedTranscript = mergeRanges(
    transcriptRanges.map(({ startMs, endMs }) => ({
      startMs: Math.max(0, startMs - UTTERANCE_PADDING_MS),
      endMs: Math.min(input.durationMs, endMs + UTTERANCE_PADDING_MS),
    })),
  );
  const unrecognizedRanges = subtractRanges(activityRanges, paddedTranscript);
  const gaps: TimedRange[] = [];
  let cursor = 0;
  for (const transcriptRange of paddedTranscript) {
    if (transcriptRange.startMs - cursor >= MIN_UNRECOGNIZED_GAP_MS)
      gaps.push({ startMs: cursor, endMs: transcriptRange.startMs });
    cursor = Math.max(cursor, transcriptRange.endMs);
  }
  if (input.durationMs - cursor >= MIN_UNRECOGNIZED_GAP_MS)
    gaps.push({ startMs: cursor, endMs: input.durationMs });
  const needsReview = gaps.some((gap) =>
    unrecognizedRanges.some(
      (range) =>
        Math.max(
          0,
          Math.min(range.endMs, gap.endMs) -
            Math.max(range.startMs, gap.startMs),
        ) >= MIN_UNRECOGNIZED_ACTIVITY_MS,
    ),
  );
  return {
    needsReview,
    speechActivityMs: duration(activityRanges),
    transcribedMs: duration(transcriptRanges),
    unrecognizedActivityMs: duration(unrecognizedRanges),
    unrecognizedRanges,
  };
}
