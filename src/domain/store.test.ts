import assert from "node:assert/strict";
import test from "node:test";
import { initialSession, reduceSession } from "./store.ts";

const now = Date.parse("2026-10-04T08:00:00Z");

test("the session starts with the Kyoto song and no recorder or drafts", () => {
  const state = initialSession();
  assert.equal(state.songs.length, 1);
  assert.equal(state.songs[0].id, "kyoto");
  assert.deepEqual(state.drafts, []);
  assert.equal(state.recorder, null);
});

test("creating a draft starts with the microphone off; only existing drafts can start", () => {
  const initial = initialSession();
  assert.equal(
    reduceSession(initial, { type: "start", id: "missing", now }),
    initial,
  );
  const created = reduceSession(initial, { type: "create", id: "a", now });
  assert.equal(created.drafts.length, 1);
  assert.equal(created.drafts[0].title, "10月4日からの記録");
  assert.equal(created.recorder, null);
  const started = reduceSession(created, { type: "start", id: "a", now });
  assert.deepEqual(started.recorder, { draftId: "a", startedAt: now });
  assert.equal(
    reduceSession(started, { type: "start", id: "a", now: now + 1000 }),
    started,
  );
});

test("stopping atomically saves the active clip once and clears the recorder", () => {
  const created = reduceSession(initialSession(), {
    type: "create",
    id: "a",
    now,
  });
  const started = reduceSession(created, { type: "start", id: "a", now });
  const stopped = reduceSession(started, { type: "stop", now: now + 5000 });
  assert.equal(stopped.recorder, null);
  assert.equal(stopped.drafts[0].clips.length, 1);
  assert.equal(stopped.drafts[0].clips[0].seconds, 5);
  assert.equal(
    reduceSession(stopped, { type: "stop", now: now + 6000 }),
    stopped,
  );
  assert.equal(started.drafts[0].clips.length, 0);
});

test("leaving during recording retains the unfinished draft and finalizes once", () => {
  const created = reduceSession(initialSession(), {
    type: "create",
    id: "a",
    now,
  });
  const started = reduceSession(created, { type: "start", id: "a", now });
  const left = reduceSession(started, {
    type: "leave",
    id: "a",
    now: now + 2000,
  });
  assert.equal(left.recorder, null);
  assert.equal(left.drafts[0].clips.length, 1);
  assert.equal(left.drafts[0].clips[0].seconds, 2);
  assert.equal(
    reduceSession(left, { type: "leave", id: "a", now: now + 3000 }),
    left,
  );
});

test("leaving a never-recorded draft discards only that empty draft", () => {
  const first = reduceSession(initialSession(), {
    type: "create",
    id: "a",
    now,
  });
  const both = reduceSession(first, { type: "create", id: "b", now });
  const left = reduceSession(both, { type: "leave", id: "a", now });
  assert.deepEqual(
    left.drafts.map((draft) => draft.id),
    ["b"],
  );
  assert.equal(left.songs.length, 1);
  assert.equal(left.recorder, null);
});

test("a stopped draft survives review cancellation and resumes as a second clip", () => {
  const created = reduceSession(initialSession(), {
    type: "create",
    id: "a",
    now,
  });
  const started = reduceSession(created, { type: "start", id: "a", now });
  const reviewed = reduceSession(started, { type: "stop", now: now + 2000 });
  const left = reduceSession(reviewed, {
    type: "leave",
    id: "a",
    now: now + 3000,
  });
  const resumed = reduceSession(left, {
    type: "start",
    id: "a",
    now: now + 60000,
  });
  const stopped = reduceSession(resumed, { type: "stop", now: now + 64000 });
  assert.deepEqual(
    stopped.drafts[0].clips.map((clip) => clip.seconds),
    [2, 4],
  );
  assert.equal(stopped.recorder, null);
  assert.equal(stopped.songs.length, 1);
});

test("leaving another draft cannot stop or move the active recorder", () => {
  const first = reduceSession(initialSession(), {
    type: "create",
    id: "a",
    now,
  });
  const both = reduceSession(first, { type: "create", id: "b", now });
  const active = reduceSession(both, { type: "start", id: "a", now });
  assert.equal(
    reduceSession(active, { type: "start", id: "b", now: now + 1000 }),
    active,
  );
  const left = reduceSession(active, {
    type: "leave",
    id: "b",
    now: now + 1000,
  });
  assert.deepEqual(left.recorder, { draftId: "a", startedAt: now });
  assert.deepEqual(
    left.drafts.map((draft) => draft.id),
    ["a"],
  );
  assert.equal(left.drafts[0].clips.length, 0);
});

test("finishing during recording keeps the last clip and cannot create a duplicate song", () => {
  const created = reduceSession(initialSession(), {
    type: "create",
    id: "a",
    now,
  });
  const firstStart = reduceSession(created, { type: "start", id: "a", now });
  const firstStop = reduceSession(firstStart, {
    type: "stop",
    now: now + 2000,
  });
  const resumed = reduceSession(firstStop, {
    type: "start",
    id: "a",
    now: now + 60000,
  });
  const event = {
    type: "finish",
    id: "a",
    title: "  秋の京都  ",
    now: now + 64000,
  } as const;
  const finished = reduceSession(resumed, event);
  assert.equal(finished.recorder, null);
  assert.deepEqual(finished.drafts, []);
  assert.equal(finished.songs.length, 2);
  assert.equal(finished.songs[0].id, "song-a");
  assert.equal(finished.songs[0].title, "秋の京都");
  assert.deepEqual(
    finished.songs[0].sourceClips.map((clip) => clip.seconds),
    [2, 4],
  );
  assert.deepEqual(
    finished.songs[0].memories.map((memory) => memory.sourceClipId),
    ["a-0", "a-1"],
  );
  assert.equal(reduceSession(finished, event), finished);
  assert.equal(resumed.drafts[0].clips.length, 1);
});

test("blank-title finishing stops recording safely but retains the draft for correction", () => {
  const created = reduceSession(initialSession(), {
    type: "create",
    id: "a",
    now,
  });
  assert.equal(
    reduceSession(created, { type: "finish", id: "a", title: "京都", now }),
    created,
  );
  const started = reduceSession(created, { type: "start", id: "a", now });
  const invalid = reduceSession(started, {
    type: "finish",
    id: "a",
    title: " \n ",
    now: now + 2000,
  });
  assert.equal(invalid.recorder, null);
  assert.equal(invalid.drafts.length, 1);
  assert.equal(invalid.drafts[0].clips.length, 1);
  assert.equal(invalid.songs.length, 1);
  assert.equal(
    reduceSession(invalid, { type: "stop", now: now + 3000 }),
    invalid,
  );
});

test("finishing a paused draft does not mix in or stop another draft's recording", () => {
  const first = reduceSession(initialSession(), {
    type: "create",
    id: "a",
    now,
  });
  const both = reduceSession(first, { type: "create", id: "b", now });
  const recordingB = reduceSession(both, { type: "start", id: "b", now });
  const savedB = reduceSession(recordingB, { type: "stop", now: now + 2000 });
  const recordingA = reduceSession(savedB, {
    type: "start",
    id: "a",
    now: now + 3000,
  });
  const before = structuredClone(recordingA);
  const finishedB = reduceSession(recordingA, {
    type: "finish",
    id: "b",
    title: "川辺",
    now: now + 5000,
  });
  assert.deepEqual(finishedB.recorder, { draftId: "a", startedAt: now + 3000 });
  assert.deepEqual(
    finishedB.drafts.map((draft) => draft.id),
    ["a"],
  );
  assert.equal(finishedB.drafts[0].clips.length, 0);
  assert.deepEqual(
    finishedB.songs[0].sourceClips.map((clip) => clip.id),
    ["b-0"],
  );
  assert.deepEqual(recordingA, before);
  const stoppedA = reduceSession(finishedB, { type: "stop", now: now + 6000 });
  assert.equal(stoppedA.drafts[0].clips[0].id, "a-0");
  assert.equal(stoppedA.drafts[0].clips[0].seconds, 3);
});
