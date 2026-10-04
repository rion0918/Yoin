import type { Memory, Song } from "./types.ts";

export const memoryFixtures: Memory[] = [
  {
    id: "kiyomizuzaka",
    date: "2026-09-27",
    time: "17:23",
    place: "清水坂",
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
    id: "kamogawa",
    date: "2026-09-27",
    time: "18:40",
    place: "鴨川",
    lyrics: ["次の季節も、この場所で"],
    startsAt: 108,
    story:
      "歩き疲れて、川辺でひと休み。夕暮れの京都を見ながら、次の旅の約束をした。",
    conversation: [
      { person: "レオン", words: "また三人で来よう。" },
      { person: "アオイ", words: "次は桜の季節がいいね。" },
      { person: "ユウ", words: "今度は、もう少しゆっくり歩こう。" },
    ],
  },
];

export const originalSong: Song = {
  id: "kyoto",
  title: "京都、三人旅。",
  trackTitle: "あと5分の坂道",
  date: "2026.09.26 - 09.27",
  contextDate: "2026-09-27",
  memories: memoryFixtures,
  // The existing song fixture has conversations, but no recorded clip durations.
  sourceClips: [],
  duration: 204,
  members: ["レオン", "アオイ", "ユウ"],
};
