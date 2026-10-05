import {
  emptyLibrary,
  type LibraryDocument,
  type LocalClip,
  type SavedRecording,
} from "../../shared/contracts";
import { createSerialQueue } from "./operations";
import type { AudioInspection, PendingRecording } from "./types";

const writes = createSerialQueue();

import { accountStorageKey } from "./account";

const nativeOnly = () =>
  new Error("端末の音声機能はiOS・Androidアプリでご利用ください。");

export async function loadLibrary(uid: string): Promise<LibraryDocument> {
  const value =
    typeof localStorage === "undefined"
      ? null
      : localStorage.getItem(`yoin.library.${accountStorageKey(uid)}`);
  if (!value) return emptyLibrary();
  const stored = JSON.parse(value) as LibraryDocument;
  return { ...stored, speakerProfiles: stored.speakerProfiles ?? [] };
}

export function saveLibrary(
  uid: string,
  state: LibraryDocument,
): Promise<void> {
  const snapshot = JSON.stringify(state);
  return writes.run(async () => {
    localStorage.setItem(`yoin.library.${accountStorageKey(uid)}`, snapshot);
  });
}

export async function importAudio(
  _uid: string,
  _draftId: string,
): Promise<LocalClip | null> {
  throw nativeOnly();
}
export async function inspectLocalAudio(
  _uri: string,
): Promise<AudioInspection> {
  throw nativeOnly();
}
export async function readAudioPart(
  _uri: string,
  _partNumber: number,
  _partBytes: number,
): Promise<Uint8Array> {
  throw nativeOnly();
}
export async function recoverRecording(
  _uid: string,
  _pending: PendingRecording,
): Promise<SavedRecording | null> {
  return null;
}
export async function preserveRecording(_uid: string, clip: SavedRecording) {
  return clip;
}
export async function eraseLibrary(uid: string) {
  localStorage.removeItem(`yoin.library.${accountStorageKey(uid)}`);
}
export async function readSpeakerAudio(_uri: string): Promise<Uint8Array> {
  throw nativeOnly();
}
export async function deleteSpeakerAudio(_uri: string): Promise<void> {
  throw nativeOnly();
}
