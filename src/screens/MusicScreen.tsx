import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import type { LyricBlock, SongDocument } from "../../shared/contracts";
import { ActionButton } from "../components/ActionButton";
import { SeekSlider } from "../components/SeekSlider";
import { figmaColors as c, formatFigmaTime } from "../design/figma";
import { blockContext, songDate } from "../pipeline/library";

type MusicScreenProps = {
  song: SongDocument;
  playing: boolean;
  position: number;
  onBack: () => void;
  onToggle: () => void;
  onSeek: (seconds: number) => void;
  onScrub: (scrubbing: boolean) => void;
  onMemory: (memory: LyricBlock) => void;
};

export function MusicScreen({
  song,
  playing,
  position,
  onBack,
  onToggle,
  onSeek,
  onScrub,
  onMemory,
}: MusicScreenProps) {
  const insets = useSafeAreaInsets();
  const [playerHeight, setPlayerHeight] = useState(170);
  const songPosition = Math.min(song.durationMs / 1000, Math.max(0, position));
  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={styles.screen}
      testID="music-screen"
    >
      <ActionButton
        label="ライブラリに戻る"
        onPress={onBack}
        style={styles.back}
        testID="back-music"
      >
        <Text style={styles.backText}>‹ ライブラリ</Text>
      </ActionButton>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: playerHeight + insets.bottom + 38 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text accessibilityRole="header" style={styles.title}>
          {song.title}
        </Text>
        <Text style={styles.date}>{songDate(song)} · あの日の記録</Text>
        <Text style={styles.lyricsHeading}>LYRICS / 歌詞の思い出</Text>
        {song.lyrics.blocks.map((block, index) => {
          const context = blockContext(song, block);
          const sourceAvailable = block.sourceUtteranceIds.length > 0;
          return (
            <View
              key={block.id}
              style={[
                styles.verse,
                sourceAvailable ? styles.verseSource : styles.versePlain,
              ]}
              testID={`lyric-block-${block.id}`}
            >
              <View style={styles.verseHeader}>
                <Text style={styles.verseNumber}>
                  VERSE / {String(index + 1).padStart(2, "0")}
                </Text>
                {sourceAvailable && (
                  <Text style={styles.sourceAvailable}>元の会話あり</Text>
                )}
              </View>
              <Text style={styles.lyrics}>{block.text}</Text>
              <Text style={styles.context}>
                {context.date.replaceAll("-", ".")} · {context.place}
              </Text>
              {sourceAvailable && (
                <ActionButton
                  label={`${block.text}の元の会話を聴く`}
                  onPress={() => onMemory(block)}
                  style={styles.sourceAction}
                  testID={`memory-${block.id}`}
                >
                  <Text style={styles.sourceActionText}>
                    ◉ 元の会話を聴く ↗
                  </Text>
                </ActionButton>
              )}
            </View>
          );
        })}
      </ScrollView>
      <View
        style={[styles.playerDock, { bottom: Math.max(insets.bottom, 14) }]}
        onLayout={(event) => setPlayerHeight(event.nativeEvent.layout.height)}
      >
        <View style={styles.playerHeader}>
          <View style={styles.playerInformation}>
            <Text style={styles.playerTitle} numberOfLines={1}>
              {song.title}
            </Text>
            <Text style={styles.playerDescription}>会話から生まれた曲</Text>
          </View>
          <ActionButton
            label={playing ? "曲を一時停止" : "曲を再生"}
            onPress={onToggle}
            style={styles.playerToggle}
            testID="player-toggle"
          >
            <Text style={styles.playerToggleText}>{playing ? "Ⅱ" : "▶"}</Text>
          </ActionButton>
        </View>
        <SeekSlider
          dark
          duration={song.durationMs / 1000}
          position={songPosition}
          onSeek={onSeek}
          onScrub={onScrub}
        />
        <View style={styles.timing}>
          <Text style={styles.time}>{formatFigmaTime(songPosition)}</Text>
          <Text style={styles.time}>
            {formatFigmaTime(song.durationMs / 1000)}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.canvas },
  back: {
    marginTop: 4,
    marginLeft: 16,
    height: 44,
    width: 170,
    justifyContent: "center",
  },
  backText: { color: c.secondary, fontSize: 15, lineHeight: 25 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 24, paddingTop: 9, gap: 16 },
  title: { color: c.primary, fontSize: 28, lineHeight: 39, fontWeight: "700" },
  date: { color: c.gold, fontSize: 13, lineHeight: 21 },
  lyricsHeading: {
    color: c.secondary,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "500",
    marginTop: 4,
  },
  verse: { borderRadius: 20, padding: 16, gap: 12 },
  verseSource: { backgroundColor: c.raised },
  versePlain: { backgroundColor: c.surface },
  verseHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  verseNumber: {
    color: c.gold,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "500",
  },
  sourceAvailable: { color: c.secondary, fontSize: 11, lineHeight: 17 },
  lyrics: { color: c.primary, fontSize: 22, lineHeight: 32, fontWeight: "700" },
  context: { color: c.secondary, fontSize: 13, lineHeight: 21 },
  sourceAction: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: c.inset,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  sourceActionText: {
    color: c.rose,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "500",
  },
  playerDock: {
    position: "absolute",
    left: 16,
    right: 16,
    borderRadius: 20,
    backgroundColor: c.raised,
    padding: 16,
    gap: 10,
  },
  playerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: 56,
  },
  playerInformation: { flex: 1, gap: 4 },
  playerTitle: { color: c.primary, fontSize: 17, lineHeight: 27 },
  playerDescription: {
    color: c.secondary,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "500",
  },
  playerToggle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: c.rose,
    alignItems: "center",
    justifyContent: "center",
  },
  playerToggleText: {
    color: c.onRose,
    fontSize: 22,
    lineHeight: 32,
    fontWeight: "700",
  },
  timing: { flexDirection: "row", justifyContent: "space-between" },
  time: { color: c.secondary, fontSize: 11, lineHeight: 17, fontWeight: "500" },
});
