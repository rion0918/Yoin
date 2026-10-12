import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { DraftDocument, LyricBlock } from "../../shared/contracts";
import {
  hasReadyReadings,
  isSingingText,
  MUSIC_PRESETS,
  SECTION_LABELS,
  VOCAL_LABELS,
} from "../../shared/music";
import { colors, radii } from "../design/tokens";
import { blockContext } from "../pipeline/library";
import { ActionButton } from "./ActionButton";

export function LyricReview({
  draft,
  blocks,
  songTitle,
  onChange,
  onSongTitle,
  onSource,
  onGenerate,
  onReading,
  onUpdateReadings,
  busy,
}: {
  draft: DraftDocument;
  blocks: LyricBlock[];
  songTitle: string;
  onChange: (id: string, text: string) => void;
  onSongTitle: (title: string) => void;
  onSource: (block: LyricBlock) => void;
  onGenerate: () => void;
  onReading: (id: string, reading: string) => void;
  onUpdateReadings: () => void;
  busy: boolean;
}) {
  const [readingsOpen, setReadingsOpen] = useState(false);
  const modern = draft.lyrics?.generationVersion === 2;
  const preferences = draft.lyrics?.musicPreferences;
  const readyReadings = hasReadyReadings(blocks);
  const locked = busy || draft.status === "updating_readings";
  return (
    <View testID="lyrics-review">
      {preferences && (
        <Text style={styles.settings}>
          {MUSIC_PRESETS[preferences.genre].label} / 歌声：
          {VOCAL_LABELS[preferences.vocal]}
        </Text>
      )}
      {modern && (
        <ActionButton
          label={readingsOpen ? "歌詞の読みを閉じる" : "歌詞の読みを確認・修正"}
          onPress={() => setReadingsOpen((value) => !value)}
          style={styles.readingToggle}
          testID="toggle-readings"
        >
          <Text style={styles.settingLabel}>歌詞の読みを確認・修正</Text>
          <Feather
            name={readingsOpen ? "chevron-up" : "chevron-down"}
            size={18}
            color={colors.ink}
          />
        </ActionButton>
      )}
      {blocks.map((block) => {
        const context = blockContext(draft, block);
        return (
          <View key={block.id} style={styles.block}>
            {modern && block.section && (
              <Text style={styles.section}>
                {SECTION_LABELS[block.section]}
              </Text>
            )}
            <TextInput
              value={block.text}
              onChangeText={(text) => onChange(block.id, text)}
              multiline
              editable={!locked}
              accessibilityLabel="歌詞を編集"
              style={styles.input}
              testID={`lyric-editor-${block.id}`}
            />
            {modern && readingsOpen && (
              <View style={styles.readingField}>
                <Text style={styles.readingHint}>歌う読み</Text>
                <TextInput
                  value={block.singingText ?? ""}
                  onChangeText={(reading) => onReading(block.id, reading)}
                  editable={!locked}
                  multiline
                  accessibilityLabel={`${block.id}の歌う読みを編集`}
                  placeholder="読みを更新するか、かなで入力"
                  style={styles.readingInput}
                  testID={`reading-editor-${block.id}`}
                />
                {!isSingingText(block.text, block.singingText) && (
                  <Text style={styles.readingHint}>
                    かなで本文と同じ行数にしてください。自動更新もできます。
                  </Text>
                )}
              </View>
            )}
            <ActionButton
              label="元の会話を確認"
              onPress={() => onSource(block)}
              style={styles.source}
            >
              <View style={styles.context}>
                <Text style={styles.place}>{context.place}</Text>
                <Text style={styles.date}>
                  {context.date} {context.time}
                </Text>
              </View>
              <Feather name="message-circle" size={19} color={colors.ink} />
            </ActionButton>
          </View>
        );
      })}
      {modern && !readyReadings && (
        <View style={styles.readingUpdate}>
          <Text style={styles.readingHint}>
            編集した歌詞の読みを更新してから、曲を作れます。
          </Text>
          <ActionButton
            label="読みを更新"
            onPress={onUpdateReadings}
            disabled={locked || blocks.some((block) => !block.text.trim())}
            style={styles.readingToggle}
            testID="update-readings"
          >
            <Text style={styles.settingLabel}>読みを更新</Text>
            <Feather name="refresh-cw" size={18} color={colors.ink} />
          </ActionButton>
        </View>
      )}
      <View style={styles.songTitleField}>
        <Text style={styles.songTitleLabel}>曲名</Text>
        <TextInput
          value={songTitle}
          onChangeText={onSongTitle}
          maxLength={80}
          returnKeyType="done"
          accessibilityLabel="完成曲の曲名"
          placeholder="曲名を入力"
          placeholderTextColor={colors.muted}
          style={styles.songTitleInput}
          testID="song-title-input"
          editable={!locked}
        />
        <Text style={styles.songTitleHint}>プレイリストに表示されます。</Text>
      </View>
      <ActionButton
        label="この歌詞で曲を作る"
        onPress={onGenerate}
        disabled={
          locked ||
          (modern && !readyReadings) ||
          !songTitle.trim() ||
          !blocks.length ||
          blocks.some((block) => !block.text.trim())
        }
        style={styles.primary}
        testID="create-song"
      >
        <Text style={styles.primaryText}>この歌詞で、一曲に</Text>
        <Feather name="arrow-right" size={19} color={colors.paper} />
      </ActionButton>
    </View>
  );
}

const styles = StyleSheet.create({
  settings: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 22,
    marginBottom: 12,
  },
  settingLabel: { color: colors.ink, fontSize: 14, fontWeight: "600" },
  section: { color: colors.muted, fontSize: 12, marginBottom: 6 },
  readingToggle: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 16,
  },
  readingField: { paddingTop: 12, gap: 6 },
  readingInput: {
    minHeight: 68,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 12,
    color: colors.ink,
    fontSize: 16,
    lineHeight: 25,
    textAlignVertical: "top",
  },
  readingHint: { color: colors.muted, fontSize: 12, lineHeight: 21 },
  readingUpdate: { marginBottom: 14 },
  block: {
    marginBottom: 28,
  },
  input: {
    minHeight: 100,
    paddingVertical: 12,
    color: colors.ink,
    fontSize: 22,
    lineHeight: 34,
    textAlignVertical: "top",
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  source: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    paddingTop: 8,
  },
  context: { flex: 1, gap: 2 },
  place: { color: colors.ink, fontSize: 13, lineHeight: 22 },
  date: { color: colors.muted, fontSize: 12, lineHeight: 20 },
  songTitleField: { marginBottom: 22 },
  songTitleLabel: {
    color: colors.ink,
    fontSize: 13,
    lineHeight: 22,
    fontWeight: "600",
  },
  songTitleInput: {
    minHeight: 54,
    marginTop: 5,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    color: colors.ink,
    fontSize: 17,
    lineHeight: 25,
  },
  songTitleHint: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 18,
    marginTop: 5,
  },
  primary: {
    minHeight: 56,
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderRadius: radii.control,
    backgroundColor: colors.ink,
  },
  primaryText: {
    flexShrink: 1,
    color: colors.paper,
    fontSize: 15,
    lineHeight: 24,
    fontWeight: "600",
  },
});
