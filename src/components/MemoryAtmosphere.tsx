import { Image, StyleSheet, View } from "react-native";

const artwork = require("../../assets/memory-light.png");

// Decorative artwork, never presented as a photograph taken on this day.
export function MemoryAtmosphere({ identity }: { identity: string }) {
  const crop =
    Array.from(identity).reduce(
      (sum, char) => sum + (char.codePointAt(0) ?? 0),
      0,
    ) % 4;
  return (
    <View
      style={styles.frame}
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Image
        source={artwork}
        resizeMode="cover"
        accessible={false}
        style={[
          styles.art,
          { left: crop % 2 ? "-40%" : "0%", top: crop > 1 ? "-40%" : "0%" },
        ]}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  frame: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "#cad2ca",
    overflow: "hidden",
  },
  art: { position: "absolute", width: "140%", height: "140%" },
});
