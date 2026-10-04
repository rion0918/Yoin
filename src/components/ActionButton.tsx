import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Platform,
  Pressable,
  type StyleProp,
  type ViewStyle,
} from "react-native";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduced,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

type Props = {
  label: string;
  onPress: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  testID?: string;
};

export function ActionButton({
  label,
  onPress,
  children,
  style,
  disabled,
  testID,
}: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const reduced = useReducedMotion();
  const animate = (value: number) => {
    scale.stopAnimation();
    if (reduced) scale.setValue(1);
    else
      Animated.spring(scale, {
        toValue: value,
        damping: 24,
        stiffness: 380,
        mass: 0.6,
        useNativeDriver: Platform.OS !== "web",
      }).start();
  };
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      testID={testID}
      hitSlop={4}
      onPress={onPress}
      onPressIn={() => animate(0.96)}
      onPressOut={() => animate(1)}
      style={[style, { transform: [{ scale }], opacity: disabled ? 0.45 : 1 }]}
    >
      {children}
    </AnimatedPressable>
  );
}
