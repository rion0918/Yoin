import { Directory, File, Paths } from "expo-file-system";
import { requireNativeModule } from "expo-modules-core";
import { Platform } from "react-native";
import { accountStorageKey } from "./account";

type NativeSaveResult =
  | { status: "saved"; uri: string; fileName: string }
  | { status: "cancelled"; cleanupFailed?: true };

type NativeSongExportModule = {
  saveMp3Async: (
    sourceUri: string,
    fileName: string,
    operationId: string,
  ) => Promise<NativeSaveResult>;
  cancelSaveAsync: (operationId: string) => Promise<void>;
  deleteFileAsync: (uri: string) => Promise<boolean>;
};

function nativeModule() {
  if (Platform.OS !== "android")
    throw new Error("MP3の保存はAndroidアプリでご利用ください。");
  return requireNativeModule<NativeSongExportModule>("YoinSongExport");
}

function exportDirectory(uid: string) {
  return new Directory(
    Paths.cache,
    "accounts",
    accountStorageKey(uid),
    "song-exports",
  );
}

export async function createSongExportTemporaryUri(
  uid: string,
  operationId: string,
) {
  const directory = exportDirectory(uid);
  directory.create({ idempotent: true, intermediates: true });
  return new File(directory, `${operationId}.mp3`).uri;
}

export async function downloadSongExportAudio(
  url: string,
  uri: string,
  options: {
    signal: AbortSignal;
    onProgress: (progress: {
      bytesWritten: number;
      totalBytes: number;
    }) => void;
  },
) {
  const file = await File.downloadFileAsync(url, new File(uri), options);
  return { uri: file.uri, size: file.size };
}

export async function saveSongExportFile(input: {
  sourceUri: string;
  fileName: string;
  operationId: string;
}) {
  return nativeModule().saveMp3Async(
    input.sourceUri,
    input.fileName,
    input.operationId,
  );
}

export async function cancelSongExportSave(operationId: string) {
  if (Platform.OS !== "android") return;
  await nativeModule().cancelSaveAsync(operationId);
}

export async function deleteSongExportTemporaryFile(uri: string) {
  const file = new File(uri);
  if (file.exists) file.delete();
}

export async function deleteSongExportSavedFile(uri: string) {
  return nativeModule().deleteFileAsync(uri);
}

export async function cleanSongExportTemporaryFiles(uid: string) {
  if (Platform.OS !== "android") return;
  const directory = exportDirectory(uid);
  if (!directory.exists) return;
  for (const entry of directory.list()) {
    if (entry instanceof File) entry.delete();
    else entry.delete();
  }
}

export async function eraseSongExportTemporaryFiles(uid: string) {
  if (Platform.OS !== "android") return;
  const directory = exportDirectory(uid);
  if (directory.exists) directory.delete();
}
