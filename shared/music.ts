import type {
  LyricBlock,
  LyricSection,
  MusicPreferences,
} from "./contracts.ts";

export const DEFAULT_MUSIC_PREFERENCES: MusicPreferences = {
  genre: "acoustic",
  vocal: "auto",
};
export const MUSIC_PRESETS = {
  acoustic: {
    label: "アコースティック",
    bpm: 84,
    mood: "温かく穏やか",
    instruments: "アコースティックギター、ピアノ、軽い打楽器",
  },
  jpop: {
    label: "J-pop",
    bpm: 112,
    mood: "明るく希望を感じる",
    instruments: "ギター、鍵盤、ベース、ドラム",
  },
  piano: {
    label: "ピアノバラード",
    bpm: 72,
    mood: "懐かしく繊細",
    instruments: "ピアノ、控えめなストリングス",
  },
  rock: {
    label: "ロック",
    bpm: 116,
    mood: "前向きで躍動感がある",
    instruments: "エレキギター、ベース、ドラム",
  },
  rnb: {
    label: "R&B",
    bpm: 88,
    mood: "落ち着いて滑らか",
    instruments: "エレクトリックピアノ、ベース、柔らかなドラム",
  },
  bossa: {
    label: "ボサノバ",
    bpm: 96,
    mood: "軽やかでくつろいだ",
    instruments: "ナイロン弦ギター、コントラバス、軽い打楽器",
  },
} as const;
export const VOCAL_LABELS = {
  male: "男性",
  female: "女性",
  auto: "おまかせ",
} as const;
export const SECTION_LABELS: Record<LyricSection, string> = {
  verse: "Aメロ",
  pre_chorus: "Bメロ",
  chorus: "サビ",
  bridge: "ブリッジ",
};

export function isMusicPreferences(value: unknown): value is MusicPreferences {
  if (!value || typeof value !== "object") return false;
  const item = value as MusicPreferences;
  return (
    Object.hasOwn(MUSIC_PRESETS, item.genre) &&
    Object.hasOwn(VOCAL_LABELS, item.vocal)
  );
}
export function isLyricSection(value: unknown): value is LyricSection {
  return typeof value === "string" && Object.hasOwn(SECTION_LABELS, value);
}
export function isSingingText(
  text: string,
  reading: unknown,
): reading is string {
  if (typeof reading !== "string" || !reading.trim() || reading.length > 12000)
    return false;
  const kana = reading.normalize("NFKC");
  if (
    /[^\p{Script=Hiragana}\p{Script=Katakana}ー\p{M}\p{P}\s]/u.test(kana) ||
    /[()[\]{}<>（）［］]/u.test(kana)
  )
    return false;
  const lines = text.trim().split("\n");
  const sungLines = kana.trim().split("\n");
  return (
    lines.length === sungLines.length &&
    lines.every((line, i) =>
      line.trim()
        ? /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(sungLines[i] ?? "")
        : !sungLines[i]?.trim(),
    )
  );
}
export function hasReadyReadings(blocks: LyricBlock[]): boolean {
  return (
    blocks.length > 0 &&
    blocks.every(
      (block) =>
        isLyricSection(block.section) &&
        isSingingText(block.text, block.singingText),
    )
  );
}
export function buildMusicPrompt(
  blocks: LyricBlock[],
  preferences: MusicPreferences,
): string {
  const preset = MUSIC_PRESETS[preferences.genre];
  const vocal =
    preferences.vocal === "male"
      ? "明瞭で温かい男性テナー"
      : preferences.vocal === "female"
        ? "明瞭で自然な女性の中音域ボーカル"
        : "曲調に合う明瞭で自然なソロボーカル";
  let verse = 0;
  const tags = { pre_chorus: "Pre-Chorus", chorus: "Chorus", bridge: "Bridge" };
  const lyrics = blocks
    .map((block) => {
      const tag =
        block.section === "verse"
          ? `Verse ${++verse}`
          : tags[block.section as keyof typeof tags];
      return `[${tag}]\n${block.singingText}`;
    })
    .join("\n\n");
  return `${preset.label}の日本語の歌。雰囲気は${preset.mood}。楽器は${preset.instruments}。テンポは約${preset.bpm} BPM。歌声は${vocal}で、日本語の言葉をはっきり丁寧に歌う。伴奏は歌声を覆わない。\n約3分。短い楽器だけのイントロから始まり、AメロからBメロ、サビへ自然に盛り上がり、ブリッジを経て最後のサビと楽器だけのアウトロで終える。\n以下は確認済みの歌唱用歌詞。書かれた順序と読みを守り、すべてのブロックを一度ずつ歌う。記載済みの繰り返しを含め、言葉を追加・省略・変更しない。この説明と構造タグは歌わない。\n\nLyrics:\n\n${lyrics}`;
}
export function singingLyricsMatch(
  blocks: LyricBlock[],
  returned: string,
): boolean {
  const clean = (value: string) =>
    value
      .normalize("NFKC")
      .replace(/^\s*Lyrics:\s*/im, "")
      .replace(
        /\[(?:Verse(?: \d+)?|Pre-Chorus|Chorus|Bridge|Intro|Outro)\]/g,
        "",
      )
      .replace(/[ァ-ヶ]/g, (char) =>
        String.fromCharCode(char.charCodeAt(0) - 0x60),
      )
      .replace(/[\p{P}\s]/gu, "");
  return (
    hasReadyReadings(blocks) &&
    clean(blocks.map((block) => block.singingText).join("\n")) ===
      clean(returned)
  );
}
