import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import type { SongDocument } from "../../shared/contracts";
import { colors, radii } from "../design/tokens";
import { memoryPlaces, memoryWords } from "../domain/memories";
import { songDate } from "../pipeline/library";
import { ActionButton } from "./ActionButton";
import { DayTrace } from "./DayTrace";
import { MemoryAtmosphere } from "./MemoryAtmosphere";
import { People } from "./People";

export function MemoryWindow({
  song,
  names,
  onOpen,
}: {
  song: SongDocument;
  names: string[];
  onOpen: () => void;
}) {
  const date = songDate(song);
  const words = memoryWords(song);
  const places = memoryPlaces(song);
  const dateParts = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(date);
  return (
    <ActionButton
      label={`${song.title} ${date}の思い出を開く`}
      onPress={onOpen}
      style={styles.window}
      testID={`album-${song.id}`}
    >
      <View style={styles.cover}>
        <MemoryAtmosphere identity={song.id} />
        <View style={styles.datePaper}>
          <Text style={styles.date}>
            {dateParts ? `${dateParts[2]}.${dateParts[3]}` : "あの日"}
          </Text>
          <Text style={styles.year}>
            {dateParts ? dateParts[1] : "日時の記録なし"}
          </Text>
        </View>
        <View style={styles.open}>
          <Feather name="arrow-up-right" size={23} color={colors.ink} />
        </View>
        <View style={styles.trace}>
          <DayTrace clips={song.clips} memory />
        </View>
      </View>
      <View style={styles.words}>
        <Text style={styles.title}>{song.title}</Text>
        {words && (
          <Text style={styles.quote} numberOfLines={3}>
            {words.kind === "conversation" ? `「${words.text}」` : words.text}
          </Text>
        )}
        <People names={names} />
        {!!places.length && (
          <Text style={styles.places}>{places.join("  →  ")}</Text>
        )}
      </View>
    </ActionButton>
  );
}
const styles = StyleSheet.create({
  window: { marginBottom: 36 },
  cover: {
    height: 234,
    borderRadius: radii.window,
    overflow: "hidden",
    backgroundColor: colors.quiet,
  },
  datePaper: {
    position: "absolute",
    left: 18,
    bottom: 42,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: radii.surface,
    backgroundColor: colors.paper,
  },
  date: {
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -1.5,
    fontWeight: "400",
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  year: { fontSize: 11, lineHeight: 19, color: colors.muted, marginTop: 3 },
  open: {
    position: "absolute",
    right: 16,
    top: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  trace: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.paper,
    paddingHorizontal: 18,
    paddingVertical: 4,
  },
  words: { paddingHorizontal: 4, paddingTop: 18, gap: 12 },
  title: { color: colors.muted, fontSize: 13, lineHeight: 21 },
  quote: {
    color: colors.ink,
    fontSize: 25,
    lineHeight: 37,
    fontWeight: "600",
    letterSpacing: -0.8,
  },
  places: { color: colors.muted, fontSize: 12, lineHeight: 21 },
});
