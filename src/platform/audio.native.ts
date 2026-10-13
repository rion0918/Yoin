import type { AudioPlayer } from "expo-audio";
import { createAudioPlayer } from "expo-audio";
import { requireNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

type AudioMetadataModule = {
  getDurationMsAsync: (uri: string) => Promise<number>;
};

function androidAudioMetadata() {
  return requireNativeModule<AudioMetadataModule>("YoinAudioMetadata");
}

export async function inspectAudioDuration(uri: string): Promise<number> {
  if (Platform.OS === "android") {
    try {
      const durationMs = await androidAudioMetadata().getDurationMsAsync(uri);
      if (Number.isFinite(durationMs) && durationMs > 0) return durationMs;
    } catch {
      // Fall back to Expo Audio for media the Android metadata reader cannot inspect.
    }
  }

  const player = createAudioPlayer(uri, { updateInterval: 100 });
  try {
    return Math.round((await waitUntilLoaded(player)) * 1000);
  } finally {
    player.release();
  }
}

export function waitUntilLoaded(player: AudioPlayer): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.remove();
      reject(
        new Error(
          "音声の読み込みに時間がかかっています。もう一度お試しください。",
        ),
      );
    }, 60000);
    const subscription = player.addListener(
      "playbackStatusUpdate",
      (status) => {
        if (status.error) {
          clearTimeout(timer);
          subscription.remove();
          reject(new Error("音声を読み取れませんでした。"));
        } else if (
          status.isLoaded &&
          Number.isFinite(status.duration) &&
          status.duration > 0
        ) {
          clearTimeout(timer);
          subscription.remove();
          resolve(status.duration);
        }
      },
    );
    if (
      player.isLoaded &&
      Number.isFinite(player.duration) &&
      player.duration > 0
    ) {
      clearTimeout(timer);
      subscription.remove();
      resolve(player.duration);
    }
  });
}
