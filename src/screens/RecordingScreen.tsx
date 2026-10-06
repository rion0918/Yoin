import { Feather } from "@expo/vector-icons";
import {
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import type { LocalClip, LocalDraft } from "../../shared/contracts";
import { ActionButton } from "../components/ActionButton";
import { displayDate, formatTime } from "../domain/session";
import { sourceContext } from "../pipeline/library";

type RecordingScreenProps = {
  draft: LocalDraft;
  speakerNames: string[];
  recording: boolean;
  busy: boolean;
  locationEnabled: boolean;
  locationStatus: "off" | "acquiring" | "tracking" | "unavailable";
  onLocationEnabledChange: (enabled: boolean) => void;
  stateLabel?: string;
  onImport: () => void;
  liveSeconds: number;
  onToggle: () => void;
  onBack: () => void;
  onFinish: () => void;
  onClip: (clip: LocalClip) => void;
};

export function RecordingScreen({
  draft,
  speakerNames,
  recording,
  busy,
  locationEnabled,
  locationStatus,
  onLocationEnabledChange,
  stateLabel,
  onImport,
  liveSeconds,
  onToggle,
  onBack,
  onFinish,
  onClip,
}: RecordingScreenProps) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const contentHeight = height - insets.top - insets.bottom - 80;
  const focusSpacing = Math.min(80, Math.max(32, contentHeight - 680));
  const recordLabel = recording
    ? "録音を止める"
    : draft.clips.length
      ? "録音を再開"
      : "録音をはじめる";
  const stateColor = recording ? "#9c5d2e" : "#6b625a";
  const locationLabel = recording
    ? locationEnabled && locationStatus === "tracking"
      ? "位置情報を使用中"
      : locationEnabled && locationStatus === "acquiring"
        ? "位置情報を取得中"
        : "位置情報なしで録音"
    : locationStatus === "unavailable"
      ? "許可されていないため、位置情報なしで録音します"
      : locationEnabled
        ? "録音中、アプリ表示中だけ位置情報を取得します"
        : "録音時に位置情報を付けます（初期設定はオフ）";

  return (
    <SafeAreaView style={styles.screen} testID="record-screen">
      <View style={styles.header}>
        <ActionButton
          label={recording ? "録音を止めて戻る" : "ホーム"}
          onPress={onBack}
          style={styles.back}
          testID="back-recording"
        >
          <Feather name="chevron-left" size={24} color="#332317" />
          <Text style={styles.headerLabel}>
            {recording ? "録音を止めて戻る" : "ホーム"}
          </Text>
        </ActionButton>
        <ActionButton
          label="仕上げる"
          onPress={onFinish}
          disabled={busy || (!draft.clips.length && !recording)}
          style={styles.finish}
          testID="finish-recording"
        >
          <Text
            style={[
              styles.headerLabel,
              styles.finishLabel,
              !draft.clips.length && !recording && styles.disabledLabel,
            ]}
          >
            仕上げる
          </Text>
        </ActionButton>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { minHeight: contentHeight }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.heading} accessibilityRole="header">
          {draft.title}
        </Text>
        <Text style={styles.date}>
          {displayDate(draft.createdAt.slice(0, 10))}
        </Text>
        {!!speakerNames.length && (
          <Text style={styles.participants}>
            参加する人 · {speakerNames.join("、")}
          </Text>
        )}

        <View style={styles.locationPreference}>
          <View style={styles.locationCopy}>
            <Text style={styles.locationTitle}>位置情報を付ける</Text>
            <Text
              style={styles.locationDescription}
              accessibilityLiveRegion="polite"
            >
              {locationLabel}
            </Text>
            <Text style={styles.locationNote}>
              場所は市・区まで記録します。画面を離れると取得を一時停止します。
            </Text>
          </View>
          <Switch
            accessibilityLabel="位置情報を付ける"
            testID="recording-location-switch"
            value={locationEnabled}
            onValueChange={onLocationEnabledChange}
            disabled={busy || draft.status !== "local"}
            trackColor={{ false: "#d7d1cb", true: "#aa7755" }}
            thumbColor={locationEnabled ? "#493020" : "#fff"}
          />
        </View>

        <View style={[styles.focus, { paddingTop: focusSpacing }]}>
          <View style={styles.stateCircle}>
            <Feather
              name={recording ? "mic" : "mic-off"}
              size={44}
              color={stateColor}
            />
          </View>
          <Text
            style={[styles.stateLabel, { color: stateColor }]}
            accessibilityLiveRegion="polite"
          >
            {stateLabel || (recording ? "録音中" : "マイクオフ")}
          </Text>
          <View style={styles.duration}>
            <Text style={styles.timer} testID="recorded-duration">
              {formatTime(
                draft.clips.reduce(
                  (sum, clip) => sum + clip.durationMs / 1000,
                  0,
                ) + liveSeconds,
              )}
            </Text>
            <Text style={styles.durationLabel}>残した音声</Text>
          </View>
          <ActionButton
            label={recordLabel}
            disabled={busy || draft.status !== "local"}
            onPress={onToggle}
            style={styles.recordToggle}
            testID="record-toggle"
          >
            <Feather
              name={recording ? "pause" : "mic"}
              size={52}
              color="#fff8f0"
            />
          </ActionButton>
          <Text style={styles.actionLabel}>{recordLabel}</Text>
          <ActionButton
            label="音声ファイルを取り込む"
            onPress={onImport}
            disabled={busy || recording || draft.status !== "local"}
            style={{ minHeight: 44, justifyContent: "center" }}
            testID="import-audio"
          >
            <Text style={styles.date}>音声ファイルを取り込む</Text>
          </ActionButton>
        </View>

        <View style={styles.clips}>
          <View style={styles.clipsHeading}>
            <Text style={styles.sectionHeading} accessibilityRole="header">
              残した会話
            </Text>
            <Text style={styles.clipCount}>{draft.clips.length}件</Text>
          </View>
          {draft.clips.length ? (
            <View style={styles.clipList}>
              {draft.clips.map((clip) => (
                <ActionButton
                  key={clip.id}
                  label={`${sourceContext(clip).date} ${sourceContext(clip).time} ${sourceContext(clip).place}の音声を確認`}
                  onPress={() => onClip(clip)}
                  style={styles.clipRow}
                  testID={`clip-${clip.id}`}
                >
                  <Feather name="message-circle" size={22} color="#332317" />
                  <View style={styles.clipInformation}>
                    <Text style={styles.clipContext}>
                      {sourceContext(clip).date} {sourceContext(clip).time} ·{" "}
                      {sourceContext(clip).place}
                    </Text>
                    <Text style={styles.clipDuration}>
                      {formatTime(clip.durationMs / 1000)}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={17} color="#726d69" />
                </ActionButton>
              ))}
            </View>
          ) : (
            <Text style={styles.empty}>残した会話がここに集まります。</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  header: {
    width: "100%",
    maxWidth: 390,
    alignSelf: "center",
    height: 80,
    paddingHorizontal: 16,
    paddingTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  back: {
    minHeight: 44,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  headerLabel: {
    flexShrink: 1,
    color: "#332317",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "500",
  },
  finish: {
    minWidth: 72,
    minHeight: 44,
    alignItems: "flex-end",
    justifyContent: "center",
    paddingLeft: 12,
  },
  finishLabel: { fontWeight: "600" },
  disabledLabel: { color: "#99918a" },
  content: {
    width: "100%",
    maxWidth: 390,
    alignSelf: "center",
    paddingTop: 24,
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  heading: {
    color: "#332317",
    fontSize: 32,
    lineHeight: 42,
    fontWeight: "700",
    letterSpacing: -1.3,
  },
  date: {
    marginTop: 8,
    color: "#726d69",
    fontSize: 14,
    lineHeight: 21,
    fontVariant: ["tabular-nums"],
  },
  participants: {
    marginTop: 4,
    color: "#544033",
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "500",
  },
  locationPreference: {
    width: "100%",
    marginTop: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    backgroundColor: "#f5f3f1",
  },
  locationCopy: { flex: 1, gap: 3 },
  locationTitle: {
    color: "#332317",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
  },
  locationDescription: {
    color: "#544033",
    fontSize: 12,
    lineHeight: 18,
  },
  locationNote: {
    color: "#726d69",
    fontSize: 11,
    lineHeight: 16,
  },
  focus: { alignItems: "center" },
  stateCircle: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: "#f5f3f1",
    alignItems: "center",
    justifyContent: "center",
  },
  stateLabel: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "500",
  },
  duration: { marginTop: 30, alignItems: "center" },
  timer: {
    color: "#332317",
    fontSize: 40,
    lineHeight: 46,
    fontWeight: "500",
    letterSpacing: -1.8,
    fontVariant: ["tabular-nums"],
  },
  durationLabel: {
    marginTop: 7,
    color: "#726d69",
    fontSize: 13,
    lineHeight: 20,
  },
  recordToggle: {
    width: 144,
    height: 144,
    marginTop: 38,
    borderRadius: 72,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#493020",
    shadowColor: "#392211",
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.15,
    shadowRadius: 9,
    elevation: 4,
  },
  actionLabel: {
    marginTop: 14,
    minHeight: 24,
    color: "#332317",
    fontSize: 14,
    lineHeight: 24,
    fontWeight: "500",
  },
  clips: { marginTop: 28 },
  clipsHeading: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  sectionHeading: {
    color: "#332317",
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
  },
  clipCount: { color: "#726d69", fontSize: 12, lineHeight: 18 },
  clipList: { marginTop: 12, gap: 8 },
  clipRow: {
    minHeight: 64,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    backgroundColor: "#f5f3f1",
  },
  clipInformation: { flex: 1, gap: 3 },
  clipContext: {
    color: "#332317",
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "500",
  },
  clipDuration: {
    color: "#726d69",
    fontSize: 12,
    lineHeight: 18,
    fontVariant: ["tabular-nums"],
  },
  empty: {
    marginTop: 18,
    paddingVertical: 12,
    color: "#726d69",
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
});
