import type { LibraryDocument, SavedRecording } from "../../shared/contracts";

export type PendingRecording = NonNullable<LibraryDocument["pendingRecording"]>;
export type AudioInspection = {
  durationMs: number;
  sizeBytes: number;
  mimeType: string;
};
export type RecorderPhase =
  | "off"
  | "preparing"
  | "recording"
  | "saving"
  | "interrupted";
export type AudioEngineState = {
  recorderState: RecorderPhase;
  elapsedMs: number;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  error: string | null;
  locationStatus:
    | "off"
    | "acquiring"
    | "tracking"
    | "foreground-only"
    | "unavailable";
};
export type NativeStopListener = (clip: SavedRecording) => void | Promise<void>;
export type PreparedListener = (pending: PendingRecording) => Promise<void>;
export type AudioEngine = {
  state: AudioEngineState;
  startRecording: (
    clipId: string,
    draftId: string,
    recordedAt: string,
    timezone: string,
    onPrepared?: PreparedListener,
    speakerProfileId?: string,
    locationEnabled?: boolean,
  ) => Promise<PendingRecording>;
  setLocationEnabled: (enabled: boolean) => Promise<boolean>;
  stopRecording: () => Promise<SavedRecording | null>;
  play: (uri: string, startMs?: number, endMs?: number) => Promise<void>;
  pause: () => Promise<void>;
  seek: (ms: number) => Promise<void>;
  stopPlayback: () => Promise<void>;
};
