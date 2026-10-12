import { StyleSheet, View } from "react-native";
import type { AudioClip } from "../../shared/contracts";
import { colors } from "../design/tokens";
import { DayTrace } from "./DayTrace";

// A folded strip of saved time. Width encodes duration; height is decorative.
export function TimeSculpture({
  clips,
  active = false,
}: {
  clips: AudioClip[];
  active?: boolean;
}) {
  return (
    <View
      style={styles.sculpture}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <View style={styles.ribbon}>
        {clips.length ? (
          clips.map((clip, index) => (
            <View
              key={clip.id}
              style={[
                styles.fold,
                {
                  flex: Math.max(1, clip.durationMs),
                  backgroundColor: index % 2 ? "#e9eee9" : "#f6f8f6",
                },
              ]}
            >
              <View style={styles.edge} />
            </View>
          ))
        ) : (
          <View style={[styles.fold, { flex: 1 }]}>
            <View style={styles.edge} />
          </View>
        )}
      </View>
      <View style={styles.trace}>
        <DayTrace clips={clips} active={active} />
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  sculpture: { height: 132, justifyContent: "center", paddingHorizontal: 18 },
  ribbon: {
    flexDirection: "row",
    gap: 4,
    height: 68,
    transform: [{ rotate: "-8deg" }],
    shadowColor: "#89988d",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.16,
    shadowRadius: 15,
  },
  fold: {
    backgroundColor: "#f3f6f3",
    borderWidth: 1,
    borderColor: "#dce3dc",
    borderRadius: 6,
    overflow: "hidden",
  },
  edge: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    width: 8,
    backgroundColor: "rgba(165,179,167,0.12)",
    borderLeftWidth: 1,
    borderLeftColor: colors.paper,
  },
  trace: { marginTop: 16 },
});
