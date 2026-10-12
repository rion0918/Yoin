import assert from "node:assert/strict";
import test from "node:test";
import { emptyLibrary } from "../../shared/contracts.ts";
import {
  hasReadyReadings,
  isSingingText,
  singingLyricsMatch,
} from "../../shared/music.ts";
import {
  createLocalDraft,
  editLyricBlock,
  editSingingText,
  mergeRemoteDraft,
} from "./library.ts";

test("editing display lyrics invalidates only the changed block's reading", () => {
  const first = {
    id: "v1",
    text: "三宮",
    section: "verse" as const,
    singingText: "さんのみや",
    sourceUtteranceIds: ["u1"],
  };
  const second = { ...first, id: "v2" };
  const draft = {
    ...createLocalDraft("draft", "2026-10-12T00:00:00Z"),
    lyrics: { revision: 1, blocks: [first, second] },
  };
  const edited = editLyricBlock(draft, "v1", "尼崎");
  assert.equal(edited.lyrics?.blocks[0]?.singingText, undefined);
  assert.deepEqual(edited.lyrics?.blocks[1], second);
  assert.deepEqual(editLyricBlock(draft, "v1", "三宮"), draft);
});
test("manual readings and music settings survive persistence and a remote refresh", () => {
  const block = {
    id: "v",
    text: "三宮",
    section: "verse" as const,
    sourceUtteranceIds: ["u1"],
  };
  const draft = {
    ...createLocalDraft("draft", "2026-10-12T00:00:00Z"),
    readingsKey: "stable-key",
    lyrics: {
      revision: 3,
      generationVersion: 2 as const,
      musicPreferences: { genre: "rock" as const, vocal: "male" as const },
      blocks: [block],
    },
  };
  const edited = editSingingText(draft, "v", "さんのみや");
  const stored = JSON.parse(
    JSON.stringify({ ...emptyLibrary(), drafts: [edited] }),
  );
  const merged = mergeRemoteDraft(stored, edited).drafts[0];
  assert.equal(merged.readingsKey, "stable-key");
  assert.deepEqual(merged.lyrics, edited.lyrics);
  assert.ok(merged.lyrics);
  assert.equal(hasReadyReadings(merged.lyrics.blocks), true);
});
test("singing readings reject instruction syntax, kanji, digits and mismatched lines", () => {
  for (const invalid of [
    "三宮",
    "さんのみや15",
    "さんのみや (さんのみや)",
    "[Chorus]さんのみや",
    "さんのみや\nへいこう",
    "abc",
    "さんのみや🎵",
  ])
    assert.equal(isSingingText("三宮", invalid), false);
  assert.equal(isSingingText("三宮\n\n十五", "さんのみや\n\nじゅうご"), true);
});
test("matching allows kana variants but rejects omissions and extra repetitions", () => {
  const block = {
    id: "v",
    text: "三宮",
    singingText: "さんのみや",
    section: "verse" as const,
    sourceUtteranceIds: ["u"],
  };
  assert.equal(
    singingLyricsMatch([block], "Lyrics:\n[Verse 1]\nサンノミヤ。"),
    true,
  );
  for (const invalid of [
    "さんのみ",
    "さんのみや さんのみや",
    "三宮",
    "[Unknown]さんのみや",
    "説明\nさんのみや",
  ])
    assert.equal(singingLyricsMatch([block], invalid), false);
  assert.equal(hasReadyReadings([{ ...block, singingText: undefined }]), false);
});
