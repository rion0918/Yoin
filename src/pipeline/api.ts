import type {
  AudioClip,
  AudioUrl,
  DraftDocument,
  JobDocument,
  LocalDraft,
  LyricBlock,
  LyricRevision,
  SongDocument,
  UploadCreated,
} from "../../shared/contracts.ts";
import { explainError } from "./messages.ts";

export type Connection = { apiUrl: string; token: string };
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function createApi(
  connection: Connection,
  fetcher: typeof fetch = fetch,
) {
  async function request<T>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    if (!connection.apiUrl || !connection.token)
      throw new Error("最初に接続設定を保存してください。");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetcher(
        `${connection.apiUrl.replace(/\/$/, "")}${path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${connection.token}`,
            "Content-Type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        },
      );
      const value = (await response.json()) as T & { error?: string };
      if (!response.ok)
        throw new ApiError(
          response.status,
          value.error
            ? explainError(value.error)
            : `処理を続けられませんでした（${response.status}）。`,
        );
      return value;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new Error(
        "通信を確認してください。生成の受付状況は、再開時に同じ処理IDで確認します。",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  return {
    createDraft: (draft: LocalDraft) =>
      request<DraftDocument>("/drafts", "POST", {
        id: draft.id,
        title: draft.title,
        createdAt: draft.createdAt,
      }),
    createUpload: (clip: AudioClip) =>
      request<UploadCreated>(
        `/drafts/${encodeURIComponent(clip.draftId)}/clips`,
        "POST",
        clip,
      ),
    async uploadPart(
      clipId: string,
      uploadId: string,
      partNumber: number,
      bytes: Uint8Array,
    ) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);
      try {
        const response = await fetcher(
          `${connection.apiUrl.replace(/\/$/, "")}/clips/${encodeURIComponent(clipId)}/parts/${partNumber}?uploadId=${encodeURIComponent(uploadId)}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${connection.token}`,
              "Content-Type": "application/octet-stream",
            },
            body: bytes.slice().buffer,
            signal: controller.signal,
          },
        );
        if (!response.ok)
          throw new ApiError(
            response.status,
            "音声の送信が中断されました。保存済みの音声から再開できます。",
          );
        return (await response.json()) as { partNumber: number; etag: string };
      } finally {
        clearTimeout(timeout);
      }
    },
    completeUpload: (
      clipId: string,
      uploadId: string,
      parts: { partNumber: number; etag: string }[],
    ) =>
      request<{ complete: true }>(
        `/clips/${encodeURIComponent(clipId)}/complete`,
        "POST",
        { uploadId, parts },
      ),
    prepare: (id: string, idempotencyKey: string) =>
      request<{ jobId: string }>(
        `/drafts/${encodeURIComponent(id)}/prepare`,
        "POST",
        { idempotencyKey },
      ),
    draft: (id: string) =>
      request<DraftDocument>(`/drafts/${encodeURIComponent(id)}`),
    job: (id: string) =>
      request<JobDocument>(`/jobs/${encodeURIComponent(id)}`),
    saveLyrics: (id: string, revision: number, blocks: LyricBlock[]) =>
      request<LyricRevision>(
        `/drafts/${encodeURIComponent(id)}/lyrics`,
        "PATCH",
        { revision, blocks },
      ),
    generate: (id: string, revision: number, idempotencyKey: string) =>
      request<{ jobId: string }>(
        `/drafts/${encodeURIComponent(id)}/generate`,
        "POST",
        { revision, idempotencyKey },
      ),
    songs: () => request<SongDocument[]>("/songs"),
    song: (id: string) =>
      request<SongDocument>(`/songs/${encodeURIComponent(id)}`),
    audioUrl: (id: string) =>
      request<AudioUrl>(`/audio/${encodeURIComponent(id)}/url`, "POST"),
  };
}
