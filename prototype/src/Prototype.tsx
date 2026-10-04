import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties } from "react";
import { ChatBubbleIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, Cross2Icon, Link2Icon, PauseIcon, PlayIcon, PlusIcon, Share1Icon } from "@radix-ui/react-icons";
import { Mic, MicOff } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { BottomSheet, FlowStack, KeyboardInput, MobileScroll, useFlow, useKeyboard, useMobileDevice, type FlowControls, type FlowScreen } from "./mobile";

const artwork = "/assets/yoin/kyoto-artwork.png";
const duration = 204;
const memories = [
  {
    id: "kiyomizuzaka", time: "17:23", place: "清水坂",
    lyrics: ["閉店まであと5分", "また三人で坂道を走った"],
    startsAt: 42,
    story: "清水寺の閉門まで、あと少し。三人で笑いながら、坂道を駆け上がった。",
    conversation: [
      { person: "アオイ", words: "あと5分らしいぞ！" },
      { person: "レオン", words: "マジ？ 走れ走れ！" },
      { person: "ユウ", words: "もう歩けないって言ったばっかりやん！" },
    ],
  },
  {
    id: "kamogawa", time: "18:40", place: "鴨川",
    lyrics: ["次の季節も、この場所で"],
    startsAt: 108,
    story: "歩き疲れて、川辺でひと休み。夕暮れの京都を見ながら、次の旅の約束をした。",
    conversation: [
      { person: "レオン", words: "また三人で来よう。" },
      { person: "アオイ", words: "次は桜の季節がいいね。" },
      { person: "ユウ", words: "今度は、もう少しゆっくり歩こう。" },
    ],
  },
];

function formatTime(seconds: number) {
  const value = Math.floor(seconds);
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

type PlayerProps = {
  playing: boolean; position: number; onToggle: () => void;
  onSeek: (value: number) => void; onScrub: (value: boolean) => void;
  inSheet?: boolean; bottomInset?: number;
};

function MiniPlayer({ playing, position, onToggle, onSeek, onScrub, inSheet, bottomInset = 0 }: PlayerProps) {
  return (
    <section className={`yoin-player${inSheet ? " yoin-player-in-sheet" : ""}`} aria-label="曲の再生" style={inSheet ? undefined : { bottom: bottomInset + 26 }}>
      <img src={artwork} alt="" draggable={false} className="player-artwork" />
      <div className="player-information">
        <p className="player-title">あと5分の坂道</p>
        <span className="player-time" data-testid="playback-time">{formatTime(position)} / 3:24</span>
        <div className="scrubber-track" style={{ "--progress": `${position / duration * 100}%` } as CSSProperties}>
          <span className="scrubber-progress" />
          <input className="player-scrubber" aria-label="曲の再生位置" aria-valuetext={`${formatTime(position)}、全体3分24秒`} type="range" min={0} max={duration} step={1} value={Math.floor(position)}
            onChange={(event) => onSeek(Number(event.target.value))}
            onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); onScrub(true); }}
            onPointerUp={() => onScrub(false)} onPointerCancel={() => onScrub(false)} />
        </div>
      </div>
      <button className="player-toggle" aria-label={playing ? "一時停止" : "曲を再生"} onClick={onToggle}>
        {playing ? <PauseIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" />}
      </button>
    </section>
  );
}

type Memory = typeof memories[number] & { date?: string };
type Clip = { id: string; seconds: number; date: string; time: string; place: string; memory: Memory };
type Draft = { id: string; title: string; date: string; clips: Clip[] };
type Song = { id: string; title: string; date: string; contextDate: string; memories: Memory[] };
type SheetKind = "memory" | "share" | "finish" | "clip";
const originalSong: Song = { id: "kyoto", title: "京都、三人旅。", date: "2026.09.26 - 09.27", contextDate: "2026-09-27", memories };
const savedSeconds = (draft: Draft) => draft.clips.reduce((sum, clip) => sum + clip.seconds, 0);
const displayDate = (date: string) => date.replaceAll("-", ".");
const shortDate = (date: string) => date.slice(5).split("-").map(Number).join(".");

function localDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return ["year", "month", "day"].map((name) => parts.find((part) => part.type === name)!.value).join("-");
}

function useYoinController() {
  const keyboard = useKeyboard();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [songs, setSongs] = useState<Song[]>([originalSong]);
  const [song, setSong] = useState(originalSong);
  const [recording, setRecording] = useState(false);
  const [liveSeconds, setLiveSeconds] = useState(0);
  const recordingStarted = useRef(0);
  const clipStartedTime = useRef("");
  const sequence = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(42);
  const [scrubbing, setScrubbing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetKind, setSheetKind] = useState<SheetKind>("memory");
  const [selectedMemory, setSelectedMemory] = useState(0);
  const [selectedClip, setSelectedClip] = useState(0);
  const [finishTitle, setFinishTitle] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const finishFlow = useRef<FlowControls | null>(null);
  const draft = drafts.find((item) => item.id === draftId);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setLiveSeconds(Math.floor((Date.now() - recordingStarted.current) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    if (!playing || scrubbing) return;
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const delta = (now - previous) / 1000;
      previous = now;
      setPosition((value) => Math.min(duration, value + delta));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, scrubbing]);
  useEffect(() => { if (position >= duration) setPlaying(false); }, [position]);

  const stopRecording = () => {
    if (!recording || !draft) return;
    const seconds = Math.max(1, Math.floor((Date.now() - recordingStarted.current) / 1000));
    const source = memories[draft.clips.length % memories.length];
    const clip: Clip = { id: `${draft.id}-${draft.clips.length}`, seconds, date: localDate(new Date(recordingStarted.current)), time: clipStartedTime.current, place: source.place, memory: { ...source, time: clipStartedTime.current } };
    setDrafts((items) => items.map((item) => item.id === draft.id ? { ...item, clips: [...item.clips, clip] } : item));
    setRecording(false);
    setLiveSeconds(0);
  };
  const startRecording = () => {
    setPlaying(false);
    recordingStarted.current = Date.now();
    clipStartedTime.current = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    setLiveSeconds(0);
    setRecording(true);
  };
  const leaveRecording = () => {
    if (recording) stopRecording();
    else if (draft && !draft.clips.length) {
      setDrafts((items) => items.filter((item) => item.id !== draft.id));
      setDraftId(null);
    }
  };
  const newDraft = (flow: FlowControls) => {
    const date = localDate();
    sequence.current += 1;
    const id = `draft-${sequence.current}`;
    const [month, day] = date.slice(5).split("-").map(Number);
    setDrafts((items) => [...items, { id, title: `${month}月${day}日からの記録`, date, clips: [] }]);
    setDraftId(id);
    setLiveSeconds(0);
    setPlaying(false);
    flow.push(recordScreen);
  };
  const openDraft = (id: string, flow: FlowControls) => {
    setDraftId(id);
    setPlaying(false);
    flow.push(recordScreen);
  };
  const openSong = (item: Song, flow: FlowControls) => {
    setSong(item);
    setPosition(42);
    setPlaying(false);
    flow.push(musicScreen);
  };
  const closeSheet = () => { keyboard.hide(); setSheetOpen(false); };
  const showSheet = (kind: SheetKind, index = 0) => {
    setSheetKind(kind);
    if (kind === "clip") setSelectedClip(index); else setSelectedMemory(index);
    setCopied(false); setCopyFailed(false); setSheetOpen(true);
  };
  const reviewSong = (flow: FlowControls) => {
    stopRecording();
    finishFlow.current = flow;
    setFinishTitle("京都、三人旅。");
    showSheet("finish");
  };
  const finishSong = () => {
    if (!draft || !draft.clips.length || !finishTitle.trim()) return;
    const item: Song = {
      id: `song-${draft.id}`, title: finishTitle.trim(),
      date: displayDate(draft.clips[0].date) + (draft.clips.at(-1)!.date !== draft.clips[0].date ? ` - ${displayDate(draft.clips.at(-1)!.date).slice(5)}` : ""),
      contextDate: draft.clips[0].date,
      memories: draft.clips.map((clip, index) => ({ ...clip.memory, id: clip.id, date: clip.date, startsAt: Math.round(42 + index * 132 / Math.max(2, draft.clips.length)) })),
    };
    setSongs((items) => [item, ...items]);
    setSong(item);
    setDrafts((items) => items.filter((item) => item.id !== draft.id));
    setDraftId(null);
    setPosition(42); setPlaying(false);
    closeSheet();
    finishFlow.current?.replace(musicScreen);
  };
  const togglePlayback = () => { if (position >= duration) setPosition(0); setPlaying((value) => !value); };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setCopyFailed(false); }
    catch { setCopyFailed(true); }
  };
  return {
    drafts, draft, songs, song, recording, liveSeconds, stopRecording, startRecording, leaveRecording, newDraft, openDraft, openSong,
    playing, position, setPosition, setPlaying,
    playerProps: { playing, position, onToggle: togglePlayback, onSeek: setPosition, onScrub: setScrubbing },
    sheetOpen, setSheetOpen, sheetKind, showSheet, closeSheet, selectedMemory, selectedClip,
    finishTitle, setFinishTitle, reviewSong, finishSong, copyLink, copied, copyFailed,
  };
}

type YoinController = ReturnType<typeof useYoinController>;
const YoinContext = createContext<YoinController | null>(null);
function useYoin() { return useContext(YoinContext)!; }

function HomeHeader() {
  const app = useYoin();
  const flow = useFlow();
  return <div className="app-toolbar home-header"><span className="yoin-wordmark">Yoin</span><button className="new-record icon-button" aria-label="新しい記録" onClick={() => app.newDraft(flow)}><PlusIcon aria-hidden="true" /></button></div>;
}

function HomePage() {
  const app = useYoin();
  const flow = useFlow();
  return <MobileScroll className="flow-scroll home-page"><main className="library-content" inert={flow.current.id !== "home"} aria-hidden={flow.current.id !== "home"}>
    <h1>ライブラリ</h1><p className="library-subtitle">あなたの時間を、もう一度。</p>
    {app.drafts.length > 0 && <section className="unfinished-records" aria-labelledby="drafts-heading"><h2 id="drafts-heading">記録の途中</h2>{app.drafts.map((item) => <button key={item.id} className="draft-row" onClick={() => app.openDraft(item.id, flow)}><span className="draft-icon"><Mic aria-hidden="true" /></span><span><strong>{item.title}</strong><small>{item.clips.length}件の会話 · {formatTime(savedSeconds(item))}</small></span><ChevronRightIcon aria-hidden="true" /></button>)}</section>}
    <section className="album-section" aria-label="これまでの曲"><div className="library-grid" data-testid="library-grid">{app.songs.map((item) => <button className="album-card" key={item.id} onClick={() => app.openSong(item, flow)} aria-label={`${item.title} ${item.date}の曲を開く`}><img src={artwork} alt="京都の坂道を歩く三人の友だち" draggable={false} /><strong>{item.title}</strong><small>{item.date}</small></button>)}</div></section>
  </main></MobileScroll>;
}

function RecordHeader() {
  const app = useYoin();
  const flow = useFlow();
  const canFinish = !!app.draft?.clips.length || app.recording;
  return <div className="app-toolbar record-header"><button className="library-back" onClick={() => { app.leaveRecording(); flow.pop(); }}><ChevronLeftIcon aria-hidden="true" />{app.recording ? "録音を止めて戻る" : "ホーム"}</button><button className="finish-button" disabled={!canFinish} onClick={() => app.reviewSong(flow)}>仕上げる</button></div>;
}

function RecordPage() {
  const app = useYoin();
  const flow = useFlow();
  useEffect(() => { if (flow.current.id !== "record") app.leaveRecording(); }, [flow.current.id, app.recording]);
  const draft = app.draft;
  if (!draft) return null;
  const total = savedSeconds(draft) + app.liveSeconds;
  return <MobileScroll className="flow-scroll record-page"><main className="record-content" inert={flow.current.id !== "record"} aria-hidden={flow.current.id !== "record"} aria-label="会話の記録" data-draft-id={draft.id}>
    <section className="record-summary"><h1>{draft.title}</h1><p>{displayDate(draft.date)}</p></section>
    <section className="record-focus" aria-label="マイクの状態">
      <div className={`record-state${app.recording ? " is-recording" : ""}`} role="status">{app.recording ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}<p>{app.recording ? "録音中" : "マイクオフ"}</p></div>
      <div className="record-duration"><p data-testid="recorded-duration">{formatTime(total)}</p><span>残した音声</span></div>
      <button className="record-toggle" data-testid="recording-toggle" aria-label={app.recording ? "録音を止める" : draft.clips.length ? "録音を再開" : "録音をはじめる"} onClick={app.recording ? app.stopRecording : app.startRecording}>{app.recording ? <PauseIcon aria-hidden="true" /> : <Mic aria-hidden="true" />}</button>
      <p className="record-action-label">{app.recording ? "録音を止める" : draft.clips.length ? "録音を再開" : "録音をはじめる"}</p>
    </section>
    <section className="record-clips" aria-labelledby="clips-heading"><h2 id="clips-heading">残した会話<span>{draft.clips.length}件</span></h2>{draft.clips.length ? <div className="clip-list">{draft.clips.map((clip, index) => <button className="clip-row" key={clip.id} onClick={() => app.showSheet("clip", index)} aria-label={`${clip.time} ${clip.place}の会話を確認`}><ChatBubbleIcon aria-hidden="true" /><span><strong>{clip.date !== draft.date ? `${shortDate(clip.date)} ` : ""}{clip.time} · {clip.place}</strong><small>{formatTime(clip.seconds)}</small></span><ChevronRightIcon aria-hidden="true" /></button>)}</div> : <p className="record-empty">残した会話がここに集まります。</p>}</section>
  </main></MobileScroll>;
}

function MusicHeader() {
  const app = useYoin();
  const flow = useFlow();
  return <div className="app-toolbar music-header"><button className="library-back" onClick={() => { app.setPlaying(false); flow.pop(); }}><ChevronLeftIcon aria-hidden="true" />ホーム</button><button className="icon-button share-button" aria-label="この旅を共有" onClick={() => app.showSheet("share")}><Share1Icon aria-hidden="true" /></button></div>;
}

function MusicPage() {
  const app = useYoin();
  const flow = useFlow();
  const { song, position } = app;
  const activeMemory = song.memories.reduce((active, item, index) => position >= item.startsAt ? index : active, 0);
  useEffect(() => { if (flow.current.id !== "music" && app.playing) app.setPlaying(false); }, [flow.current.id, app.playing]);
  return <MobileScroll className="flow-scroll music-page"><main className="yoin-content" inert={flow.current.id !== "music"} aria-hidden={flow.current.id !== "music"} aria-label="旅の曲と思い出">
    <section className="trip-summary" aria-labelledby="trip-title"><h1 id="trip-title">{song.title}</h1><p className="trip-date">{song.date}</p><p className="trip-members">レオン・アオイ・ユウ</p><img className="trip-artwork" src={artwork} alt="京都の坂道を駆け上がる三人の友だち" draggable={false} /><h2 className="song-title">あと5分の坂道</h2></section>
    <section className="lyric-memories" aria-labelledby="lyrics-title"><h2 id="lyrics-title">歌詞の思い出</h2><div className="memory-verses">{song.memories.map((item, index) => <article key={item.id} className={`lyric-moment${activeMemory === index ? " is-current" : ""}`} aria-label={`${item.place}、${shortDate(item.date ?? song.contextDate)} ${item.time}の思い出`} data-testid={`moment-${item.id}`} data-current={activeMemory === index}><p className="moment-lyrics">{item.lyrics.map((line) => <span key={line}>{line}</span>)}</p><p className="moment-context" aria-label="旅の日時と場所"><time dateTime={`${item.date ?? song.contextDate}T${item.time}:00+09:00`}>{shortDate(item.date ?? song.contextDate)} {item.time}</time><span aria-hidden="true">·</span><span>{item.place}</span></p><button className="conversation-icon" aria-label={`${item.place}の元の会話を開く`} title="この歌詞のもとになった会話" aria-haspopup="dialog" onClick={() => app.showSheet("memory", index)}><ChatBubbleIcon aria-hidden="true" /></button></article>)}</div></section>
  </main></MobileScroll>;
}

function MusicFooter() { const app = useYoin(); return <MiniPlayer {...app.playerProps} />; }
const homeScreen: FlowScreen = { id: "home", headerHeight: 80, header: () => <HomeHeader />, render: () => <HomePage /> };
const recordScreen: FlowScreen = { id: "record", headerHeight: 80, header: () => <RecordHeader />, render: () => <RecordPage /> };
const musicScreen: FlowScreen = { id: "music", headerHeight: 80, header: () => <MusicHeader />, footerHeight: 114, footer: () => <MusicFooter />, render: () => <MusicPage /> };

export default function Prototype() {
  const { device, setDeviceId } = useMobileDevice();
  const keyboard = useKeyboard();
  const reduceMotion = useReducedMotion();
  const app = useYoinController();
  const sheetOpenRef = useRef(app.sheetOpen);
  sheetOpenRef.current = app.sheetOpen;
  const focusSheetClose = useCallback((element: HTMLButtonElement | null) => { element?.focus({ preventScroll: true }); }, []);
  const memory = app.song.memories[app.selectedMemory] ?? app.song.memories[0];
  const clip = app.draft?.clips[app.selectedClip];
  const sheetTitle = app.sheetKind === "memory" ? memory.place : app.sheetKind === "share" ? "この旅を届ける" : app.sheetKind === "finish" ? "思い出を一曲に" : clip?.place ?? "残した会話";
  const sheetDescription = app.sheetKind === "memory" ? `${displayDate(memory.date ?? app.song.contextDate)} ${memory.time} · 京都` : app.sheetKind === "share" ? "受け取った人は、アプリなしで無料再生。" : app.sheetKind === "finish" ? "残した会話を確かめて、名前を付けよう。" : `${clip?.time ?? ""} · ${formatTime(clip?.seconds ?? 0)}`;
  useEffect(() => { document.title = "Yoin | 思い出のライブラリ"; setDeviceId("pixel-10"); }, []);

  return <YoinContext.Provider value={app}><div className="yoin" data-sheet-open={app.sheetOpen} style={{
    "--app-top-inset": `${device.geometry.safeArea.top}px`,
    "--record-content-height": `${device.geometry.screen.height - device.geometry.safeArea.top - device.geometry.safeArea.bottom - 80}px`,
    "--artwork-height": `${Math.max(160, device.geometry.screen.height - device.geometry.safeArea.top - device.geometry.safeArea.bottom - 610)}px`,
  } as CSSProperties} onPointerDownCapture={(event) => { if (!sheetOpenRef.current && (event.target as Element).closest('[data-testid="sheet-handle"]')) app.setSheetOpen(true); }}>
    <motion.div className="yoin-background" animate={{ scale: app.sheetOpen && !reduceMotion ? 0.985 : 1 }} transition={{ type: "spring", bounce: 0, duration: 0.3 }}><FlowStack initial={homeScreen} /></motion.div>
    <BottomSheet open={app.sheetOpen} onOpenChange={(open) => { if (!open) keyboard.hide(); app.setSheetOpen(open); }} title={sheetTitle} description={sheetDescription} snap={app.sheetKind === "memory" ? 0.76 : app.sheetKind === "finish" ? 0.66 : 0.58}>
      <div className="yoin-sheet-content" data-testid={`yoin-${app.sheetKind}-sheet`}><button ref={focusSheetClose} className="sheet-close icon-button" aria-label="シートを閉じる" onClick={app.closeSheet}><Cross2Icon aria-hidden="true" /></button>
      {app.sheetKind === "memory" ? <div className="memory-detail"><p className="moment-story">{memory.story}</p><h3>あのときの会話</h3><div className="original-conversation">{memory.conversation.map((line) => <div className="conversation-line" key={line.person}><span className="speaker-name">{line.person}</span><p>「{line.words}」</p></div>)}</div><div className="lyric-connection"><h3>ここから生まれた歌詞</h3><p>{memory.lyrics.map((line) => <span key={line}>{line}</span>)}</p></div><button className="scene-listen" onClick={() => { app.setPosition(memory.startsAt); app.setPlaying(true); app.closeSheet(); }}><PlayIcon aria-hidden="true" />この場面を聴く<span>{formatTime(memory.startsAt)}から</span></button><MiniPlayer {...app.playerProps} inSheet /></div>
      : app.sheetKind === "share" ? <div className="share-detail"><img src={artwork} className="share-artwork" alt="京都の旅のジャケット" draggable={false} /><h3>あと5分の坂道</h3><p>{app.song.title}<br />{app.song.date}</p><button className="scene-listen" onClick={app.copyLink}>{app.copied ? <CheckIcon aria-hidden="true" /> : <Link2Icon aria-hidden="true" />}{app.copied ? "リンクをコピーしました" : "リンクをコピー"}</button><p className="copy-status" role="status">{app.copyFailed ? "コピーできませんでした。もう一度お試しください。" : app.copied ? "一緒に過ごした人へ、この一曲を。" : ""}</p></div>
      : app.sheetKind === "finish" ? <div className="finish-detail"><p className="finish-summary">{app.draft?.clips.length ?? 0}件の会話 · {formatTime(app.draft ? savedSeconds(app.draft) : 0)}</p><label className="finish-field">思い出の名前<KeyboardInput value={app.finishTitle} onChange={(event) => app.setFinishTitle(event.target.value)} onBlur={() => keyboard.hide()} maxLength={40} enterKeyHint="done" onKeyDown={(event) => { if (event.key === "Enter") keyboard.hide(); }} /></label><div className="finish-clips">{app.draft?.clips.map((item) => <p key={item.id}><ChatBubbleIcon aria-hidden="true" /><span>{shortDate(item.date)} {item.time} · {item.place}</span><small>{formatTime(item.seconds)}</small></p>)}</div><button className="scene-listen" disabled={!app.finishTitle.trim()} onClick={app.finishSong}>曲に仕上げる<ChevronRightIcon aria-hidden="true" /></button></div>
      : clip ? <div className="clip-detail"><h3>残した会話</h3><div className="original-conversation">{clip.memory.conversation.map((line) => <div className="conversation-line" key={line.person}><span className="speaker-name">{line.person}</span><p>「{line.words}」</p></div>)}</div></div> : null}
      </div>
    </BottomSheet>
  </div></YoinContext.Provider>;
}
