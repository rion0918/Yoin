import { Feather } from "@expo/vector-icons";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
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
import { figmaColors } from "../design/figma";
import { colors, radii } from "../design/tokens";
import { ActionButton, useReducedMotion } from "./ActionButton";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  children: ReactNode;
  snap?: number;
  footer?: ReactNode;
  closeDisabled?: boolean;
  avoidKeyboard?: boolean;
  appearance?: "default" | "songSource" | "recording" | "dark";
};

export function NativeSheet({
  open,
  onClose,
  title,
  description,
  children,
  snap = 0.76,
  footer,
  closeDisabled = false,
  avoidKeyboard = false,
  appearance = "default",
}: Props) {
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const translation = useRef(new Animated.Value(height)).current;
  const heightRef = useRef(height);
  heightRef.current = height;
  const [presented, setPresented] = useState(open);
  const songSource = appearance === "songSource";
  const recordingSheet = appearance === "recording";
  const darkSheet = appearance === "dark";
  const sheetHeight = songSource
    ? Math.min(442, height - insets.top - insets.bottom - 32)
    : Math.min(height - insets.top - 16, height * snap);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const openRef = useRef(open);
  openRef.current = open;
  const closeDisabledRef = useRef(closeDisabled);
  closeDisabledRef.current = closeDisabled;
  const requestClose = () => {
    if (!closeDisabledRef.current) closeRef.current();
  };

  useEffect(() => {
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
        toValue: heightRef.current,
        duration: reduced ? 0 : 220,
        useNativeDriver: Platform.OS !== "web",
      }).start(({ finished }) => {
        if (finished) setPresented(false);
      });
    }
    return () => translation.stopAnimation();
  }, [open, reduced, translation]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          !closeDisabledRef.current && gesture.dy > 5,
        onPanResponderGrant: () => {
          if (openRef.current) translation.stopAnimation();
        },
        onPanResponderMove: (_, gesture) => {
          if (openRef.current) translation.setValue(Math.max(0, gesture.dy));
        },
        onPanResponderRelease: (_, gesture) => {
          if (!openRef.current) return;
          if (
            (gesture.dy > 80 || gesture.vy > 0.8) &&
            !closeDisabledRef.current
          )
            closeRef.current();
          else if (reduced) translation.setValue(0);
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
          if (reduced) {
            translation.setValue(0);
            return;
          }
          Animated.spring(translation, {
            toValue: 0,
            damping: 30,
            stiffness: 300,
            useNativeDriver: Platform.OS !== "web",
          }).start();
        },
      }),
    [translation, reduced],
  );

  return (
    <Modal
      transparent
      visible={presented}
      animationType="none"
      onRequestClose={requestClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={[
          styles.overlay,
          avoidKeyboard && { paddingTop: insets.top + 8 },
        ]}
        behavior={
          Platform.OS === "ios" && avoidKeyboard ? "padding" : undefined
        }
      >
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.dim,
            songSource && styles.sourceDim,
            recordingSheet && styles.recordingDim,
            darkSheet && styles.darkDim,
            {
              opacity: translation.interpolate({
                inputRange: [0, height],
                outputRange: [1, 0],
                extrapolate: "clamp",
              }),
            },
          ]}
        />
        <Animated.View
          pointerEvents={open ? "auto" : "none"}
          accessibilityViewIsModal
          style={[
            styles.card,
            songSource && styles.sourceCard,
            recordingSheet && styles.recordingCard,
            darkSheet && styles.darkCard,
            songSource && {
              width: Math.min(358, width - 32),
              marginBottom: Math.max(16, insets.bottom - 11),
            },
            avoidKeyboard && { flexShrink: 1 },
            { height: sheetHeight, transform: [{ translateY: translation }] },
          ]}
        >
          <View
            {...responder.panHandlers}
            style={[
              styles.handleArea,
              songSource && styles.sourceHandleArea,
              recordingSheet && styles.recordingHandleArea,
            ]}
          >
            <View
              style={[
                styles.handle,
                songSource && styles.sourceHandle,
                recordingSheet && styles.recordingHandle,
                darkSheet && styles.darkHandle,
              ]}
            />
          </View>
          <View
            style={[
              styles.header,
              songSource && styles.sourceHeader,
              recordingSheet && styles.recordingHeader,
            ]}
          >
            <View style={styles.heading}>
              {songSource && (
                <Text style={styles.sourceEyebrow}>ORIGINAL CONVERSATION</Text>
              )}
              <Text
                style={[
                  styles.title,
                  songSource && styles.sourceTitle,
                  recordingSheet && styles.recordingTitle,
                  darkSheet && styles.darkTitle,
                ]}
                accessibilityRole="header"
              >
                {title}
              </Text>
              {!songSource && (
                <Text
                  style={[
                    styles.description,
                    recordingSheet && styles.recordingDescription,
                    darkSheet && styles.darkDescription,
                  ]}
                >
                  {description}
                </Text>
              )}
            </View>
            {!recordingSheet && (
              <ActionButton
                label="シートを閉じる"
                onPress={requestClose}
                disabled={closeDisabled}
                style={[
                  styles.close,
                  songSource && styles.sourceClose,
                  darkSheet && styles.darkClose,
                ]}
                testID="close-sheet"
              >
                <Feather
                  name="x"
                  size={20}
                  color={
                    songSource || darkSheet ? figmaColors.primary : colors.ink
                  }
                />
              </ActionButton>
            )}
          </View>
          <ScrollView
            key={title}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.content,
              songSource && styles.sourceContent,
              recordingSheet && styles.recordingContent,
              {
                paddingBottom: songSource
                  ? 20
                  : footer
                    ? 20
                    : insets.bottom + 28,
              },
            ]}
          >
            {children}
          </ScrollView>
          {footer && (
            <View
              style={[
                styles.footer,
                recordingSheet && styles.recordingFooter,
                darkSheet && styles.darkFooter,
                { paddingBottom: insets.bottom + 16 },
              ]}
            >
              {footer}
            </View>
          )}
        </Animated.View>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={requestClose}
          disabled={closeDisabled}
          accessibilityLabel="シートを閉じる"
          accessibilityRole="button"
          tabIndex={-1}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  dim: { backgroundColor: "rgba(41,39,38,0.26)" },
  sourceDim: { backgroundColor: "rgba(0,0,0,0.68)" },
  recordingDim: { backgroundColor: "rgba(0,0,0,0.68)" },
  darkDim: { backgroundColor: "rgba(0,0,0,0.68)" },
  card: {
    zIndex: 1,
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
    borderTopLeftRadius: radii.window,
    borderTopRightRadius: radii.window,
    backgroundColor: colors.paper,
    overflow: "hidden",
  },
  sourceCard: {
    borderRadius: 24,
    backgroundColor: figmaColors.raised,
  },
  recordingCard: { backgroundColor: figmaColors.surface },
  darkCard: { backgroundColor: figmaColors.canvas },
  handleArea: { height: 28, alignItems: "center", justifyContent: "center" },
  sourceHandleArea: { height: 32 },
  recordingHandleArea: { height: 30 },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.line,
  },
  sourceHandle: { width: 40, backgroundColor: figmaColors.border },
  recordingHandle: { backgroundColor: figmaColors.border },
  darkHandle: { backgroundColor: figmaColors.border },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingBottom: 16,
    gap: 12,
  },
  sourceHeader: { paddingHorizontal: 20, paddingBottom: 12 },
  recordingHeader: { paddingHorizontal: 24, paddingBottom: 14 },
  heading: { flex: 1 },
  sourceEyebrow: {
    color: figmaColors.gold,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "500",
    marginBottom: 3,
  },
  title: {
    color: colors.ink,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "600",
    letterSpacing: -0.7,
  },
  sourceTitle: {
    color: figmaColors.primary,
    fontSize: 17,
    lineHeight: 27,
    fontWeight: "400",
    letterSpacing: 0,
  },
  recordingTitle: {
    color: figmaColors.primary,
    fontSize: 22,
    lineHeight: 31,
    letterSpacing: -0.5,
  },
  darkTitle: { color: figmaColors.primary },
  description: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
  },
  recordingDescription: { color: figmaColors.secondary, marginTop: 5 },
  darkDescription: { color: figmaColors.secondary },
  close: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.quiet,
    alignItems: "center",
    justifyContent: "center",
  },
  sourceClose: { backgroundColor: figmaColors.inset },
  darkClose: { backgroundColor: figmaColors.raised },
  content: { paddingHorizontal: 24 },
  sourceContent: { paddingHorizontal: 20 },
  recordingContent: { paddingHorizontal: 24 },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.paper,
  },
  recordingFooter: {
    borderTopColor: figmaColors.border,
    backgroundColor: figmaColors.surface,
  },
  darkFooter: {
    borderTopColor: figmaColors.border,
    backgroundColor: figmaColors.canvas,
  },
});
