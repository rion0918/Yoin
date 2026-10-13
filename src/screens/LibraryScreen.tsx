import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import type {
  LocalDraft,
  LocalSpeakerProfile,
  SongDocument,
} from "../../shared/contracts";
import { ActionButton } from "../components/ActionButton";
import { DayTrace } from "../components/DayTrace";
import { MemoryReveal } from "../components/MemoryReveal";
import { MemoryWindow } from "../components/MemoryWindow";
import { NativeSheet } from "../components/NativeSheet";
import { TimeSculpture } from "../components/TimeSculpture";
import { YoinLogo } from "../components/YoinLogo";
import { colors, layout, radii } from "../design/tokens";
import { memoryGroups } from "../domain/memories";
import { formatTime } from "../domain/session";

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

const draftLabels: Partial<Record<LocalDraft["status"], string>> = {
  uploading: "一日の言葉を届けています",
  preparing: "会話から、歌詞へ",
  updating_readings: "歌詞の読みを更新しています",
  waiting_review: "歌詞を確かめよう",
  needs_audio_review: "話者と内容を確認して歌詞を作る",
  generating: "この一日が、一曲になる",
  failed: "保存した記録から続きを確認",
  needs_reconciliation: "処理結果の確認が必要です",
};

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
  const insets = useSafeAreaInsets();
  const [dockHeight, setDockHeight] = useState(0);
  const [speakerSelectionOpen, setSpeakerSelectionOpen] = useState(false);
  const [selectedSpeakerProfileIds, setSelectedSpeakerProfileIds] = useState<
    string[]
  >([]);
  const registeredSpeakers = speakers.filter(
    (s) => s.status === "ready" && s.sampleId && s.modelVersion,
  );
  function openNewRecording() {
    if (!registeredSpeakers.length) {
      onSpeakerSettings();
      return;
    }
    setSelectedSpeakerProfileIds([]);
    setSpeakerSelectionOpen(true);
  }
  function toggleSpeaker(id: string) {
    setSelectedSpeakerProfileIds((selected) =>
      selected.includes(id)
        ? selected.filter((value) => value !== id)
        : [...selected, id],
    );
  }
  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={styles.screen}
      testID="home"
    >
      <View style={styles.header}>
        <YoinLogo style={styles.wordmark} />
        <View style={styles.headerActions}>
          <ActionButton
            label="話者設定"
            onPress={onSpeakerSettings}
            style={styles.iconButton}
            testID="speaker-settings"
          >
            <Feather name="users" size={20} color={colors.ink} />
          </ActionButton>
          <ActionButton
            label="設定"
            onPress={onSettings}
            style={styles.iconButton}
            testID="account-settings"
          >
            <Feather name="settings" size={20} color={colors.ink} />
          </ActionButton>
        </View>
      </View>
      <ScrollView
        style={[
          styles.scroll,
          {
            marginBottom: dockHeight
              ? dockHeight + insets.bottom + 24
              : insets.bottom + 116,
          },
        ]}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 24 },
        ]}
      >
        <View style={styles.introduction}>
          <Text accessibilityRole="header" style={styles.heading}>
            {songs.length
              ? "あの日のことを、\nもう一度。"
              : "今日を、\n未来に残そう。"}
          </Text>
          <Text style={styles.intro}>声も、笑った理由も、ここに。</Text>
        </View>
        {!!drafts.length && (
          <View style={styles.drafts}>
            <Text style={styles.sectionHeading} accessibilityRole="header">
              途中の一日
            </Text>
            {drafts.map((draft) => (
              <ActionButton
                key={draft.id}
                label={`${draft.title}の続きを開く`}
                onPress={() => onOpenDraft(draft)}
                style={styles.draftRow}
                testID={`draft-${draft.id}`}
              >
                <View style={styles.draftIcon}>
                  <Feather name="mic" size={20} color={colors.ink} />
                </View>
                <View style={styles.rowInformation}>
                  <Text style={styles.draftTitle}>{draft.title}</Text>
                  <Text style={styles.detail}>
                    {draft.status === "needs_reconciliation" &&
                    !draft.lyrics &&
                    draft.transcriptRecoveryAvailable
                      ? "文字起こしを復旧できます"
                      : (draftLabels[draft.status] ??
                        `${draft.clips.length}区間の会話 / ${formatTime(draft.clips.reduce((sum, clip) => sum + clip.durationMs, 0) / 1000)}`)}
                  </Text>
                  <DayTrace clips={draft.clips} />
                </View>
                <Feather name="arrow-up-right" size={20} color={colors.ink} />
              </ActionButton>
            ))}
          </View>
        )}
        <View style={styles.memoriesHeading}>
          <Text style={styles.sectionHeading} accessibilityRole="header">
            わたしたちの思い出
          </Text>
          <Text style={styles.detail}>
            {songs.length
              ? `${songs.length}つの思い出`
              : "はじめての一日を、ここに。"}
          </Text>
        </View>
        {memoryGroups(songs).map((group) => (
          <View key={group.key}>
            <Text style={styles.monthLabel} accessibilityRole="header">
              {group.label}
            </Text>
            {group.songs.map((song) => (
              <MemoryReveal key={song.id}>
                <MemoryWindow
                  song={song}
                  names={(song.speakerProfileIds ?? []).flatMap((id) => {
                    const name = speakers.find((s) => s.id === id)?.name;
                    return name ? [name] : [];
                  })}
                  onOpen={() => onOpenSong(song)}
                />
              </MemoryReveal>
            ))}
          </View>
        ))}
        {!songs.length && (
          <View style={styles.empty}>
            <TimeSculpture clips={[]} />
            <Text style={styles.emptyWords}>
              {"なんでもない話が、\n忘れたくない一日になる。"}
            </Text>
            <Text style={styles.intro}>今日の会話から、思い出の一曲を。</Text>
          </View>
        )}
      </ScrollView>
      <View
        style={[styles.dock, { bottom: insets.bottom + 16 }]}
        pointerEvents="box-none"
      >
        <View
          style={styles.dockContent}
          onLayout={(event) => setDockHeight(event.nativeEvent.layout.height)}
        >
          <Text style={styles.startHint}>メンバーを選んで録音へ</Text>
          <ActionButton
            label="メンバーを選んで会話を録音する"
            onPress={openNewRecording}
            style={styles.start}
            testID="new-recording"
          >
            <View style={styles.startLeft}>
              <Feather name="mic" size={21} color={colors.paper} />
              <View style={styles.startDivider} />
              <Text style={styles.startText}>会話を録音する</Text>
            </View>
          </ActionButton>
        </View>
      </View>
      <NativeSheet
        open={speakerSelectionOpen}
        onClose={() => setSpeakerSelectionOpen(false)}
        title="今日は、誰と？"
        description="この一日を一緒に過ごす人を選んでください。"
        snap={0.66}
        footer={
          <ActionButton
            label="選んだ話者で新しい記録を始める"
            onPress={() => {
              setSpeakerSelectionOpen(false);
              onNewRecording(selectedSpeakerProfileIds);
            }}
            disabled={!selectedSpeakerProfileIds.length}
            style={styles.primary}
            testID="start-memory-recording"
          >
            <Text style={styles.primaryText}>このメンバーで、残そう</Text>
            <Feather name="arrow-right" size={19} color={colors.paper} />
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
                <Text style={styles.speakerName}>{speaker.name}</Text>
                <Feather
                  name={selected ? "check-circle" : "circle"}
                  size={24}
                  color={selected ? colors.ink : colors.muted}
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
  screen: { flex: 1, backgroundColor: colors.paper },
  header: {
    width: "100%",
    maxWidth: layout.pageWidth,
    alignSelf: "center",
    minHeight: 80,
    paddingHorizontal: layout.inset,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  wordmark: { width: 144 },
  headerActions: { flexDirection: "row", gap: 8 },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.quiet,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    width: "100%",
    maxWidth: layout.pageWidth,
    alignSelf: "center",
    paddingHorizontal: layout.inset,
  },
  scroll: { flex: 1 },
  introduction: { paddingTop: 18, paddingBottom: 34 },
  heading: {
    color: colors.ink,
    fontSize: 34,
    lineHeight: 46,
    fontWeight: "600",
    letterSpacing: -1.3,
  },
  intro: { color: colors.muted, fontSize: 13, lineHeight: 24, marginTop: 12 },
  sectionHeading: {
    color: colors.ink,
    fontSize: 16,
    lineHeight: 26,
    fontWeight: "600",
  },
  detail: { color: colors.muted, fontSize: 12, lineHeight: 20 },
  drafts: { marginBottom: 28 },
  draftRow: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: radii.surface,
    backgroundColor: colors.quiet,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  draftIcon: {
    width: 32,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  rowInformation: { flex: 1, gap: 4 },
  draftTitle: {
    color: colors.ink,
    fontSize: 14,
    lineHeight: 23,
    fontWeight: "600",
  },
  memoriesHeading: { paddingBottom: 20, gap: 5 },
  monthLabel: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 22,
    marginBottom: 14,
    marginTop: 2,
  },
  dock: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  dockContent: {
    width: "100%",
    maxWidth: layout.pageWidth,
    paddingHorizontal: layout.inset,
    alignItems: "flex-end",
    gap: 8,
  },
  start: {
    maxWidth: "100%",
    alignSelf: "flex-end",
    shadowColor: "#839286",
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 8,
    minHeight: 56,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: radii.control,
    backgroundColor: colors.ink,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 12,
  },
  startHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 1,
  },
  startLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  startDivider: {
    width: StyleSheet.hairlineWidth,
    height: 24,
    backgroundColor: "#707872",
  },
  startText: {
    color: colors.paper,
    fontSize: 15,
    lineHeight: 24,
    fontWeight: "600",
    flexShrink: 1,
  },
  empty: { paddingVertical: 16, gap: 16 },
  emptyWords: {
    color: colors.ink,
    fontSize: 23,
    lineHeight: 36,
    letterSpacing: -0.6,
    fontWeight: "500",
  },
  primary: {
    minHeight: 60,
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderRadius: radii.control,
    backgroundColor: colors.ink,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  primaryText: {
    color: colors.paper,
    fontSize: 15,
    lineHeight: 25,
    fontWeight: "600",
    flexShrink: 1,
  },
  speakerOption: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 20,
  },
  speakerName: {
    color: colors.ink,
    fontSize: 24,
    lineHeight: 34,
    fontWeight: "500",
    flex: 1,
  },
});
