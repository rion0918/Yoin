import { useEffect, useRef, useState } from "react";
import type {
  AudioEngine,
  AudioEngineState,
  NativeStopListener,
} from "./types";

const initial: AudioEngineState = {
  recorderState: "off",
  elapsedMs: 0,
  playing: false,
  positionMs: 0,
  durationMs: 0,
  error: null,
  locationStatus: "off",
};

export function useAudioEngine(
  _onNativeStop?: NativeStopListener,
  _uid?: string,
): AudioEngine {
  const [state, setState] = useState(initial);
  const audio = useRef<HTMLAudioElement | null>(null);
  const end = useRef<number | undefined>(undefined);
  const uri = useRef<string | null>(null);
  useEffect(() => {
    const element = new Audio();
    audio.current = element;
    const update = () => {
      if (
        end.current !== undefined &&
        element.currentTime * 1000 >= end.current
      )
        element.pause();
      setState((current) => ({
        ...current,
        playing: !element.paused && !element.ended,
        positionMs: Math.round(element.currentTime * 1000),
        durationMs: Number.isFinite(element.duration)
          ? Math.round(element.duration * 1000)
          : 0,
      }));
    };
    const events = [
      "timeupdate",
      "play",
      "pause",
      "ended",
      "loadedmetadata",
      "seeked",
    ];
    for (const event of events) element.addEventListener(event, update);
    const failure = () =>
      setState((current) => ({
        ...current,
        error: "音声を再生できませんでした。",
      }));
    element.addEventListener("error", failure);
    return () => {
      element.pause();
      for (const event of events) element.removeEventListener(event, update);
      element.removeEventListener("error", failure);
      element.removeAttribute("src");
      element.load();
      audio.current = null;
    };
  }, []);
  const unavailable = async (): Promise<never> => {
    const error = new Error(
      "バックグラウンド録音はiOS・Androidアプリでご利用ください。",
    );
    setState((current) => ({ ...current, error: error.message }));
    throw error;
  };
  return {
    state,
    startRecording: unavailable,
    setLocationEnabled: async () => false,
    stopRecording: async () => null,
    play: async (source, startMs = 0, endMs) => {
      const element = audio.current;
      if (!element) throw new Error("音声プレイヤーを準備しています。");
      end.current = endMs;
      if (uri.current !== source) {
        await new Promise<void>((resolve, reject) => {
          const loaded = () => {
            cleanup();
            resolve();
          };
          const failed = () => {
            cleanup();
            reject(new Error("音声を再生できませんでした。"));
          };
          const timer = setTimeout(failed, 15000);
          const cleanup = () => {
            clearTimeout(timer);
            element.removeEventListener("loadedmetadata", loaded);
            element.removeEventListener("error", failed);
          };
          element.addEventListener("loadedmetadata", loaded);
          element.addEventListener("error", failed);
          element.src = source;
          element.load();
        });
        uri.current = source;
      }
      element.currentTime = Math.max(
        0,
        Math.min(startMs / 1000, element.duration),
      );
      setState((current) => ({ ...current, error: null }));
      await element.play();
    },
    pause: async () => {
      audio.current?.pause();
    },
    seek: async (ms) => {
      if (audio.current)
        audio.current.currentTime = Math.max(
          0,
          Math.min(ms / 1000, audio.current.duration),
        );
    },
    stopPlayback: async () => {
      audio.current?.pause();
      if (audio.current) audio.current.currentTime = 0;
      end.current = undefined;
    },
  };
}
