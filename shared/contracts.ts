export const MAX_AUDIO_MS = 60 * 60 * 1000;
export const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
export const UPLOAD_PART_BYTES = 8 * 1024 * 1024;
export const CHUNK_MS = 25 * 60 * 1000;
export const SPEAKER_SAMPLE_MS = 20_000;
export const MIN_SPEAKER_SAMPLE_MS = 10_000;
export const MAX_SPEAKER_SAMPLE_MS = 30_000;
export const MAX_SPEAKER_SAMPLE_BYTES = 5 * 1024 * 1024;
export const SPEAKER_MODEL_VERSION =
  "wespeaker-resnet34-lm-e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012";
export const SPEAKER_EMBEDDING_DIM = 256;
export type RegisteredSpeaker = {
  id: string;
  name: string;
  modelVersion: string;
  embedding: number[];
};
export type SpeakerMatch = { speaker: string; speakerProfileId: string | null };

export type SpeakerProfile = {
  id: string;
  name: string;
  status: "pending" | "ready";
  sampleId: string | null;
  modelVersion: string | null;
};
export type LocalSpeakerSample = {
  purpose: "speaker";
  id: string;
  speakerProfileId: string;
  localUri: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
};
export type LocalSpeakerProfile = SpeakerProfile & {
  sample?: LocalSpeakerSample;
};
export type SpeakerSampleDocument = {
  id: string;
  speakerProfileId: string;
  status: "uploading" | "uploaded" | "ready";
};

export type RecordingTarget =
  | { purpose?: "conversation"; draftId: string }
  | { purpose: "speaker"; speakerProfileId: string };
export type ConversationRecordingMetadata = {
  purpose?: "conversation";
  draftId: string;
  clipId: string;
  recordedAt: string;
  timezone: string;
};
export type SpeakerRecordingMetadata = {
  purpose: "speaker";
  speakerProfileId: string;
  clipId: string;
  recordedAt: string;
  timezone: string;
};
export type RecordingMetadata =
  | ConversationRecordingMetadata
  | SpeakerRecordingMetadata;
export type ConversationPendingRecording = {
  purpose?: "conversation";
  draftId: string;
  clipId: string;
  recordedAt: string;
  timezone: string;
  localUri: string | null;
};
export type SpeakerPendingRecording = {
  purpose: "speaker";
  speakerProfileId: string;
  clipId: string;
  recordedAt: string;
  timezone: string;
  localUri: string | null;
};
export type PendingRecording =
  | ConversationPendingRecording
  | SpeakerPendingRecording;

export type AudioClip = {
  id: string;
  draftId: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
  recordedAt: string | null;
  importedAt: string | null;
  timezone: string;
  place: string | null;
};

export type UploadProgress = {
  uploadId: string;
  parts: { partNumber: number; etag: string }[];
  complete: boolean;
};

export type LocalClip = AudioClip & {
  purpose?: "conversation";
  localUri: string;
  upload?: UploadProgress;
};
export type SavedRecording = LocalClip | LocalSpeakerSample;

export type Utterance = {
  id: string;
  clipId: string;
  startMs: number;
  endMs: number;
  speaker: string;
  speakerProfileId?: string;
  speakerName?: string;
  text: string;
};

export type LyricBlock = {
  id: string;
  text: string;
  sourceUtteranceIds: string[];
};

export type LyricRevision = { revision: number; blocks: LyricBlock[] };
export type DraftStatus =
  | "local"
  | "uploading"
  | "preparing"
  | "waiting_review"
  | "generating"
  | "ready"
  | "failed"
  | "needs_reconciliation";

export type DraftDocument = {
  id: string;
  title: string;
  createdAt: string;
  speakerProfileIds?: string[];
  clips: AudioClip[];
  utterances: Utterance[];
  lyrics: LyricRevision | null;
  status: DraftStatus;
  jobId: string | null;
  error: string | null;
};

export type LocalDraft = Omit<DraftDocument, "clips"> & {
  clips: LocalClip[];
  prepareKey?: string;
  generateKey?: string;
};

export type SongDocument = {
  id: string;
  draftId: string;
  title: string;
  createdAt: string;
  speakerProfileIds?: string[];
  clips: AudioClip[];
  utterances: Utterance[];
  lyrics: LyricRevision;
  audioId: string;
  durationMs: number;
};

export type JobDocument = {
  id: string;
  draftId: string;
  kind: "prepare" | "generate";
  status:
    | "queued"
    | "running"
    | "waiting_review"
    | "ready"
    | "failed"
    | "needs_reconciliation";
  stage: string;
  error: string | null;
  songId: string | null;
};

export type LibraryDocument = {
  drafts: LocalDraft[];
  songs: SongDocument[];
  speakerProfiles?: LocalSpeakerProfile[];
  pendingRecording: PendingRecording | null;
  recoveryFiles?: NonNullable<LibraryDocument["pendingRecording"]>[];
};

export type MediaChunk = {
  key: string;
  offsetMs: number;
  durationMs: number;
  mimeType: string;
};
export type MediaInspection = {
  durationMs: number;
  sizeBytes: number;
  chunks: MediaChunk[];
};
export type UploadCreated = {
  uploadId: string;
  partBytes: number;
  parts: { partNumber: number; etag: string }[];
  complete: boolean;
};
export type AudioUrl = { url: string; expiresAt: string };

export function emptyLibrary(): LibraryDocument {
  return { drafts: [], songs: [], speakerProfiles: [], pendingRecording: null };
}
