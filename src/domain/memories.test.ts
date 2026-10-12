import assert from "node:assert/strict";
import test from "node:test";
import type { SongDocument } from "../../shared/contracts.ts";
import { memoryGroups, memoryPlaces, memoryWords } from "./memories.ts";

function memory(
  id: string,
  recordedAt: string | null,
  timezone = "Asia/Tokyo",
): SongDocument {
  return {
    id,
    draftId: id,
    title: id,
    createdAt: "2026-10-07T00:00:00Z",
    clips: [
      {
        id: `${id}-clip`,
        draftId: id,
        recordedAt,
        importedAt: "2026-10-06T00:00:00Z",
        timezone,
        durationMs: 60000,
        sizeBytes: 1,
        mimeType: "audio/mp4",
        place: null,
      },
    ],
    utterances: [],
    lyrics: { revision: 1, blocks: [] },
    audioId: id,
    durationMs: 180000,
  };
}

test("思い出を生成日ではなく録音した現地の年月で並べ、元の一覧を変更しない", () => {
  const old = memory("old", "2025-12-31T15:30:00Z");
  const recent = memory("recent", "2026-09-30T15:30:00Z");
  const unknown = memory("unknown", null);
  const earlier = memory("earlier", "2026-09-01T00:00:00Z");
  const input = [unknown, old, earlier, recent];
  assert.deepEqual(
    memoryGroups(input).map((g) => [g.label, g.songs.map((s) => s.id)]),
    [
      ["2026年10月", ["recent"]],
      ["2026年9月", ["earlier"]],
      ["2026年1月", ["old"]],
      ["日時の記録なし", ["unknown"]],
    ],
  );
  assert.deepEqual(
    input.map((s) => s.id),
    ["unknown", "old", "earlier", "recent"],
  );
});

test("日付を跨ぐ思い出は最初の録音日でまとめ、歌詞・場所の不明値を推測しない", () => {
  const song = memory("trip", "2026-08-31T14:00:00Z");
  song.clips.unshift({
    ...song.clips[0],
    id: "later",
    recordedAt: "2026-09-01T00:00:00Z",
  });
  assert.equal(memoryGroups([song])[0].label, "2026年8月");
  assert.deepEqual(memoryPlaces(song), []);
  assert.equal(memoryWords(song), null);
});

test("言葉は実際の会話を優先し、会話がないときだけ既存歌詞を使う", () => {
  const song = memory("words", null);
  song.lyrics.blocks = [
    {
      id: "block",
      text: "また三人で坂道を走った\nあの日のこと",
      sourceUtteranceIds: [],
    },
  ];
  assert.deepEqual(memoryWords(song), {
    text: "また三人で坂道を走った",
    kind: "lyrics",
  });
  song.utterances = [
    {
      id: "u",
      clipId: song.clips[0].id,
      speaker: "A",
      startMs: 0,
      endMs: 1000,
      text: "あと5分らしいぞ！",
    },
  ];
  assert.deepEqual(memoryWords(song), {
    text: "あと5分らしいぞ！",
    kind: "conversation",
  });
});

test("場所は保存した会話の順序で重複を除き、存在しない場所を追加しない", () => {
  const song = memory("places", "2026-09-27T08:00:00Z");
  song.clips[0].place = "清水坂";
  song.clips.push(
    {
      ...song.clips[0],
      id: "two",
      recordedAt: "2026-09-27T09:00:00Z",
      place: "鴨川",
    },
    { ...song.clips[0], id: "three", recordedAt: "2026-09-27T10:00:00Z" },
  );
  assert.deepEqual(memoryPlaces(song), ["清水坂", "鴨川"]);
});
