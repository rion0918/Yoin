import { Feather } from "@expo/vector-icons";
import {
  createNavigationContainerRef,
  DefaultTheme,
  NavigationContainer,
  StackActions,
  useFocusEffect,
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
  Keyboard,
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
  LyricBlock,
  SongDocument,
  Utterance,
} from "./shared/contracts";
import { ActionButton, useReducedMotion } from "./src/components/ActionButton";
import { NativeSheet } from "./src/components/NativeSheet";
import { SpeakerEnrollmentSheet } from "./src/components/SpeakerEnrollmentSheet";
import { formatTime } from "./src/domain/session";
import { blockContext, sourceContext } from "./src/pipeline/library";
import { explainError } from "./src/pipeline/messages";
import { hasRegisteredSpeaker, speakerLabel } from "./src/pipeline/speakers";
import { LibraryScreen } from "./src/screens/LibraryScreen";
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
  uploading: "音声を送信中",
  preparing: "歌詞を準備中",
  waiting_review: "歌詞を確かめよう",
  generating: "曲を作っています",
  ready: "曲ができました",
  failed: "処理を続けられませんでした",
  needs_reconciliation: "受付状況の確認が必要です",
};

function LibraryRoute({
  navigation,
}: NativeStackScreenProps<Routes, "Library">) {
  const app = useController();
  return (
    <LibraryScreen
      songs={app.state.songs}
      drafts={app.state.drafts}
      onSettings={() => app.show({ kind: "settings" })}
      onSpeakerSettings={() => app.show({ kind: "speakers" })}
      onNewRecording={() => {
        if (!hasRegisteredSpeaker(app.state)) {
          app.show({
            kind:
              app.connection.apiUrl && app.connection.token
                ? "speakers"
                : "settings",
          });
          return;
        }
        void app.newRecording().then((draftId) => {
          if (draftId) navigation.navigate("Recording", { draftId });
        });
      }}
      onOpenDraft={(draft) => {
        void app.pause();
        navigation.navigate("Recording", { draftId: draft.id });
      }}
      onOpenSong={(song) => {
        void app
          .openSong(song)
          .then(() => navigation.navigate("Music", { songId: song.id }));
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
  const saving =
    app.busy ||
    (app.state.pendingRecording?.purpose !== "speaker" &&
      app.state.pendingRecording?.draftId === draftId) ||
    ["preparing", "saving"].includes(app.recorder.recorderState);
  usePreventRemove(saving, ({ data }) => {
    if (exiting.current || app.busy) return;
    exiting.current = true;
    void app
      .leave(draftId)
      .then((saved) => {
        if (saved) navigation.dispatch(data.action);
      })
      .finally(() => {
        exiting.current = false;
      });
  });
  if (!draft) return null;
  return (
    <RecordingScreen
      draft={draft}
      recording={recording}
      busy={
        app.busy || ["preparing", "saving"].includes(app.recorder.recorderState)
      }
      liveSeconds={recording ? app.recorder.elapsedMs / 1000 : 0}
      stateLabel={
        recording
          ? "録音中"
          : app.recorder.recorderState === "saving"
            ? "音声を保存中"
            : draft.status === "local"
              ? undefined
              : statusLabel[draft.status]
      }
      onToggle={() => {
        void app.toggleRecording(draftId);
      }}
      onImport={() => {
        void app.importClip(draftId);
      }}
      onBack={() => {
        void app.leave(draftId).then((left) => {
          if (left) navigation.goBack();
        });
      }}
      onFinish={() => {
        void app.finishRecording(draftId).then((saved) => {
          if (saved?.clips.length)
            app.show({
              kind:
                saved.status === "waiting_review" ||
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
  const pause = useRef(app.pause);
  pause.current = app.pause;
  useFocusEffect(
    useCallback(
      () => () => {
        void pause.current();
      },
      [],
    ),
  );
  const song = app.state.songs.find(
    (value) => value.id === route.params.songId,
  );
  if (!song) return null;
  return (
    <MusicScreen
      song={song}
      playing={app.playing}
      position={app.position}
      onBack={() => {
        void app.pause();
        navigation.goBack();
      }}
      onToggle={() => {
        void app.togglePlayback();
      }}
      onSeek={(seconds) => {
        void app.seek(seconds);
      }}
      onScrub={(scrubbing) => {
        if (scrubbing) void app.pause();
      }}
      onMemory={(block) => app.show({ kind: "source", document: song, block })}
    />
  );
}

export default function App() {
  const app = useSession();
  const reducedMotion = useReducedMotion();
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [finishTitle, setFinishTitle] = useState("");
  const [place, setPlace] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [token, setToken] = useState("");
  const [editedBlocks, setEditedBlocks] = useState<LyricBlock[]>([]);
  const close = () => {
    Keyboard.dismiss();
    void app.closeSource();
    setSheetOpen(false);
  };
  const show = useCallback(
    (next: Overlay) => {
      Keyboard.dismiss();
      app.clearError();
      if (next.kind === "finish")
        setFinishTitle(
          app.state.drafts.find((draft) => draft.id === next.draftId)?.title ??
            "",
        );
      if (next.kind === "review")
        setEditedBlocks(
          app.state.drafts.find((draft) => draft.id === next.draftId)?.lyrics
            ?.blocks ?? [],
        );
      if (next.kind === "source") setPlace(next.clip?.place ?? "");
      if (next.kind === "settings") {
        setApiUrl(app.connection.apiUrl);
        setToken(app.connection.token);
      }
      setOverlay(next);
      setSheetOpen(true);
    },
    [
      app.clearError,
      app.connection.apiUrl,
      app.connection.token,
      app.state.drafts,
    ],
  );
  const draft =
    overlay && "draftId" in overlay
      ? app.state.drafts.find((value) => value.id === overlay.draftId)
      : undefined;
  const firstRunGuidanceShown = useRef(false);
  const speakerRegistered = hasRegisteredSpeaker(app.state);
  const hasConnection = Boolean(app.connection.apiUrl && app.connection.token);
  useEffect(() => {
    if (!app.ready || firstRunGuidanceShown.current) return;
    if (speakerRegistered) {
      firstRunGuidanceShown.current = true;
      return;
    }
    firstRunGuidanceShown.current = true;
    show({
      kind: hasConnection ? "speakers" : "settings",
    });
  }, [app.ready, speakerRegistered, hasConnection, show]);
  const overlayKind =
    overlay?.kind === "progress" && draft?.status === "waiting_review"
      ? "review"
      : overlay?.kind;
  useEffect(() => {
    if (overlay?.kind === "progress" && draft?.status === "waiting_review") {
      setEditedBlocks(draft.lyrics?.blocks ?? []);
      setOverlay({ kind: "review", draftId: draft.id });
    }
  }, [overlay?.kind, draft?.id, draft?.status, draft?.lyrics]);
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
    if (await app.prepare(draft.id, finishTitle))
      setOverlay({ kind: "progress", draftId: draft.id });
  };
  const generate = async () => {
    if (!draft) return;
    if (await app.generate(draft.id, editedBlocks))
      setOverlay({ kind: "progress", draftId: draft.id });
  };
  const title =
    overlayKind === "settings"
      ? "接続設定"
      : overlayKind === "speakers"
        ? "話者の声を登録"
        : overlayKind === "source"
          ? "あのときの会話"
          : overlayKind === "review"
            ? "この歌詞で、残そう。"
            : overlayKind === "progress"
              ? statusLabel[draft?.status ?? "preparing"]
              : "思い出を一曲に";
  const description =
    overlayKind === "settings"
      ? "検証用の接続先とトークンを設定します。"
      : overlayKind === "speakers"
        ? "名前と声を登録すると、次の会話から発話者を名前で表示します。"
        : overlayKind === "review"
          ? "会話を確かめながら、言葉を整えられます。"
          : overlayKind === "source"
            ? "歌詞の元になった音声を聴き返せます。"
            : overlayKind === "progress"
              ? "この画面を閉じても、記録は残ります。"
              : "残した音声を確かめて、名前を付けよう。";
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
      <StatusBar style="dark" />
      <SessionContext.Provider value={{ ...app, show }}>
        <NavigationContainer ref={navigationRef} theme={navigationTheme}>
          <Stack.Navigator
            screenOptions={{
              headerShown: false,
              animation: reducedMotion ? "none" : "slide_from_right",
              contentStyle: { backgroundColor: "#fff" },
            }}
          >
            <Stack.Screen name="Library" component={LibraryRoute} />
            <Stack.Screen name="Recording" component={RecordingRoute} />
            <Stack.Screen name="Music" component={MusicRoute} />
          </Stack.Navigator>
        </NavigationContainer>
        {!app.ready && (
          <View style={extra.loading}>
            <ActivityIndicator color="#493020" />
            <Text style={styles.summary}>
              {app.error || "思い出を読み込んでいます"}
            </Text>
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
          snap={
            overlayKind === "review" || overlayKind === "source" ? 0.84 : 0.72
          }
        >
          {!!app.error && (
            <Text accessibilityLiveRegion="polite" style={extra.errorCopy}>
              {app.error}
            </Text>
          )}
          {!!draft?.error && (
            <Text accessibilityLiveRegion="polite" style={extra.errorCopy}>
              {explainError(draft.error)}
            </Text>
          )}
          {overlayKind === "settings" && (
            <View testID="connection-sheet">
              <Text style={styles.fieldLabel}>接続先URL</Text>
              <TextInput
                value={apiUrl}
                onChangeText={setApiUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                accessibilityLabel="接続先URL"
                style={styles.input}
                testID="api-url"
              />
              <Text style={styles.fieldLabel}>検証用トークン</Text>
              <TextInput
                value={token}
                onChangeText={setToken}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="検証用トークン"
                style={styles.input}
                testID="tester-token"
              />
              <ActionButton
                label="接続を保存"
                onPress={() => {
                  void app.configure({ apiUrl, token }).then((success) => {
                    if (success) {
                      if (hasRegisteredSpeaker(app.state)) close();
                      else show({ kind: "speakers" });
                    }
                  });
                }}
                disabled={app.busy}
                style={styles.primary}
                testID="save-connection"
              >
                <Text style={styles.primaryText}>接続を保存</Text>
              </ActionButton>
            </View>
          )}
          {overlayKind === "finish" && draft && (
            <View testID="finish-sheet">
              <Text style={styles.summary}>
                {draft.clips.length}件の音声 ·{" "}
                {formatTime(
                  draft.clips.reduce(
                    (sum, clip) => sum + clip.durationMs / 1000,
                    0,
                  ),
                )}
              </Text>
              <Text style={styles.fieldLabel}>思い出の名前</Text>
              <TextInput
                value={finishTitle}
                onChangeText={setFinishTitle}
                editable={draft.status === "local"}
                maxLength={40}
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
                accessibilityLabel="思い出の名前"
                style={styles.input}
                testID="finish-title"
              />
              <View style={styles.finishClips}>
                {draft.clips.map((clip) => {
                  const context = sourceContext(clip);
                  return (
                    <ActionButton
                      key={clip.id}
                      label={`${context.place}の音声を確認`}
                      onPress={() =>
                        show({
                          kind: "source",
                          document: draft,
                          clip,
                          draftId: draft.id,
                        })
                      }
                      style={styles.clipRow}
                    >
                      <Feather
                        name="message-circle"
                        size={18}
                        color="#493020"
                      />
                      <Text style={styles.clipContext}>
                        {context.date} {context.time} · {context.place}
                      </Text>
                      <Text style={styles.clipDuration}>
                        {formatTime(clip.durationMs / 1000)}
                      </Text>
                    </ActionButton>
                  );
                })}
              </View>
              <ActionButton
                label="歌詞を準備する"
                onPress={() => {
                  void prepare();
                }}
                disabled={app.busy || !finishTitle.trim()}
                style={styles.primary}
                testID="prepare-lyrics"
              >
                <Text style={styles.primaryText}>
                  {app.busy ? "音声を送信中" : "歌詞を準備する"}
                </Text>
                <Feather name="chevron-right" size={20} color="#fff8f0" />
              </ActionButton>
            </View>
          )}
          {overlayKind === "review" && draft && (
            <View testID="lyrics-review">
              <ScrollView
                keyboardShouldPersistTaps="handled"
                style={{ maxHeight: 350 }}
              >
                {editedBlocks.map((block) => {
                  const context = blockContext(draft, block);
                  return (
                    <View key={block.id} style={{ marginBottom: 24 }}>
                      <TextInput
                        value={block.text}
                        onChangeText={(text) => {
                          setEditedBlocks((blocks) =>
                            blocks.map((value) =>
                              value.id === block.id
                                ? { ...value, text }
                                : value,
                            ),
                          );
                          void app.editLyrics(draft.id, block.id, text);
                        }}
                        multiline
                        accessibilityLabel="歌詞を編集"
                        style={[
                          styles.input,
                          {
                            minHeight: 100,
                            lineHeight: 28,
                            textAlignVertical: "top",
                          },
                        ]}
                        testID={`lyric-editor-${block.id}`}
                      />
                      <ActionButton
                        label="元の会話を確認"
                        onPress={() =>
                          show({
                            kind: "source",
                            document: draft,
                            block,
                            draftId: draft.id,
                          })
                        }
                        style={styles.clipRow}
                      >
                        <Feather
                          name="message-circle"
                          size={20}
                          color="#493020"
                        />
                        <Text style={styles.clipContext}>
                          {context.date} {context.time} · {context.place}
                        </Text>
                      </ActionButton>
                    </View>
                  );
                })}
              </ScrollView>
              <ActionButton
                label="この歌詞で曲を作る"
                onPress={() => {
                  void generate();
                }}
                disabled={
                  app.busy ||
                  !editedBlocks.length ||
                  editedBlocks.some((block) => !block.text.trim())
                }
                style={styles.primary}
                testID="create-song"
              >
                <Text style={styles.primaryText}>この歌詞で曲を作る</Text>
              </ActionButton>
            </View>
          )}
          {overlayKind === "progress" && draft && (
            <View testID="generation-progress">
              <Text style={styles.story}>
                {draft.status === "needs_reconciliation"
                  ? "生成が受け付けられたか確認できないため、自動では作り直しません。接続を確認してから、実行履歴を確認してください。"
                  : draft.status === "failed"
                    ? "音声と歌詞は残っています。ホームからこの記録を開き、もう一度仕上げられます。"
                    : "思い出の言葉を、一曲にしています。完成したらライブラリに残ります。"}
              </Text>
              {["preparing", "generating", "uploading"].includes(
                draft.status,
              ) && <ActivityIndicator color="#493020" />}
              <ActionButton
                label="閉じる"
                onPress={close}
                style={styles.primary}
              >
                <Text style={styles.primaryText}>閉じる</Text>
              </ActionButton>
            </View>
          )}
          {overlay?.kind === "source" && (
            <View testID="memory-sheet">
              <ScrollView style={{ maxHeight: 270 }}>
                {sourceClips.map((clip) => {
                  const lines = sourceUtterances.filter(
                    (value) => value.clipId === clip.id,
                  );
                  const context = sourceContext(clip, lines[0]?.startMs ?? 0);
                  return (
                    <Text
                      key={clip.id}
                      style={[styles.summary, { marginBottom: 16 }]}
                    >
                      {context.date} {context.time} · {context.place}
                    </Text>
                  );
                })}
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
                        style={{ width: 50, color: "#6f5d4e", fontSize: 12 }}
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
              {overlay.clip &&
                overlay.draftId &&
                app.state.drafts.find((value) => value.id === overlay.draftId)
                  ?.status === "local" && (
                  <>
                    <Text style={styles.fieldLabel}>
                      この録音の場所（任意）
                    </Text>
                    <TextInput
                      value={place}
                      onChangeText={setPlace}
                      placeholder="場所不明"
                      accessibilityLabel="録音の場所"
                      style={styles.input}
                    />
                    <ActionButton
                      label="場所を保存"
                      onPress={() => {
                        if (overlay.clip && overlay.draftId)
                          void app
                            .setPlace(overlay.draftId, overlay.clip.id, place)
                            .then(() => close());
                      }}
                      disabled={app.busy}
                      style={styles.clipRow}
                    >
                      <Text style={styles.clipContext}>場所を保存</Text>
                    </ActionButton>
                  </>
                )}
              {sourceClips.map((clip) => {
                const lines = sourceUtterances.filter(
                  (value) => value.clipId === clip.id,
                );
                const start = lines.length
                  ? Math.min(...lines.map((value) => value.startMs))
                  : 0;
                const end = lines.length
                  ? Math.max(...lines.map((value) => value.endMs))
                  : clip.durationMs;
                return (
                  <ActionButton
                    key={clip.id}
                    label="元の会話を聴く"
                    onPress={() => {
                      void app.playSource(clip.id, start, end, overlay.draftId);
                    }}
                    disabled={app.busy}
                    style={styles.primary}
                    testID="listen-memory"
                  >
                    <Feather name="play" size={19} color="#fff8f0" />
                    <Text style={styles.primaryText}>元の会話を聴く</Text>
                    <Text style={styles.buttonNote}>
                      {formatTime(start / 1000)}から
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
                        kind: current.lyrics ? "review" : "finish",
                        draftId: current.id,
                      });
                  }}
                  style={styles.clipRow}
                >
                  <Feather name="chevron-left" size={18} color="#493020" />
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
});

const styles = StyleSheet.create({
  story: { color: "#493020", fontSize: 15, lineHeight: 26, marginBottom: 24 },
  sectionHeading: {
    color: "#6f5d4e",
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
    marginBottom: 16,
  },
  connection: {
    marginTop: 28,
    paddingTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#ddcfc1",
  },
  lyric: { color: "#332317", fontSize: 18, lineHeight: 29, fontWeight: "600" },
  primary: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    borderRadius: 16,
    backgroundColor: "#493020",
    paddingHorizontal: 16,
    marginTop: 28,
  },
  primaryText: {
    color: "#fff8f0",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
  },
  buttonNote: { color: "#f0ded0", fontSize: 12 },
  summary: { color: "#544033", fontSize: 13, lineHeight: 22 },
  fieldLabel: {
    color: "#493020",
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
    marginTop: 24,
    marginBottom: 10,
  },
  input: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#cdb7a5",
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#fff",
    color: "#332317",
    fontSize: 16,
  },
  finishClips: { gap: 16, marginTop: 26 },
  clipRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  clipContext: { flex: 1, color: "#493020", fontSize: 13, lineHeight: 20 },
  clipDuration: {
    color: "#544033",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  share: { alignItems: "center" },
  shareArtwork: { width: 160, height: 160, borderRadius: 16 },
  shareTitle: {
    color: "#332317",
    fontSize: 22,
    lineHeight: 30,
    fontWeight: "700",
    marginTop: 20,
    marginBottom: 8,
  },
});
