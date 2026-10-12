import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type {
  LocalClip,
  LocalDraft,
  MusicPreferences,
} from "../../shared/contracts";
import {
  DEFAULT_MUSIC_PREFERENCES,
  MUSIC_PRESETS,
  VOCAL_LABELS,
} from "../../shared/music";
import { colors, radii } from "../design/tokens";
import { formatTime } from "../domain/session";
import { sourceContext } from "../pipeline/library";
import { ActionButton } from "./ActionButton";
import { TimeSculpture } from "./TimeSculpture";

export function FinishMemory({
  draft,
  onClip,
  onPrepare,
  onMusicPreferences,
  busy,
}: {
  draft: LocalDraft;
  onClip: (clip: LocalClip) => void;
  onPrepare: () => void;
  onMusicPreferences: (preferences: MusicPreferences) => void;
  busy: boolean;
}) {
  const preferences = draft.musicPreferences ?? DEFAULT_MUSIC_PREFERENCES;
  const locked = busy || !["local", "failed"].includes(draft.status);
  return (
    <View testID="finish-sheet">
      <Text style={styles.summary}>
        {draft.clips.length}区間の会話 /{" "}
        {formatTime(
          draft.clips.reduce((sum, clip) => sum + clip.durationMs, 0) / 1000,
        )}
      </Text>
      <TimeSculpture clips={draft.clips} />
      <View style={styles.clips}>
        {draft.clips.map((clip) => {
          const context = sourceContext(clip);
          return (
            <ActionButton
              key={clip.id}
              label={`${context.place}の音声を確認`}
              onPress={() => onClip(clip)}
              style={styles.clipRow}
            >
              <Text style={styles.time}>{context.time || "時刻不明"}</Text>
              <View style={styles.clipCopy}>
                <Text style={styles.clipPlace}>{context.place}</Text>
                <Text style={styles.summary}>
                  {context.date} / {formatTime(clip.durationMs / 1000)}
                </Text>
              </View>
              <Feather name="headphones" size={19} color={colors.ink} />
            </ActionButton>
          );
        })}
      </View>
      <View style={styles.settings}>
        <Text style={styles.settingLabel}>どんな曲にする？</Text>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="曲のジャンル"
          style={styles.choices}
        >
          {(Object.keys(MUSIC_PRESETS) as MusicPreferences["genre"][]).map(
            (genre) => (
              <Pressable
                key={genre}
                accessibilityRole="radio"
                aria-checked={preferences.genre === genre}
                aria-disabled={locked}
                accessibilityState={{
                  checked: preferences.genre === genre,
                  disabled: locked,
                }}
                disabled={locked}
                onPress={() => onMusicPreferences({ ...preferences, genre })}
                testID={`genre-${genre}`}
                style={[
                  styles.choice,
                  preferences.genre === genre && styles.selected,
                ]}
              >
                <Text style={styles.choiceText}>
                  {MUSIC_PRESETS[genre].label}
                </Text>
              </Pressable>
            ),
          )}
        </View>
        <Text style={styles.settingLabel}>歌声</Text>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="歌声"
          style={styles.choices}
        >
          {(Object.keys(VOCAL_LABELS) as MusicPreferences["vocal"][]).map(
            (vocal) => (
              <Pressable
                key={vocal}
                accessibilityRole="radio"
                aria-checked={preferences.vocal === vocal}
                aria-disabled={locked}
                accessibilityState={{
                  checked: preferences.vocal === vocal,
                  disabled: locked,
                }}
                disabled={locked}
                onPress={() => onMusicPreferences({ ...preferences, vocal })}
                testID={`vocal-${vocal}`}
                style={[
                  styles.choice,
                  preferences.vocal === vocal && styles.selected,
                ]}
              >
                <Text style={styles.choiceText}>{VOCAL_LABELS[vocal]}</Text>
              </Pressable>
            ),
          )}
        </View>
        <Text style={styles.summary}>
          選んだ曲調に合わせて、歌詞を作ります。
        </Text>
      </View>
      <ActionButton
        label="この一日を歌詞にする"
        onPress={onPrepare}
        disabled={busy || !draft.clips.length}
        style={styles.primary}
        testID="prepare-lyrics"
      >
        <Text style={styles.primaryText}>
          {busy ? "会話を届けています" : "この一日を、歌詞に"}
        </Text>
        <Feather name="arrow-right" size={19} color={colors.paper} />
      </ActionButton>
    </View>
  );
}

const styles = StyleSheet.create({
  settings: { marginBottom: 24, gap: 10 },
  settingLabel: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "600",
    marginTop: 6,
  },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.line,
  },
  selected: { borderColor: colors.ink, backgroundColor: colors.paper },
  choiceText: { color: colors.ink, fontSize: 14 },
  summary: { color: colors.muted, fontSize: 12, lineHeight: 21 },
  clips: { marginVertical: 22 },
  clipRow: {
    minHeight: 74,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  time: {
    width: 54,
    color: colors.ink,
    fontSize: 13,
    lineHeight: 23,
    fontVariant: ["tabular-nums"],
  },
  clipCopy: { flex: 1, gap: 3 },
  clipPlace: { color: colors.ink, fontSize: 15, lineHeight: 24 },
  primary: {
    minHeight: 56,
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: colors.ink,
    borderRadius: radii.control,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  primaryText: {
    color: colors.paper,
    fontSize: 15,
    lineHeight: 24,
    fontWeight: "600",
    flexShrink: 1,
  },
});
