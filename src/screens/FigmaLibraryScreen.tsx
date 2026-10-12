import { Feather } from "@expo/vector-icons";
import { useRef, useState } from "react";
import {
  Animated,
  Image,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import type {
  LocalDraft,
  LocalSpeakerProfile,
  SongDocument,
} from "../../shared/contracts";
import { ActionButton, useReducedMotion } from "../components/ActionButton";
import { NativeSheet } from "../components/NativeSheet";
import { YoinLogo } from "../components/YoinLogo";
import { figmaColors as c, formatFigmaTime } from "../design/figma";
import { searchCompletedSongs } from "../domain/librarySearch";
import { songDate } from "../pipeline/library";

const searchIcon = require("../../assets/figma/search-icon.png");
const playControl = require("../../assets/figma/play-control.png");

type Props = {
  songs: SongDocument[];
  drafts: LocalDraft[];
  speakers: LocalSpeakerProfile[];
  activeSongId: string | null;
  playing: boolean;
  position: number;
  busy: boolean;
  onNewRecording: (speakerProfileIds: string[]) => Promise<boolean>;
  onSettings: () => void;
  onSpeakerSettings: () => void;
  onOpenDraft: (draft: LocalDraft) => void;
  onOpenSong: (song: SongDocument) => void;
  onToggleSong: (song: SongDocument) => void;
  onSeek: (seconds: number) => void;
};

export function FigmaLibraryScreen({
  songs,
  drafts,
  speakers,
  activeSongId,
  playing,
  position,
  busy,
  onNewRecording,
  onSettings,
  onSpeakerSettings,
  onOpenDraft,
  onOpenSong,
  onToggleSong,
  onSeek,
}: Props) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const scroll = useRef<ScrollView>(null);
  const input = useRef<TextInput>(null);
  const scrollPosition = useRef(0);
  const progressWidth = useRef(326);
  const savedScrollPosition = useRef(0);
  const morph = useRef(new Animated.Value(0)).current;
  const resultsMotion = useRef(new Animated.Value(1)).current;
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [headerWidth, setHeaderWidth] = useState(358);
  const [speakerSelectionOpen, setSpeakerSelectionOpen] = useState(false);
  const [startingRecording, setStartingRecording] = useState(false);
  const startingRecordingRef = useRef(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [selectedSpeakerProfileIds, setSelectedSpeakerProfileIds] = useState<
    string[]
  >([]);
  const registeredSpeakers = speakers.filter(
    (speaker) =>
      speaker.status === "ready" && speaker.sampleId && speaker.modelVersion,
  );
  const shownSongs = searchCompletedSongs(songs, searchOpen ? query : "");
  const fieldWidth = Math.max(44, headerWidth - 96);
  const searchLeft = morph.interpolate({
    inputRange: [0, 1],
    outputRange: [headerWidth - 44, 0],
  });
  const searchWidth = morph.interpolate({
    inputRange: [0, 1],
    outputRange: [44, fieldWidth],
  });

  function updateQuery(value: string) {
    setQuery(value);
    if (reduced) {
      resultsMotion.setValue(1);
      return;
    }
    resultsMotion.setValue(0);
    Animated.timing(resultsMotion, {
      toValue: 1,
      duration: 180,
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }

  function openSearch() {
    savedScrollPosition.current = scrollPosition.current;
    setSearchOpen(true);
    morph.stopAnimation();
    if (reduced) {
      morph.setValue(1);
      requestAnimationFrame(() => input.current?.focus());
      return;
    }
    Animated.spring(morph, {
      toValue: 1,
      damping: 28,
      stiffness: 210,
      mass: 0.75,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) input.current?.focus();
    });
  }

  function cancelSearch() {
    Keyboard.dismiss();
    input.current?.blur();
    setQuery("");
    morph.stopAnimation();
    const finish = () => {
      setSearchOpen(false);
      requestAnimationFrame(() =>
        scroll.current?.scrollTo({
          y: savedScrollPosition.current,
          animated: false,
        }),
      );
    };
    if (reduced) {
      morph.setValue(0);
      finish();
      return;
    }
    Animated.spring(morph, {
      toValue: 0,
      damping: 28,
      stiffness: 210,
      mass: 0.75,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) finish();
    });
  }

  function openNewRecording() {
    if (!registeredSpeakers.length) {
      onSpeakerSettings();
      return;
    }
    setSelectionError(null);
    setSelectedSpeakerProfileIds([]);
    setSpeakerSelectionOpen(true);
  }

  async function confirmSpeakerSelection() {
    if (
      busy ||
      startingRecordingRef.current ||
      !selectedSpeakerProfileIds.length
    )
      return;
    startingRecordingRef.current = true;
    setStartingRecording(true);
    setSelectionError(null);
    try {
      const started = await onNewRecording(selectedSpeakerProfileIds);
      if (started) setSpeakerSelectionOpen(false);
      else
        setSelectionError(
          "録音画面を開けませんでした。もう一度お試しください。",
        );
    } catch (failure) {
      setSelectionError(
        failure instanceof Error
          ? failure.message
          : "録音画面を開けませんでした。もう一度お試しください。",
      );
    } finally {
      startingRecordingRef.current = false;
      setStartingRecording(false);
    }
  }

  function toggleSpeaker(id: string) {
    setSelectedSpeakerProfileIds((selected) =>
      selected.includes(id)
        ? selected.filter((value) => value !== id)
        : [...selected, id],
    );
  }

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={styles.screen}
      testID="home"
    >
      <View style={styles.masthead}>
        <View style={styles.topLine}>
          <YoinLogo style={styles.wordmark} />
          <View style={styles.headerActions}>
            <ActionButton
              label="友達の声を登録"
              onPress={onSpeakerSettings}
              style={styles.headerAction}
              testID="speaker-settings"
            >
              <Feather name="users" size={17} color={c.secondary} />
            </ActionButton>
            <ActionButton
              label="設定"
              onPress={onSettings}
              style={styles.headerAction}
              testID="account-settings"
            >
              <Feather name="settings" size={17} color={c.secondary} />
            </ActionButton>
          </View>
        </View>
        <View
          style={styles.searchRow}
          onLayout={(event) => setHeaderWidth(event.nativeEvent.layout.width)}
        >
          <Animated.View
            style={[
              styles.searchField,
              {
                left: searchLeft,
                width: searchWidth,
                borderRadius: morph.interpolate({
                  inputRange: [0, 1],
                  outputRange: [24, 16],
                }),
                borderWidth: morph,
              },
            ]}
          >
            <ActionButton
              label={searchOpen ? "検索欄に入力" : "曲を検索"}
              onPress={searchOpen ? () => input.current?.focus() : openSearch}
              style={styles.searchIconButton}
              testID="search-toggle"
            >
              <Image source={searchIcon} style={styles.searchIcon} />
            </ActionButton>
            {searchOpen && (
              <TextInput
                ref={input}
                value={query}
                onChangeText={updateQuery}
                placeholder="曲のタイトルで検索"
                placeholderTextColor={c.secondary}
                style={styles.searchInput}
                returnKeyType="search"
                accessibilityLabel="完成した曲のタイトルで検索"
                testID="song-search-input"
              />
            )}
            {searchOpen && query.length > 0 && (
              <ActionButton
                label="検索文字を消す"
                onPress={() => {
                  updateQuery("");
                  input.current?.focus();
                }}
                style={styles.clearButton}
                testID="clear-song-search"
              >
                <Text style={styles.clearText}>×</Text>
              </ActionButton>
            )}
          </Animated.View>
          {searchOpen && (
            <Animated.View style={[styles.cancelWrap, { opacity: morph }]}>
              <ActionButton
                label="検索をキャンセル"
                onPress={cancelSearch}
                style={styles.cancel}
                testID="cancel-song-search"
              >
                <Text style={styles.cancelText}>キャンセル</Text>
              </ActionButton>
            </Animated.View>
          )}
        </View>
        {(searchOpen || songs.length > 0) && (
          <Text style={styles.subtitle}>
            {searchOpen
              ? "完成した曲のタイトルから探す"
              : "あの日の曲を、もう一度。"}
          </Text>
        )}
      </View>
      <ScrollView
        ref={scroll}
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: searchOpen ? 24 : insets.bottom + 104 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        onScroll={(event) => {
          scrollPosition.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
      >
        <Animated.View
          style={{
            opacity: resultsMotion,
            transform: [
              {
                translateY: resultsMotion.interpolate({
                  inputRange: [0, 1],
                  outputRange: [8, 0],
                }),
              },
            ],
          }}
        >
          <Text style={styles.sectionHeading}>
            完成した曲 · {shownSongs.length}曲
          </Text>
          {shownSongs.length === 0 && searchOpen && (
            <Text style={styles.noResults}>該当する曲がありません</Text>
          )}
          {!songs.length && !searchOpen && (
            <View style={styles.emptyState} testID="empty-library">
              <View style={styles.emptyIcon}>
                <Feather name="music" size={24} color={c.gold} />
              </View>
              <Text style={styles.emptyTitle}>最初の一曲を作りましょう</Text>
              <Text style={styles.emptyCopy}>
                録音した会話から、歌詞と曲を作れます。
              </Text>
            </View>
          )}
          {shownSongs.map((song) => {
            const isPlaying = activeSongId === song.id && playing;
            const songPosition = activeSongId === song.id ? position : 0;
            return (
              <View
                key={song.id}
                style={[styles.track, isPlaying && styles.playingTrack]}
                testID={`song-row-${song.id}`}
              >
                <View style={styles.trackHeader}>
                  <View
                    style={[styles.marker, isPlaying && styles.playingMarker]}
                  />
                  <ActionButton
                    label={`${song.title}の詳細を開く`}
                    onPress={() => onOpenSong(song)}
                    style={styles.trackDetail}
                    testID={`song-detail-${song.id}`}
                  >
                    <View style={styles.trackInformation}>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.trackTitle,
                          isPlaying && styles.playingTitle,
                        ]}
                      >
                        {song.title}
                      </Text>
                      <Text style={styles.trackMeta}>
                        {songDate(song)} ·{" "}
                        {formatFigmaTime(song.durationMs / 1000)}
                      </Text>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </ActionButton>
                  <ActionButton
                    label={
                      isPlaying
                        ? `${song.title}を一時停止`
                        : `${song.title}を再生`
                    }
                    onPress={() => onToggleSong(song)}
                    style={[styles.playButton, isPlaying && styles.pauseButton]}
                    testID={`song-play-${song.id}`}
                  >
                    {isPlaying ? (
                      <Text style={styles.pauseText}>Ⅱ</Text>
                    ) : (
                      <Image source={playControl} style={styles.playIcon} />
                    )}
                  </ActionButton>
                </View>
                {isPlaying && (
                  <View style={styles.playingInformation}>
                    <Text style={styles.nowPlaying}>● NOW PLAYING</Text>
                    <Pressable
                      accessibilityRole="adjustable"
                      accessibilityLabel={`${song.title}の再生位置`}
                      accessibilityValue={{
                        min: 0,
                        max: song.durationMs / 1000,
                        now: songPosition,
                      }}
                      onLayout={(event) => {
                        progressWidth.current = event.nativeEvent.layout.width;
                      }}
                      onPress={(event) =>
                        onSeek(
                          (Math.max(
                            0,
                            Math.min(
                              progressWidth.current,
                              event.nativeEvent.locationX,
                            ),
                          ) /
                            progressWidth.current) *
                            (song.durationMs / 1000),
                        )
                      }
                      style={styles.progressTouch}
                      testID={`song-seek-${song.id}`}
                    >
                      <View style={styles.progressTrack}>
                        <View
                          style={[
                            styles.progressFill,
                            {
                              width: `${Math.min(
                                100,
                                (songPosition / (song.durationMs / 1000 || 1)) *
                                  100,
                              )}%`,
                            },
                          ]}
                        />
                      </View>
                    </Pressable>
                    <View style={styles.times}>
                      <Text style={styles.time}>
                        {formatFigmaTime(songPosition)}
                      </Text>
                      <Text style={styles.time}>
                        {formatFigmaTime(song.durationMs / 1000)}
                      </Text>
                    </View>
                    <ActionButton
                      label={`${song.title}の歌詞と元の会話を開く`}
                      onPress={() => onOpenSong(song)}
                      style={styles.detailsLink}
                      testID={`song-lyrics-${song.id}`}
                    >
                      <Text style={styles.detailsLinkText}>
                        詳細を開く · 歌詞と元の会話 ↗
                      </Text>
                    </ActionButton>
                  </View>
                )}
              </View>
            );
          })}
          {!searchOpen && drafts.length > 0 && (
            <View style={styles.drafts}>
              <Text style={styles.sectionHeading}>制作中の思い出</Text>
              {drafts.map((draft) => (
                <ActionButton
                  key={draft.id}
                  label={`${draft.title}の続きを開く`}
                  onPress={() => onOpenDraft(draft)}
                  style={styles.draftRow}
                  testID={`draft-${draft.id}`}
                >
                  <View style={styles.draftText}>
                    <Text style={styles.draftTitle}>{draft.title}</Text>
                    <Text style={styles.draftMeta}>
                      保存した会話から、続きを。
                    </Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </ActionButton>
              ))}
            </View>
          )}
        </Animated.View>
      </ScrollView>
      {!searchOpen && (
        <View style={[styles.dock, { bottom: Math.max(insets.bottom, 16) }]}>
          <ActionButton
            label="会話を録音する"
            onPress={openNewRecording}
            style={styles.recordButton}
            testID="new-recording"
          >
            <Text style={styles.recordLabel}>会話を録音する</Text>
          </ActionButton>
        </View>
      )}
      <NativeSheet
        open={speakerSelectionOpen}
        onClose={() => setSpeakerSelectionOpen(false)}
        closeDisabled={startingRecording}
        title="今日は、誰と？"
        description="この一日を一緒に過ごす人を選んでください。"
        snap={0.66}
        appearance="recording"
        footer={
          <ActionButton
            label={
              startingRecording
                ? "記録を準備中"
                : "選んだ友達で新しい記録を始める"
            }
            onPress={() => void confirmSpeakerSelection()}
            disabled={
              !selectedSpeakerProfileIds.length || busy || startingRecording
            }
            style={styles.selectionConfirm}
            testID="start-memory-recording"
          >
            <Text style={styles.selectionConfirmText}>
              {startingRecording
                ? "記録を準備しています…"
                : "このメンバーで、残そう"}
            </Text>
            <Feather name="arrow-right" size={19} color={c.onRose} />
          </ActionButton>
        }
      >
        <View testID="speaker-selection-sheet">
          {registeredSpeakers.map((speaker) => {
            const selected = selectedSpeakerProfileIds.includes(speaker.id);
            return (
              <ActionButton
                key={speaker.id}
                label={`${speaker.name}${selected ? "を選択済み" : "を選ぶ"}`}
                onPress={() => toggleSpeaker(speaker.id)}
                disabled={busy || startingRecording}
                style={[
                  styles.speakerOption,
                  selected
                    ? styles.speakerOptionSelected
                    : styles.speakerOptionIdle,
                ]}
                testID={`select-speaker-${speaker.id}`}
              >
                <Text style={styles.speakerName}>{speaker.name}</Text>
                <Feather
                  name={selected ? "check-circle" : "circle"}
                  size={24}
                  color={selected ? c.rose : c.tertiary}
                />
              </ActionButton>
            );
          })}
        </View>
        {!!selectionError && (
          <Text style={styles.selectionError} accessibilityLiveRegion="polite">
            {selectionError}
          </Text>
        )}
        <Text style={styles.speakerSelectionCount}>
          {selectedSpeakerProfileIds.length}人を選択中
        </Text>
      </NativeSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.canvas },
  masthead: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  topLine: {
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  wordmark: { width: 92 },
  headerActions: { flexDirection: "row", gap: 4 },
  headerAction: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  searchRow: { height: 60, position: "relative" },
  searchField: {
    position: "absolute",
    top: 6,
    height: 48,
    backgroundColor: c.raised,
    borderColor: c.rose,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
  },
  searchIconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  searchIcon: { width: 20, height: 20 },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: 44,
    color: c.primary,
    fontSize: 13,
    paddingVertical: 0,
    paddingRight: 4,
  },
  clearButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  clearText: { color: c.primary, fontSize: 23, lineHeight: 30 },
  cancelWrap: { position: "absolute", right: 0, top: 6 },
  cancel: {
    width: 80,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { color: c.primary, fontSize: 13, fontWeight: "500" },
  subtitle: { color: c.secondary, fontSize: 13, lineHeight: 21, marginTop: 12 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 4 },
  sectionHeading: {
    color: c.secondary,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "500",
    marginBottom: 12,
  },
  noResults: {
    color: c.secondary,
    fontSize: 15,
    lineHeight: 24,
    paddingVertical: 30,
  },
  emptyState: {
    minHeight: 208,
    marginTop: 4,
    padding: 24,
    borderRadius: 20,
    backgroundColor: c.surface,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: c.raised,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    color: c.primary,
    fontSize: 17,
    lineHeight: 26,
    fontWeight: "600",
  },
  emptyCopy: {
    color: c.secondary,
    fontSize: 13,
    lineHeight: 21,
    textAlign: "center",
  },
  track: {
    backgroundColor: c.surface,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    minHeight: 80,
  },
  playingTrack: { backgroundColor: c.raised, minHeight: 250 },
  trackHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  marker: { width: 4, height: 44, borderRadius: 4, backgroundColor: c.border },
  playingMarker: { backgroundColor: c.rose },
  trackDetail: {
    flex: 1,
    minWidth: 0,
    height: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  trackInformation: { flex: 1, gap: 4 },
  trackTitle: { color: c.primary, fontSize: 17, lineHeight: 27 },
  playingTitle: { fontSize: 22, lineHeight: 32, fontWeight: "700" },
  trackMeta: { color: c.secondary, fontSize: 13, lineHeight: 21 },
  chevron: { color: c.tertiary, fontSize: 23, lineHeight: 30 },
  playButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  playIcon: { width: 44, height: 44 },
  pauseButton: { backgroundColor: c.rose, borderRadius: 22 },
  pauseText: {
    color: c.onRose,
    fontSize: 22,
    lineHeight: 31,
    fontWeight: "700",
  },
  playingInformation: { marginTop: 16, gap: 7 },
  nowPlaying: {
    color: c.rose,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "500",
  },
  progressTouch: { height: 44, marginVertical: -6, justifyContent: "center" },
  progressTrack: {
    height: 4,
    backgroundColor: c.inset,
    borderRadius: 4,
    overflow: "hidden",
  },
  progressFill: { height: 4, backgroundColor: c.rose, borderRadius: 4 },
  times: { flexDirection: "row", justifyContent: "space-between" },
  time: { color: c.secondary, fontSize: 13, lineHeight: 19 },
  detailsLink: { minHeight: 44, justifyContent: "center" },
  detailsLinkText: {
    color: c.gold,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "500",
  },
  drafts: { marginTop: 20 },
  draftRow: {
    backgroundColor: c.surface,
    borderRadius: 16,
    minHeight: 84,
    padding: 16,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  draftText: { flex: 1, gap: 4 },
  draftTitle: { color: c.primary, fontSize: 17, lineHeight: 27 },
  draftMeta: { color: c.secondary, fontSize: 13, lineHeight: 21 },
  dock: { position: "absolute", left: 16, right: 16 },
  recordButton: {
    height: 56,
    borderRadius: 18,
    backgroundColor: c.rose,
    alignItems: "center",
    justifyContent: "center",
  },
  recordLabel: {
    color: c.onRose,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
  },
  selectionConfirm: {
    minHeight: 60,
    borderRadius: 18,
    paddingHorizontal: 20,
    backgroundColor: c.rose,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  selectionConfirmText: { color: c.onRose, fontSize: 15, fontWeight: "600" },
  speakerOption: {
    minHeight: 58,
    marginBottom: 9,
    paddingHorizontal: 15,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  speakerOptionSelected: {
    borderColor: c.rose,
    backgroundColor: "rgba(238,145,163,0.09)",
  },
  speakerOptionIdle: {
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  speakerName: {
    color: c.primary,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "500",
  },
  speakerSelectionCount: {
    color: c.secondary,
    fontSize: 11,
    lineHeight: 18,
    marginTop: 3,
  },
  selectionError: {
    color: c.rose,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 12,
  },
});
