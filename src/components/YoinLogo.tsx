import {
  Image,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";

const artwork = require("../../assets/yoinlogo.png");

export function YoinLogo({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.frame, style]} pointerEvents="none">
      <Image
        source={artwork}
        resizeMode="contain"
        accessible={true}
        accessibilityLabel="Yoin"
        accessibilityRole="image"
        testID="yoin-logo"
        style={styles.artwork}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: "100%", aspectRatio: 2.5, overflow: "hidden" },
  // Show the mark at (370, 50, 1580, 632), excluding the original PNG's
  // transparent padding. Keep the supplied 2172 x 724 artwork unchanged.
  artwork: {
    position: "absolute",
    width: `${(2172 / 1580) * 100}%`,
    height: `${(724 / 632) * 100}%`,
    left: `${(-370 / 1580) * 100}%`,
    top: `${(-50 / 632) * 100}%`,
  },
});
