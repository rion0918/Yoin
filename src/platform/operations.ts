import {
  type ConversationPendingRecording,
  type ConversationRecordingMetadata,
  type LocalClip,
  type LocalSpeakerSample,
  type RecordingMetadata,
  type SavedRecording,
  SPEAKER_SAMPLE_MS,
  type SpeakerPendingRecording,
  type SpeakerRecordingMetadata,
  UPLOAD_PART_BYTES,
} from "../../shared/contracts.ts";
import type { AudioInspection, PendingRecording } from "./types.ts";

export function createSerialQueue() {
  let tail = Promise.resolve();
  return {
    run<T>(operation: () => Promise<T>): Promise<T> {
      const result = tail.then(operation);
      tail = result.then(
        () => {},
        () => {},
      );
      return result;
    },
  };
}

export function createSingleFlight() {
  const active = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, operation: () => Promise<T>): Promise<T> {
      const existing = active.get(key);
      if (existing) return existing as Promise<T>;
      const result = Promise.resolve().then(operation);
      const settled = result.finally(() => active.delete(key));
      active.set(key, settled);
      return settled;
    },
  };
}

export function shouldStopSpeakerRecording(
  pending: PendingRecording,
  durationMs: number,
) {
  return pending.purpose === "speaker" && durationMs >= SPEAKER_SAMPLE_MS;
}

export function audioPartRange(
  sizeBytes: number,
  partNumber: number,
  partBytes: number,
) {
  if (
    !Number.isSafeInteger(partNumber) ||
    partNumber < 1 ||
    !Number.isSafeInteger(partBytes) ||
    partBytes < 1 ||
    partBytes > UPLOAD_PART_BYTES
  ) {
    throw new Error("音声の送信区間が正しくありません。");
  }
  const offset = (partNumber - 1) * partBytes;
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || offset >= sizeBytes)
    throw new Error("音声の送信区間が正しくありません。");
  return { offset, length: Math.min(partBytes, sizeBytes - offset) };
}

export function validateInspection(
  inspection: AudioInspection,
): AudioInspection {
  if (
    !Number.isFinite(inspection.durationMs) ||
    inspection.durationMs <= 0 ||
    !Number.isSafeInteger(inspection.sizeBytes) ||
    inspection.sizeBytes <= 0
  )
    throw new Error("音声を読み取れませんでした。");
  return inspection;
}

export function clipFromRecording(
  pending: ConversationPendingRecording,
  inspection: AudioInspection,
): LocalClip;
export function clipFromRecording(
  pending: SpeakerPendingRecording,
  inspection: AudioInspection,
): LocalSpeakerSample;
export function clipFromRecording(
  pending: PendingRecording,
  inspection: AudioInspection,
): SavedRecording {
  if (!pending.localUri) throw new Error("録音ファイルが見つかりません。");
  if (pending.purpose === "speaker")
    return {
      ...validateInspection(inspection),
      purpose: "speaker",
      id: pending.clipId,
      speakerProfileId: pending.speakerProfileId,
      localUri: pending.localUri,
    };
  return {
    ...validateInspection(inspection),
    id: pending.clipId,
    draftId: pending.draftId,
    localUri: pending.localUri,
    recordedAt: pending.recordedAt,
    importedAt: null,
    timezone: pending.timezone,
    place: null,
  };
}

type PreparedRecorder = {
  uri: string | null;
  prepareToRecordAsync: () => Promise<void>;
  record: () => void;
};
type PersistPending = (pending: PendingRecording) => Promise<void>;

export function beginPreparedRecording(
  recorder: PreparedRecorder,
  metadata: ConversationRecordingMetadata,
  onPrepared: PersistPending,
): Promise<ConversationPendingRecording>;
export function beginPreparedRecording(
  recorder: PreparedRecorder,
  metadata: SpeakerRecordingMetadata,
  onPrepared: PersistPending,
): Promise<SpeakerPendingRecording>;
export async function beginPreparedRecording(
  recorder: {
    uri: string | null;
    prepareToRecordAsync: () => Promise<void>;
    record: () => void;
  },
  metadata: RecordingMetadata,
  onPrepared: PersistPending,
): Promise<PendingRecording> {
  await recorder.prepareToRecordAsync();
  if (!recorder.uri)
    throw new Error("録音ファイルの保存先を確保できませんでした。");
  const prepared: PendingRecording = {
    ...metadata,
    recordedAt: new Date().toISOString(),
    localUri: recorder.uri,
  };
  await onPrepared(prepared);
  recorder.record();
  return prepared;
}

export function importedClip(
  id: string,
  draftId: string,
  localUri: string,
  inspection: AudioInspection,
  importedAt: string,
  timezone: string,
): LocalClip {
  return {
    ...validateInspection(inspection),
    id,
    draftId,
    localUri,
    recordedAt: null,
    importedAt,
    timezone,
    place: null,
  };
}

export function mimeTypeForUri(uri: string, declared = ""): string {
  if (declared.startsWith("audio/")) return declared;
  const extension = uri.split("?")[0].split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    m4a: "audio/mp4",
    mp4: "audio/mp4",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    aac: "audio/aac",
    flac: "audio/flac",
    ogg: "audio/ogg",
    webm: "audio/webm",
    aiff: "audio/aiff",
  };
  return mimeTypes[extension ?? ""] ?? "application/octet-stream";
}
