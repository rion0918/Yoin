import type { SongDocument } from "../../shared/contracts.ts";

export type SongExportState = {
  operationId: string;
  songId: string;
  draftId: string;
  title: string;
  phase: "downloading" | "saving";
  bytesWritten: number;
  totalBytes: number;
};

export type SongExportResult =
  | { status: "saved"; uri: string; fileName: string }
  | { status: "cancelled"; cleanupFailed?: true }
  | { status: "busy" }
  | { status: "failed"; message: string };

export type SongExportDependencies = {
  createOperationId: () => string;
  createTemporaryUri: (operationId: string) => Promise<string>;
  getAudioUrl: (audioId: string) => Promise<{ url: string }>;
  download: (
    url: string,
    uri: string,
    options: {
      signal: AbortSignal;
      onProgress: (progress: {
        bytesWritten: number;
        totalBytes: number;
      }) => void;
    },
  ) => Promise<{ uri: string; size: number }>;
  saveFile: (input: {
    sourceUri: string;
    fileName: string;
    operationId: string;
  }) => Promise<
    | { status: "saved"; uri: string; fileName: string }
    | { status: "cancelled"; cleanupFailed?: true }
  >;
  cancelSave: (operationId: string) => Promise<void>;
  deleteTemporaryFile: (uri: string) => Promise<void>;
  deleteSavedFile: (uri: string) => Promise<boolean>;
  onState: (state: SongExportState | null) => void;
};

const invalidFilenameCharacters = new Set([
  "<",
  ">",
  ":",
  '"',
  "/",
  "\\",
  "|",
  "?",
  "*",
]);

type ActiveExport = {
  operationId: string;
  draftId: string;
  controller: AbortController;
};

export function safeMp3FileName(title: string) {
  const safeTitle = [...title]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        codePoint >= 32 &&
        codePoint !== 127 &&
        !invalidFilenameCharacters.has(character)
      );
    })
    .join("")
    .trim()
    .replace(/[. ]+$/g, "");
  return `${safeTitle || "Yoinの曲"}.mp3`;
}

function errorMessage(error: unknown) {
  if (error instanceof Error && /[ぁ-んァ-ヶ一-龠]/.test(error.message))
    return error.message;
  return "音源を保存できませんでした。通信状況と保存先を確認し、もう一度お試しください。";
}

export function createSongExportManager(dependencies: SongExportDependencies) {
  let active: ActiveExport | null = null;

  function publish(
    operation: ActiveExport,
    state: Omit<
      SongExportState,
      "operationId" | "songId" | "draftId" | "title"
    >,
    song: SongDocument,
  ) {
    if (active !== operation || operation.controller.signal.aborted) return;
    dependencies.onState({
      operationId: operation.operationId,
      songId: song.id,
      draftId: song.draftId,
      title: song.title,
      ...state,
    });
  }

  async function start(song: SongDocument): Promise<SongExportResult> {
    if (active) return { status: "busy" };

    const operation: ActiveExport = {
      operationId: dependencies.createOperationId(),
      draftId: song.draftId,
      controller: new AbortController(),
    };
    active = operation;
    let temporaryUri: string | null = null;
    publish(
      operation,
      { phase: "downloading", bytesWritten: 0, totalBytes: -1 },
      song,
    );

    try {
      const { url } = await dependencies.getAudioUrl(song.audioId);
      if (operation.controller.signal.aborted) return { status: "cancelled" };

      temporaryUri = await dependencies.createTemporaryUri(
        operation.operationId,
      );
      if (operation.controller.signal.aborted) return { status: "cancelled" };

      const file = await dependencies.download(url, temporaryUri, {
        signal: operation.controller.signal,
        onProgress: ({ bytesWritten, totalBytes }) =>
          publish(
            operation,
            { phase: "downloading", bytesWritten, totalBytes },
            song,
          ),
      });
      if (operation.controller.signal.aborted) return { status: "cancelled" };
      if (file.size <= 0) throw new Error("取得した音源が空でした。");

      publish(
        operation,
        { phase: "saving", bytesWritten: file.size, totalBytes: file.size },
        song,
      );
      const saved = await dependencies.saveFile({
        sourceUri: file.uri,
        fileName: safeMp3FileName(song.title),
        operationId: operation.operationId,
      });
      if (saved.status === "cancelled")
        return saved.cleanupFailed
          ? { status: "cancelled", cleanupFailed: true }
          : { status: "cancelled" };
      if (operation.controller.signal.aborted) {
        let removed = false;
        try {
          removed = await dependencies.deleteSavedFile(saved.uri);
        } catch {
          // A failed removal is reported so the user can check the destination.
        }
        return removed
          ? { status: "cancelled" }
          : { status: "cancelled", cleanupFailed: true };
      }
      return saved;
    } catch (error) {
      if (operation.controller.signal.aborted) return { status: "cancelled" };
      return { status: "failed", message: errorMessage(error) };
    } finally {
      if (temporaryUri) {
        try {
          await dependencies.deleteTemporaryFile(temporaryUri);
        } catch {
          // The next session startup retries cleanup of the account cache.
        }
      }
      if (active === operation) {
        active = null;
        dependencies.onState(null);
      }
    }
  }

  function cancel(draftId?: string) {
    const operation = active;
    if (!operation || (draftId && operation.draftId !== draftId)) return false;
    active = null;
    operation.controller.abort();
    dependencies.onState(null);
    void dependencies.cancelSave(operation.operationId).catch(() => {});
    return true;
  }

  return { start, cancel };
}
