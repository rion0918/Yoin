import assert from "node:assert/strict";
import test from "node:test";
import {
  appendClip,
  createDraft,
  displayDate,
  finishDraft,
  formatTime,
  originalSong,
  savedSeconds,
} from "./session.ts";

const baseTime = Date.parse("2026-10-03T15:05:06Z");

test("new drafts use the date in Japan and start with no saved clips", () => {
  assert.deepEqual(createDraft("draft-a", new Date(baseTime)), {
    id: "draft-a",
    title: "10月4日からの記録",
    date: "2026-10-04",
    clips: [],
  });
});

test("a clip keeps its start date and time when recording crosses midnight", () => {
  const startedAt = Date.parse("2026-10-03T14:59:59Z");
  const draft = createDraft("draft-a", new Date(startedAt));
  const result = appendClip(draft, startedAt, startedAt + 2900);
  assert.equal(result.clips[0].date, "2026-10-03");
  assert.equal(result.clips[0].time, "23:59");
  assert.equal(result.clips[0].seconds, 2);
  assert.equal(result.clips[0].memory.date, "2026-10-03");
  assert.equal(result.clips[0].memory.time, "23:59");
  assert.equal(draft.clips.length, 0);
});

test("an immediate stop still saves a one-second clip", () => {
  const draft = createDraft("draft-a", new Date(baseTime));
  assert.equal(appendClip(draft, baseTime, baseTime).clips[0].seconds, 1);
  assert.equal(appendClip(draft, baseTime, baseTime + 999).clips[0].seconds, 1);
});

test("stop and resume append independent clips without changing earlier recordings", () => {
  const empty = createDraft("draft-a", new Date(baseTime));
  const first = appendClip(empty, baseTime, baseTime + 2000);
  const second = appendClip(first, baseTime + 60000, baseTime + 64000);
  const third = appendClip(second, baseTime + 120000, baseTime + 126000);
  const other = appendClip(
    createDraft("draft-b", new Date(baseTime)),
    baseTime,
    baseTime + 2000,
  );
  assert.equal(first.clips.length, 1);
  assert.equal(second.clips.length, 2);
  assert.equal(third.clips.length, 3);
  assert.equal(new Set(third.clips.map((clip) => clip.id)).size, 3);
  assert.notEqual(first.clips[0].id, other.clips[0].id);
  assert.deepEqual(
    third.clips.map((clip) => clip.place),
    ["清水坂", "鴨川", "清水坂"],
  );
  assert.deepEqual(
    third.clips[1].memory.conversation,
    originalSong.memories[1].conversation,
  );
  assert.equal(savedSeconds(third), 12);
});

test("finishing keeps every source clip and maps every lyric back to that clip", () => {
  let draft = createDraft("draft-a", new Date(baseTime));
  for (let index = 0; index < 4; index += 1) {
    const start = baseTime + index * 60000;
    draft = appendClip(draft, start, start + 2000);
  }
  const before = structuredClone(draft);
  const song = finishDraft(draft, "  秋の京都  ");
  assert.equal(song.id, "song-draft-a");
  assert.equal(song.title, "秋の京都");
  assert.equal(song.trackTitle, "秋の京都");
  assert.equal(song.members, undefined);
  assert.equal(song.duration, 204);
  assert.deepEqual(song.sourceClips, draft.clips);
  assert.equal(song.memories.length, 4);
  for (const [index, memory] of song.memories.entries()) {
    const clip = draft.clips[index];
    assert.equal(memory.sourceClipId, clip.id);
    assert.equal(memory.date, clip.date);
    assert.equal(memory.time, clip.time);
    assert.equal(memory.place, clip.place);
    assert.deepEqual(memory.conversation, clip.memory.conversation);
    assert.ok(memory.startsAt >= 0 && memory.startsAt < song.duration);
    if (index > 0)
      assert.ok(memory.startsAt > song.memories[index - 1].startsAt);
  }
  assert.deepEqual(draft, before);
});

test("a song can only be finished with saved clips and a nonblank title", () => {
  const empty = createDraft("draft-a", new Date(baseTime));
  const saved = appendClip(empty, baseTime, baseTime + 1000);
  assert.throws(() => finishDraft(empty, "京都"), /会話/);
  assert.throws(() => finishDraft(saved, ""), /名前/);
  assert.throws(() => finishDraft(saved, " \n "), /名前/);
});

test("song date ranges retain each clip's own date, including across a year boundary", () => {
  const firstStart = Date.parse("2026-12-31T14:59:00Z");
  const nextStart = Date.parse("2026-12-31T15:01:00Z");
  const first = appendClip(
    createDraft("draft-a", new Date(firstStart)),
    firstStart,
    firstStart + 1000,
  );
  assert.equal(finishDraft(first, "年越し").date, "2026.12.31");
  const draft = appendClip(first, nextStart, nextStart + 1000);
  const song = finishDraft(draft, "年越し");
  assert.equal(song.date, "2026.12.31 - 2027.01.01");
  assert.equal(song.contextDate, "2026-12-31");
  assert.deepEqual(
    song.memories.map((memory) => memory.date),
    ["2026-12-31", "2027-01-01"],
  );

  const firstDay = appendClip(
    createDraft("draft-b", new Date(baseTime)),
    baseTime,
    baseTime + 1000,
  );
  const nextDay = baseTime + 86400000;
  assert.equal(
    finishDraft(appendClip(firstDay, nextDay, nextDay + 1000), "旅").date,
    "2026.10.04 - 10.05",
  );
});

test("the existing Kyoto song and formatting remain compatible with the prototype", () => {
  assert.equal(originalSong.title, "京都、三人旅。");
  assert.equal(originalSong.date, "2026.09.26 - 09.27");
  assert.deepEqual(originalSong.members, ["レオン", "アオイ", "ユウ"]);
  assert.deepEqual(
    originalSong.memories.map((memory) => memory.startsAt),
    [42, 108],
  );
  assert.equal(formatTime(204.9), "3:24");
  assert.equal(formatTime(0), "0:00");
  assert.equal(displayDate("2026-10-04"), "2026.10.04");
  assert.equal(savedSeconds(createDraft("draft-a", new Date(baseTime))), 0);
});
