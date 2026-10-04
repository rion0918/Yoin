import {
  emptyLibrary,
  type LibraryDocument,
  type LocalClip,
} from "../../shared/contracts";
import { createSerialQueue } from "./operations";
import type { AudioInspection, Connection, PendingRecording } from "./types";

const writes = createSerialQueue();
let sessionToken = "";
const nativeOnly = () =>
  new Error("端末の音声機能はiOS・Androidアプリでご利用ください。");

export async function loadLibrary(): Promise<LibraryDocument> {
  const value =
    typeof localStorage === "undefined"
      ? null
      : localStorage.getItem("yoin.library");
  return value ? (JSON.parse(value) as LibraryDocument) : emptyLibrary();
}

export function saveLibrary(state: LibraryDocument): Promise<void> {
  const snapshot = JSON.stringify(state);
  return writes.run(async () => {
    localStorage.setItem("yoin.library", snapshot);
  });
}

export async function importAudio(_draftId: string): Promise<LocalClip | null> {
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
  _pending: PendingRecording,
): Promise<LocalClip | null> {
  return null;
}
export async function loadConnection(): Promise<Connection> {
  return {
    apiUrl:
      typeof localStorage === "undefined"
        ? ""
        : (localStorage.getItem("yoin.apiUrl") ?? ""),
    token: sessionToken,
  };
}
export async function saveConnection(connection: Connection): Promise<void> {
  localStorage.setItem("yoin.apiUrl", connection.apiUrl);
  sessionToken = connection.token;
}
