import {
  RecordingPresets,
  type RecordingStatus,
  requestNotificationPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import type { SavedRecording } from "../../shared/contracts";
import { waitUntilLoaded } from "./audio.native";
import {
  beginPreparedRecording,
  clipFromRecording,
  createSerialQueue,
  createSingleFlight,
  shouldStopSpeakerRecording,
} from "./operations";
import { inspectLocalAudio } from "./storage.native";
import type {
  AudioEngine,
  NativeStopListener,
  PendingRecording,
  RecorderPhase,
} from "./types";

const options = {
  ...RecordingPresets.HIGH_QUALITY,
  directory: "document" as const,
};

export function useAudioEngine(onNativeStop?: NativeStopListener): AudioEngine {
  const [recorderState, setRecorderState] = useState<RecorderPhase>("off");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<PendingRecording | null>(null);
  const capturing = useRef(false);
  const manualStopId = useRef<string | null>(null);
  const nativeCallback = useRef(onNativeStop);
  nativeCallback.current = onNativeStop;
  const recorderListener = useRef<(status: RecordingStatus) => void>(() => {});
  const receiveRecordingStatus = useCallback(
    (status: RecordingStatus) => recorderListener.current(status),
    [],
  );
  const recorder = useAudioRecorder(options, receiveRecordingStatus);
  const recorderStatus = useAudioRecorderState(recorder, 250);
  const player = useAudioPlayer(null, { updateInterval: 100 });
  const playerStatus = useAudioPlayerStatus(player);
  const playbackUri = useRef<string | null>(null);
  const playbackEnd = useRef<number | undefined>(undefined);
  const queue = useRef(createSerialQueue()).current;
  const stops = useRef(createSingleFlight()).current;

  const completeRecording = useCallback(
    (
      native: boolean,
      alreadyStopped = false,
      finishedUri?: string | null,
    ): Promise<SavedRecording | null> => {
      const current = pending.current;
      if (!current) return Promise.resolve(null);
      if (!native) manualStopId.current = current.clipId;
      return stops.run(current.clipId, () =>
        queue.run(async () => {
          setRecorderState("saving");
          capturing.current = false;
          try {
            if (!alreadyStopped) await recorder.stop();
            const uri = finishedUri ?? recorder.uri ?? current.localUri;
            if (!uri) throw new Error("録音ファイルが見つかりません。");
            const inspection = await inspectLocalAudio(uri);
            const clip =
              current.purpose === "speaker"
                ? clipFromRecording({ ...current, localUri: uri }, inspection)
                : clipFromRecording({ ...current, localUri: uri }, inspection);
            if (native && manualStopId.current !== current.clipId)
              await nativeCallback.current?.(clip);
            pending.current = null;
            setElapsedMs(0);
            setRecorderState("off");
            return clip;
          } catch (cause) {
            setRecorderState("interrupted");
            setError(
              cause instanceof Error
                ? cause.message
                : "録音を保存できませんでした。",
            );
            throw cause;
          }
        }),
      );
    },
    [queue, recorder, stops],
  );

  recorderListener.current = (status) => {
    const current = pending.current;
    if (!current || manualStopId.current === current.clipId) return;
    if (status.url && current.localUri && status.url !== current.localUri)
      return;
    if (status.hasError || status.mediaServicesDidReset) {
      setError(
        status.error ||
          "録音が中断されました。保存された音声を確認してから再開してください。",
      );
      setRecorderState("interrupted");
    }
    if (status.isFinished)
      void completeRecording(true, true, status.url).catch(() => {});
    else if (
      shouldStopSpeakerRecording(current, recorder.getStatus().durationMillis)
    )
      void completeRecording(true).catch(() => {});
  };

  const reconcileRecorder = useCallback(() => {
    if (!pending.current || !capturing.current) return;
    const status = recorder.getStatus();
    setElapsedMs(Math.max(0, status.durationMillis));
    if (!status.isRecording) {
      setError(
        "録音が中断されました。残した音声を確認してから再開してください。",
      );
      setRecorderState("interrupted");
      void completeRecording(true).catch(() => {});
    }
  }, [completeRecording, recorder]);

  useEffect(() => {
    if (recorderStatus.isRecording) {
      if (pending.current)
        setElapsedMs(Math.max(0, recorderStatus.durationMillis));
    } else reconcileRecorder();
  }, [
    recorderStatus.isRecording,
    recorderStatus.durationMillis,
    reconcileRecorder,
  ]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") reconcileRecorder();
      else if (playbackEnd.current !== undefined) player.pause();
    });
    return () => subscription.remove();
  }, [player, reconcileRecorder]);

  useEffect(() => {
    if (
      playbackEnd.current !== undefined &&
      playerStatus.currentTime * 1000 >= playbackEnd.current
    )
      player.pause();
  }, [player, playerStatus.currentTime]);

  const startRecording: AudioEngine["startRecording"] = useCallback(
    (clipId, draftId, recordedAt, timezone, onPrepared, speakerProfileId) =>
      queue.run(async () => {
        if (pending.current)
          throw new Error("今の録音を保存してから次の録音を開始してください。");
        setError(null);
        setRecorderState("preparing");
        setElapsedMs(0);
        try {
          player.pause();
          player.clearLockScreenControls();
          const permission = await requestRecordingPermissionsAsync();
          if (!permission.granted)
            throw new Error(
              "録音にはマイクの許可が必要です。端末の設定をご確認ください。",
            );
          if (Platform.OS === "android")
            await requestNotificationPermissionsAsync();
          await setAudioModeAsync({
            playsInSilentMode: true,
            allowsRecording: true,
            allowsBackgroundRecording: true,
            shouldPlayInBackground: false,
            interruptionMode: "doNotMix",
          });
          const onRecordingPrepared = async (next: PendingRecording) => {
            pending.current = next;
            manualStopId.current = null;
            await onPrepared?.(next);
          };
          const prepared = speakerProfileId
            ? await beginPreparedRecording(
                recorder,
                {
                  clipId,
                  purpose: "speaker",
                  speakerProfileId,
                  recordedAt,
                  timezone,
                },
                onRecordingPrepared,
              )
            : await beginPreparedRecording(
                recorder,
                { clipId, draftId, recordedAt, timezone },
                onRecordingPrepared,
              );
          capturing.current = true;
          setRecorderState("recording");
          return prepared;
        } catch (cause) {
          pending.current = null;
          capturing.current = false;
          try {
            await recorder.stop();
          } catch {}
          setRecorderState("interrupted");
          setError(
            cause instanceof Error
              ? cause.message
              : "録音を開始できませんでした。",
          );
          throw cause;
        }
      }),
    [player, queue, recorder],
  );

  const play: AudioEngine["play"] = useCallback(
    (uri, startMs = 0, endMs) =>
      queue.run(async () => {
        if (pending.current)
          throw new Error("録音を保存してから音声を再生してください。");
        try {
          setError(null);
          player.pause();
          await setAudioModeAsync({
            playsInSilentMode: true,
            allowsRecording: false,
            allowsBackgroundRecording: false,
            shouldPlayInBackground: endMs === undefined,
            interruptionMode: "doNotMix",
          });
          playbackEnd.current = endMs;
          if (playbackUri.current !== uri) {
            player.replace(uri);
            playbackUri.current = uri;
          }
          const duration = await waitUntilLoaded(player);
          const position = Math.max(0, Math.min(startMs / 1000, duration));
          if (
            endMs !== undefined &&
            (!Number.isFinite(endMs) || endMs <= position * 1000)
          )
            throw new Error("元の会話の再生区間が正しくありません。");
          await player.seekTo(position);
          if (endMs === undefined)
            player.setActiveForLockScreen(true, { title: "Yoin" });
          else player.clearLockScreenControls();
          player.play();
        } catch (cause) {
          setError(
            cause instanceof Error
              ? cause.message
              : "音声を再生できませんでした。",
          );
          throw cause;
        }
      }),
    [player, queue],
  );

  const pause = useCallback(
    () =>
      queue.run(async () => {
        player.pause();
      }),
    [player, queue],
  );
  const seek = useCallback(
    (ms: number) =>
      queue.run(async () => {
        await player.seekTo(Math.max(0, Math.min(ms / 1000, player.duration)));
      }),
    [player, queue],
  );
  const stopPlayback = useCallback(
    () =>
      queue.run(async () => {
        player.pause();
        player.clearLockScreenControls();
        playbackUri.current = null;
        playbackEnd.current = undefined;
      }),
    [player, queue],
  );
  const stopRecording = useCallback(
    () => completeRecording(false),
    [completeRecording],
  );

  return {
    state: {
      recorderState,
      elapsedMs,
      playing: playerStatus.playing,
      positionMs: Math.round(playerStatus.currentTime * 1000),
      durationMs: Math.round(playerStatus.duration * 1000),
      error: error ?? playerStatus.error,
    },
    startRecording,
    stopRecording,
    play,
    pause,
    seek,
    stopPlayback,
  };
}
