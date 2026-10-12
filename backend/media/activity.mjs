export function activityRangesFromSilenceLog(log, durationMs) {
  if (!Number.isSafeInteger(durationMs) || durationMs < 1)
    throw new Error("invalid_audio_duration");
  const events = [
    ...log.matchAll(/silence_(start|end):\s*(-?[0-9]+(?:\.[0-9]+)?)/g),
  ]
    .map((match) => ({
      kind: match[1],
      atMs: Math.round(Number(match[2]) * 1000),
    }))
    .filter((event) => Number.isSafeInteger(event.atMs))
    .sort((left, right) => left.atMs - right.atMs);
  const ranges = [];
  let cursor = 0;
  let silenceStart = null;
  for (const event of events) {
    const atMs = Math.max(0, Math.min(durationMs, event.atMs));
    if (event.kind === "start" && silenceStart === null) {
      if (atMs > cursor) ranges.push({ startMs: cursor, endMs: atMs });
      silenceStart = atMs;
    } else if (event.kind === "end" && silenceStart !== null) {
      cursor = Math.max(cursor, atMs);
      silenceStart = null;
    }
  }
  if (silenceStart === null && cursor < durationMs)
    ranges.push({ startMs: cursor, endMs: durationMs });
  return ranges.filter((range) => range.endMs > range.startMs);
}
