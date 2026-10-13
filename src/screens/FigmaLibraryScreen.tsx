import { Feather } from "@expo/vector-icons";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
  PendingMemoryDeletion,
  SongDocument,
} from "../../shared/contracts";
import { ActionButton, useReducedMotion } from "../components/ActionButton";
import { NativeSheet } from "../components/NativeSheet";
import { YoinLogo } from "../components/YoinLogo";
import { figmaColors as c, formatFigmaTime } from "../design/figma";
import { searchCompletedSongs } from "../domain/librarySearch";
import { draftProgress } from "../pipeline/draft-progress";
import { songDate } from "../pipeline/library";
import type { SongExportResult, SongExportState } from "../pipeline/songExport";

const searchIcon = require("../../assets/figma/search-icon.png");
const playControl = require("../../assets/figma/play-control.png");

function formatExportBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`;
  return `${(kilobytes / 1024).toFixed(1)} MB`;
}

type Props = {
  songs: SongDocument[];
  drafts: LocalDraft[];
  speakers: LocalSpeakerProfile[];
  activeSongId: string | null;
  playing: boolean;
  position: number;
  busy: boolean;
  pendingMemoryDeletions: PendingMemoryDeletion[];
  songExportState: SongExportState | null;
  onNewRecording: (speakerProfileIds: string[]) => Promise<boolean>;
  onSettings: () => void;
  onSpeakerSettings: () => void;
  onOpenDraft: (draft: LocalDraft) => void;
  onOpenSong: (song: SongDocument) => void;
  onToggleSong: (song: SongDocument) => void;
  onSeek: (seconds: number) => void;
  onDeleteMemory: (draftId: string, title: string) => void;
  onRetryMemoryDeletion: (draftId: string) => void;
  onDownloadSong: (song: SongDocument) => Promise<SongExportResult>;
  onCancelSongDownload: () => void;
};

export function FigmaLibraryScreen({
  songs,
  drafts,
  speakers,
  activeSongId,
  playing,
  position,
  busy,
  pendingMemoryDeletions,
  songExportState,
  onNewRecording,
  onSettings,
  onSpeakerSettings,
  onOpenDraft,
  onOpenSong,
  onToggleSong,
  onSeek,
  onDeleteMemory,
  onRetryMemoryDeletion,
  onDownloadSong,
  onCancelSongDownload,
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
  const [memoryAction, setMemoryAction] = useState<{
    draftId: string;
    title: string;
    stage: "menu" | "confirm";
    song?: SongDocument;
  } | null>(null);
  const [songExportAction, setSongExportAction] = useState<{
    song: SongDocument;
    status: "running" | "failed";
    message?: string;
  } | null>(null);
  const songExportRequest = useRef(0);
  const [selectedSpeakerProfileIds, setSelectedSpeakerProfileIds] = useState<
    string[]
  >([]);
  const registeredSpeakers = speakers.filter(
    (speaker) =>
      speaker.status === "ready" && speaker.sampleId && speaker.modelVersion,
  );
  const shownSongs = searchCompletedSongs(songs, searchOpen ? query : "");
  const menuSong = memoryAction?.stage === "menu" ? memoryAction.song : null;
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

  function startSongDownload(song: SongDocument) {
    const request = ++songExportRequest.current;
    setMemoryAction(null);
    setSongExportAction({ song, status: "running" });
    void onDownloadSong(song)
      .then((result) => {
        if (request !== songExportRequest.current) return;
        if (result.status === "saved") {
          setSongExportAction(null);
          Alert.alert(
            "保存しました",
            `${result.fileName}を保存しました。書き出したMP3は、思い出やアカウントを削除しても保存先に残ります。`,
          );
        } else if (result.status === "cancelled") {
          setSongExportAction(null);
          if (result.cleanupFailed)
            Alert.alert(
              "途中ファイルを削除できませんでした",
              "保存をキャンセルしましたが、途中ファイルが保存先に残っている可能性があります。保存先を確認してください。",
            );
        } else if (result.status === "busy") {
          setSongExportAction({
            song,
            status: "failed",
            message: "別の曲を保存しています。完了後にもう一度お試しください。",
          });
        } else {
          setSongExportAction({
            song,
            status: "failed",
            message: result.message,
          });
        }
      })
      .catch(() => {
        if (request === songExportRequest.current)
          setSongExportAction({
            song,
            status: "failed",
            message:
              "音源を保存できませんでした。通信状況と保存先を確認して、もう一度お試しください。",
          });
      });
  }

  function cancelSongDownload() {
    songExportRequest.current++;
    setSongExportAction(null);
    onCancelSongDownload();
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
                  <ActionButton
                    label={`${song.title}のメニュー`}
                    onPress={() =>
                      setMemoryAction({
                        draftId: song.draftId,
                        title: song.title,
                        stage: "menu",
                        song,
                      })
                    }
                    style={styles.moreButton}
                    testID={`song-actions-${song.id}`}
                  >
                    <Feather
                      name="more-horizontal"
                      size={20}
                      color={c.secondary}
                    />
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
                <View
                  key={draft.id}
                  style={styles.draftRow}
                  testID={`draft-${draft.id}`}
                >
                  <ActionButton
                    label={`${draft.title}の続きを開く`}
                    onPress={() => onOpenDraft(draft)}
                    style={styles.draftOpen}
                    testID={`open-draft-${draft.id}`}
                  >
                    <View style={styles.draftText}>
                      <Text style={styles.draftTitle}>{draft.title}</Text>
                      <Text style={styles.draftMeta}>
                        {draftProgress(draft).label}
                      </Text>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </ActionButton>
                  <ActionButton
                    label={`${draft.title}のメニュー`}
                    onPress={() =>
                      setMemoryAction({
                        draftId: draft.id,
                        title: draft.title,
                        stage: "menu",
                      })
                    }
                    style={styles.moreButton}
                    testID={`draft-actions-${draft.id}`}
                  >
                    <Feather
                      name="more-horizontal"
                      size={20}
                      color={c.secondary}
                    />
                  </ActionButton>
                </View>
              ))}
            </View>
          )}
          {pendingMemoryDeletions.length > 0 && (
            <View
              style={styles.deletionNotices}
              testID="memory-deletion-status"
            >
              {pendingMemoryDeletions.map((deletion) => (
                <View key={deletion.draftId} style={styles.deletionNotice}>
                  <Text style={styles.deletionNoticeText}>
                    {deletion.status === "failed" ||
                    deletion.status === "local_failed"
                      ? "思い出の削除を完了できませんでした。"
                      : deletion.status === "requesting"
                        ? "削除状況を確認しています。"
                        : "思い出を削除しています。"}
                  </Text>
                  {deletion.status !== "deleting" && (
                    <ActionButton
                      label="思い出の削除を再試行"
                      onPress={() => onRetryMemoryDeletion(deletion.draftId)}
                      style={styles.retryDeletion}
                      testID={`retry-memory-deletion-${deletion.draftId}`}
                    >
                      <Text style={styles.retryDeletionText}>再試行</Text>
                    </ActionButton>
                  )}
                </View>
              ))}
            </View>
          )}
        </Animated.View>
      </ScrollView>
      <NativeSheet
        open={memoryAction !== null}
        onClose={() => setMemoryAction(null)}
        title={
          memoryAction?.stage === "confirm"
            ? "思い出を削除しますか？"
            : "思い出の操作"
        }
        description={
          memoryAction?.stage === "confirm"
            ? `${memoryAction.title}の元の会話と歌詞も削除され、元に戻せません。保存先に書き出したMP3は端末に残ります。`
            : (memoryAction?.title ?? "思い出を選んでください。")
        }
        closeDisabled={busy}
        snap={0.42}
        footer={
          memoryAction?.stage === "confirm" ? (
            <View style={styles.deleteFooter}>
              <ActionButton
                label="削除をキャンセル"
                onPress={() => setMemoryAction(null)}
                disabled={busy}
                style={styles.cancelDeletion}
                testID="cancel-memory-deletion"
              >
                <Text style={styles.cancelDeletionText}>キャンセル</Text>
              </ActionButton>
              <ActionButton
                label="思い出を削除する"
                onPress={() => {
                  if (!memoryAction) return;
                  const target = memoryAction;
                  setMemoryAction(null);
                  onDeleteMemory(target.draftId, target.title);
                }}
                disabled={busy}
                style={styles.confirmDeletion}
                testID="confirm-memory-deletion"
              >
                <Text style={styles.confirmDeletionText}>削除する</Text>
              </ActionButton>
            </View>
          ) : (
            <View style={styles.memoryMenuFooter}>
              {menuSong && Platform.OS === "android" && (
                <ActionButton
                  label={`${menuSong.title}をMP3でダウンロード`}
                  onPress={() => startSongDownload(menuSong)}
                  style={styles.downloadSongAction}
                  testID={`download-song-${menuSong.id}`}
                >
                  <Feather name="download" size={17} color={c.primary} />
                  <Text style={styles.downloadSongActionText}>
                    ダウンロード（MP3）
                  </Text>
                </ActionButton>
              )}
              <ActionButton
                label="思い出の削除を選ぶ"
                onPress={() =>
                  setMemoryAction((current) =>
                    current ? { ...current, stage: "confirm" } : null,
                  )
                }
                style={styles.confirmDeletion}
                testID="open-memory-deletion-confirmation"
              >
                <Text style={styles.confirmDeletionText}>削除</Text>
              </ActionButton>
            </View>
          )
        }
      >
        {memoryAction?.stage === "confirm" && (
          <Text style={styles.deletionExplanation}>
            完成した曲、元の会話、文字起こし、歌詞、位置情報を削除します。この操作は取り消せません。保存先に書き出したMP3は端末に残ります。
          </Text>
        )}
      </NativeSheet>
      <NativeSheet
        open={songExportAction !== null}
        onClose={() => {
          if (songExportAction?.status === "running") cancelSongDownload();
          else setSongExportAction(null);
        }}
        title={
          songExportAction?.status === "failed"
            ? "曲を保存できませんでした"
            : "曲をMP3で保存しています"
        }
        description={`${songExportAction?.song.title ?? "曲"}を保存先に書き出します。保存したMP3は思い出やアカウントを削除しても残ります。`}
        snap={0.42}
        footer={
          songExportAction?.status === "failed" ? (
            <View style={styles.deleteFooter}>
              <ActionButton
                label="曲の保存を閉じる"
                onPress={() => setSongExportAction(null)}
                style={styles.cancelDeletion}
                testID="song-download-close"
              >
                <Text style={styles.cancelDeletionText}>閉じる</Text>
              </ActionButton>
              <ActionButton
                label="曲の保存を再試行"
                onPress={() => startSongDownload(songExportAction.song)}
                style={styles.confirmDeletion}
                testID="song-download-retry"
              >
                <Text style={styles.confirmDeletionText}>再試行</Text>
              </ActionButton>
            </View>
          ) : (
            <ActionButton
              label="曲のダウンロードをキャンセル"
              onPress={cancelSongDownload}
              style={styles.cancelDeletion}
              testID="song-download-cancel"
            >
              <Text style={styles.cancelDeletionText}>キャンセル</Text>
            </ActionButton>
          )
        }
      >
        {songExportAction?.status === "failed" ? (
          <Text style={styles.songExportError} accessibilityLiveRegion="polite">
            {songExportAction.message}
          </Text>
        ) : songExportState?.phase === "saving" ? (
          <View style={styles.songExportProgress}>
            <Feather name="file-text" size={22} color={c.gold} />
            <Text style={styles.songExportProgressText}>
              Androidの保存画面で保存先とファイル名を選んでください。
            </Text>
          </View>
        ) : (
          <View style={styles.songExportProgress}>
            {songExportState && songExportState.totalBytes > 0 ? (
              <>
                <View
                  accessibilityRole="progressbar"
                  accessibilityValue={{
                    min: 0,
                    max: songExportState.totalBytes,
                    now: songExportState.bytesWritten,
                  }}
                  style={styles.songExportProgressTrack}
                >
                  <View
                    style={[
                      styles.songExportProgressFill,
                      {
                        width: `${Math.min(100, (songExportState.bytesWritten / songExportState.totalBytes) * 100)}%`,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.songExportProgressText}>
                  {`${formatExportBytes(songExportState.bytesWritten)} / ${formatExportBytes(songExportState.totalBytes)}`}
                </Text>
              </>
            ) : (
              <>
                <ActivityIndicator color={c.gold} />
                <Text style={styles.songExportProgressText}>
                  音源サイズを確認しています。
                </Text>
              </>
            )}
          </View>
        )}
      </NativeSheet>
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
  moreButton: {
    width: 36,
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
  draftOpen: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
  },
  draftText: { flex: 1, gap: 4 },
  draftTitle: { color: c.primary, fontSize: 17, lineHeight: 27 },
  draftMeta: { color: c.secondary, fontSize: 13, lineHeight: 21 },
  deletionNotices: { gap: 8, marginTop: 16 },
  deletionNotice: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: c.raised,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  deletionNoticeText: {
    flex: 1,
    color: c.secondary,
    fontSize: 13,
    lineHeight: 20,
  },
  retryDeletion: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: c.surface,
  },
  retryDeletionText: { color: c.primary, fontSize: 13, fontWeight: "600" },
  deleteFooter: { flexDirection: "row", gap: 10 },
  cancelDeletion: {
    flex: 1,
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: c.raised,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelDeletionText: { color: c.primary, fontSize: 15, fontWeight: "600" },
  confirmDeletion: {
    minHeight: 50,
    borderRadius: 16,
    paddingHorizontal: 20,
    backgroundColor: c.rose,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmDeletionText: { color: c.onRose, fontSize: 15, fontWeight: "700" },
  memoryMenuFooter: { gap: 10 },
  downloadSongAction: {
    minHeight: 50,
    borderRadius: 16,
    paddingHorizontal: 18,
    backgroundColor: c.raised,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  downloadSongActionText: { color: c.primary, fontSize: 15, fontWeight: "600" },
  deletionExplanation: {
    color: c.secondary,
    fontSize: 14,
    lineHeight: 22,
    paddingBottom: 12,
  },
  songExportProgress: {
    minHeight: 72,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingBottom: 12,
  },
  songExportProgressText: {
    color: c.secondary,
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
  },
  songExportProgressTrack: {
    width: "100%",
    height: 7,
    overflow: "hidden",
    borderRadius: 8,
    backgroundColor: c.raised,
  },
  songExportProgressFill: {
    height: "100%",
    backgroundColor: c.gold,
    borderRadius: 8,
  },
  songExportError: {
    color: c.secondary,
    fontSize: 14,
    lineHeight: 22,
    paddingBottom: 12,
  },
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
