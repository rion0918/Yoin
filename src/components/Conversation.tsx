import { StyleSheet, Text, View } from "react-native";
import type { Memory } from "../domain/types";

export function Conversation({ memory }: { memory: Memory }) {
  return (
    <View style={styles.conversation}>
      {memory.conversation.map((line) => (
        <View
          key={`${memory.id}-${line.person}-${line.words}`}
          style={styles.line}
        >
          <Text style={styles.person}>{line.person}</Text>
          <Text style={styles.words}>「{line.words}」</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  conversation: { gap: 20 },
  line: { flexDirection: "row", alignItems: "flex-start", gap: 16 },
  person: {
    width: 46,
    color: "#6f5d4e",
    fontSize: 12,
    lineHeight: 24,
    fontWeight: "600",
  },
  words: { flex: 1, color: "#332317", fontSize: 16, lineHeight: 27 },
});
