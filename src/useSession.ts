import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  emptyLibrary,
  type LibraryDocument,
  type LocalDraft,
  type LyricBlock,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_MS,
  MAX_SPEAKER_SAMPLE_BYTES,
  MAX_SPEAKER_SAMPLE_MS,
  MIN_SPEAKER_SAMPLE_MS,
  type SavedRecording,
  type SongDocument,
  type SpeakerProfile,
  type SpeakerSampleDocument,
} from "../shared/contracts";
import type { SessionIdentity } from "./auth/types";
import { ApiError, type Connection, createApi } from "./pipeline/api";
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
  assertCanRecordConversation,
  mergeSpeakerProfiles,
} from "./pipeline/speakers";
import {
  deleteSpeakerAudio,
  eraseLibrary,
  importAudio,
  loadLibrary,
  preserveRecording,
  readAudioPart,
  readSpeakerAudio,
  recoverRecording,
  saveLibrary,
  useAudioEngine,
} from "./platform";
import { createAccountScope } from "./platform/account";

function id(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
const message = (error: unknown) =>
  error instanceof Error && /[ぁ-んァ-ヶ一-龠]/.test(error.message)
    ? error.message
    : "処理を続けられませんでした。時間をおいてお試しください。";

export function useSession(identity: SessionIdentity) {
  const [scope] = useState(() =>
    createAccountScope(identity.uid, async () => {
      await audioRef.current.stopRecording();
      await audioRef.current.stopPlayback();
      await queue.current;
    }),
  );
  const [state, setState] = useState<LibraryDocument>(emptyLibrary);
  const stateRef = useRef(state);
  const connectionRef = useRef<Connection>({
    apiUrl:
      process.env.EXPO_PUBLIC_API_URL ??
      "https://yoin-private-api.h-rion-0910.workers.dev",
    signal: scope.signal,
    getIdToken: async () => {
      scope.assertActive();
      const token = await identity.getIdToken();
      scope.assertActive();
      return token;
    },
  });
  const [accountDeleted, setAccountDeleted] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const clearError = useCallback(() => setError(null), []);
  const queue = useRef(Promise.resolve());
  const unsavedClip = useRef<SavedRecording | null>(null);
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
        scope.assertActive();
        const next = change(stateRef.current);
        await saveLibrary(identity.uid, next);
        scope.assertActive();
        stateRef.current = next;
        setState(next);
      });
      queue.current = operation.catch(() => {});
      return operation;
    },
    [scope, identity.uid],
  );

  const nativeStopped = useCallback(
    async (clip: SavedRecording) => {
      scope.assertActive();
      const previous =
        "purpose" in clip && clip.purpose === "speaker"
          ? stateRef.current.speakerProfiles?.find(
              (profile) => profile.id === clip.speakerProfileId,
            )?.sample?.localUri
          : undefined;
      const saved = await preserveRecording(identity.uid, clip);
      await commit((current) => addSavedClip(current, saved));
      if (previous && previous !== clip.localUri)
        await deleteSpeakerAudio(previous);
    },
    [commit, identity.uid, scope],
  );
  const audio = useAudioEngine(nativeStopped);
  const audioRef = useRef(audio);
  audioRef.current = audio;

  useEffect(() => {
    let alive = true;
    void loadLibrary(identity.uid)
      .then(async (stored) => {
        let restored = stored;
        if (stored.pendingRecording) {
          const pending = stored.pendingRecording;
          const canRecover =
            pending.purpose === "speaker"
              ? stored.speakerProfiles?.some(
                  (profile) => profile.id === pending.speakerProfileId,
                )
              : stored.drafts.some((draft) => draft.id === pending.draftId);
          const recovered = canRecover
            ? await recoverRecording(identity.uid, stored.pendingRecording)
            : null;
          restored = restoreRecording(
            stored,
            recovered ? await preserveRecording(identity.uid, recovered) : null,
          );
          scope.assertActive();
          await saveLibrary(identity.uid, restored);
        }
        for (const pending of stored.recoveryFiles ?? []) {
          const exists =
            pending.purpose === "speaker"
              ? restored.speakerProfiles?.some(
                  (profile) => profile.id === pending.speakerProfileId,
                )
              : restored.drafts.some((draft) => draft.id === pending.draftId);
          if (!exists) continue;
          const recovered = await recoverRecording(identity.uid, pending);
          if (recovered) {
            restored = addSavedClip(
              restored,
              await preserveRecording(identity.uid, recovered),
            );
            scope.assertActive();
            await saveLibrary(identity.uid, restored);
          }
        }
        if (!alive) return;
        stateRef.current = restored;
        setState(restored);
        setReady(true);
      })
      .catch((failure) => {
        if (alive) setError(`保存データを読み込めません。${message(failure)}`);
      });
    return () => {
      alive = false;
      scope.close();
    };
  }, [scope, identity.uid]);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    void createApi(connectionRef.current)
      .speakers()
      .then((profiles) => {
        if (active)
          return commit((current) => mergeSpeakerProfiles(current, profiles));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [ready, commit]);

  async function run<T>(
    action: () => Promise<T>,
    closing = false,
  ): Promise<T | undefined> {
    if (!ready || busyRef.current) return undefined;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      scope.assertActive();
      const result = await action();
      if (!closing) scope.assertActive();
      return result;
    } catch (failure) {
      if (!scope.signal.aborted || closing) setError(message(failure));
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
  const stopAndSave = useCallback(async () => {
    const clip =
      unsavedClip.current ?? (await audioRef.current.stopRecording());
    if (clip) {
      const saved = await preserveRecording(identity.uid, clip);
      unsavedClip.current = saved;
      await commit((current) => addSavedClip(current, saved));
      unsavedClip.current = null;
    }
  }, [commit, identity.uid]);
  async function newRecording(speakerProfileIds: string[]) {
    return run(async () => {
      assertCanRecordConversation(stateRef.current, speakerProfileIds);
      if (unsavedClip.current) await stopAndSave();
      await audioRef.current.stopPlayback();
      const draftId = id("draft");
      await commit((current) => ({
        ...current,
        drafts: [
          createLocalDraft(
            draftId,
            new Date().toISOString(),
            speakerProfileIds,
          ),
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
      assertCanRecordConversation(stateRef.current);
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
  async function createSpeaker(name: string) {
    return run(async () => {
      const cleanName = name.trim();
      if (!cleanName || cleanName.length > 80)
        throw new Error("名前を80文字以内で入力してください。");
      const api = createApi(connectionRef.current);
      const speakerId = id("speaker");
      let profile: SpeakerProfile;
      try {
        profile = await api.createSpeaker(speakerId, cleanName);
      } catch (failure) {
        try {
          const recovered = await api.speaker(speakerId);
          if (recovered.name !== cleanName) throw failure;
          profile = recovered;
        } catch {
          throw failure;
        }
      }
      await commit((current) => {
        const previous = current.speakerProfiles ?? [];
        return {
          ...current,
          speakerProfiles: [
            ...previous.filter((item) => item.id !== profile.id),
            {
              ...profile,
              sample: previous.find((item) => item.id === profile.id)?.sample,
            },
          ],
        };
      });
      return profile;
    });
  }
  async function startSpeakerSample(speakerProfileId: string) {
    return run(async () => {
      if (
        !stateRef.current.speakerProfiles?.some(
          (profile) => profile.id === speakerProfileId,
        )
      )
        throw new Error("話者プロフィールが見つかりません。");
      if (unsavedClip.current || stateRef.current.pendingRecording)
        await stopAndSave();
      await audioRef.current.stopPlayback();
      await audioRef.current.startRecording(
        id("speaker-sample"),
        "",
        new Date().toISOString(),
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        async (prepared) => {
          await commit((current) => ({
            ...current,
            pendingRecording: prepared,
          }));
        },
        speakerProfileId,
      );
      return true;
    });
  }
  async function stopSpeakerSample() {
    return run(async () => {
      if (stateRef.current.pendingRecording?.purpose !== "speaker")
        throw new Error("声の録音は開始されていません。");
      await stopAndSave();
      return true;
    });
  }
  async function previewSpeakerSample(speakerProfileId: string) {
    return run(async () => {
      const sample = stateRef.current.speakerProfiles?.find(
        (profile) => profile.id === speakerProfileId,
      )?.sample;
      if (!sample) throw new Error("試聴できる声の録音がありません。");
      await audioRef.current.stopPlayback();
      await audioRef.current.play(sample.localUri, 0, sample.durationMs);
      return true;
    });
  }
  async function stopSpeakerPreview() {
    await audioRef.current.stopPlayback();
  }
  async function registerSpeaker(speakerProfileId: string) {
    return run(async () => {
      const profile = stateRef.current.speakerProfiles?.find(
        (item) => item.id === speakerProfileId,
      );
      const sample = profile?.sample;
      if (!profile || !sample)
        throw new Error("声を録音してから登録してください。");
      if (
        sample.durationMs < MIN_SPEAKER_SAMPLE_MS ||
        sample.durationMs > MAX_SPEAKER_SAMPLE_MS
      )
        throw new Error("10秒以上30秒以内の声を録音してください。");
      if (sample.sizeBytes > MAX_SPEAKER_SAMPLE_BYTES)
        throw new Error("録音が大きすぎます。短く録り直してください。");
      const api = createApi(connectionRef.current);
      const metadata = {
        id: sample.id,
        mimeType: sample.mimeType,
        sizeBytes: sample.sizeBytes,
        durationMs: sample.durationMs,
      };
      let remoteSample: SpeakerSampleDocument;
      try {
        remoteSample = await api.createSpeakerSample(
          speakerProfileId,
          metadata,
        );
      } catch (failure) {
        try {
          remoteSample = await api.speakerSample(speakerProfileId, sample.id);
        } catch {
          throw failure;
        }
      }
      if (remoteSample.status === "uploading") {
        try {
          remoteSample = await api.uploadSpeakerSample(
            speakerProfileId,
            sample.id,
            await readSpeakerAudio(sample.localUri),
          );
        } catch (failure) {
          try {
            remoteSample = await api.speakerSample(speakerProfileId, sample.id);
            if (remoteSample.status === "uploading") throw failure;
          } catch {
            throw failure;
          }
        }
      }
      if (remoteSample.status !== "uploaded" && remoteSample.status !== "ready")
        throw new Error("声のアップロードを確認できませんでした。");
      let remote: SpeakerProfile;
      try {
        remote = await api.enrollSpeaker(speakerProfileId, sample.id);
      } catch (failure) {
        try {
          const recovered = await api.speaker(speakerProfileId);
          if (recovered.status !== "ready" || recovered.sampleId !== sample.id)
            throw failure;
          remote = recovered;
        } catch {
          throw failure;
        }
      }
      if (remote.status !== "ready" || remote.sampleId !== sample.id)
        throw new Error("声の登録結果を確認できませんでした。");
      await commit((current) => {
        const previous = current.speakerProfiles ?? [];
        return {
          ...current,
          speakerProfiles: [
            ...previous.filter((item) => item.id !== remote.id),
            {
              ...remote,
              sample: previous.find((item) => item.id === remote.id)?.sample,
            },
          ],
        };
      });
      return remote;
    });
  }
  async function renameSpeaker(speakerProfileId: string, name: string) {
    return run(async () => {
      const cleanName = name.trim();
      if (!cleanName || cleanName.length > 80)
        throw new Error("名前を80文字以内で入力してください。");
      const api = createApi(connectionRef.current);
      let remote: SpeakerProfile;
      try {
        remote = await api.renameSpeaker(speakerProfileId, cleanName);
      } catch (failure) {
        try {
          const recovered = await api.speaker(speakerProfileId);
          if (recovered.name !== cleanName) throw failure;
          remote = recovered;
        } catch {
          throw failure;
        }
      }
      await commit((current) => ({
        ...current,
        speakerProfiles: (current.speakerProfiles ?? []).map((profile) =>
          profile.id === speakerProfileId
            ? { ...remote, sample: profile.sample }
            : profile,
        ),
      }));
      return true;
    });
  }
  async function deleteSpeaker(speakerProfileId: string) {
    return run(async () => {
      const api = createApi(connectionRef.current);
      try {
        await api.deleteSpeaker(speakerProfileId);
      } catch (failure) {
        try {
          await api.speaker(speakerProfileId);
          throw failure;
        } catch (check) {
          if (!(check instanceof ApiError) || check.status !== 404)
            throw failure;
        }
      }
      const profile = stateRef.current.speakerProfiles?.find(
        (item) => item.id === speakerProfileId,
      );
      const files = [
        profile?.sample?.localUri,
        ...(stateRef.current.recoveryFiles ?? [])
          .filter(
            (pending) =>
              pending.purpose === "speaker" &&
              pending.speakerProfileId === speakerProfileId,
          )
          .map((pending) => pending.localUri),
      ].filter((value): value is string => Boolean(value));
      await commit((current) => ({
        ...current,
        speakerProfiles: (current.speakerProfiles ?? []).filter(
          (item) => item.id !== speakerProfileId,
        ),
        recoveryFiles: (current.recoveryFiles ?? []).filter(
          (pending) =>
            pending.purpose !== "speaker" ||
            pending.speakerProfileId !== speakerProfileId,
        ),
      }));
      for (const file of files) await deleteSpeakerAudio(file);
      return true;
    });
  }
  async function leave(draftId: string) {
    return run(async () => {
      if (
        stateRef.current.pendingRecording?.purpose !== "speaker" &&
        stateRef.current.pendingRecording?.draftId === draftId
      )
        await stopAndSave();
      await commit((current) => ({
        ...current,
        drafts: current.drafts.filter(
          (draft) =>
            draft.id !== draftId ||
            draft.clips.length > 0 ||
            current.recoveryFiles?.some(
              (pending) =>
                pending.purpose !== "speaker" && pending.draftId === draftId,
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
      const clip = await importAudio(identity.uid, draftId);
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
        throw new Error("一曲に使える音声は合計60分までです。");
      if (draft.clips.some((clip) => clip.sizeBytes > MAX_AUDIO_BYTES))
        throw new Error(
          "1ファイル100 MiBまで送信できます。録音は端末に残っています。",
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
    if (polling.current || busyRef.current || scope.signal.aborted) return;
    polling.current = true;
    try {
      const api = createApi(connectionRef.current);
      for (const draft of stateRef.current.drafts.filter(
        (value) =>
          value.status === "preparing" ||
          value.status === "generating" ||
          value.status === "needs_reconciliation",
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
      if (!scope.signal.aborted) setError(message(failure));
    } finally {
      polling.current = false;
    }
  }, [commit, scope]);
  useEffect(() => {
    if (!ready) return;
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
  }, [ready, refresh]);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    const api = createApi(connectionRef.current);
    void api
      .account()
      .then(async (account) => {
        if (!active) return;
        if (account.uid !== identity.uid)
          throw new Error("ログインを確認できません。");
        if (account.status !== "active") {
          await stopAndSave();
          await audioRef.current.stopPlayback();
          await api.deleteAccount();
          scope.close();
          await queue.current;
          await eraseLibrary(identity.uid);
          setAccountDeleted(true);
          return;
        }
        const songs = await api.songs();
        if (active)
          await commit((current) => ({
            ...current,
            drafts: current.drafts.filter(
              (draft) => !songs.some((song) => song.draftId === draft.id),
            ),
            songs: [
              ...songs,
              ...current.songs.filter(
                (song) => !songs.some((remote) => remote.id === song.id),
              ),
            ],
          }));
      })
      .catch((failure) => {
        if (active && !scope.signal.aborted) setError(message(failure));
      });
    return () => {
      active = false;
    };
  }, [ready, commit, scope, identity.uid, stopAndSave]);
  async function suspend() {
    if (scope.signal.aborted) return true;
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      await stopAndSave();
      await audioRef.current.stopPlayback();
      await queue.current;
      scope.close();
      return true;
    } catch (failure) {
      setError(message(failure));
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function deleteAccount() {
    return run(async () => {
      await stopAndSave();
      await audioRef.current.stopPlayback();
      const api = createApi(connectionRef.current);
      await api.deleteAccount();
      scope.close();
      await queue.current;
      await eraseLibrary(identity.uid);
      return true;
    }, true);
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
      if (request !== playbackRequest.current || scope.signal.aborted) return;
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
      if (request !== playbackRequest.current || scope.signal.aborted) return;
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
    accountDeleted,
    busy,
    error: error || audio.state.error,
    clearError,
    suspend,
    deleteAccount,
    recorder: audio.state,
    newRecording,
    toggleRecording,
    createSpeaker,
    startSpeakerSample,
    stopSpeakerSample,
    previewSpeakerSample,
    stopSpeakerPreview,
    registerSpeaker,
    renameSpeaker,
    deleteSpeaker,
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
