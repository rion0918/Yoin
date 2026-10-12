import { StyleSheet, Text, View } from "react-native";
import type { AudioClip, Utterance } from "../../shared/contracts";
import { figmaColors as c, formatFigmaTime } from "../design/figma";
import { sourcePlaybackRange } from "../pipeline/library";
import { speakerLabel } from "../pipeline/speakers";
import { ActionButton } from "./ActionButton";
import { TranscriptTimingNotice } from "./TranscriptTimingNotice";

type Props = {
  clips: AudioClip[];
  utterances: Utterance[];
  songPosition: number;
  sourcePlaying: boolean;
  activeClipId: string | null;
  busy: boolean;
  onPlay: (clipId: string, startMs: number, endMs?: number) => void;
  onStop: () => void;
};

export function SongSourceContent({
  clips,
  utterances,
  songPosition,
  sourcePlaying,
  activeClipId,
  busy,
  onPlay,
  onStop,
}: Props) {
  return (
    <View style={styles.content} testID="memory-sheet">
      {clips.length === 0 && (
        <Text style={styles.empty}>元の会話を表示できません</Text>
      )}
      {clips.map((clip) => {
        const lines = utterances.filter((line) => line.clipId === clip.id);
        const { startMs, endMs } = sourcePlaybackRange(clip, lines);
        const isPlaying = sourcePlaying && activeClipId === clip.id;
        return (
          <View key={clip.id} style={styles.clip}>
            <View style={styles.quote}>
              <TranscriptTimingNotice
                issues={lines.flatMap((line) => line.timingIssues ?? [])}
              />
              {lines.map((line) => (
                <View key={line.id} style={styles.line}>
                  <Text style={styles.speaker}>
                    {speakerLabel(line)} /{" "}
                    {line.timingIssues?.length
                      ? "音声区間全体が出典"
                      : "出典付き発話"}
                  </Text>
                  <Text style={styles.utterance}>「{line.text}」</Text>
                </View>
              ))}
              <Text style={styles.range}>
                元の録音 · {formatFigmaTime(startMs / 1000)} –{" "}
                {formatFigmaTime((endMs ?? clip.durationMs) / 1000)}
              </Text>
            </View>
            <ActionButton
              label={isPlaying ? "元の会話の再生を止める" : "元の会話を再生"}
              onPress={() => {
                if (isPlaying) onStop();
                else onPlay(clip.id, startMs, endMs);
              }}
              disabled={busy}
              style={styles.playback}
              testID="listen-memory"
            >
              <View style={styles.playButton}>
                <Text style={styles.playIcon}>{isPlaying ? "Ⅱ" : "▶"}</Text>
              </View>
              <View style={styles.playbackText}>
                <Text style={styles.playTitle}>
                  {isPlaying ? "元の会話を再生中" : "元の会話を再生"}
                </Text>
                <Text style={styles.playCaption}>
                  {isPlaying
                    ? "タップして再生を止める"
                    : "会話の一部を聴き返す"}
                </Text>
              </View>
            </ActionButton>
          </View>
        );
      })}
      <View style={styles.songStatus}>
        <Text style={styles.songStatusText}>
          曲は {formatFigmaTime(songPosition)} で一時停止中
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12 },
  clip: { gap: 12 },
  quote: {
    minHeight: 134,
    borderRadius: 16,
    backgroundColor: c.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 6,
  },
  line: { gap: 6 },
  speaker: { color: c.rose, fontSize: 13, lineHeight: 19, fontWeight: "500" },
  utterance: { color: c.primary, fontSize: 17, lineHeight: 27 },
  range: {
    color: c.secondary,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "500",
  },
  playback: {
    minHeight: 57,
    borderRadius: 16,
    backgroundColor: c.inset,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  playButton: {
    width: 45,
    height: 45,
    borderRadius: 23,
    backgroundColor: c.rose,
    alignItems: "center",
    justifyContent: "center",
  },
  playIcon: {
    color: c.onRose,
    fontSize: 22,
    lineHeight: 32,
    fontWeight: "700",
  },
  playbackText: { flex: 1, gap: 4 },
  playTitle: { color: c.primary, fontSize: 15, lineHeight: 25 },
  playCaption: {
    color: c.secondary,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "500",
  },
  songStatus: {
    minHeight: 45,
    borderRadius: 12,
    backgroundColor: c.surface,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  songStatusText: { color: c.secondary, fontSize: 13, lineHeight: 21 },
  empty: { color: c.secondary, fontSize: 15, lineHeight: 24 },
});
