import { Feather } from "@expo/vector-icons";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActionButton, useReducedMotion } from "./ActionButton";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  children: ReactNode;
  snap?: number;
};

export function NativeSheet({
  open,
  onClose,
  title,
  description,
  children,
  snap = 0.76,
}: Props) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const translation = useRef(new Animated.Value(height)).current;
  const [presented, setPresented] = useState(open);
  const sheetHeight = Math.min(height - insets.top - 16, height * snap);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    Keyboard.dismiss();
    translation.stopAnimation();
    if (open) {
      setPresented(true);
      if (reduced) translation.setValue(0);
      else
        Animated.spring(translation, {
          toValue: 0,
          damping: 30,
          stiffness: 300,
          mass: 0.8,
          useNativeDriver: Platform.OS !== "web",
        }).start();
    } else {
      Animated.timing(translation, {
        toValue: height,
        duration: reduced ? 0 : 220,
        useNativeDriver: Platform.OS !== "web",
      }).start(({ finished }) => {
        if (finished) setPresented(false);
      });
    }
  }, [open, reduced, height, translation]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 5,
        onPanResponderGrant: () => {
          if (openRef.current) translation.stopAnimation();
        },
        onPanResponderMove: (_, gesture) => {
          if (openRef.current) translation.setValue(Math.max(0, gesture.dy));
        },
        onPanResponderRelease: (_, gesture) => {
          if (!openRef.current) return;
          if (gesture.dy > 80 || gesture.vy > 0.8) closeRef.current();
          else
            Animated.spring(translation, {
              toValue: 0,
              damping: 30,
              stiffness: 300,
              useNativeDriver: Platform.OS !== "web",
            }).start();
        },
        onPanResponderTerminate: () => {
          if (!openRef.current) return;
          Animated.spring(translation, {
            toValue: 0,
            damping: 30,
            stiffness: 300,
            useNativeDriver: Platform.OS !== "web",
          }).start();
        },
      }),
    [translation],
  );

  return (
    <Modal
      transparent
      visible={presented}
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.dim,
            {
              opacity: translation.interpolate({
                inputRange: [0, height],
                outputRange: [1, 0],
                extrapolate: "clamp",
              }),
            },
          ]}
        />
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="シートを閉じる"
          accessibilityRole="button"
        />
        <Animated.View
          pointerEvents={open ? "auto" : "none"}
          accessibilityViewIsModal
          style={[
            styles.card,
            { height: sheetHeight, transform: [{ translateY: translation }] },
          ]}
        >
          <View {...responder.panHandlers} style={styles.handleArea}>
            <View style={styles.handle} />
          </View>
          <View style={styles.header}>
            <View style={styles.heading}>
              <Text style={styles.title} accessibilityRole="header">
                {title}
              </Text>
              <Text style={styles.description}>{description}</Text>
            </View>
            <ActionButton
              label="シートを閉じる"
              onPress={onClose}
              style={styles.close}
              testID="close-sheet"
            >
              <Feather name="x" size={20} color="#493020" />
            </ActionButton>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.content,
              { paddingBottom: insets.bottom + 28 },
            ]}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  dim: { backgroundColor: "rgba(40,29,21,0.32)" },
  card: {
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: "#fffaf5",
    overflow: "hidden",
  },
  handleArea: { height: 28, alignItems: "center", justifyContent: "center" },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#cec2b8" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingBottom: 16,
    gap: 12,
  },
  heading: { flex: 1 },
  title: {
    color: "#332317",
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "700",
    letterSpacing: -0.7,
  },
  description: { color: "#726050", fontSize: 13, lineHeight: 20, marginTop: 6 },
  close: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#ede5dd",
    alignItems: "center",
    justifyContent: "center",
  },
  content: { paddingHorizontal: 24 },
});
