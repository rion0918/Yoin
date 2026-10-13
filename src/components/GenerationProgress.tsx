import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import type { LocalDraft } from "../../shared/contracts";
import { colors } from "../design/tokens";
import { draftProgress } from "../pipeline/draft-progress";
import { sourceContext } from "../pipeline/library";
import { ActionButton } from "./ActionButton";
import { MemoryReveal } from "./MemoryReveal";
import { TimeSculpture } from "./TimeSculpture";

export function GenerationProgress({
  draft,
  onClose,
}: {
  draft: LocalDraft;
  onClose: () => void;
}) {
  const waiting = [
    "uploading",
    "preparing",
    "generating",
    "updating_readings",
  ].includes(draft.status);
  const lyrics =
    draft.status === "generating" ? (draft.lyrics?.blocks ?? []) : [];
  const { label: heading, description } = draftProgress(draft);
  return (
    <View testID="generation-content">
      <Text style={styles.day}>{draft.title}</Text>
      <Text accessibilityRole="header" style={styles.heading}>
        {heading}
      </Text>
      <TimeSculpture clips={draft.clips} active={waiting} />
      <Text style={styles.description} accessibilityLiveRegion="polite">
        {description}
      </Text>
      {waiting && (
        <MemoryReveal key={draft.status}>
          <View style={styles.words}>
            <Text style={styles.wordsLabel}>
              {lyrics.length
                ? "確かめた歌詞より"
                : draft.utterances.length
                  ? "残した会話より"
                  : "残した時間"}
            </Text>
            {lyrics.length
              ? lyrics.slice(0, 3).map((block) => (
                  <Text key={block.id} style={styles.lyric} numberOfLines={3}>
                    {block.text}
                  </Text>
                ))
              : draft.utterances.length
                ? draft.utterances.slice(0, 3).map((utterance) => (
                    <Text
                      key={utterance.id}
                      style={styles.lyric}
                      numberOfLines={3}
                    >
                      「{utterance.text}」
                    </Text>
                  ))
                : draft.clips.slice(0, 3).map((clip) => {
                    const context = sourceContext(clip);
                    return (
                      <Text key={clip.id} style={styles.capture}>
                        {context.date} {context.time}
                        {context.place === "場所不明"
                          ? ""
                          : ` / ${context.place}`}
                      </Text>
                    );
                  })}
          </View>
        </MemoryReveal>
      )}
      <View style={styles.footer}>
        <Text style={styles.note}>
          {waiting
            ? "画面を閉じても、続きを確認できます。"
            : "保存した内容から、状況を確認できます。"}
        </Text>
        <ActionButton label="記録に戻る" onPress={onClose} style={styles.close}>
          <Text style={styles.closeLabel}>記録に戻る</Text>
          <Feather name="arrow-right" size={18} color={colors.ink} />
        </ActionButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  day: { color: colors.muted, fontSize: 13, lineHeight: 22 },
  heading: {
    marginTop: 16,
    marginBottom: 22,
    fontSize: 28,
    lineHeight: 41,
    letterSpacing: -0.8,
    fontWeight: "600",
    color: colors.ink,
  },
  description: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 25,
    marginTop: 12,
  },
  words: {
    marginTop: 30,
    gap: 16,
  },
  wordsLabel: { color: colors.muted, fontSize: 12, lineHeight: 20 },
  lyric: { color: colors.ink, fontSize: 20, lineHeight: 31, fontWeight: "500" },
  capture: { color: colors.ink, fontSize: 15, lineHeight: 26 },
  footer: { marginTop: 30 },
  note: { color: colors.muted, fontSize: 12, lineHeight: 21 },
  close: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    marginTop: 8,
  },
  closeLabel: {
    color: colors.ink,
    fontSize: 15,
    lineHeight: 24,
    fontWeight: "600",
  },
});
