import { Feather } from "@expo/vector-icons";
import {
  createNavigationContainerRef,
  DefaultTheme,
  type NavigationAction,
  NavigationContainer,
  StackActions,
  usePreventRemove,
} from "@react-navigation/native";
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type {
  AudioClip,
  DraftDocument,
  LocalDraft,
  LyricBlock,
  SongDocument,
  TranscriptSpeakerAssignment,
  Utterance,
} from "./shared/contracts";
import type { SessionIdentity } from "./src/auth/types";
import { useAuthentication } from "./src/auth/useAuthentication";
import { ActionButton, useReducedMotion } from "./src/components/ActionButton";
import { FinishMemory } from "./src/components/FinishMemory";
import { GenerationProgress } from "./src/components/GenerationProgress";
import { LyricReview } from "./src/components/LyricReview";
import { NativeSheet } from "./src/components/NativeSheet";
import { SongSourceContent } from "./src/components/SongSourceContent";
import { SpeakerEnrollmentSheet } from "./src/components/SpeakerEnrollmentSheet";
import { TranscriptSpeakerReview } from "./src/components/TranscriptSpeakerReview";
import { TranscriptTimingNotice } from "./src/components/TranscriptTimingNotice";
import { figmaColors } from "./src/design/figma";
import { colors, radii } from "./src/design/tokens";
import { formatTime } from "./src/domain/session";
import { draftProgress } from "./src/pipeline/draft-progress";
import {
  editLyricText,
  sourceContext,
  sourcePlaybackRange,
} from "./src/pipeline/library";
import { explainError } from "./src/pipeline/messages";
import { speakerLabel, transcriptReviewSummary } from "./src/pipeline/speakers";
import { FigmaLibraryScreen } from "./src/screens/FigmaLibraryScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { MusicScreen } from "./src/screens/MusicScreen";
import { RecordingScreen } from "./src/screens/RecordingScreen";
import { useSession } from "./src/useSession";

type Routes = {
  Library: undefined;
  Recording: { draftId: string };
  Music: { songId: string };
};
type Overlay =
  | { kind: "finish" | "review" | "progress"; draftId: string }
  | {
      kind: "source";
      document: DraftDocument | SongDocument;
      clip?: AudioClip;
      block?: LyricBlock;
      draftId?: string;
    }
  | { kind: "settings" | "speakers" };
type Controller = ReturnType<typeof useSession> & {
  show: (overlay: Overlay) => void;
};
const SessionContext = createContext<Controller | null>(null);
const Stack = createNativeStackNavigator<Routes>();
const navigationRef = createNavigationContainerRef<Routes>();
const navigationTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: "#fff" },
};
function useController() {
  const app = useContext(SessionContext);
  if (!app) throw new Error("SessionContext is required");
  return app;
}
const statusLabel: Record<string, string> = {
  local: "マイクオフ",
  uploading: "残した会話を届けています",
  preparing: "会話から、歌詞へ",
  updating_readings: "歌詞の読みを更新しています",
  needs_audio_review: "音声と文字起こしを確認しよう",
  waiting_review: "歌詞を確かめよう",
  generating: "この一日が、一曲になる",
  ready: "曲ができました",
  failed: "処理を続けられませんでした",
  needs_reconciliation: "処理結果の確認が必要です",
};

function LibraryRoute({
  navigation,
}: NativeStackScreenProps<Routes, "Library">) {
  const app = useController();
  const deletionIds = new Set(
    (app.state.pendingMemoryDeletions ?? []).map(
      (deletion) => deletion.draftId,
    ),
  );
  const screenProps = {
    songs: app.state.songs.filter((song) => !deletionIds.has(song.draftId)),
    drafts: app.state.drafts.filter((draft) => !deletionIds.has(draft.id)),
    speakers: app.state.speakerProfiles ?? [],
    pendingMemoryDeletions: app.state.pendingMemoryDeletions ?? [],
    onSettings: () => app.show({ kind: "settings" }),
    onSpeakerSettings: () => app.show({ kind: "speakers" }),
    onNewRecording: async (speakerProfileIds: string[]) => {
      await app.pauseSong();
      const draftId = await app.newRecording(speakerProfileIds);
      if (!draftId) return false;
      navigation.navigate("Recording", { draftId });
      return true;
    },
    onOpenDraft: (draft: LocalDraft) => {
      void app.pauseSong().then(() => {
        if (draft.status === "local" || draft.status === "uploading")
          navigation.navigate("Recording", { draftId: draft.id });
        else
          app.show({
            kind: draft.musicRecoveryAvailable
              ? "progress"
              : draft.status === "waiting_review" ||
                  (draft.status === "failed" && draft.lyrics)
                ? "review"
                : draft.status === "failed"
                  ? "finish"
                  : "progress",
            draftId: draft.id,
          });
      });
    },
    onOpenSong: (song: SongDocument) => {
      if (app.activeSongId === song.id) {
        navigation.navigate("Music", { songId: song.id });
        return;
      }
      void app
        .openSong(song)
        .then(() => navigation.navigate("Music", { songId: song.id }));
    },
    onDeleteMemory: (draftId: string) => {
      void app.deleteMemory(draftId);
    },
    onRetryMemoryDeletion: (draftId: string) => {
      void app.retryMemoryDeletion(draftId);
    },
  };
  return (
    <FigmaLibraryScreen
      {...screenProps}
      busy={app.busy}
      activeSongId={app.activeSongId}
      playing={app.playing}
      position={app.position}
      onToggleSong={(song) => {
        void (async () => {
          if (app.activeSongId !== song.id) await app.openSong(song);
          await app.togglePlayback();
        })();
      }}
      onSeek={(seconds) => {
        void app.seek(seconds);
      }}
    />
  );
}

function RecordingRoute({
  route,
  navigation,
}: NativeStackScreenProps<Routes, "Recording">) {
  const app = useController();
  const { draftId } = route.params;
  const draft = app.state.drafts.find((value) => value.id === draftId);
  const recording =
    app.state.pendingRecording?.purpose !== "speaker" &&
    app.state.pendingRecording?.draftId === draftId &&
    app.recorder.recorderState === "recording";
  const exiting = useRef(false);
  const pendingRemoval = useRef<NavigationAction | null>(null);
  const exit = useCallback(
    (action: NavigationAction) => {
      if (exiting.current) return;
      exiting.current = true;
      void app
        .leave(draftId)
        .then((saved) => {
          if (saved) navigation.dispatch(action);
        })
        .finally(() => {
          exiting.current = false;
        });
    },
    [app.leave, draftId, navigation],
  );
  useEffect(() => {
    const action = pendingRemoval.current;
    if (app.busy || !action) return;
    pendingRemoval.current = null;
    exit(action);
  }, [app.busy, exit]);
  usePreventRemove(true, ({ data }) => {
    if (exiting.current) return;
    if (app.busy) {
      pendingRemoval.current = data.action;
      return;
    }
    exit(data.action);
  });
  if (!draft) return null;
  return (
    <RecordingScreen
      draft={draft}
      speakerNames={(draft.speakerProfileIds ?? [])
        .map(
          (speakerId) =>
            app.state.speakerProfiles?.find(
              (speaker) => speaker.id === speakerId,
            )?.name,
        )
        .filter((name): name is string => !!name)}
      recording={recording}
      busy={
        app.busy || ["preparing", "saving"].includes(app.recorder.recorderState)
      }
      liveSeconds={recording ? app.recorder.elapsedMs / 1000 : 0}
      locationEnabled={draft.locationEnabled ?? false}
      locationStatus={app.recorder.locationStatus}
      onLocationEnabledChange={(enabled) => {
        void app.setRecordingLocationEnabled(draftId, enabled);
      }}
      stateLabel={
        recording
          ? "録音中"
          : app.recorder.recorderState === "saving"
            ? "音声を保存中"
            : draft.status === "local"
              ? undefined
              : draft.status === "needs_reconciliation" &&
                  !draft.lyrics &&
                  draft.transcriptRecoveryAvailable
                ? "文字起こしを復旧できます"
                : statusLabel[draft.status]
      }
      onToggle={(title) => {
        void app.toggleRecording(draftId, title);
      }}
      onImport={(title) => {
        void app.importClip(draftId, title);
      }}
      onBack={() => navigation.goBack()}
      onFinish={() => {
        void app.finishRecording(draftId).then((saved) => {
          if (saved?.clips.length)
            app.show({
              kind: saved.musicRecoveryAvailable
                ? "progress"
                : saved.status === "waiting_review" ||
                    (saved.status === "failed" && saved.lyrics)
                  ? "review"
                  : saved.status === "local" ||
                      saved.status === "uploading" ||
                      saved.status === "failed"
                    ? "finish"
                    : "progress",
              draftId,
            });
        });
      }}
      onClip={(clip) =>
        app.show({ kind: "source", document: draft, clip, draftId })
      }
    />
  );
}

function MusicRoute({
  route,
  navigation,
}: NativeStackScreenProps<Routes, "Music">) {
  const app = useController();
  const song = app.state.songs.find(
    (value) => value.id === route.params.songId,
  );
  if (!song) return null;
  return (
    <MusicScreen
      song={song}
      playing={app.playing}
      position={app.position}
      onBack={() => navigation.goBack()}
      onToggle={() => {
        void app.togglePlayback();
      }}
      onSeek={(seconds) => {
        void app.seek(seconds);
      }}
      onScrub={(scrubbing) => {
        if (scrubbing) void app.pause();
      }}
      onMemory={(block) => {
        void app
          .pauseSong()
          .then(() => app.show({ kind: "source", document: song, block }));
      }}
    />
  );
}

function PrivacyPolicyLink({ dark = false }: { dark?: boolean }) {
  return (
    <ActionButton
      label="プライバシーポリシー"
      onPress={() => {
        void Linking.openURL(
          "https://yoin-private-api.h-rion-0910.workers.dev/privacy",
        ).catch(() => {
          Alert.alert(
            "ページを開けませんでした",
            "通信を確認して、もう一度お試しください。",
          );
        });
      }}
      style={dark ? extra.accountSecondary : styles.secondary}
      testID="privacy-policy"
    >
      <Text
        style={
          dark
            ? extra.accountSecondaryText
            : [styles.secondaryText, { color: colors.paper }]
        }
      >
        プライバシーポリシー
      </Text>
    </ActionButton>
  );
}

export default function App() {
  const auth = useAuthentication();
  if (auth.identity)
    return (
      <SessionApp
        key={auth.identity.uid}
        identity={auth.identity}
        auth={auth}
      />
    );
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <LoginScreen
        ready={auth.ready}
        busy={auth.busy}
        error={auth.error}
        onSignIn={() => {
          void auth.signIn();
        }}
        privacyPolicy={<PrivacyPolicyLink />}
      />
    </SafeAreaProvider>
  );
}
function SessionApp({
  identity,
  auth,
}: {
  identity: SessionIdentity;
  auth: ReturnType<typeof useAuthentication>;
}) {
  const app = useSession(identity);
  const reducedMotion = useReducedMotion();
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [activeRoute, setActiveRoute] = useState<keyof Routes>("Library");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [songTitle, setSongTitle] = useState("");
  const [place, setPlace] = useState("");
  const [placeEditing, setPlaceEditing] = useState(false);
  const [activeSourceClipId, setActiveSourceClipId] = useState<string | null>(
    null,
  );
  const [activeTranscriptUtteranceId, setActiveTranscriptUtteranceId] =
    useState<string | null>(null);
  const [editedBlocks, setEditedBlocks] = useState<LyricBlock[]>([]);
  const [speakerAssignmentState, setSpeakerAssignmentState] = useState<{
    key: string;
    assignments: TranscriptSpeakerAssignment[];
  }>({ key: "", assignments: [] });
  const close = () => {
    Keyboard.dismiss();
    void app.closeSource();
    setActiveSourceClipId(null);
    setActiveTranscriptUtteranceId(null);
    setSheetOpen(false);
    setOverlay(null);
  };
  const show = useCallback(
    (next: Overlay) => {
      Keyboard.dismiss();
      app.clearError();
      if (next.kind === "review") {
        const draft = app.state.drafts.find(
          (value) => value.id === next.draftId,
        );
        setEditedBlocks(draft?.lyrics?.blocks ?? []);
        setSongTitle(draft?.songTitle ?? "");
      }
      if (next.kind === "source") {
        setPlace(next.clip?.place ?? "");
        setPlaceEditing(false);
        setActiveSourceClipId(null);
      }
      setOverlay(next);
      setSheetOpen(true);
    },
    [app.clearError, app.state.drafts],
  );
  const draft =
    overlay && "draftId" in overlay
      ? app.state.drafts.find((value) => value.id === overlay.draftId)
      : undefined;
  const transcriptAssignmentKey = draft
    ? `${draft.id}:${draft.jobId ?? ""}`
    : "";
  const transcriptAssignments =
    speakerAssignmentState.key === transcriptAssignmentKey
      ? speakerAssignmentState.assignments
      : [];
  const transcriptReview = draft
    ? transcriptReviewSummary(draft.utterances, transcriptAssignments)
    : null;
  const deletionExit = useRef(false);
  useEffect(() => {
    if (app.accountDeleted && !deletionExit.current) {
      deletionExit.current = true;
      void auth.signOut();
    }
  }, [app.accountDeleted, auth.signOut]);
  async function logout() {
    if (await app.suspend()) await auth.signOut();
  }
  async function removeAccount() {
    try {
      if (!(await auth.reauthenticate(identity.uid))) return;
      if (await app.deleteAccount()) await auth.signOut();
    } catch {
      setAccountError(
        "本人確認を完了できませんでした。通信を確認して、もう一度お試しください。",
      );
    }
  }
  const [accountError, setAccountError] = useState<string | null>(null);
  const overlayKind =
    overlay?.kind === "progress" && draft?.status === "waiting_review"
      ? "review"
      : overlay?.kind;
  const songSource =
    overlay?.kind === "source" && "audioId" in overlay.document;
  useEffect(() => {
    if (overlay?.kind === "review" && draft?.status === "updating_readings") {
      setOverlay({ kind: "progress", draftId: draft.id });
      return;
    }
    if (overlay?.kind === "progress" && draft?.status === "waiting_review") {
      setEditedBlocks(draft.lyrics?.blocks ?? []);
      setSongTitle(draft.songTitle ?? "");
      setOverlay({ kind: "review", draftId: draft.id });
    }
  }, [
    overlay?.kind,
    draft?.id,
    draft?.status,
    draft?.lyrics,
    draft?.songTitle,
  ]);
  useEffect(() => {
    const route = navigationRef.isReady()
      ? navigationRef.getCurrentRoute()
      : undefined;
    if (route?.name === "Recording") {
      const draftId = (route.params as Routes["Recording"]).draftId;
      if (app.deletedMemoryIds.includes(draftId))
        navigationRef.navigate("Library");
    } else if (route?.name === "Music") {
      const songId = (route.params as Routes["Music"]).songId;
      if (!app.state.songs.some((song) => song.id === songId))
        navigationRef.navigate("Library");
    }
    const overlayDraftId =
      overlay && "draftId" in overlay
        ? overlay.draftId
        : overlay?.kind === "source" && "draftId" in overlay.document
          ? overlay.document.draftId
          : undefined;
    if (overlayDraftId && app.deletedMemoryIds.includes(overlayDraftId)) {
      Keyboard.dismiss();
      void app.closeSource();
      setActiveSourceClipId(null);
      setActiveTranscriptUtteranceId(null);
      setSheetOpen(false);
      setOverlay(null);
    }
  }, [app.closeSource, app.deletedMemoryIds, app.state.songs, overlay]);
  useEffect(() => {
    const route = navigationRef.isReady()
      ? navigationRef.getCurrentRoute()
      : undefined;
    if (route?.name !== "Recording") return;
    const draftId = (route.params as Routes["Recording"]).draftId;
    const song = app.state.songs.find((value) => value.draftId === draftId);
    if (!song) return;
    setSheetOpen(false);
    void app
      .openSong(song)
      .then(() =>
        navigationRef.dispatch(
          StackActions.replace("Music", { songId: song.id }),
        ),
      );
  }, [app.state.songs, app.openSong]);
  const prepare = async () => {
    if (!draft) return;
    if (await app.prepare(draft.id))
      setOverlay({ kind: "progress", draftId: draft.id });
  };
  const generate = async () => {
    if (!draft) return;
    if (await app.generate(draft.id, editedBlocks, songTitle))
      setOverlay({ kind: "progress", draftId: draft.id });
  };
  const title =
    overlayKind === "settings"
      ? "設定"
      : overlayKind === "speakers"
        ? "友達の声を登録"
        : overlayKind === "source"
          ? "あのときの会話"
          : overlayKind === "review"
            ? "この歌詞で、残そう。"
            : overlayKind === "progress" &&
                draft?.status === "needs_audio_review"
              ? "話者と文字起こしの確認"
              : overlayKind === "progress"
                ? "思い出の仕上げ"
                : "この一日を、仕上げよう。";
  const description =
    overlayKind === "settings"
      ? "アカウントと、登録した声を管理できます。"
      : overlayKind === "speakers"
        ? "友達の名前と声を登録すると、会話を友達ごとに振り返れます。"
        : overlayKind === "review"
          ? "会話を確かめながら、言葉を整えられます。"
          : overlayKind === "progress" && draft?.status === "needs_audio_review"
            ? "文字起こしと話者の確認が必要です。話者未特定の発話は下で再生し、参加者を割り当てられます。歌詞はまだ作成されていません。画面下のボタンから作成できます。"
            : overlayKind === "source"
              ? "歌詞の元になった音声を聴き返せます。"
              : overlayKind === "progress"
                ? "この画面を閉じても、記録は残ります。"
                : "残した音声を確かめて、歌詞にしよう。";
  let sourceUtterances: Utterance[] = [];
  let sourceClips: AudioClip[] = [];
  if (overlay?.kind === "source") {
    sourceUtterances = overlay.document.utterances.filter((value) =>
      overlay.clip
        ? value.clipId === overlay.clip.id
        : overlay.block?.sourceUtteranceIds.includes(value.id),
    );
    sourceClips = overlay.clip
      ? [overlay.clip]
      : overlay.document.clips.filter((clip) =>
          sourceUtterances.some((value) => value.clipId === clip.id),
        );
  }

  return (
    <SafeAreaProvider>
      <StatusBar
        style={
          activeRoute === "Music" ||
          activeRoute === "Library" ||
          activeRoute === "Recording"
            ? "light"
            : "dark"
        }
      />
      <SessionContext.Provider value={{ ...app, show }}>
        <NavigationContainer
          ref={navigationRef}
          theme={navigationTheme}
          onStateChange={() => {
            setActiveRoute(navigationRef.getCurrentRoute()?.name ?? "Library");
          }}
        >
          <Stack.Navigator
            screenOptions={{
              headerShown: false,
              animation: reducedMotion ? "none" : "slide_from_right",
              contentStyle: { backgroundColor: colors.paper },
            }}
          >
            <Stack.Screen
              name="Library"
              component={LibraryRoute}
              options={{
                contentStyle: { backgroundColor: figmaColors.canvas },
              }}
            />
            <Stack.Screen
              name="Recording"
              component={RecordingRoute}
              options={{
                contentStyle: { backgroundColor: figmaColors.canvas },
              }}
            />
            <Stack.Screen
              name="Music"
              component={MusicRoute}
              options={{
                contentStyle: { backgroundColor: figmaColors.canvas },
              }}
            />
          </Stack.Navigator>
        </NavigationContainer>
        {!app.ready && (
          <View style={extra.loading}>
            <ActivityIndicator color={colors.ink} />
            <Text style={styles.summary}>
              {app.error || "思い出を読み込んでいます"}
            </Text>
            {!!app.error && (
              <ActionButton
                label="ログアウト"
                onPress={() => {
                  void logout();
                }}
                disabled={auth.busy}
                style={styles.secondary}
              >
                <Text style={styles.secondaryText}>ログアウト</Text>
              </ActionButton>
            )}
          </View>
        )}
        {!!app.error && app.ready && !sheetOpen && (
          <ActionButton
            label="エラーを閉じる"
            onPress={app.clearError}
            style={extra.error}
          >
            <Text accessibilityLiveRegion="polite" style={styles.summary}>
              {app.error}
            </Text>
          </ActionButton>
        )}
        <SpeakerEnrollmentSheet
          open={sheetOpen && overlayKind === "speakers"}
          onClose={() => setSheetOpen(false)}
          app={app}
        />
        <NativeSheet
          open={sheetOpen && overlayKind !== "speakers"}
          onClose={close}
          title={title}
          description={description}
          appearance={
            overlayKind === "settings"
              ? "dark"
              : songSource
                ? "songSource"
                : "default"
          }
          avoidKeyboard={
            overlayKind === "finish" ||
            overlayKind === "review" ||
            (overlayKind === "source" && placeEditing)
          }
          snap={
            overlayKind === "review" || overlayKind === "source" ? 0.84 : 0.72
          }
        >
          {!!app.error && (
            <Text
              accessibilityLiveRegion="polite"
              style={
                overlayKind === "settings"
                  ? extra.accountErrorCopy
                  : extra.errorCopy
              }
            >
              {app.error}
            </Text>
          )}
          {!!draft?.error && (
            <Text accessibilityLiveRegion="polite" style={extra.errorCopy}>
              {draft.status === "needs_reconciliation" ||
              draft.status === "needs_audio_review"
                ? draftProgress(draft).description
                : explainError(draft.error)}
            </Text>
          )}
          {overlayKind === "settings" && (
            <View testID="account-sheet" style={extra.accountContent}>
              <Text style={extra.accountFieldLabel}>
                ログイン中のアカウント
              </Text>
              <Text style={extra.accountSummary}>{identity.name}</Text>
              <Text style={extra.accountSummary}>{identity.email}</Text>
              <ActionButton
                label="友達の声を登録"
                onPress={() => show({ kind: "speakers" })}
                disabled={app.busy}
                style={extra.accountPrimary}
              >
                <Text style={extra.accountPrimaryText}>友達の声を登録</Text>
              </ActionButton>
              <ActionButton
                label="ログアウト"
                onPress={() => {
                  void logout();
                }}
                disabled={app.busy || auth.busy}
                style={extra.accountSecondary}
              >
                <Text style={extra.accountSecondaryText}>ログアウト</Text>
              </ActionButton>
              <ActionButton
                label="アカウントを削除"
                onPress={() => {
                  setAccountError(null);
                  Alert.alert(
                    "アカウントを削除しますか？",
                    "下書き、曲、登録した声を削除します。元に戻せません。続けるとGoogleで本人確認を行います。",
                    [
                      { text: "キャンセル", style: "cancel" },
                      {
                        text: "削除する",
                        style: "destructive",
                        onPress: () => {
                          void removeAccount();
                        },
                      },
                    ],
                  );
                }}
                disabled={app.busy || auth.busy}
                style={extra.accountSecondary}
              >
                <Text style={extra.accountDeleteText}>アカウントを削除</Text>
              </ActionButton>
              <PrivacyPolicyLink dark />
              {!!(accountError || auth.error) && (
                <Text
                  accessibilityLiveRegion="polite"
                  style={extra.accountErrorCopy}
                >
                  {accountError || auth.error}
                </Text>
              )}
            </View>
          )}
          {overlayKind === "finish" && draft && (
            <FinishMemory
              draft={draft}
              busy={app.busy}
              onMusicPreferences={(preferences) => {
                void app.editMusicPreferences(draft.id, preferences);
              }}
              onPrepare={() => {
                void prepare();
              }}
              onClip={(clip) =>
                show({
                  kind: "source",
                  document: draft,
                  clip,
                  draftId: draft.id,
                })
              }
            />
          )}
          {overlayKind === "review" && draft && (
            <LyricReview
              draft={draft}
              blocks={editedBlocks}
              songTitle={songTitle}
              busy={app.busy}
              onSongTitle={(title) => {
                setSongTitle(title);
                void app.editSongTitle(draft.id, title);
              }}
              onChange={(id, text) => {
                setEditedBlocks((blocks) =>
                  blocks.map((block) =>
                    block.id === id ? editLyricText(block, text) : block,
                  ),
                );
                void app.editLyrics(draft.id, id, text);
              }}
              onReading={(id, reading) => {
                setEditedBlocks((blocks) =>
                  blocks.map((block) =>
                    block.id === id
                      ? {
                          ...block,
                          singingText: reading.trim() ? reading : undefined,
                        }
                      : block,
                  ),
                );
                void app.editReading(draft.id, id, reading);
              }}
              onUpdateReadings={() => {
                void app
                  .updateReadings(draft.id, editedBlocks)
                  .then((updated) => {
                    if (updated)
                      setOverlay({ kind: "progress", draftId: draft.id });
                  });
              }}
              onSource={(block) =>
                show({
                  kind: "source",
                  document: draft,
                  block,
                  draftId: draft.id,
                })
              }
              onGenerate={() => {
                void generate();
              }}
            />
          )}
          {overlayKind === "progress" && draft && (
            <View testID="generation-progress">
              {draft.status === "needs_audio_review" ? (
                <>
                  <ScrollView style={{ maxHeight: 310 }}>
                    {draft.clips.map((clip) => (
                      <View key={clip.id} style={{ marginBottom: 18 }}>
                        <TranscriptTimingNotice
                          issues={clip.processing?.timingIssues}
                        />
                        <Text style={styles.summary}>
                          処理した音声{" "}
                          {formatTime(
                            (clip.processing?.processedMs ?? clip.durationMs) /
                              1000,
                          )}
                          {" · "}発話のある時間{" "}
                          {formatTime(
                            (clip.processing?.speechActivityMs ?? 0) / 1000,
                          )}
                          {" · "}
                          {clip.processing?.timingIssues?.length
                            ? "時刻を確認できた範囲"
                            : "認識した時間"}{" "}
                          {formatTime(
                            (clip.processing?.transcribedMs ?? 0) / 1000,
                          )}
                        </Text>
                        {clip.processing?.unrecognizedActivityMs ? (
                          <Text style={styles.summary}>
                            {clip.processing?.timingIssues?.length
                              ? "認識時刻が未確認の有音区間"
                              : "未認識の有音区間"}{" "}
                            {formatTime(
                              clip.processing.unrecognizedActivityMs / 1000,
                            )}
                          </Text>
                        ) : null}
                        {clip.processing?.status === "needs_review" ? (
                          <Text style={styles.summary}>
                            録音器{" "}
                            {clip.processing.recordedDurationMs
                              ? formatTime(
                                  clip.processing.recordedDurationMs / 1000,
                                )
                              : "不明"}
                            {" · "}端末ファイル{" "}
                            {formatTime(
                              clip.processing.clientDurationMs / 1000,
                            )}
                            {" · "}サーバー検査{" "}
                            {formatTime(
                              clip.processing.serverDurationMs / 1000,
                            )}
                          </Text>
                        ) : null}
                        <ActionButton
                          label="全文を確認"
                          onPress={() =>
                            show({
                              kind: "source",
                              document: draft,
                              clip,
                              draftId: draft.id,
                            })
                          }
                          style={styles.clipRow}
                          testID={`audio-review-source-${clip.id}`}
                        >
                          <Feather
                            name="headphones"
                            size={18}
                            color={colors.ink}
                          />
                          <Text style={styles.clipContext}>
                            原音を最初から最後まで聴く
                          </Text>
                        </ActionButton>
                      </View>
                    ))}
                    <TranscriptSpeakerReview
                      draft={draft}
                      speakers={app.state.speakerProfiles ?? []}
                      assignments={transcriptAssignments}
                      activePlaybackUtteranceId={activeTranscriptUtteranceId}
                      sourcePlaying={app.sourcePlaying}
                      busy={app.busy}
                      onPlayUtterance={(utterance) => {
                        setActiveTranscriptUtteranceId(utterance.id);
                        void app.playSource(
                          utterance.clipId,
                          utterance.timingIssues?.some(
                            (issue) => issue.correction !== "clamped_end",
                          )
                            ? 0
                            : utterance.startMs,
                          utterance.timingIssues?.some(
                            (issue) => issue.correction !== "clamped_end",
                          )
                            ? undefined
                            : utterance.endMs,
                          draft.id,
                        );
                      }}
                      onStopUtterance={() => {
                        setActiveTranscriptUtteranceId(null);
                        void app.closeSource();
                      }}
                      onAssignmentsChange={(assignments) =>
                        setSpeakerAssignmentState({
                          key: transcriptAssignmentKey,
                          assignments,
                        })
                      }
                    />
                  </ScrollView>
                  <Text style={styles.summary}>
                    {transcriptReview?.unresolvedCount
                      ? `未割当${transcriptReview.unresolvedCount}件は話者名なしで歌詞に含めます。`
                      : "話者の割り当てを歌詞作成に反映します。"}
                  </Text>
                  {!draft.jobId && (
                    <Text style={styles.summary}>
                      処理状況を確認しています。通信後にこの画面を開き直してください。
                    </Text>
                  )}
                  <ActionButton
                    label={
                      transcriptReview?.unresolvedCount
                        ? `未割当${transcriptReview.unresolvedCount}件のまま歌詞を作る`
                        : "内容を確認して歌詞を作る"
                    }
                    onPress={() =>
                      void app.approveTranscript(
                        draft.id,
                        transcriptAssignments,
                      )
                    }
                    disabled={app.busy || !draft.jobId}
                    style={styles.primary}
                    testID="approve-transcript"
                  >
                    <Text style={styles.primaryText}>
                      {transcriptReview?.unresolvedCount
                        ? `未割当${transcriptReview.unresolvedCount}件のまま歌詞を作る`
                        : "内容を確認して歌詞を作る"}
                    </Text>
                    <Feather
                      name="chevron-right"
                      size={20}
                      color={colors.paper}
                    />
                  </ActionButton>
                </>
              ) : (
                <>
                  <GenerationProgress draft={draft} onClose={close} />
                  {draft.musicRecoveryAvailable && (
                    <ActionButton
                      label="保存済み曲を復旧"
                      onPress={() => void app.recoverMusic(draft.id)}
                      disabled={app.busy || !draft.jobId}
                      style={styles.primary}
                      testID="recover-music"
                    >
                      <Text style={styles.primaryText}>保存済み曲を復旧</Text>
                    </ActionButton>
                  )}

                  {draft.status === "needs_reconciliation" &&
                    draft.transcriptRecoveryAvailable && (
                      <ActionButton
                        label="保存済みの文字起こしを復旧"
                        onPress={() => void app.recoverTranscript(draft.id)}
                        disabled={app.busy || !draft.jobId}
                        style={styles.primary}
                        testID="recover-transcript"
                      >
                        <Text style={styles.primaryText}>
                          保存済みの文字起こしを復旧
                        </Text>
                      </ActionButton>
                    )}
                </>
              )}
              {draft.status === "needs_audio_review" && (
                <ActionButton
                  label="閉じる"
                  onPress={close}
                  style={styles.primary}
                >
                  <Text style={styles.primaryText}>閉じる</Text>
                </ActionButton>
              )}
            </View>
          )}
          {overlay?.kind === "source" && songSource && (
            <SongSourceContent
              clips={sourceClips}
              utterances={sourceUtterances}
              songPosition={app.position}
              sourcePlaying={app.sourcePlaying}
              activeClipId={activeSourceClipId}
              busy={app.busy}
              onPlay={(clipId, startMs, endMs) => {
                setActiveSourceClipId(clipId);
                void app.playSource(clipId, startMs, endMs);
              }}
              onStop={() => {
                setActiveSourceClipId(null);
                void app.closeSource();
              }}
            />
          )}
          {overlay?.kind === "source" && !songSource && (
            <View testID="memory-sheet">
              <ScrollView style={{ maxHeight: 270 }}>
                {sourceClips.map((clip) => {
                  const lines = sourceUtterances.filter(
                    (value) => value.clipId === clip.id,
                  );
                  const context = sourceContext(clip, lines[0]?.startMs ?? 0);
                  return (
                    <View key={clip.id} style={{ marginBottom: 16 }}>
                      <Text style={styles.summary}>
                        {context.date} {context.time} · {context.place}
                      </Text>
                      {overlay.block && (
                        <ActionButton
                          label="全文を確認"
                          onPress={() =>
                            show({
                              kind: "source",
                              document: overlay.document,
                              clip,
                              draftId: overlay.draftId,
                            })
                          }
                          style={styles.clipRow}
                        >
                          <Text style={styles.clipContext}>
                            この録音の全文を確認
                          </Text>
                        </ActionButton>
                      )}
                    </View>
                  );
                })}
                <TranscriptTimingNotice
                  issues={sourceUtterances.flatMap(
                    (utterance) => utterance.timingIssues ?? [],
                  )}
                />
                {sourceUtterances.length ? (
                  sourceUtterances.map((utterance) => (
                    <View
                      key={utterance.id}
                      style={{
                        flexDirection: "row",
                        gap: 16,
                        marginBottom: 18,
                      }}
                    >
                      <Text
                        style={{ width: 50, color: colors.muted, fontSize: 12 }}
                      >
                        {speakerLabel(utterance)}
                      </Text>
                      <Text
                        style={[styles.story, { flex: 1, marginBottom: 0 }]}
                      >
                        「{utterance.text}」
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.story}>
                    文字起こしは、仕上げるときに行います。
                  </Text>
                )}
              </ScrollView>
              {overlay.clip && overlay.draftId && draft?.status === "local" && (
                <>
                  <ActionButton
                    label={placeEditing ? "場所の編集を閉じる" : "場所を編集"}
                    onPress={() => setPlaceEditing((value) => !value)}
                    style={styles.clipRow}
                    testID="edit-recording-place"
                  >
                    <Feather name="map-pin" size={17} color={colors.ink} />
                    <Text style={styles.clipContext}>
                      {placeEditing ? "編集を閉じる" : "場所を編集"}
                    </Text>
                  </ActionButton>
                  {placeEditing && (
                    <>
                      <Text style={styles.fieldLabel}>場所（任意）</Text>
                      <Text style={styles.summary}>
                        空欄で保存すると自動表示に戻ります。
                      </Text>
                      <TextInput
                        value={place}
                        onChangeText={setPlace}
                        placeholder={
                          sourceContext({ ...overlay.clip, place: null }).place
                        }
                        accessibilityLabel="録音の場所"
                        style={styles.input}
                        testID="recording-place-input"
                      />
                      <ActionButton
                        label="場所を保存"
                        onPress={() => {
                          const { draftId, clip } = overlay;
                          if (!draftId || !clip) return;
                          void app
                            .setPlace(draftId, clip.id, place)
                            .then(() => close());
                        }}
                        disabled={app.busy}
                        style={styles.clipRow}
                        testID="save-recording-place"
                      >
                        <Text style={styles.clipContext}>場所を保存</Text>
                      </ActionButton>
                    </>
                  )}
                </>
              )}
              {sourceClips.map((clip) => {
                const lines = sourceUtterances.filter(
                  (value) => value.clipId === clip.id,
                );
                const { startMs, endMs } = sourcePlaybackRange(
                  clip,
                  lines,
                  Boolean(overlay.clip),
                );
                return (
                  <ActionButton
                    key={clip.id}
                    label={overlay.clip ? "録音全体を聴く" : "元の会話を聴く"}
                    onPress={() => {
                      void app.playSource(
                        clip.id,
                        startMs,
                        endMs,
                        overlay.draftId,
                      );
                    }}
                    disabled={app.busy}
                    style={styles.primary}
                    testID="listen-memory"
                  >
                    <Feather name="play" size={19} color={colors.paper} />
                    <Text style={styles.primaryText}>元の会話を聴く</Text>
                    <Text style={styles.buttonNote}>
                      {overlay.clip
                        ? "最初から最後まで"
                        : `${formatTime(startMs / 1000)}から`}
                    </Text>
                  </ActionButton>
                );
              })}
              {app.sourcePlaying && (
                <ActionButton
                  label="会話の再生を止める"
                  onPress={() => {
                    void app.closeSource();
                  }}
                  style={styles.clipRow}
                >
                  <Text style={styles.clipContext}>再生を止める</Text>
                </ActionButton>
              )}
              {overlay.draftId && (
                <ActionButton
                  label="記録の確認に戻る"
                  onPress={() => {
                    void app.closeSource();
                    const current = app.state.drafts.find(
                      (value) => value.id === overlay.draftId,
                    );
                    if (current)
                      show({
                        kind:
                          current.status === "needs_audio_review"
                            ? "progress"
                            : current.lyrics
                              ? "review"
                              : "finish",
                        draftId: current.id,
                      });
                  }}
                  style={styles.clipRow}
                >
                  <Feather name="chevron-left" size={18} color={colors.ink} />
                  <Text style={styles.clipContext}>確認に戻る</Text>
                </ActionButton>
              )}
            </View>
          )}
        </NativeSheet>
      </SessionContext.Provider>
    </SafeAreaProvider>
  );
}

const extra = StyleSheet.create({
  loading: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
  },
  error: {
    position: "absolute",
    bottom: 30,
    left: 16,
    right: 16,
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#fff4e9",
  },
  errorCopy: {
    color: "#8a3e26",
    fontSize: 13,
    lineHeight: 22,
    marginBottom: 18,
  },
  accountContent: { gap: 8 },
  accountFieldLabel: {
    color: figmaColors.secondary,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
    marginTop: 4,
  },
  accountSummary: {
    color: figmaColors.primary,
    fontSize: 14,
    lineHeight: 22,
  },
  accountPrimary: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.control,
    backgroundColor: figmaColors.rose,
    paddingHorizontal: 16,
    marginTop: 12,
  },
  accountPrimaryText: {
    color: figmaColors.onRose,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
  },
  accountSecondary: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.control,
    backgroundColor: figmaColors.surface,
    paddingHorizontal: 16,
  },
  accountSecondaryText: {
    color: figmaColors.primary,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
  },
  accountDeleteText: {
    color: figmaColors.rose,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
  },
  accountErrorCopy: {
    color: figmaColors.rose,
    fontSize: 13,
    lineHeight: 22,
    marginBottom: 18,
  },
});

const styles = StyleSheet.create({
  story: { color: colors.ink, fontSize: 15, lineHeight: 26, marginBottom: 24 },
  sectionHeading: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
    marginBottom: 16,
  },
  connection: {
    marginTop: 28,
    paddingTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  lyric: { color: colors.ink, fontSize: 18, lineHeight: 29, fontWeight: "600" },
  primary: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    borderRadius: radii.control,
    backgroundColor: colors.ink,
    paddingHorizontal: 16,
    marginTop: 28,
  },
  secondary: {
    minHeight: 52,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 16,
  },
  secondaryText: { color: colors.ink, fontSize: 15 },
  primaryText: {
    color: colors.paper,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
  },
  buttonNote: { color: colors.paper, fontSize: 12 },
  summary: { color: colors.muted, fontSize: 13, lineHeight: 22 },
  fieldLabel: {
    color: colors.ink,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
    marginTop: 24,
    marginBottom: 10,
  },
  input: {
    minHeight: 52,
    borderRadius: 0,
    borderBottomWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#fff",
    color: colors.ink,
    fontSize: 16,
  },
  clipRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  clipContext: { flex: 1, color: colors.ink, fontSize: 13, lineHeight: 20 },
  share: { alignItems: "center" },
  shareArtwork: { width: 160, height: 160, borderRadius: 16 },
  shareTitle: {
    color: colors.ink,
    fontSize: 22,
    lineHeight: 30,
    fontWeight: "700",
    marginTop: 20,
    marginBottom: 8,
  },
});
