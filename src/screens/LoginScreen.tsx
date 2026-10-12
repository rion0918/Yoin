import { type ReactNode, useState } from "react";
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActionButton } from "../components/ActionButton";
import { YoinLogo } from "../components/YoinLogo";
import { colors, layout, radii } from "../design/tokens";

const artwork = require("../../assets/loginhome.png");

type LoginScreenProps = {
  ready: boolean;
  busy: boolean;
  error: string | null;
  onSignIn: () => void;
  privacyPolicy: ReactNode;
};

export function LoginScreen({
  ready,
  busy,
  error,
  onSignIn,
  privacyPolicy,
}: LoginScreenProps) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(
    null,
  );
  const width = frame?.width ?? Math.min(window.width, layout.pageWidth);
  const height = frame?.height ?? window.height;
  const fontScale = window.fontScale;
  const [copyMeasurement, setCopyMeasurement] = useState<{
    width: number;
    fontScale: number;
    height: number;
  } | null>(null);
  const [actionsHeight, setActionsHeight] = useState(148);
  const bottomPadding = Math.max(24, insets.bottom + 12);
  const top = insets.top + (height - insets.top - insets.bottom) * 0.3;
  const copyHeight =
    copyMeasurement?.width === width && copyMeasurement.fontScale === fontScale
      ? copyMeasurement.height
      : 180 * fontScale;
  const stacked =
    fontScale >= 1.3 ||
    top + copyHeight + 24 + actionsHeight + bottomPadding > height;
  const label = !ready
    ? "ログインを確認中…"
    : busy
      ? "ログイン中…"
      : "Googleでログイン";
  const copy = (
    <View
      testID="login-copy"
      onLayout={(event) => {
        if (!stacked)
          setCopyMeasurement({
            width,
            fontScale,
            height: event.nativeEvent.layout.height,
          });
      }}
    >
      <YoinLogo />
      <Text
        style={[
          styles.title,
          stacked && styles.footerText,
          {
            fontSize: width < 360 ? 16 : 20,
            lineHeight: width < 360 ? 26 : 32,
          },
        ]}
      >
        写真にはない、{"\n"}あの日のこと。
      </Text>
      <Text style={[styles.description, stacked && styles.footerText]}>
        {stacked ? "会話を、思い出の一曲に。" : "会話を、\n思い出の一曲に。"}
      </Text>
    </View>
  );
  return (
    <View style={styles.screen}>
      <View
        style={styles.frame}
        testID="login-screen"
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setFrame({ width, height });
        }}
      >
        <View
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        >
          <Image
            source={artwork}
            resizeMode="cover"
            accessible={false}
            style={styles.artwork}
          />
        </View>
        <ScrollView
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.content, { minHeight: height }]}
          testID="login-scroll"
        >
          {stacked ? (
            <View style={[styles.space, { minHeight: insets.top + 128 }]} />
          ) : (
            <>
              <View
                style={{
                  paddingTop: top,
                  paddingLeft: width * 0.56,
                  paddingRight: Math.max(24, insets.right + 12),
                }}
              >
                {copy}
              </View>
              <View style={[styles.space, { minHeight: 24 }]} />
            </>
          )}
          <View
            testID="login-footer"
            style={[
              styles.footer,
              {
                paddingLeft: Math.max(24, insets.left + 12),
                paddingRight: Math.max(24, insets.right + 12),
                paddingBottom: bottomPadding,
              },
            ]}
          >
            {stacked && <View style={styles.stackedCopy}>{copy}</View>}
            <View
              testID="login-actions"
              onLayout={(event) =>
                setActionsHeight(event.nativeEvent.layout.height + 24)
              }
              accessibilityState={{ busy: !ready || busy }}
            >
              <ActionButton
                label={label}
                onPress={onSignIn}
                disabled={!ready || busy}
                style={styles.primary}
                testID="google-login"
              >
                <Text style={styles.primaryText}>{label}</Text>
              </ActionButton>
              {!!error && (
                <Text accessibilityLiveRegion="polite" style={styles.error}>
                  {error}
                </Text>
              )}
              {privacyPolicy}
            </View>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  frame: {
    flex: 1,
    width: "100%",
    maxWidth: layout.pageWidth,
    alignSelf: "center",
    backgroundColor: "#f8efdf",
  },
  artwork: { width: "100%", height: "100%" },
  scroll: { flex: 1 },
  content: { flexGrow: 1 },
  space: { flexGrow: 1 },
  title: { color: colors.ink, fontWeight: "600", marginTop: 20 },
  description: {
    color: colors.ink,
    fontSize: 13,
    lineHeight: 23,
    marginTop: 14,
  },
  footer: { paddingTop: 24, backgroundColor: "rgba(0,0,0,0.72)" },
  footerText: { color: colors.paper },
  stackedCopy: { marginBottom: 28 },
  primary: {
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: radii.control,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: {
    color: colors.ink,
    fontSize: 15,
    lineHeight: 24,
    fontWeight: "600",
    textAlign: "center",
  },
  error: {
    color: "#ffe2d6",
    fontSize: 13,
    lineHeight: 22,
    marginTop: 16,
  },
});
