import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  emptyLibrary,
  type LibraryDocument,
  type LocalClip,
  type LocalDraft,
  type LyricBlock,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_MS,
  type SongDocument,
} from "../shared/contracts";
import { type Connection, createApi } from "./pipeline/api";
import {
  addSavedClip,
  completeSong,
  createLocalDraft,
  editLyricBlock,
  mergeRemoteDraft,
  restoreRecording,
} from "./pipeline/library";
import { confirmLyrics } from "./pipeline/lyrics";
import {
  initPlayback,
  type PlaybackEvent,
  playbackTransition,
} from "./pipeline/playback";
import {
  importAudio,
  loadConnection,
  loadLibrary,
  readAudioPart,
  recoverRecording,
  saveConnection,
  saveLibrary,
  useAudioEngine,
} from "./platform";

function id(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : "処理を続けられませんでした。";

export function useSession() {
  const [state, setState] = useState<LibraryDocument>(emptyLibrary);
  const stateRef = useRef(state);
  const [connection, setConnection] = useState<Connection>({
    apiUrl: "",
    token: "",
  });
  const connectionRef = useRef(connection);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const queue = useRef(Promise.resolve());
  const unsavedClip = useRef<LocalClip | null>(null);
  const activeSong = useRef<SongDocument | null>(null);
  const [playback, setPlayback] = useState(initPlayback);
  const playbackRef = useRef(playback);
  const playbackRequest = useRef(0);
  const changePlayback = useCallback((event: PlaybackEvent) => {
    const next = playbackTransition(playbackRef.current, event);
    if (next === playbackRef.current) return;
    playbackRef.current = next;
    setPlayback(next);
  }, []);

  const commit = useCallback(
    (change: (current: LibraryDocument) => LibraryDocument) => {
      const operation = queue.current.then(async () => {
        const next = change(stateRef.current);
        await saveLibrary(next);
        stateRef.current = next;
        setState(next);
      });
      queue.current = operation.catch(() => {});
      return operation;
    },
    [],
  );

  const nativeStopped = useCallback(
    (clip: LocalClip) => {
      return commit((current) => addSavedClip(current, clip));
    },
    [commit],
  );
  const audio = useAudioEngine(nativeStopped);
  const audioRef = useRef(audio);
  audioRef.current = audio;

  useEffect(() => {
    let alive = true;
    void Promise.all([loadLibrary(), loadConnection()])
      .then(async ([stored, savedConnection]) => {
        let restored = stored;
        if (stored.pendingRecording) {
          const recovered = stored.drafts.some(
            (draft) => draft.id === stored.pendingRecording?.draftId,
          )
            ? await recoverRecording(stored.pendingRecording)
            : null;
          restored = restoreRecording(stored, recovered);
          await saveLibrary(restored);
        }
        for (const pending of stored.recoveryFiles ?? []) {
          if (!restored.drafts.some((draft) => draft.id === pending.draftId))
            continue;
          const recovered = await recoverRecording(pending);
          if (recovered) {
            restored = addSavedClip(restored, recovered);
            await saveLibrary(restored);
          }
        }
        if (!alive) return;
        stateRef.current = restored;
        setState(restored);
        connectionRef.current = savedConnection;
        setConnection(savedConnection);
        setReady(true);
      })
      .catch((failure) => {
        if (alive) setError(`保存データを読み込めません。${message(failure)}`);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (!ready || busyRef.current) return undefined;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (failure) {
      setError(message(failure));
      return undefined;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const getDraft = (draftId: string) => {
    const draft = stateRef.current.drafts.find((value) => value.id === draftId);
    if (!draft) throw new Error("記録が見つかりません。");
    return draft;
  };
  async function stopAndSave() {
    const clip =
      unsavedClip.current ?? (await audioRef.current.stopRecording());
    if (clip) {
      unsavedClip.current = clip;
      await commit((current) => addSavedClip(current, clip));
      unsavedClip.current = null;
    }
  }
  async function newRecording() {
    return run(async () => {
      if (unsavedClip.current) await stopAndSave();
      await audioRef.current.stopPlayback();
      const draftId = id("draft");
      await commit((current) => ({
        ...current,
        drafts: [
          createLocalDraft(draftId, new Date().toISOString()),
          ...current.drafts,
        ],
      }));
      return draftId;
    });
  }
  async function toggleRecording(draftId: string) {
    return run(async () => {
      if (audioRef.current.state.recorderState === "recording") {
        await stopAndSave();
        return;
      }
      if (unsavedClip.current || stateRef.current.pendingRecording)
        await stopAndSave();
      const draft = getDraft(draftId);
      if (draft.status !== "local")
        throw new Error("仕上げ中の記録には録音を追加できません。");
      await audioRef.current.stopPlayback();
      const pending = await audioRef.current.startRecording(
        id("clip"),
        draftId,
        new Date().toISOString(),
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        async (prepared) => {
          await commit((current) => ({
            ...current,
            pendingRecording: prepared,
          }));
        },
      );
      if (stateRef.current.pendingRecording?.clipId !== pending.clipId)
        await commit((current) => ({ ...current, pendingRecording: pending }));
    });
  }
  async function leave(draftId: string) {
    return run(async () => {
      if (stateRef.current.pendingRecording?.draftId === draftId)
        await stopAndSave();
      await commit((current) => ({
        ...current,
        drafts: current.drafts.filter(
          (draft) =>
            draft.id !== draftId ||
            draft.clips.length > 0 ||
            current.recoveryFiles?.some(
              (pending) => pending.draftId === draftId,
            ),
        ),
      }));
      return true;
    });
  }
  async function finishRecording(draftId: string) {
    return run(async () => {
      await stopAndSave();
      return getDraft(draftId);
    });
  }
  async function importClip(draftId: string) {
    return run(async () => {
      if (getDraft(draftId).status !== "local")
        throw new Error("仕上げ中の記録には音声を追加できません。");
      await stopAndSave();
      const clip = await importAudio(draftId);
      if (clip) await commit((current) => addSavedClip(current, clip));
    });
  }
  async function updateDraft(
    draftId: string,
    change: (draft: LocalDraft) => LocalDraft,
  ) {
    await commit((current) => ({
      ...current,
      drafts: current.drafts.map((draft) =>
        draft.id === draftId ? change(draft) : draft,
      ),
    }));
  }
  async function setPlace(draftId: string, clipId: string, place: string) {
    return run(async () => {
      if (getDraft(draftId).status !== "local")
        throw new Error("場所は仕上げ前に指定してください。");
      await updateDraft(draftId, (draft) => ({
        ...draft,
        clips: draft.clips.map((clip) =>
          clip.id === clipId ? { ...clip, place: place.trim() || null } : clip,
        ),
      }));
    });
  }
  async function prepare(draftId: string, title: string) {
    return run(async () => {
      let draft = getDraft(draftId);
      if (!title.trim()) throw new Error("思い出の名前を入力してください。");
      if (!draft.clips.length)
        throw new Error("音声を残してから仕上げてください。");
      if (
        draft.clips.reduce((sum, clip) => sum + clip.durationMs, 0) >
        MAX_AUDIO_MS
      )
        throw new Error("今回の検証は合計60分までの音声に対応しています。");
      if (draft.clips.some((clip) => clip.sizeBytes > MAX_AUDIO_BYTES))
        throw new Error(
          "今回の検証では1ファイル100 MiBまで送信できます。録音は端末に残っています。",
        );
      const api = createApi(connectionRef.current);
      const prepareKey =
        draft.status === "failed"
          ? id("prepare")
          : draft.prepareKey || id("prepare");
      await updateDraft(draftId, (value) => ({
        ...value,
        title: title.trim(),
        status: "uploading",
        prepareKey,
        error: null,
      }));
      await api.createDraft(getDraft(draftId));
      for (const original of getDraft(draftId).clips) {
        const uploaded = await api.createUpload(original);
        await updateDraft(draftId, (value) => ({
          ...value,
          clips: value.clips.map((clip) =>
            clip.id === original.id
              ? {
                  ...clip,
                  upload: {
                    uploadId: uploaded.uploadId,
                    parts: uploaded.parts,
                    complete: uploaded.complete,
                  },
                }
              : clip,
          ),
        }));
        if (uploaded.complete) continue;
        const count = Math.ceil(original.sizeBytes / uploaded.partBytes);
        for (let partNumber = 1; partNumber <= count; partNumber++) {
          const current = getDraft(draftId).clips.find(
            (clip) => clip.id === original.id,
          );
          if (
            current?.upload?.parts.some(
              (part) => part.partNumber === partNumber,
            )
          )
            continue;
          const part = await api.uploadPart(
            original.id,
            uploaded.uploadId,
            partNumber,
            await readAudioPart(
              original.localUri,
              partNumber,
              uploaded.partBytes,
            ),
          );
          await updateDraft(draftId, (value) => ({
            ...value,
            clips: value.clips.map((clip) =>
              clip.id === original.id && clip.upload
                ? {
                    ...clip,
                    upload: {
                      ...clip.upload,
                      parts: [...clip.upload.parts, part],
                    },
                  }
                : clip,
            ),
          }));
        }
        const uploadedClip = getDraft(draftId).clips.find(
          (clip) => clip.id === original.id,
        );
        await api.completeUpload(
          original.id,
          uploaded.uploadId,
          uploadedClip?.upload?.parts ?? [],
        );
        await updateDraft(draftId, (value) => ({
          ...value,
          clips: value.clips.map((clip) =>
            clip.id === original.id && clip.upload
              ? { ...clip, upload: { ...clip.upload, complete: true } }
              : clip,
          ),
        }));
      }
      await updateDraft(draftId, (value) => ({
        ...value,
        status: "preparing",
      }));
      draft = getDraft(draftId);
      const response = await api.prepare(
        draftId,
        draft.prepareKey ?? prepareKey,
      );
      await updateDraft(draftId, (value) => ({
        ...value,
        jobId: response.jobId,
      }));
      return true;
    });
  }
  async function generate(draftId: string, blocks: LyricBlock[]) {
    return run(async () => {
      const draft = getDraft(draftId);
      if (!draft.lyrics || blocks.some((block) => !block.text.trim()))
        throw new Error("歌詞を確認してください。");
      const api = createApi(connectionRef.current);
      await updateDraft(draftId, (value) => ({
        ...value,
        lyrics: value.lyrics ? { ...value.lyrics, blocks } : null,
      }));
      const lyrics = await confirmLyrics(
        api,
        draftId,
        draft.lyrics.revision,
        blocks,
      );
      const generateKey = id("generate");
      await updateDraft(draftId, (value) => ({
        ...value,
        lyrics,
        generateKey,
        status: "generating",
        jobId: null,
        error: null,
      }));
      const result = await api.generate(draftId, lyrics.revision, generateKey);
      await updateDraft(draftId, (value) => ({
        ...value,
        jobId: result.jobId,
      }));
      return true;
    });
  }
  const polling = useRef(false);
  const refresh = useCallback(async () => {
    if (
      polling.current ||
      busyRef.current ||
      !connectionRef.current.apiUrl ||
      !connectionRef.current.token
    )
      return;
    polling.current = true;
    try {
      const api = createApi(connectionRef.current);
      for (const draft of stateRef.current.drafts.filter(
        (value) =>
          value.status === "preparing" || value.status === "generating",
      )) {
        let jobId = draft.jobId;
        if (!jobId) {
          const result =
            draft.status === "preparing" && draft.prepareKey
              ? await api.prepare(draft.id, draft.prepareKey)
              : draft.status === "generating" &&
                  draft.generateKey &&
                  draft.lyrics
                ? await api.generate(
                    draft.id,
                    draft.lyrics.revision,
                    draft.generateKey,
                  )
                : null;
          if (!result) continue;
          jobId = result.jobId;
          await commit((current) => ({
            ...current,
            drafts: current.drafts.map((value) =>
              value.id === draft.id ? { ...value, jobId } : value,
            ),
          }));
        }
        const job = await api.job(jobId);
        if (job.status === "ready" && job.songId) {
          const song = await api.song(job.songId);
          await commit((current) => completeSong(current, song));
        } else if (
          job.status === "waiting_review" ||
          job.status === "failed" ||
          job.status === "needs_reconciliation"
        ) {
          const remote = await api.draft(draft.id);
          await commit((current) => mergeRemoteDraft(current, remote));
        }
      }
    } catch (failure) {
      setError(message(failure));
    } finally {
      polling.current = false;
    }
  }, [commit]);
  useEffect(() => {
    if (!ready || !connection.apiUrl || !connection.token) return;
    void refresh();
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void refresh();
    }, 5000);
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void refresh();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [ready, refresh, connection.apiUrl, connection.token]);

  async function configure(value: Connection) {
    return run(async () => {
      const url = new URL(value.apiUrl);
      if (
        url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "10.0.2.2"].includes(url.hostname)
        )
      )
        throw new Error("接続先にはHTTPSのURLを指定してください。");
      if (!value.token.trim())
        throw new Error("検証用トークンを入力してください。");
      await saveConnection({
        apiUrl: value.apiUrl.replace(/\/$/, ""),
        token: value.token.trim(),
      });
      connectionRef.current = {
        apiUrl: value.apiUrl.replace(/\/$/, ""),
        token: value.token.trim(),
      };
      setConnection(connectionRef.current);
      const songs = await createApi(connectionRef.current).songs();
      await commit((current) => ({
        ...current,
        songs: [
          ...songs,
          ...current.songs.filter(
            (song) => !songs.some((remote) => remote.id === song.id),
          ),
        ],
      }));
      return true;
    });
  }
  const openSong = useCallback(
    async (song: SongDocument) => {
      playbackRequest.current++;
      activeSong.current = song;
      changePlayback({ type: "selectSong", durationMs: song.durationMs });
      await audioRef.current.stopPlayback();
    },
    [changePlayback],
  );
  async function togglePlayback() {
    return run(async () => {
      const song = activeSong.current;
      if (!song) return;
      if (
        playbackRef.current.target === "song" &&
        audioRef.current.state.playing
      ) {
        await audioRef.current.pause();
        return;
      }
      const request = ++playbackRequest.current;
      await audioRef.current.pause();
      const url = await createApi(connectionRef.current).audioUrl(song.audioId);
      if (request !== playbackRequest.current) return;
      const resumeMs =
        playbackRef.current.positionMs >= song.durationMs
          ? 0
          : playbackRef.current.positionMs;
      changePlayback({ type: "seek", positionMs: resumeMs });
      changePlayback({ type: "playSong" });
      await audioRef.current.play(url.url, resumeMs);
    });
  }
  async function playSource(
    clipId: string,
    startMs: number,
    endMs: number,
    draftId?: string,
  ) {
    return run(async () => {
      const request = ++playbackRequest.current;
      changePlayback({
        type: "playSource",
        currentMs: audioRef.current.state.positionMs,
      });
      await audioRef.current.pause();
      const local = draftId
        ? getDraft(draftId).clips.find((clip) => clip.id === clipId)?.localUri
        : undefined;
      const uri =
        local || (await createApi(connectionRef.current).audioUrl(clipId)).url;
      if (request !== playbackRequest.current) return;
      await audioRef.current.play(uri, startMs, endMs);
    });
  }
  async function closeSource() {
    if (playbackRef.current.target !== "source") return;
    playbackRequest.current++;
    changePlayback({ type: "closeSource" });
    await audioRef.current.stopPlayback();
  }
  const pause = useCallback(async () => {
    playbackRequest.current++;
    await audioRef.current.pause();
  }, []);
  async function seek(seconds: number) {
    changePlayback({ type: "seek", positionMs: seconds * 1000 });
    if (playbackRef.current.target === "song")
      await audioRef.current.seek(playbackRef.current.positionMs);
  }
  useEffect(() => {
    changePlayback({ type: "time", positionMs: audio.state.positionMs });
  }, [audio.state.positionMs, changePlayback]);

  const editLyrics = async (draftId: string, blockId: string, text: string) => {
    try {
      await updateDraft(draftId, (draft) =>
        editLyricBlock(draft, blockId, text),
      );
    } catch (failure) {
      setError(`歌詞を端末に保存できませんでした。${message(failure)}`);
    }
  };
  return {
    state,
    ready,
    busy,
    error: error || audio.state.error,
    clearError: () => setError(null),
    connection,
    configure,
    recorder: audio.state,
    newRecording,
    toggleRecording,
    leave,
    finishRecording,
    importClip,
    setPlace,
    prepare,
    generate,
    refresh,
    openSong,
    togglePlayback,
    seek,
    playSource,
    closeSource,
    pause,
    playing: audio.state.playing && playback.target === "song",
    sourcePlaying: audio.state.playing && playback.target === "source",
    position: playback.positionMs / 1000,
    editLyrics,
  };
}
