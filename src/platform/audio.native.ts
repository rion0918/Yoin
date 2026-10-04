import type { AudioPlayer } from "expo-audio";

export function waitUntilLoaded(player: AudioPlayer): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.remove();
      reject(
        new Error(
          "音声の読み込みに時間がかかっています。もう一度お試しください。",
        ),
      );
    }, 15000);
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
