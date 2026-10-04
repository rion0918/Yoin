import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import {
  Image,
  ImageBackground,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import type { LyricBlock, SongDocument } from "../../shared/contracts";
import { ActionButton } from "../components/ActionButton";
import { SeekSlider } from "../components/SeekSlider";
import { formatTime } from "../domain/session";
import { blockContext, songDate } from "../pipeline/library";

const artwork = require("../../assets/season-background.png");
const background = require("../../assets/season-background.png");

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
  const { height, width } = useWindowDimensions();
  const [playerHeight, setPlayerHeight] = useState(78);
  const artworkHeight = Math.max(
    160,
    height - insets.top - insets.bottom - 610,
  );
  const currentPosition = Math.min(
    song.durationMs / 1000,
    Math.max(0, position),
  );

  return (
    <ImageBackground
      source={background}
      resizeMode="cover"
      style={[styles.screen, { height, width }]}
      testID="music-screen"
    >
      <SafeAreaView edges={["top", "left", "right"]} style={styles.safeArea}>
        <View style={styles.header}>
          <ActionButton
            label="ホームに戻る"
            onPress={onBack}
            style={styles.back}
            testID="back-music"
          >
            <Feather name="chevron-left" size={24} color="#332317" />
            <Text style={styles.backLabel}>ホーム</Text>
          </ActionButton>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + playerHeight + 50 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <Text accessibilityRole="header" style={styles.tripTitle}>
            {song.title}
          </Text>
          <Text style={styles.tripDate}>{songDate(song)}</Text>
          <Image
            source={artwork}
            resizeMode="cover"
            style={[styles.artwork, { height: artworkHeight }]}
            accessibilityLabel={`${song.title}のジャケット`}
          />
          <Text accessibilityRole="header" style={styles.trackTitle}>
            {song.title}
          </Text>

          <View style={styles.lyricSection}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              歌詞の思い出
            </Text>
            <View style={styles.verses}>
              {song.lyrics.blocks.map((memory) => {
                const context = blockContext(song, memory);
                return (
                  <View key={memory.id} style={styles.memory}>
                    <View style={styles.lyricCopy}>
                      <Text style={styles.lyrics}>{memory.text}</Text>
                      <Text
                        style={styles.context}
                        accessibilityLabel={`${context.date} ${context.time} ${context.place}`}
                      >
                        {context.date} {context.time} · {context.place}
                      </Text>
                    </View>
                    <ActionButton
                      label={`${context.place}、${context.date} ${context.time}の元の会話を開く`}
                      onPress={() => onMemory(memory)}
                      style={styles.sourceButton}
                      testID={`memory-${memory.id}`}
                    >
                      <Feather
                        name="message-circle"
                        size={26}
                        color="#332317"
                      />
                    </ActionButton>
                  </View>
                );
              })}
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>

      <View style={[styles.playerDock, { bottom: insets.bottom + 26 }]}>
        <View
          style={styles.player}
          onLayout={(event) => setPlayerHeight(event.nativeEvent.layout.height)}
        >
          <Image
            source={artwork}
            resizeMode="cover"
            style={styles.playerArtwork}
            accessible={false}
          />
          <View style={styles.playerInformation}>
            <Text style={styles.playerTitle} numberOfLines={1}>
              {song.title}
            </Text>
            <Text style={styles.playerTime}>
              {formatTime(currentPosition)} /{" "}
              {formatTime(song.durationMs / 1000)}
            </Text>
            <SeekSlider
              duration={song.durationMs / 1000}
              position={currentPosition}
              onSeek={onSeek}
              onScrub={onScrub}
            />
          </View>
          <ActionButton
            label={playing ? "一時停止" : "曲を再生"}
            onPress={onToggle}
            style={styles.playerToggle}
            testID="player-toggle"
          >
            <Feather
              name={playing ? "pause" : "play"}
              size={24}
              color="#fff8f0"
            />
          </ActionButton>
        </View>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#e6d4bf", overflow: "hidden" },
  safeArea: { flex: 1 },
  header: {
    width: "100%",
    maxWidth: 390,
    height: 80,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  back: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 2,
    backgroundColor: "transparent",
  },
  backLabel: { color: "#332317", fontSize: 15, fontWeight: "600" },
  share: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: "transparent",
  },
  scroll: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: 390,
    alignSelf: "center",
    paddingTop: 24,
    paddingHorizontal: 16,
  },
  tripTitle: {
    color: "#332317",
    fontSize: 32,
    lineHeight: 40,
    fontWeight: "700",
    letterSpacing: -1.15,
  },
  tripDate: {
    marginTop: 6,
    color: "#544033",
    fontSize: 14,
    lineHeight: 20,
    fontVariant: ["tabular-nums"],
  },
  members: {
    marginTop: 4,
    color: "#332317",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "500",
  },
  artwork: { width: "100%", marginTop: 10, borderRadius: 16 },
  trackTitle: {
    marginTop: 16,
    color: "#332317",
    fontSize: 26,
    lineHeight: 35,
    fontWeight: "700",
    letterSpacing: -0.9,
  },
  lyricSection: { marginTop: 26 },
  sectionTitle: {
    color: "#544033",
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "500",
  },
  verses: { marginTop: 22, gap: 24 },
  memory: {
    marginLeft: 6,
    flexDirection: "row",
    alignItems: "flex-start",
    paddingLeft: 22,
    gap: 16,
  },
  activeBar: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderRadius: 3,
    backgroundColor: "#9c5d2e",
  },
  lyricCopy: { flex: 1, minWidth: 0 },
  lyrics: {
    color: "#332317",
    fontSize: 22,
    lineHeight: 30,
    fontWeight: "700",
    letterSpacing: -0.7,
  },
  context: {
    marginTop: 5,
    color: "#544033",
    fontSize: 13,
    lineHeight: 20,
    fontVariant: ["tabular-nums"],
  },
  sourceButton: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.24)",
    backgroundColor: "rgba(255, 255, 255, 0.28)",
  },
  playerDock: {
    position: "absolute",
    left: 16,
    right: 16,
    alignItems: "center",
  },
  player: {
    width: "100%",
    maxWidth: 358,
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.48)",
    borderRadius: 20,
    backgroundColor: "rgba(249, 242, 234, 0.88)",
    shadowColor: "#392211",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 13,
    elevation: 3,
  },
  playerArtwork: { width: 52, height: 52, borderRadius: 9 },
  playerInformation: { flex: 1, minWidth: 0 },
  playerTitle: {
    color: "#332317",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  playerTime: {
    marginTop: 3,
    color: "#544033",
    fontSize: 12,
    lineHeight: 17,
    fontVariant: ["tabular-nums"],
  },
  playerToggle: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
    backgroundColor: "#493020",
  },
});
