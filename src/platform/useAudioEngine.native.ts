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
import * as TaskManager from "expo-task-manager";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Platform } from "react-native";
import type {
  LocationSample,
  RecordingLocationRoute,
  SavedRecording,
} from "../../shared/contracts";
import {
  type createLocationRouteRecorder,
  locationRouteRecorderForRecording,
  mergeBackgroundLocationSample,
} from "../pipeline/location";
import { waitUntilLoaded } from "./audio.native";
import {
  BACKGROUND_LOCATION_TASK,
  clearActiveLocationCapture,
  setActiveLocationCapture,
  stopBackgroundLocationTask,
} from "./locationTask.native";
import {
  beginPreparedRecording,
  clipFromRecording,
  createSerialQueue,
  createSingleFlight,
  shouldStopSpeakerRecording,
} from "./operations";
import {
  inspectLocalAudio,
  peekPendingBackgroundLocationSample,
  takePendingBackgroundLocationSample,
} from "./storage.native";
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

function confirmBackgroundLocationPermission() {
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      "画面ロック中の位置取得",
      "位置情報をONにした録音で、画面ロックまでに位置を取得できていない場合、最初の位置を得るまでロック中も取得を試みます。位置情報は端末に保存し、録音中に送信しません。",
      [
        {
          text: "画面表示中のみ",
          style: "cancel",
          onPress: () => resolve(false),
        },
        { text: "許可へ進む", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export function useAudioEngine(
  onNativeStop?: NativeStopListener,
  uid = "",
): AudioEngine {
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
  const locationSampleSeen = useRef(false);
  const backgroundLocationAllowed = useRef(false);
  const backgroundLocationGeneration = useRef(0);

  const stopLocationWatch = useCallback(() => {
    locationGeneration.current++;
    locationSubscription.current?.remove();
    locationSubscription.current = null;
  }, []);

  const stopBackgroundCapture = useCallback(
    async (clearContext = false) => {
      backgroundLocationGeneration.current++;
      try {
        await stopBackgroundLocationTask();
      } catch {
        // A missing or already stopped task must not interrupt audio recording.
      }
      if (!clearContext) return;
      const current = pending.current;
      try {
        if (current && current.purpose !== "speaker")
          await clearActiveLocationCapture({ uid, clipId: current.clipId });
        else await clearActiveLocationCapture();
      } catch {
        // Location cleanup must not block audio recording or saving.
      }
    },
    [uid],
  );

  const startBackgroundCapture = useCallback(async () => {
    const current = pending.current;
    if (
      !locationEnabled.current ||
      !backgroundLocationAllowed.current ||
      locationSampleSeen.current ||
      !capturing.current ||
      !current ||
      current.purpose === "speaker"
    )
      return;
    try {
      const savedSample = await peekPendingBackgroundLocationSample(
        uid,
        current.draftId,
        current.clipId,
      );
      if (savedSample) {
        locationSampleSeen.current = true;
        setLocationStatus("foreground-only");
        return;
      }
      if (!(await TaskManager.isAvailableAsync())) {
        setLocationStatus("foreground-only");
        return;
      }
      const generation = ++backgroundLocationGeneration.current;
      const capture = {
        uid,
        draftId: current.draftId,
        clipId: current.clipId,
        recordedAt: current.recordedAt,
      };
      await setActiveLocationCapture(capture);
      if (
        generation !== backgroundLocationGeneration.current ||
        !capturing.current ||
        locationSampleSeen.current ||
        pending.current?.clipId !== current.clipId
      ) {
        await clearActiveLocationCapture(capture);
        return;
      }
      if (
        await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)
      )
        return;
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 60_000,
        distanceInterval: 0,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: "Yoin",
          notificationBody: "録音場所を取得しています",
        },
      });
      if (
        generation !== backgroundLocationGeneration.current ||
        !capturing.current
      ) {
        await stopBackgroundLocationTask();
        return;
      }
      setLocationStatus("acquiring");
    } catch {
      try {
        await clearActiveLocationCapture({ uid, clipId: current.clipId });
      } catch {
        // Location cleanup is best effort.
      }
      setLocationStatus("foreground-only");
    }
  }, [uid]);

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
          if (recorderForClip.add(sample)) locationSampleSeen.current = true;
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
      setLocationStatus(
        backgroundLocationAllowed.current ? "tracking" : "foreground-only",
      );
    } catch {
      if (generation === locationGeneration.current) {
        recorderForClip.pause(Date.now());
        setLocationStatus("unavailable");
      }
    }
  }, [stopLocationWatch]);

  const finishLocationCapture = useCallback(async () => {
    stopLocationWatch();
    const current = pending.current;
    await stopBackgroundCapture(true);
    let route = locationRecorder.current?.finish(Date.now()) ?? null;
    if (current && current.purpose !== "speaker") {
      try {
        const sample = await takePendingBackgroundLocationSample(
          uid,
          current.draftId,
          current.clipId,
        );
        if (sample)
          route = mergeBackgroundLocationSample(
            route,
            current,
            sample,
            Date.now(),
          );
      } catch {
        // Missing location data must not interrupt audio saving.
      }
    }
    if (!completedLocationRoute.current) completedLocationRoute.current = route;
    locationRecorder.current = null;
    setLocationStatus(locationEnabled.current ? "acquiring" : "off");
    return completedLocationRoute.current;
  }, [stopBackgroundCapture, stopLocationWatch, uid]);

  const setLocationEnabled: AudioEngine["setLocationEnabled"] = useCallback(
    async (enabled) => {
      if (!enabled) {
        locationEnabled.current = false;
        pauseLocationCapture();
        await stopBackgroundCapture(true);
        backgroundLocationAllowed.current = false;
        setLocationStatus("off");
        return true;
      }
      setLocationStatus("acquiring");
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== "granted") {
          locationEnabled.current = false;
          backgroundLocationAllowed.current = false;
          setLocationStatus("unavailable");
          return false;
        }
        try {
          let backgroundPermission =
            await Location.getBackgroundPermissionsAsync();
          if (
            backgroundPermission.status !== "granted" &&
            (await confirmBackgroundLocationPermission())
          )
            backgroundPermission =
              await Location.requestBackgroundPermissionsAsync();
          backgroundLocationAllowed.current =
            backgroundPermission.status === "granted";
        } catch {
          backgroundLocationAllowed.current = false;
        }
        locationEnabled.current = true;
        if (capturing.current) {
          locationRecorder.current = locationRouteRecorderForRecording(
            locationRecorder.current,
            pending.current,
          );
          if (!locationRecorder.current) locationSampleSeen.current = false;
          if (locationRecorder.current) await startLocationWatch();
          else setLocationStatus("unavailable");
        } else
          setLocationStatus(
            backgroundLocationAllowed.current ? "acquiring" : "foreground-only",
          );
        return true;
      } catch {
        locationEnabled.current = false;
        backgroundLocationAllowed.current = false;
        setLocationStatus("unavailable");
        return false;
      }
    },
    [pauseLocationCapture, startLocationWatch, stopBackgroundCapture],
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
          const locationRoute = await finishLocationCapture();
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
            locationSampleSeen.current = false;
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

  const resumeLocationCapture = useCallback(async () => {
    const current = pending.current;
    await stopBackgroundCapture();
    if (current && current.purpose !== "speaker") {
      try {
        const sample = await peekPendingBackgroundLocationSample(
          uid,
          current.draftId,
          current.clipId,
        );
        if (sample) locationSampleSeen.current = true;
      } catch {
        // Foreground location capture can continue if the temporary read fails.
      }
    }
    await startLocationWatch();
  }, [startLocationWatch, stopBackgroundCapture, uid]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        reconcileRecorder();
        if (capturing.current) void resumeLocationCapture();
      } else {
        if (capturing.current) {
          pauseLocationCapture();
          if (next === "background" && locationEnabled.current) {
            if (locationSampleSeen.current)
              setLocationStatus("foreground-only");
            else if (backgroundLocationAllowed.current)
              void startBackgroundCapture();
            else setLocationStatus("foreground-only");
          }
        }
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
    resumeLocationCapture,
    startBackgroundCapture,
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
          await stopBackgroundCapture(true);
          locationSampleSeen.current = false;
          backgroundLocationAllowed.current = false;
          if (locationEnabledForClip) {
            try {
              backgroundLocationAllowed.current =
                (await Location.getBackgroundPermissionsAsync()).status ===
                "granted";
            } catch {
              backgroundLocationAllowed.current = false;
            }
          }
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
          locationSampleSeen.current = false;
          locationRecorder.current = locationEnabled.current
            ? locationRouteRecorderForRecording(null, pending.current)
            : null;
          completedLocationRoute.current = null;
          if (locationEnabled.current) void startLocationWatch();
          else setLocationStatus("off");
          return prepared;
        } catch (cause) {
          pending.current = null;
          capturing.current = false;
          await finishLocationCapture();
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
    [
      finishLocationCapture,
      player,
      queue,
      recorder,
      startLocationWatch,
      stopBackgroundCapture,
    ],
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
  const stopRecording = useCallback(() => {
    if (pending.current) return completeRecording(false);
    return stopBackgroundCapture(true).then(() => null);
  }, [completeRecording, stopBackgroundCapture]);

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
