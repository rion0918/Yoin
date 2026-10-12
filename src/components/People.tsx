import { StyleSheet, Text, View } from "react-native";
import { figmaColors } from "../design/figma";
import { colors } from "../design/tokens";

export function People({
  names,
  tone = "light",
}: {
  names: string[];
  tone?: "light" | "dark";
}) {
  if (!names.length) return null;
  return (
    <View style={styles.people}>
      <View
        style={styles.portraits}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      >
        {Array.from(new Set(names))
          .slice(0, 4)
          .map((name, index) => (
            <View
              key={name}
              style={[
                styles.portrait,
                tone === "dark" && styles.darkPortrait,
                index > 0 && styles.overlap,
              ]}
            >
              <Text
                style={[styles.initial, tone === "dark" && styles.darkText]}
              >
                {Array.from(name)[0]}
              </Text>
            </View>
          ))}
      </View>
      <Text style={[styles.names, tone === "dark" && styles.darkText]}>
        {names.join("、")}と
      </Text>
    </View>
  );
}
const styles = StyleSheet.create({
  people: { flexDirection: "row", alignItems: "center", gap: 10 },
  portraits: { flexDirection: "row" },
  portrait: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.quiet,
    borderWidth: 2,
    borderColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  darkPortrait: {
    backgroundColor: figmaColors.inset,
    borderColor: figmaColors.surface,
  },
  overlap: { marginLeft: -9 },
  initial: { fontSize: 11, fontWeight: "600", color: colors.muted },
  names: { flex: 1, fontSize: 12, lineHeight: 20, color: colors.muted },
  darkText: { color: figmaColors.primary },
});
