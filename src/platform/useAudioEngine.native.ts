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
import * as Location from "expo-location";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import type {
  LocationSample,
  RecordingLocationRoute,
  SavedRecording,
} from "../../shared/contracts";
import { createLocationRouteRecorder } from "../pipeline/location";
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
  const [locationStatus, setLocationStatus] =
    useState<AudioEngine["state"]["locationStatus"]>("off");
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
  const locationSubscription = useRef<Location.LocationSubscription | null>(
    null,
  );
  const locationRecorder = useRef<ReturnType<
    typeof createLocationRouteRecorder
  > | null>(null);
  const completedLocationRoute = useRef<RecordingLocationRoute | null>(null);
  const locationGeneration = useRef(0);
  const locationEnabled = useRef(false);

  const stopLocationWatch = useCallback(() => {
    locationGeneration.current++;
    locationSubscription.current?.remove();
    locationSubscription.current = null;
  }, []);

  const pauseLocationCapture = useCallback(() => {
    stopLocationWatch();
    locationRecorder.current?.pause(Date.now());
    if (locationEnabled.current) setLocationStatus("acquiring");
  }, [stopLocationWatch]);

  const startLocationWatch = useCallback(async () => {
    const current = pending.current;
    if (
      !locationEnabled.current ||
      !current ||
      current.purpose === "speaker" ||
      !capturing.current
    )
      return;
    if (AppState.currentState !== "active") {
      locationRecorder.current?.pause(Date.now());
      setLocationStatus("acquiring");
      return;
    }
    stopLocationWatch();
    const generation = locationGeneration.current;
    const recorderForClip = locationRecorder.current;
    if (!recorderForClip) return;
    setLocationStatus("acquiring");
    try {
      const permission = await Location.getForegroundPermissionsAsync();
      if (generation !== locationGeneration.current) return;
      if (permission.status !== "granted") {
        setLocationStatus("unavailable");
        return;
      }
      recorderForClip.resume(Date.now());
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 60_000,
          distanceInterval: 0,
          mayShowUserSettingsDialog: false,
        },
        (location) => {
          if (
            generation !== locationGeneration.current ||
            !capturing.current ||
            pending.current?.clipId !== current.clipId ||
            AppState.currentState !== "active" ||
            typeof location.coords.accuracy !== "number"
          )
            return;
          const sample: LocationSample = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            accuracy: location.coords.accuracy,
            timestamp: Math.trunc(location.timestamp),
          };
          recorderForClip.add(sample);
        },
      );
      if (
        generation !== locationGeneration.current ||
        pending.current?.clipId !== current.clipId ||
        !capturing.current
      ) {
        subscription.remove();
        if (generation === locationGeneration.current)
          recorderForClip.pause(Date.now());
        return;
      }
      locationSubscription.current = subscription;
      setLocationStatus("tracking");
    } catch {
      if (generation === locationGeneration.current) {
        recorderForClip.pause(Date.now());
        setLocationStatus("unavailable");
      }
    }
  }, [stopLocationWatch]);

  const finishLocationCapture = useCallback(() => {
    stopLocationWatch();
    if (!completedLocationRoute.current)
      completedLocationRoute.current =
        locationRecorder.current?.finish(Date.now()) ?? null;
    locationRecorder.current = null;
    setLocationStatus(locationEnabled.current ? "acquiring" : "off");
    return completedLocationRoute.current;
  }, [stopLocationWatch]);

  const setLocationEnabled: AudioEngine["setLocationEnabled"] = useCallback(
    async (enabled) => {
      if (!enabled) {
        locationEnabled.current = false;
        pauseLocationCapture();
        setLocationStatus("off");
        return true;
      }
      setLocationStatus("acquiring");
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== "granted") {
          locationEnabled.current = false;
          setLocationStatus("unavailable");
          return false;
        }
        locationEnabled.current = true;
        if (capturing.current) await startLocationWatch();
        else setLocationStatus("acquiring");
        return true;
      } catch {
        locationEnabled.current = false;
        setLocationStatus("unavailable");
        return false;
      }
    },
    [pauseLocationCapture, startLocationWatch],
  );

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
          const locationRoute =
            current.purpose === "speaker" ? null : finishLocationCapture();
          try {
            if (!alreadyStopped) await recorder.stop();
            const uri = finishedUri ?? recorder.uri ?? current.localUri;
            if (!uri) throw new Error("録音ファイルが見つかりません。");
            const inspection = await inspectLocalAudio(uri);
            const saved =
              current.purpose === "speaker"
                ? clipFromRecording({ ...current, localUri: uri }, inspection)
                : clipFromRecording({ ...current, localUri: uri }, inspection);
            const clip =
              locationRoute && saved.purpose !== "speaker"
                ? { ...saved, locationRoute }
                : saved;
            if (native && manualStopId.current !== current.clipId)
              await nativeCallback.current?.(clip);
            pending.current = null;
            completedLocationRoute.current = null;
            locationRecorder.current = null;
            setElapsedMs(0);
            setRecorderState("off");
            if (!locationEnabled.current) setLocationStatus("off");
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
    [finishLocationCapture, queue, recorder, stops],
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
      if (next === "active") {
        reconcileRecorder();
        if (capturing.current) void startLocationWatch();
      } else {
        if (capturing.current) pauseLocationCapture();
        if (playbackEnd.current !== undefined) player.pause();
      }
    });
    return () => {
      subscription.remove();
      stopLocationWatch();
      locationRecorder.current?.pause(Date.now());
    };
  }, [
    pauseLocationCapture,
    player,
    reconcileRecorder,
    startLocationWatch,
    stopLocationWatch,
  ]);

  useEffect(() => {
    if (
      playbackEnd.current !== undefined &&
      playerStatus.currentTime * 1000 >= playbackEnd.current
    )
      player.pause();
  }, [player, playerStatus.currentTime]);

  const startRecording: AudioEngine["startRecording"] = useCallback(
    (
      clipId,
      draftId,
      recordedAt,
      timezone,
      onPrepared,
      speakerProfileId,
      locationEnabledForClip = false,
    ) =>
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
          locationEnabled.current = !speakerProfileId && locationEnabledForClip;
          locationRecorder.current = locationEnabled.current
            ? createLocationRouteRecorder(draftId, clipId, prepared.recordedAt)
            : null;
          completedLocationRoute.current = null;
          if (locationEnabled.current) void startLocationWatch();
          else setLocationStatus("off");
          return prepared;
        } catch (cause) {
          pending.current = null;
          capturing.current = false;
          finishLocationCapture();
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
    [finishLocationCapture, player, queue, recorder, startLocationWatch],
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
      locationStatus,
    },
    startRecording,
    setLocationEnabled,
    stopRecording,
    play,
    pause,
    seek,
    stopPlayback,
  };
}
