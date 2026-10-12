import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { DraftDocument, LyricBlock } from "../../shared/contracts";
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
  busy,
}: {
  draft: DraftDocument;
  blocks: LyricBlock[];
  songTitle: string;
  onChange: (id: string, text: string) => void;
  onSongTitle: (title: string) => void;
  onSource: (block: LyricBlock) => void;
  onGenerate: () => void;
  busy: boolean;
}) {
  return (
    <View testID="lyrics-review">
      {blocks.map((block) => {
        const context = blockContext(draft, block);
        return (
          <View key={block.id} style={styles.block}>
            <TextInput
              value={block.text}
              onChangeText={(text) => onChange(block.id, text)}
              multiline
              accessibilityLabel="歌詞を編集"
              style={styles.input}
              testID={`lyric-editor-${block.id}`}
            />
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
        />
        <Text style={styles.songTitleHint}>プレイリストに表示されます。</Text>
      </View>
      <ActionButton
        label="この歌詞で曲を作る"
        onPress={onGenerate}
        disabled={
          busy ||
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
