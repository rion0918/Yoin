import {
  type AudioClip,
  type LyricBlock,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_MS,
  type Utterance,
} from "../shared/contracts.ts";
import { HttpError } from "./types.ts";

export function id(value: unknown) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(value))
    throw new HttpError(422, "invalid_id");
  return value;
}
export function text(value: unknown, limit: number) {
  if (typeof value !== "string" || !value.trim() || value.length > limit)
    throw new HttpError(422, "invalid_text");
  return value.trim();
}
export function integer(value: unknown, minimum: number, maximum: number) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    throw new HttpError(422, "invalid_number");
  return value;
}
function nullableDate(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new HttpError(422, "invalid_date");
  return value;
}
export async function json(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > 150_000) throw new HttpError(413, "request_too_large");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "invalid_json");
  return value as Record<string, unknown>;
}
export function clipMetadata(
  value: Record<string, unknown>,
  draftId: string,
): AudioClip {
  const mimeType = text(value.mimeType, 80);
  if (
    ![
      "audio/mp4",
      "audio/m4a",
      "audio/x-m4a",
      "audio/mpeg",
      "audio/mp3",
      "audio/wav",
      "audio/x-wav",
      "audio/aac",
    ].includes(mimeType)
  )
    throw new HttpError(422, "unsupported_audio_format");
  const timezone = text(value.timezone, 100);
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    throw new HttpError(422, "invalid_timezone");
  }
  return {
    id: id(value.id),
    draftId,
    mimeType,
    sizeBytes: integer(value.sizeBytes, 1, MAX_AUDIO_BYTES),
    durationMs: integer(value.durationMs, 1, MAX_AUDIO_MS),
    recordedAt: nullableDate(value.recordedAt),
    importedAt: nullableDate(value.importedAt),
    timezone,
    place:
      value.place === null || value.place === undefined || value.place === ""
        ? null
        : text(value.place, 200),
  };
}
export function validateBlocks(
  value: unknown,
  utterances: Utterance[],
): LyricBlock[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16)
    throw new HttpError(422, "invalid_lyrics");
  const sources = new Set(utterances.map((item) => item.id));
  const ids = new Set<string>();
  let totalLength = 0;
  return value.map((item) => {
    if (!item || typeof item !== "object")
      throw new HttpError(422, "invalid_lyrics");
    const blockId = text(item.id, 80);
    if (ids.has(blockId)) throw new HttpError(422, "duplicate_lyric_id");
    ids.add(blockId);
    if (
      !Array.isArray(item.sourceUtteranceIds) ||
      item.sourceUtteranceIds.length === 0 ||
      item.sourceUtteranceIds.length > 64 ||
      item.sourceUtteranceIds.some(
        (source: unknown) => typeof source !== "string" || !sources.has(source),
      )
    )
      throw new HttpError(422, "invalid_lyric_source");
    const blockText = text(item.text, 6000);
    totalLength += blockText.length;
    if (totalLength > 6000) throw new HttpError(422, "invalid_lyrics");
    return {
      id: blockId,
      text: blockText,
      sourceUtteranceIds: [...new Set<string>(item.sourceUtteranceIds)],
    };
  });
}
export function validateUtterances(
  value: Utterance[],
  clipId: string,
  durationMs: number,
) {
  const ids = new Set<string>();
  return value.map((item) => {
    if (typeof item.id !== "string" || !/^[a-zA-Z0-9_:-]{1,160}$/.test(item.id))
      throw new HttpError(422, "invalid_utterance_id");
    const utteranceId = item.id;
    if (ids.has(utteranceId) || item.clipId !== clipId)
      throw new HttpError(422, "invalid_transcript_source");
    ids.add(utteranceId);
    const startMs = integer(item.startMs, 0, durationMs);
    const endMs = integer(item.endMs, startMs + 1, durationMs);
    return {
      id: utteranceId,
      clipId,
      startMs,
      endMs,
      speaker: text(item.speaker, 100),
      text: text(item.text, 10_000),
    };
  });
}
