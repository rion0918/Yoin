import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type {
  LocalDraft,
  LocalSpeakerProfile,
  SongDocument,
} from "../../shared/contracts";
import { ActionButton } from "../components/ActionButton";
import { NativeSheet } from "../components/NativeSheet";
import { formatTime } from "../domain/session";
import { songDate } from "../pipeline/library";

type LibraryScreenProps = {
  songs: SongDocument[];
  drafts: LocalDraft[];
  speakers: LocalSpeakerProfile[];
  onNewRecording: (speakerProfileIds: string[]) => void;
  onSettings: () => void;
  onSpeakerSettings: () => void;
  onOpenDraft: (draft: LocalDraft) => void;
  onOpenSong: (song: SongDocument) => void;
};

const artwork = require("../../assets/season-background.png");

export function LibraryScreen({
  songs,
  drafts,
  speakers,
  onNewRecording,
  onSettings,
  onSpeakerSettings,
  onOpenDraft,
  onOpenSong,
}: LibraryScreenProps) {
  const [speakerSelectionOpen, setSpeakerSelectionOpen] = useState(false);
  const [selectedSpeakerProfileIds, setSelectedSpeakerProfileIds] = useState<
    string[]
  >([]);
  const { width } = useWindowDimensions();
  const albumWidth = (Math.min(width, 390) - 48) / 2;
  const registeredSpeakers = speakers.filter(
    (speaker) =>
      speaker.status === "ready" && speaker.sampleId && speaker.modelVersion,
  );

  function openNewRecording() {
    if (!registeredSpeakers.length) {
      onSpeakerSettings();
      return;
    }
    setSelectedSpeakerProfileIds([]);
    setSpeakerSelectionOpen(true);
  }

  function startRecording() {
    setSpeakerSelectionOpen(false);
    onNewRecording(selectedSpeakerProfileIds);
  }

  function toggleSpeaker(speakerId: string) {
    setSelectedSpeakerProfileIds((selected) =>
      selected.includes(speakerId)
        ? selected.filter((value) => value !== speakerId)
        : [...selected, speakerId],
    );
  }

  return (
    <SafeAreaView style={styles.screen} testID="home">
      <View style={styles.header}>
        <Text style={styles.wordmark}>Yoin</Text>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <ActionButton
            label="話者設定"
            onPress={onSpeakerSettings}
            style={styles.newRecording}
            testID="speaker-settings"
          >
            <Feather name="users" size={20} color="#332317" />
          </ActionButton>
          <ActionButton
            label="設定"
            onPress={onSettings}
            style={styles.newRecording}
            testID="account-settings"
          >
            <Feather name="settings" size={21} color="#332317" />
          </ActionButton>
          <ActionButton
            label="新しい記録"
            onPress={openNewRecording}
            style={styles.newRecording}
            testID="new-recording"
          >
            <Feather name="plus" size={25} color="#332317" />
          </ActionButton>
        </View>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.heading} accessibilityRole="header">
          ライブラリ
        </Text>
        <Text style={styles.subtitle}>あなたの時間を、もう一度。</Text>

        {drafts.length > 0 && (
          <View style={styles.drafts}>
            <Text style={styles.sectionHeading} accessibilityRole="header">
              記録の途中
            </Text>
            {drafts.map((draft) => (
              <ActionButton
                key={draft.id}
                label={`${draft.title}を再開`}
                onPress={() => onOpenDraft(draft)}
                style={styles.draftRow}
                testID={`draft-${draft.id}`}
              >
                <View style={styles.draftIcon}>
                  <Feather name="mic" size={21} color="#332317" />
                </View>
                <View style={styles.rowInformation}>
                  <Text style={styles.draftTitle}>{draft.title}</Text>
                  <Text style={styles.rowDetail}>
                    {draft.clips.length}件の会話 ·{" "}
                    {formatTime(
                      draft.clips.reduce(
                        (sum, clip) => sum + clip.durationMs,
                        0,
                      ) / 1000,
                    )}
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color="#726d69" />
              </ActionButton>
            ))}
          </View>
        )}

        {!songs.length && (
          <Text style={styles.subtitle}>
            右上の＋から、会話を残してみよう。
          </Text>
        )}
        <View style={styles.albums}>
          {songs.map((song) => (
            <ActionButton
              key={song.id}
              label={`${song.title} ${songDate(song)}の曲を開く`}
              onPress={() => onOpenSong(song)}
              style={[styles.album, { width: albumWidth }]}
              testID={`album-${song.id}`}
            >
              <Image
                source={artwork}
                style={[
                  styles.cover,
                  { width: albumWidth, height: albumWidth },
                ]}
                resizeMode="cover"
                accessibilityLabel={`${song.title}の仮ジャケット`}
              />
              <Text style={styles.albumTitle}>{song.title}</Text>
              <Text style={styles.albumDate}>{songDate(song)}</Text>
            </ActionButton>
          ))}
        </View>
      </ScrollView>
      <NativeSheet
        open={speakerSelectionOpen}
        onClose={() => setSpeakerSelectionOpen(false)}
        title="参加する人を選ぶ"
        description="この記録で話した人を選んでください。記録ごとに別の組み合わせを選べます。"
        snap={0.66}
        footer={
          <ActionButton
            label="選んだ話者で新しい記録を始める"
            onPress={startRecording}
            disabled={!selectedSpeakerProfileIds.length}
            style={styles.startRecording}
            testID="start-memory-recording"
          >
            <Text style={styles.startRecordingLabel}>
              選んだ人で記録をはじめる
            </Text>
          </ActionButton>
        }
      >
        <View testID="speaker-selection-sheet">
          {registeredSpeakers.map((speaker) => {
            const selected = selectedSpeakerProfileIds.includes(speaker.id);
            return (
              <ActionButton
                key={speaker.id}
                label={`${speaker.name}${selected ? "を選択済み" : "を選ぶ"}`}
                onPress={() => toggleSpeaker(speaker.id)}
                style={styles.speakerOption}
                testID={`select-speaker-${speaker.id}`}
              >
                <View style={styles.speakerOptionCopy}>
                  <Text style={styles.speakerName}>{speaker.name}</Text>
                  <Text style={styles.speakerHint}>登録済みの話者</Text>
                </View>
                <Feather
                  name={selected ? "check-circle" : "circle"}
                  size={22}
                  color={selected ? "#9c5d2e" : "#aaa19a"}
                />
              </ActionButton>
            );
          })}
        </View>
      </NativeSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  header: {
    width: "100%",
    maxWidth: 390,
    alignSelf: "center",
    height: 80,
    paddingHorizontal: 16,
    paddingTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  wordmark: {
    color: "#332317",
    fontSize: 32,
    lineHeight: 36,
    fontWeight: "700",
    letterSpacing: -1.4,
  },
  newRecording: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f1f0ef",
  },
  content: {
    width: "100%",
    maxWidth: 390,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 32,
  },
  heading: {
    color: "#332317",
    fontSize: 38,
    lineHeight: 48,
    fontWeight: "700",
    letterSpacing: -1.7,
  },
  subtitle: { marginTop: 8, color: "#726d69", fontSize: 16, lineHeight: 24 },
  drafts: { marginTop: 28 },
  sectionHeading: {
    color: "#726d69",
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
    marginBottom: 8,
  },
  draftRow: {
    minHeight: 70,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  draftIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#f2f0ee",
    alignItems: "center",
    justifyContent: "center",
  },
  rowInformation: { flex: 1, gap: 3 },
  draftTitle: {
    color: "#332317",
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "600",
  },
  rowDetail: {
    color: "#726d69",
    fontSize: 12,
    lineHeight: 18,
    fontVariant: ["tabular-nums"],
  },
  albums: {
    marginTop: 28,
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 16,
    rowGap: 26,
  },
  album: { alignItems: "flex-start" },
  cover: { width: "100%", aspectRatio: 1, borderRadius: 14 },
  albumTitle: {
    marginTop: 10,
    color: "#332317",
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "600",
  },
  albumDate: {
    marginTop: 5,
    color: "#726d69",
    fontSize: 13,
    lineHeight: 20,
    fontVariant: ["tabular-nums"],
  },
  speakerOption: {
    minHeight: 64,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5ded8",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  speakerOptionCopy: { gap: 2 },
  speakerName: {
    color: "#332317",
    fontSize: 16,
    lineHeight: 23,
    fontWeight: "600",
  },
  speakerHint: { color: "#726d69", fontSize: 12, lineHeight: 18 },
  startRecording: {
    minHeight: 52,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 14,
    backgroundColor: "#493020",
  },
  startRecordingLabel: {
    color: "#fff8f0",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
  },
});
