import { Feather } from "@expo/vector-icons";
import {
  createNavigationContainerRef,
  DefaultTheme,
  NavigationContainer,
  StackActions,
  useFocusEffect,
} from "@react-navigation/native";
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { createContext, useCallback, useContext, useState } from "react";
import {
  Image,
  Keyboard,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ActionButton, useReducedMotion } from "./src/components/ActionButton";
import { Conversation } from "./src/components/Conversation";
import { NativeSheet } from "./src/components/NativeSheet";
import { displayDate, formatTime, savedSeconds } from "./src/domain/session";
import type { Clip, Draft, Memory, Song } from "./src/domain/types";
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
  | { kind: "memory"; memory: Memory }
  | { kind: "clip"; clip: Clip }
  | { kind: "finish"; draft: Draft }
  | { kind: "share"; song: Song };
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
const artwork = require("./assets/kyoto-artwork.png");

function useController() {
  const controller = useContext(SessionContext);
  if (!controller) throw new Error("SessionContext is required");
  return controller;
}

function LibraryRoute({
  navigation,
}: NativeStackScreenProps<Routes, "Library">) {
  const app = useController();
  return (
    <LibraryScreen
      songs={app.state.songs}
      drafts={app.state.drafts}
      onNewRecording={() =>
        navigation.navigate("Recording", { draftId: app.newRecording() })
      }
      onOpenDraft={(draft) => {
        app.pause();
        navigation.navigate("Recording", { draftId: draft.id });
      }}
      onOpenSong={(song) => {
        app.openSong(song.id);
        navigation.navigate("Music", { songId: song.id });
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
  const { leave } = app;
  useFocusEffect(
    useCallback(
      () => () => {
        leave(draftId);
      },
      [draftId, leave],
    ),
  );
  const draft = app.state.drafts.find((item) => item.id === draftId);
  if (!draft) return null;
  return (
    <RecordingScreen
      draft={draft}
      recording={app.state.recorder?.draftId === draftId}
      liveSeconds={
        app.state.recorder?.draftId === draftId ? app.liveSeconds : 0
      }
      onToggle={() => app.toggleRecording(draftId)}
      onBack={() => {
        app.leave(draftId);
        navigation.goBack();
      }}
      onFinish={() => {
        const next = app.stop();
        const saved = next.drafts.find((item) => item.id === draftId);
        if (saved?.clips.length) app.show({ kind: "finish", draft: saved });
      }}
      onClip={(clip) => app.show({ kind: "clip", clip })}
    />
  );
}

function MusicRoute({
  route,
  navigation,
}: NativeStackScreenProps<Routes, "Music">) {
  const app = useController();
  const { pause } = app;
  useFocusEffect(useCallback(() => () => pause(), [pause]));
  const song = app.state.songs.find((item) => item.id === route.params.songId);
  if (!song) return null;
  return (
    <MusicScreen
      song={song}
      playing={app.playing}
      position={app.position}
      onBack={() => {
        app.pause();
        navigation.goBack();
      }}
      onToggle={app.togglePlayback}
      onSeek={app.seek}
      onScrub={app.setScrubbing}
      onMemory={(memory) => app.show({ kind: "memory", memory })}
      onShare={() => app.show({ kind: "share", song })}
    />
  );
}

export default function App() {
  const app = useSession();
  const reducedMotion = useReducedMotion();
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [finishTitle, setFinishTitle] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const close = () => {
    Keyboard.dismiss();
    setSheetOpen(false);
  };
  const show = (next: Overlay) => {
    Keyboard.dismiss();
    if (next.kind === "finish") setFinishTitle(next.draft.title);
    setShareStatus("");
    setOverlay(next);
    setSheetOpen(true);
  };
  const finish = () => {
    if (overlay?.kind !== "finish" || !finishTitle.trim()) return;
    const next = app.perform({
      type: "finish",
      id: overlay.draft.id,
      title: finishTitle,
      now: Date.now(),
    });
    const song = next.songs.find(
      (item) => item.id === `song-${overlay.draft.id}`,
    );
    if (!song || !sheetOpen) return;
    close();
    app.openSong(song.id);
    navigationRef.dispatch(StackActions.replace("Music", { songId: song.id }));
  };
  const share = async () => {
    if (overlay?.kind !== "share") return;
    try {
      await Share.share({
        title: overlay.song.title,
        message: `${overlay.song.title}\n${overlay.song.trackTitle}\n${overlay.song.date}`,
      });
    } catch {
      setShareStatus("共有を開けませんでした。もう一度お試しください。");
    }
  };
  const title =
    overlay?.kind === "memory"
      ? overlay.memory.place
      : overlay?.kind === "clip"
        ? overlay.clip.place
        : overlay?.kind === "share"
          ? "この旅を届ける"
          : "思い出を一曲に";
  const description =
    overlay?.kind === "memory"
      ? `${displayDate(overlay.memory.date)} ${overlay.memory.time}`
      : overlay?.kind === "clip"
        ? `${displayDate(overlay.clip.date)} ${overlay.clip.time} · ${formatTime(overlay.clip.seconds)}`
        : overlay?.kind === "share"
          ? overlay.song.date
          : "残した会話を確かめて、名前を付けよう。";

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
        <NativeSheet
          open={sheetOpen}
          onClose={close}
          title={title}
          description={description}
          snap={overlay?.kind === "memory" ? 0.76 : 0.66}
        >
          {overlay?.kind === "memory" && (
            <View testID="memory-sheet">
              <Text style={styles.story}>{overlay.memory.story}</Text>
              <Text style={styles.sectionHeading}>あのときの会話</Text>
              <Conversation memory={overlay.memory} />
              <View style={styles.connection}>
                <Text style={styles.sectionHeading}>ここから生まれた歌詞</Text>
                {overlay.memory.lyrics.map((line) => (
                  <Text key={line} style={styles.lyric}>
                    {line}
                  </Text>
                ))}
              </View>
              <ActionButton
                label="この場面を聴く"
                testID="listen-memory"
                style={styles.primary}
                onPress={() => {
                  if (overlay.kind === "memory") {
                    app.seek(overlay.memory.startsAt);
                    app.setPlaying(true);
                    close();
                  }
                }}
              >
                <Feather name="play" size={19} color="#fff8f0" />
                <Text style={styles.primaryText}>この場面を聴く</Text>
                <Text style={styles.buttonNote}>
                  {formatTime(overlay.memory.startsAt)}から
                </Text>
              </ActionButton>
            </View>
          )}
          {overlay?.kind === "clip" && (
            <View testID="clip-sheet">
              <Text style={styles.sectionHeading}>残した会話</Text>
              <Conversation memory={overlay.clip.memory} />
            </View>
          )}
          {overlay?.kind === "finish" && (
            <View testID="finish-sheet">
              <Text style={styles.summary}>
                {overlay.draft.clips.length}件の会話 ·{" "}
                {formatTime(savedSeconds(overlay.draft))}
              </Text>
              <Text style={styles.fieldLabel}>思い出の名前</Text>
              <TextInput
                style={styles.input}
                accessibilityLabel="思い出の名前"
                testID="finish-title"
                value={finishTitle}
                onChangeText={setFinishTitle}
                maxLength={40}
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
              />
              <View style={styles.finishClips}>
                {overlay.draft.clips.map((clip) => (
                  <View key={clip.id} style={styles.clipRow}>
                    <Feather name="message-circle" size={18} color="#493020" />
                    <Text style={styles.clipContext}>
                      {displayDate(clip.date).slice(5)} {clip.time} ·{" "}
                      {clip.place}
                    </Text>
                    <Text style={styles.clipDuration}>
                      {formatTime(clip.seconds)}
                    </Text>
                  </View>
                ))}
              </View>
              <ActionButton
                label="曲に仕上げる"
                testID="create-song"
                disabled={!finishTitle.trim()}
                style={styles.primary}
                onPress={finish}
              >
                <Text style={styles.primaryText}>曲に仕上げる</Text>
                <Feather name="chevron-right" size={20} color="#fff8f0" />
              </ActionButton>
            </View>
          )}
          {overlay?.kind === "share" && (
            <View style={styles.share} testID="share-sheet">
              <Image source={artwork} style={styles.shareArtwork} />
              <Text style={styles.shareTitle}>{overlay.song.trackTitle}</Text>
              <Text style={styles.summary}>{overlay.song.title}</Text>
              <ActionButton
                label="曲の情報を共有"
                style={styles.primary}
                onPress={share}
              >
                <Feather name="share" size={20} color="#fff8f0" />
                <Text style={styles.primaryText}>曲の情報を共有</Text>
              </ActionButton>
              {!!shareStatus && (
                <Text accessibilityLiveRegion="polite" style={styles.summary}>
                  {shareStatus}
                </Text>
              )}
            </View>
          )}
        </NativeSheet>
      </SessionContext.Provider>
    </SafeAreaProvider>
  );
}

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
