import { useEffect, useRef } from "react";
import { Animated, Platform, StyleSheet, View } from "react-native";
import type { AudioClip } from "../../shared/contracts";
import { colors } from "../design/tokens";
import { useReducedMotion } from "./ActionButton";

// These segments encode saved duration, not measured audio amplitude.
export function DayTrace({
  clips,
  active = false,
  memory = false,
}: {
  clips: AudioClip[];
  active?: boolean;
  memory?: boolean;
}) {
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active || reduced) {
      opacity.setValue(1);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.45,
          duration: 1100,
          useNativeDriver: Platform.OS !== "web",
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 1100,
          useNativeDriver: Platform.OS !== "web",
        }),
      ]),
    );
    animation.start();
    return () => {
      animation.stop();
      opacity.setValue(1);
    };
  }, [active, reduced, opacity]);
  return (
    <View style={styles.trace} accessible={false} pointerEvents="none">
      {clips.length ? (
        clips.map((clip) => (
          <View
            key={clip.id}
            style={[
              styles.segment,
              {
                flex: Math.max(1, clip.durationMs),
                backgroundColor: memory ? colors.memoryAccent : colors.ink,
              },
            ]}
          >
            <View
              style={[
                styles.notch,
                memory && { backgroundColor: colors.memoryAccent },
              ]}
            />
          </View>
        ))
      ) : (
        <View style={styles.empty} />
      )}
      <Animated.View
        style={[
          styles.end,
          {
            opacity,
            backgroundColor: memory ? colors.memoryAccent : colors.ink,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  trace: { minHeight: 24, flexDirection: "row", alignItems: "center", gap: 5 },
  segment: { height: 3, minWidth: 3, borderRadius: 2 },
  notch: {
    position: "absolute",
    left: 0,
    top: -4,
    height: 11,
    width: 2,
    backgroundColor: colors.ink,
  },
  empty: { flex: 1, height: 1, backgroundColor: colors.line },
  end: { width: 7, height: 7, borderRadius: 4 },
});
