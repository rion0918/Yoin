import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import type { LocalClip, LocalDraft } from "../../shared/contracts";
import { ActionButton } from "../components/ActionButton";
import { NativeSheet } from "../components/NativeSheet";
import { figmaColors as c, formatFigmaTime } from "../design/figma";
import { layout } from "../design/tokens";
import { displayDate } from "../domain/session";
import { sourceContext } from "../pipeline/library";

type RecordingScreenProps = {
  draft: LocalDraft;
  speakerNames: string[];
  recording: boolean;
  busy: boolean;
  locationEnabled: boolean;
  locationStatus:
    | "off"
    | "acquiring"
    | "tracking"
    | "foreground-only"
    | "unavailable";
  onLocationEnabledChange: (enabled: boolean) => void;
  stateLabel?: string;
  onImport: (creationTitle: string) => void;
  liveSeconds: number;
  onToggle: (creationTitle: string) => void;
  onBack: () => void;
  onFinish: () => void;
  onClip: (clip: LocalClip) => void;
};

const waveformHeights = [
  8, 12, 18, 13, 24, 16, 10, 27, 18, 12, 30, 19, 13, 23, 15, 29, 18, 10, 26, 17,
  12, 31, 20, 14, 25, 17, 11, 28, 19, 13, 23, 16, 30, 18, 12, 26, 17, 10, 22,
  15, 27, 18, 12, 21, 8,
];

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
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [locationOpen, setLocationOpen] = useState(false);
  const [creationTitle, setCreationTitle] = useState(draft.title);
  const recordLabel = recording
    ? "いったん止める"
    : draft.clips.length
      ? "続きを残す"
      : "録音をはじめる";
  const locationLabel = recording
    ? locationEnabled && locationStatus === "tracking"
      ? "位置情報を使用中"
      : locationEnabled && locationStatus === "acquiring"
        ? "位置情報を取得中"
        : locationEnabled && locationStatus === "foreground-only"
          ? "画面表示中のみ位置情報を取得します"
          : "位置情報なしで録音"
    : locationStatus === "unavailable"
      ? "許可されていないため、位置情報なしで録音します"
      : locationStatus === "foreground-only"
        ? "画面表示中のみ位置情報を取得します"
        : locationEnabled
          ? "録音中の位置を取得します"
          : "録音時に位置情報を付けます（初期設定はオフ）";
  const total =
    draft.clips.reduce((sum, clip) => sum + clip.durationMs / 1000, 0) +
    liveSeconds;

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={styles.screen}
      testID="record-screen"
    >
      <View style={styles.header}>
        <ActionButton
          label={recording ? "録音を止めて戻る" : "ホーム"}
          onPress={onBack}
          style={styles.back}
          testID="back-recording"
        >
          <Feather name="chevron-left" size={21} color={c.primary} />
          <Text style={styles.headerLabel}>
            {recording ? "止めて戻る" : "ホーム"}
          </Text>
        </ActionButton>
        <ActionButton
          label="仕上げる"
          onPress={onFinish}
          disabled={busy || (!draft.clips.length && !recording)}
          style={styles.finish}
          testID="finish-recording"
        >
          <Text style={styles.finishLabel}>仕上げる</Text>
          <Feather name="arrow-up-right" size={16} color={c.onRose} />
        </ActionButton>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 146 },
        ]}
      >
        <View style={styles.creationTitleField}>
          <Text style={styles.creationTitleLabel}>制作の名前</Text>
          <TextInput
            value={creationTitle}
            onChangeText={setCreationTitle}
            editable={
              !recording &&
              !busy &&
              draft.status === "local" &&
              !draft.clips.length
            }
            maxLength={80}
            returnKeyType="done"
            accessibilityLabel="制作の名前"
            placeholder="制作の名前を入力"
            placeholderTextColor={c.tertiary}
            style={styles.creationTitleInput}
            testID="creation-title-input"
          />
        </View>

        <View style={styles.focus}>
          <Text
            style={[styles.timer, { fontSize: Math.min(66, width * 0.17) }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            testID="recorded-duration"
          >
            {formatFigmaTime(total)}
          </Text>
          <View style={styles.status}>
            <View
              style={[styles.statusDot, recording && styles.statusDotRecording]}
            />
            <Feather
              name={recording ? "mic" : "mic-off"}
              size={14}
              color={recording ? c.rose : c.tertiary}
            />
            <Text
              style={[styles.stateLabel, recording && styles.activeLabel]}
              accessibilityLiveRegion="polite"
            >
              {stateLabel || (recording ? "録音中" : "マイクオフ")}
            </Text>
          </View>
          <View style={styles.waveform} accessible={false}>
            {(() => {
              const occurrences = new Map<number, number>();
              return waveformHeights.map((height) => {
                const occurrence = occurrences.get(height) ?? 0;
                occurrences.set(height, occurrence + 1);
                return (
                  <View
                    key={`wave-${height}-${occurrence}`}
                    style={[
                      styles.waveBar,
                      {
                        height: recording ? height : Math.max(4, height * 0.34),
                        backgroundColor:
                          recording && height % 5 === 0 ? c.rose : c.tertiary,
                        opacity: recording ? 0.9 : 0.42,
                      },
                    ]}
                  />
                );
              });
            })()}
          </View>
        </View>

        {speakerNames.length > 0 && (
          <View style={styles.metadataRow}>
            <Feather name="users" size={17} color={c.secondary} />
            <Text style={styles.metadataLabel}>参加者</Text>
            <Text style={styles.metadataValue} numberOfLines={1}>
              {speakerNames.join("、")}
            </Text>
          </View>
        )}

        <View style={styles.metadataRow}>
          <Feather name="map-pin" size={17} color={c.secondary} />
          <Text style={styles.metadataLabel}>位置情報</Text>
          <ActionButton
            label={`位置情報の設定。現在${locationEnabled ? "オン" : "オフ"}`}
            onPress={() => setLocationOpen(true)}
            style={styles.locationToggle}
            testID="recording-location-settings"
          >
            <Text style={styles.metadataValue}>
              {locationEnabled ? "オン" : "オフ"}
            </Text>
            <Feather name="chevron-right" size={14} color={c.tertiary} />
          </ActionButton>
        </View>
        {locationEnabled && (
          <Text style={styles.locationState} accessibilityLiveRegion="polite">
            {locationLabel}
          </Text>
        )}

        <View style={styles.clips}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeading} accessibilityRole="header">
              保存された音声
            </Text>
            <ActionButton
              label="音声ファイルを取り込む"
              onPress={() => onImport(creationTitle.trim())}
              disabled={
                busy ||
                recording ||
                draft.status !== "local" ||
                !creationTitle.trim()
              }
              style={styles.importAction}
              testID="import-audio"
            >
              <Feather name="upload" size={14} color={c.secondary} />
              <Text style={styles.importLabel}>音声を取り込む</Text>
            </ActionButton>
          </View>
          {draft.clips.length ? (
            draft.clips.map((clip) => {
              const context = sourceContext(clip);
              return (
                <ActionButton
                  key={clip.id}
                  label={`${context.date} ${context.time} ${context.place}の音声を確認`}
                  onPress={() => onClip(clip)}
                  style={styles.clipRow}
                  testID={`clip-${clip.id}`}
                >
                  <View style={styles.listen}>
                    <Feather name="play" size={14} color={c.primary} />
                  </View>
                  <View style={styles.clipInformation}>
                    <Text style={styles.clipContext}>
                      {context.place === "場所不明"
                        ? displayDate(context.date)
                        : context.place}
                    </Text>
                    <Text style={styles.small}>
                      {displayDate(context.date)}
                      {context.time ? ` · ${context.time}` : ""} ·{" "}
                      {formatFigmaTime(clip.durationMs / 1000)}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={c.tertiary} />
                </ActionButton>
              );
            })
          ) : (
            <Text style={styles.empty}>
              録音を止めると、ここに保存されます。
            </Text>
          )}
        </View>
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: insets.bottom + 14 }]}>
        <View style={styles.dockContent}>
          <ActionButton
            label={recordLabel}
            disabled={
              busy ||
              draft.status !== "local" ||
              (!recording && !creationTitle.trim())
            }
            onPress={() => {
              const title = recording ? creationTitle : creationTitle.trim();
              if (!recording) setCreationTitle(title);
              onToggle(title);
            }}
            style={[styles.recordToggle, recording && styles.stopToggle]}
            testID="record-toggle"
          >
            <View style={[styles.toggleIcon, recording && styles.stopIcon]}>
              <Feather
                name={recording ? "square" : "mic"}
                size={17}
                color={c.onRose}
              />
            </View>
            <Text style={styles.toggleLabel}>{recordLabel}</Text>
          </ActionButton>
        </View>
      </View>

      <NativeSheet
        open={locationOpen}
        onClose={() => setLocationOpen(false)}
        title="この時間に、場所も。"
        description="位置情報は任意です。会話だけでも残せます。"
        snap={0.64}
        appearance="recording"
      >
        <View style={styles.locationPreference}>
          <View style={styles.locationPreferenceText}>
            <Text style={styles.locationTitle}>位置情報を付ける</Text>
            <Text style={styles.locationDescription}>
              場所は市・区まで記録します。
            </Text>
          </View>
          <Switch
            accessibilityLabel="位置情報を付ける"
            testID="recording-location-switch"
            value={locationEnabled}
            onValueChange={onLocationEnabledChange}
            disabled={busy || draft.status !== "local"}
            trackColor={{ false: c.border, true: c.rose }}
            thumbColor={c.primary}
          />
        </View>
        <Text
          style={styles.locationDescription}
          accessibilityLiveRegion="polite"
        >
          {locationLabel}
        </Text>
        <Text style={styles.locationDescription}>
          {locationStatus === "foreground-only"
            ? "バックグラウンド位置情報を利用できないため、画面表示中のみ取得します。"
            : locationEnabled
              ? "画面ロック時は、位置が未取得なら最初の1点を得た時点で停止します。"
              : "位置取得は録音ごとに選べます。初期設定はオフです。"}
        </Text>
      </NativeSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.canvas },
  header: {
    width: "100%",
    maxWidth: layout.pageWidth,
    alignSelf: "center",
    minHeight: 56,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  back: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    flexShrink: 1,
  },
  headerLabel: { color: c.primary, fontSize: 13, lineHeight: 21 },
  finish: {
    minHeight: 38,
    borderRadius: 13,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: c.rose,
  },
  finishLabel: {
    color: c.onRose,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
  },
  content: {
    width: "100%",
    maxWidth: layout.pageWidth,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingTop: 32,
  },
  creationTitleField: { marginBottom: 27 },
  creationTitleLabel: {
    color: c.secondary,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
  },
  creationTitleInput: {
    minHeight: 44,
    marginTop: 2,
    paddingHorizontal: 0,
    borderRadius: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    backgroundColor: "transparent",
    color: c.primary,
    fontSize: 20,
    lineHeight: 30,
  },
  metadataRow: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  metadataLabel: { color: c.secondary, fontSize: 12, lineHeight: 21 },
  metadataValue: {
    flex: 1,
    color: c.primary,
    fontSize: 14,
    lineHeight: 21,
  },
  locationToggle: {
    minHeight: 44,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  focus: { alignItems: "center", paddingTop: 2, paddingBottom: 28 },
  status: {
    marginTop: 23,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: c.tertiary,
  },
  statusDotRecording: { backgroundColor: c.rose },
  stateLabel: { color: c.secondary, fontSize: 11, lineHeight: 17 },
  activeLabel: { color: c.rose },
  timer: {
    lineHeight: 76,
    color: c.primary,
    fontWeight: "300",
    letterSpacing: -3,
    fontVariant: ["tabular-nums"],
    marginTop: 6,
  },
  waveform: {
    width: "100%",
    minHeight: 44,
    marginTop: 27,
    marginBottom: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 2,
  },
  waveBar: { width: 3, borderRadius: 2 },
  small: {
    color: c.tertiary,
    fontSize: 11,
    lineHeight: 19,
    fontVariant: ["tabular-nums"],
    flexShrink: 1,
  },
  locationTitle: {
    color: c.primary,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "500",
  },
  locationState: {
    color: c.secondary,
    fontSize: 11,
    lineHeight: 18,
    marginTop: 0,
    marginBottom: 8,
    paddingLeft: 26,
  },
  clips: { marginTop: 23 },
  sectionHeader: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  sectionHeading: {
    color: c.primary,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "600",
  },
  importAction: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  importLabel: { color: c.secondary, fontSize: 12, lineHeight: 19 },
  clipRow: {
    minHeight: 66,
    paddingHorizontal: 0,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  clipInformation: { flex: 1, gap: 3 },
  clipContext: {
    color: c.primary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
  },
  listen: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: c.inset,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: { color: c.tertiary, fontSize: 12, lineHeight: 20, marginTop: 4 },
  dock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 10,
    backgroundColor: c.canvas,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
  },
  dockContent: {
    width: "100%",
    maxWidth: layout.pageWidth,
    alignSelf: "center",
    paddingHorizontal: 20,
  },
  recordToggle: {
    minHeight: 62,
    borderRadius: 31,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    backgroundColor: c.rose,
  },
  stopToggle: { backgroundColor: c.rose },
  toggleIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(36,21,28,0.11)",
    alignItems: "center",
    justifyContent: "center",
  },
  stopIcon: { backgroundColor: "rgba(238,145,163,0.16)" },
  toggleLabel: {
    flex: 1,
    color: c.onRose,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "600",
  },
  locationPreference: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  locationPreferenceText: { flex: 1, gap: 4 },
  locationDescription: {
    color: c.secondary,
    fontSize: 12,
    lineHeight: 21,
    marginTop: 14,
  },
});
