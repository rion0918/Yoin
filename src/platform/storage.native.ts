import { createAudioPlayer } from "expo-audio";
import * as DocumentPicker from "expo-document-picker";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { openDatabaseAsync } from "expo-sqlite";
import {
  emptyLibrary,
  type LibraryDocument,
  type LocalClip,
} from "../../shared/contracts";
import { waitUntilLoaded } from "./audio.native";
import {
  audioPartRange,
  clipFromRecording,
  createSerialQueue,
  importedClip,
  mimeTypeForUri,
  validateInspection,
} from "./operations";
import type { AudioInspection, Connection, PendingRecording } from "./types";

const writes = createSerialQueue();
let database: ReturnType<typeof openDatabaseAsync> | null = null;
const connectionKey = "yoin.connection";

function getDatabase() {
  if (!database) {
    database = openDatabaseAsync("yoin.db")
      .then(async (db) => {
        await db.execAsync(
          "PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS library (id INTEGER PRIMARY KEY CHECK (id = 1), document TEXT NOT NULL);",
        );
        return db;
      })
      .catch((error: unknown) => {
        database = null;
        throw error;
      });
  }
  return database;
}

export async function loadLibrary(): Promise<LibraryDocument> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ document: string }>(
    "SELECT document FROM library WHERE id = 1",
  );
  return row ? (JSON.parse(row.document) as LibraryDocument) : emptyLibrary();
}

export function saveLibrary(state: LibraryDocument): Promise<void> {
  const snapshot = JSON.stringify(state);
  return writes.run(async () => {
    const db = await getDatabase();
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

export async function importAudio(draftId: string): Promise<LocalClip | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "audio/*",
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const inspection = await inspectLocalAudio(asset.uri);
  inspection.mimeType = mimeTypeForUri(
    asset.uri,
    asset.mimeType ?? inspection.mimeType,
  );
  const id = `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const directory = new Directory(Paths.document, "audio");
  directory.create({ idempotent: true, intermediates: true });
  const source = new File(asset.uri);
  const extension = source.extension || ".audio";
  const destination = new File(directory, `${id}${extension}`);
  await source.copy(destination);
  return importedClip(
    id,
    draftId,
    destination.uri,
    inspection,
    new Date().toISOString(),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
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
  pending: PendingRecording,
): Promise<LocalClip | null> {
  if (!pending.localUri) return null;
  try {
    return clipFromRecording(
      pending,
      await inspectLocalAudio(pending.localUri),
    );
  } catch {
    return null;
  }
}

export async function loadConnection(): Promise<Connection> {
  const value = await SecureStore.getItemAsync(connectionKey);
  return value ? (JSON.parse(value) as Connection) : { apiUrl: "", token: "" };
}

export async function saveConnection(connection: Connection): Promise<void> {
  await SecureStore.setItemAsync(connectionKey, JSON.stringify(connection), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}
