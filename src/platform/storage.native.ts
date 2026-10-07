import { createAudioPlayer } from "expo-audio";
import * as DocumentPicker from "expo-document-picker";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import { deleteDatabaseAsync, openDatabaseAsync } from "expo-sqlite";
import {
  emptyLibrary,
  type LibraryDocument,
  type LocalClip,
  type LocationSample,
  type SavedRecording,
} from "../../shared/contracts";
import {
  mergeBackgroundLocationSample,
  validLocationSample,
} from "../pipeline/location";
import { accountStorageKey } from "./account";
import { waitUntilLoaded } from "./audio.native";
import {
  audioPartRange,
  clipFromRecording,
  createSerialQueue,
  importedClip,
  mimeTypeForUri,
  validateInspection,
} from "./operations";
import type { AudioInspection, PendingRecording } from "./types";

const writes = createSerialQueue();
const databases = new Map<string, ReturnType<typeof openDatabaseAsync>>();
const erased = new Set<string>();
export function accountAudioDirectory(uid: string) {
  if (erased.has(uid)) throw new Error("このアカウントは削除されています。");
  const directory = new Directory(
    Paths.document,
    "accounts",
    accountStorageKey(uid),
    "audio",
  );
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}

function getDatabase(uid: string) {
  let database = databases.get(uid);
  if (!database) {
    database = openDatabaseAsync(`${accountStorageKey(uid)}.db`)
      .then(async (db) => {
        await db.execAsync(
          "PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS library (id INTEGER PRIMARY KEY CHECK (id = 1), document TEXT NOT NULL); CREATE TABLE IF NOT EXISTS pending_location_samples (clip_id TEXT PRIMARY KEY, draft_id TEXT NOT NULL, sample TEXT NOT NULL);",
        );
        return db;
      })
      .catch((error: unknown) => {
        databases.delete(uid);
        throw error;
      });
    databases.set(uid, database);
  }
  return database;
}

export async function savePendingBackgroundLocationSample(
  uid: string,
  draftId: string,
  clipId: string,
  sample: LocationSample,
): Promise<void> {
  if (!validLocationSample(sample)) return;
  const db = await getDatabase(uid);
  await db.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      "INSERT OR IGNORE INTO pending_location_samples (clip_id, draft_id, sample) VALUES (?, ?, ?)",
      clipId,
      draftId,
      JSON.stringify(sample),
    );
  });
}

export async function takePendingBackgroundLocationSample(
  uid: string,
  draftId: string,
  clipId: string,
): Promise<LocationSample | null> {
  const db = await getDatabase(uid);
  let sample: LocationSample | null = null;
  await db.withExclusiveTransactionAsync(async (transaction) => {
    const row = await transaction.getFirstAsync<{ sample: string }>(
      "SELECT sample FROM pending_location_samples WHERE clip_id = ? AND draft_id = ?",
      clipId,
      draftId,
    );
    if (!row) return;
    await transaction.runAsync(
      "DELETE FROM pending_location_samples WHERE clip_id = ? AND draft_id = ?",
      clipId,
      draftId,
    );
    try {
      const decoded = JSON.parse(row.sample) as LocationSample;
      if (validLocationSample(decoded)) sample = decoded;
    } catch {
      sample = null;
    }
  });
  return sample;
}

export async function peekPendingBackgroundLocationSample(
  uid: string,
  draftId: string,
  clipId: string,
): Promise<LocationSample | null> {
  const db = await getDatabase(uid);
  const row = await db.getFirstAsync<{ sample: string }>(
    "SELECT sample FROM pending_location_samples WHERE clip_id = ? AND draft_id = ?",
    clipId,
    draftId,
  );
  if (!row) return null;
  try {
    const sample = JSON.parse(row.sample) as LocationSample;
    return validLocationSample(sample) ? sample : null;
  } catch {
    return null;
  }
}

export async function loadLibrary(uid: string): Promise<LibraryDocument> {
  const db = await getDatabase(uid);
  const row = await db.getFirstAsync<{ document: string }>(
    "SELECT document FROM library WHERE id = 1",
  );
  if (!row) return emptyLibrary();
  const stored = JSON.parse(row.document) as LibraryDocument;
  return { ...stored, speakerProfiles: stored.speakerProfiles ?? [] };
}

export function saveLibrary(
  uid: string,
  state: LibraryDocument,
): Promise<void> {
  const snapshot = JSON.stringify(state);
  return writes.run(async () => {
    if (erased.has(uid)) throw new Error("このアカウントは削除されています。");
    const db = await getDatabase(uid);
    await db.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        "INSERT INTO library (id, document) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET document = excluded.document",
        snapshot,
      );
    });
  });
}

export async function inspectLocalAudio(uri: string): Promise<AudioInspection> {
  const file = new File(uri);
  if (!file.exists || file.size <= 0)
    throw new Error("音声ファイルが見つかりません。");
  const player = createAudioPlayer(uri, { updateInterval: 100 });
  try {
    const seconds = await waitUntilLoaded(player);
    return validateInspection({
      durationMs: Math.round(seconds * 1000),
      sizeBytes: file.size,
      mimeType: mimeTypeForUri(uri, file.type),
    });
  } finally {
    player.release();
  }
}

export async function importAudio(
  uid: string,
  draftId: string,
): Promise<LocalClip | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "audio/*",
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const source = new File(asset.uri);
  try {
    const inspection = await inspectLocalAudio(asset.uri);
    inspection.mimeType = mimeTypeForUri(
      asset.uri,
      asset.mimeType ?? inspection.mimeType,
    );
    const id = `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const directory = accountAudioDirectory(uid);
    const destination = new File(
      directory,
      `${id}${source.extension || ".audio"}`,
    );
    source.copy(destination);
    return importedClip(
      id,
      draftId,
      destination.uri,
      inspection,
      new Date().toISOString(),
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  } finally {
    if (source.uri.startsWith(Paths.cache.uri) && source.exists)
      source.delete();
  }
}

export async function readAudioPart(
  uri: string,
  partNumber: number,
  partBytes: number,
): Promise<Uint8Array> {
  const file = new File(uri);
  if (!file.exists) throw new Error("音声ファイルが見つかりません。");
  const range = audioPartRange(file.size, partNumber, partBytes);
  const handle = file.open(FileMode.ReadOnly);
  try {
    handle.offset = range.offset;
    const bytes = handle.readBytes(range.length);
    if (bytes.length !== range.length)
      throw new Error("音声の送信区間を読み取れませんでした。");
    return bytes;
  } finally {
    handle.close();
  }
}

export async function recoverRecording(
  uid: string,
  pending: PendingRecording,
): Promise<SavedRecording | null> {
  if (!pending.localUri) return null;
  try {
    const candidate = new File(pending.localUri).exists
      ? pending.localUri
      : new File(accountAudioDirectory(uid), `${pending.clipId}.m4a`).uri;
    const inspection = await inspectLocalAudio(candidate);
    const recording = { ...pending, localUri: candidate };
    if (recording.purpose === "speaker")
      return clipFromRecording(recording, inspection);
    const recovered = clipFromRecording(recording, inspection);
    const sample = await takePendingBackgroundLocationSample(
      uid,
      recording.draftId,
      recording.clipId,
    );
    const locationRoute = sample
      ? mergeBackgroundLocationSample(
          null,
          recording,
          sample,
          Date.parse(recording.recordedAt) + inspection.durationMs,
        )
      : null;
    return locationRoute ? { ...recovered, locationRoute } : recovered;
  } catch {
    return null;
  }
}

export async function preserveRecording(
  uid: string,
  clip: SavedRecording,
): Promise<SavedRecording> {
  const destination = new File(accountAudioDirectory(uid), `${clip.id}.m4a`);
  if (clip.localUri !== destination.uri) {
    const source = new File(clip.localUri);
    if (!destination.exists) source.move(destination);
  }
  return { ...clip, localUri: destination.uri };
}
export async function eraseLibrary(uid: string): Promise<void> {
  erased.add(uid);
  return writes.run(async () => {
    const library = await loadLibrary(uid);
    const pending = [
      library.pendingRecording,
      ...(library.recoveryFiles ?? []),
    ];
    for (const recording of pending) {
      if (recording?.localUri) {
        const file = new File(recording.localUri);
        if (file.exists) file.delete();
      }
    }
    const db = await databases.get(uid);
    if (db) await db.closeAsync();
    databases.delete(uid);
    await deleteDatabaseAsync(`${accountStorageKey(uid)}.db`);
    const directory = new Directory(
      Paths.document,
      "accounts",
      accountStorageKey(uid),
    );
    if (directory.exists) directory.delete();
  });
}
export async function readSpeakerAudio(uri: string): Promise<Uint8Array> {
  const file = new File(uri);
  if (!file.exists || file.size <= 0 || file.size > 5 * 1024 * 1024)
    throw new Error("登録用の声の録音が見つからないか、大きすぎます。");
  const handle = file.open(FileMode.ReadOnly);
  try {
    const bytes = handle.readBytes(file.size);
    if (bytes.length !== file.size)
      throw new Error("登録用の声の録音を読み取れませんでした。");
    return bytes;
  } finally {
    handle.close();
  }
}

export async function deleteSpeakerAudio(uri: string): Promise<void> {
  const file = new File(uri);
  if (file.exists) file.delete();
}
