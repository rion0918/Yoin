import assert from "node:assert/strict";
import test from "node:test";
import { initPlayback, playbackTransition } from "./playback.ts";

test("song at 40 seconds survives a conversation, closing it, and opening a different conversation", () => {
  let state = playbackTransition(initPlayback(), {
    type: "selectSong",
    durationMs: 180000,
  });
  state = playbackTransition(state, { type: "playSong" });
  state = playbackTransition(state, { type: "time", positionMs: 39000 });
  state = playbackTransition(state, { type: "playSource", currentMs: 40000 });
  assert.equal(state.target, "source");
  state = playbackTransition(state, { type: "time", positionMs: 1000 });
  state = playbackTransition(state, { type: "closeSource" });
  state = playbackTransition(state, { type: "playSource", currentMs: 0 });
  state = playbackTransition(state, { type: "time", positionMs: 2000 });
  state = playbackTransition(state, { type: "closeSource" });
  state = playbackTransition(state, { type: "playSong" });
  assert.deepEqual(state, {
    target: "song",
    positionMs: 40000,
    durationMs: 180000,
  });
});

test("opening and closing a lyrics sheet while the song plays does not stop song time updates", () => {
  let state = playbackTransition(initPlayback(), {
    type: "selectSong",
    durationMs: 180000,
  });
  state = playbackTransition(state, { type: "playSong" });
  state = playbackTransition(state, { type: "time", positionMs: 40000 });
  const beforeClosing = state;
  state = playbackTransition(state, { type: "closeSource" });
  assert.equal(state, beforeClosing);
  state = playbackTransition(state, { type: "time", positionMs: 45000 });
  assert.equal(state.target, "song");
  assert.equal(state.positionMs, 45000);
});

test("switching directly between two source clips never replaces the saved song position with source time", () => {
  let state = playbackTransition(initPlayback(), {
    type: "selectSong",
    durationMs: 180000,
  });
  state = playbackTransition(state, { type: "playSong" });
  state = playbackTransition(state, { type: "playSource", currentMs: 40000 });
  state = playbackTransition(state, { type: "playSource", currentMs: 3000 });
  state = playbackTransition(state, { type: "playSong" });
  assert.equal(state.positionMs, 40000);
});

test("a paused song can be scrubbed and resumes from a position inside its duration", () => {
  let state = playbackTransition(initPlayback(), {
    type: "selectSong",
    durationMs: 180000,
  });
  state = playbackTransition(state, { type: "seek", positionMs: 40000 });
  assert.equal(state.target, "none");
  assert.equal(state.positionMs, 40000);
  state = playbackTransition(state, { type: "time", positionMs: 0 });
  assert.equal(state.positionMs, 40000);
  state = playbackTransition(state, { type: "seek", positionMs: 200000 });
  assert.equal(state.positionMs, 180000);
  state = playbackTransition(state, { type: "seek", positionMs: -1000 });
  assert.equal(state.positionMs, 0);
  state = playbackTransition(state, { type: "seek", positionMs: 45000 });
  state = playbackTransition(state, { type: "playSong" });
  assert.equal(state.positionMs, 45000);
});

test("selecting another song clears a previous song's duration and saved position", () => {
  let state = playbackTransition(initPlayback(), {
    type: "selectSong",
    durationMs: 180000,
  });
  state = playbackTransition(state, { type: "seek", positionMs: 40000 });
  state = playbackTransition(state, { type: "playSource", currentMs: 0 });
  state = playbackTransition(state, { type: "selectSong", durationMs: 120000 });
  assert.deepEqual(state, {
    target: "none",
    positionMs: 0,
    durationMs: 120000,
  });
});
