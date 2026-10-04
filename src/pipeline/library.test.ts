import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyLibrary,
  type LocalClip,
  type SongDocument,
} from "../../shared/contracts.ts";
import {
  addSavedClip,
  completeSong,
  createLocalDraft,
  editLyricBlock,
  mergeRemoteDraft,
  restoreRecording,
  sourceContext,
} from "./library.ts";

const clip: LocalClip = {
  id: "c1",
  draftId: "d1",
  localUri: "file:///audio.m4a",
  mimeType: "audio/mp4",
  sizeBytes: 1200,
  durationMs: 2900,
  recordedAt: "2026-10-03T14:59:59Z",
  importedAt: null,
  timezone: "Asia/Tokyo",
  place: null,
};
function saved() {
  return addSavedClip(
    {
      ...emptyLibrary(),
      drafts: [createLocalDraft("d1", "2026-10-03T14:59:59Z")],
    },
    clip,
  );
}

test("interrupted recovery retains the file reference but never restores a recording indicator", () => {
  const pending = {
    clipId: clip.id,
    draftId: clip.draftId,
    localUri: clip.localUri,
    recordedAt: "2026-10-03T14:59:59Z",
    timezone: clip.timezone,
  };
  const state = {
    ...emptyLibrary(),
    drafts: [createLocalDraft("d1", pending.recordedAt)],
    pendingRecording: pending,
  };
  const interrupted = restoreRecording(state, null);
  assert.equal(interrupted.pendingRecording, null);
  assert.deepEqual(interrupted.recoveryFiles, [pending]);
  assert.equal(interrupted.drafts[0].clips.length, 0);
  const recovered = restoreRecording(state, clip);
  assert.equal(recovered.pendingRecording, null);
  assert.deepEqual(recovered.drafts[0].clips, [clip]);
});

test("native save completion adds exactly one real clip without inventing dialogue or duration", () => {
  const once = saved();
  assert.deepEqual(addSavedClip(once, clip), once);
  assert.equal(once.drafts[0].clips[0].durationMs, 2900);
  assert.deepEqual(once.drafts[0].utterances, []);
  assert.equal(once.drafts[0].lyrics, null);
  assert.deepEqual(once.songs, []);
});

test("imported audio does not use import date as recording time or invent a place", () => {
  const imported = {
    ...clip,
    recordedAt: null,
    importedAt: "2026-10-04T03:00:00Z",
  };
  assert.deepEqual(sourceContext(imported, 500), {
    date: "日時不明",
    time: "",
    place: "場所不明",
  });
  assert.deepEqual(sourceContext(clip, 2500), {
    date: "2026-10-04",
    time: "00:00",
    place: "場所不明",
  });
});

test("remote preparation merges metadata while retaining local files and multipart progress", () => {
  const state = saved();
  state.drafts[0].clips[0].upload = {
    uploadId: "u1",
    parts: [{ partNumber: 1, etag: "etag" }],
    complete: true,
  };
  const remote = {
    ...state.drafts[0],
    status: "waiting_review" as const,
    clips: [{ ...clip, durationMs: 2950 }],
  };
  const merged = mergeRemoteDraft(state, remote);
  assert.equal(merged.drafts[0].clips[0].localUri, clip.localUri);
  assert.equal(merged.drafts[0].clips[0].upload?.parts[0].etag, "etag");
  assert.equal(merged.drafts[0].clips[0].durationMs, 2950);
});

test("editing a lyric keeps its source and never changes another block", () => {
  const draft = saved().drafts[0];
  draft.lyrics = {
    revision: 2,
    blocks: [
      { id: "b1", text: "元の歌詞", sourceUtteranceIds: ["u1"] },
      { id: "b2", text: "川の歌詞", sourceUtteranceIds: ["u2"] },
    ],
  };
  const edited = editLyricBlock(draft, "b1", "編集した歌詞");
  assert.deepEqual(edited.lyrics?.blocks[0], {
    id: "b1",
    text: "編集した歌詞",
    sourceUtteranceIds: ["u1"],
  });
  assert.deepEqual(edited.lyrics?.blocks[1], draft.lyrics.blocks[1]);
  assert.equal(edited.lyrics?.revision, 2);
  assert.equal(draft.lyrics.blocks[0].text, "元の歌詞");
});

test("only a real completed song removes its draft and repeated completion is harmless", () => {
  const song: SongDocument = {
    id: "s1",
    draftId: "d1",
    title: "旅",
    createdAt: "2026-10-04T03:00:00Z",
    clips: [clip],
    utterances: [],
    lyrics: { revision: 1, blocks: [] },
    audioId: "audio-s1",
    durationMs: 113400,
  };
  const state = saved();
  assert.throws(() => completeSong(state, { ...song, audioId: "" }));
  assert.throws(() => completeSong(state, { ...song, durationMs: 0 }));
  const completed = completeSong(state, song);
  assert.equal(completed.drafts.length, 0);
  assert.equal(completed.songs[0].durationMs, 113400);
  assert.deepEqual(completeSong(completed, song), completed);
  assert.equal(state.drafts.length, 1);
});
