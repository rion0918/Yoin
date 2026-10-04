export const MAX_AUDIO_MS = 60 * 60 * 1000;
export const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
export const UPLOAD_PART_BYTES = 8 * 1024 * 1024;
export const CHUNK_MS = 25 * 60 * 1000;

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
  localUri: string;
  upload?: UploadProgress;
};

export type Utterance = {
  id: string;
  clipId: string;
  startMs: number;
  endMs: number;
  speaker: string;
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
  pendingRecording: {
    clipId: string;
    draftId: string;
    recordedAt: string;
    timezone: string;
    localUri: string | null;
  } | null;
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
  return { drafts: [], songs: [], pendingRecording: null };
}
