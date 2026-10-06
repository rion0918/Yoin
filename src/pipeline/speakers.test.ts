import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyLibrary,
  type LocalSpeakerProfile,
} from "../../shared/contracts.ts";
import { clipFromRecording } from "../platform/operations.ts";
import { addSavedClip, restoreRecording } from "./library.ts";
import * as speakerUi from "./speakers.ts";
import {
  assertCanRecordConversation,
  mergeSpeakerProfiles,
  speakerLabel,
} from "./speakers.ts";

const profile: LocalSpeakerProfile = {
  id: "speaker-a",
  name: "あおい",
  status: "pending",
  sampleId: null,
  modelVersion: null,
};
const pending = {
  purpose: "speaker" as const,
  speakerProfileId: profile.id,
  clipId: "sample-a",
  recordedAt: "2026-10-05T00:00:00Z",
  timezone: "Asia/Tokyo",
  localUri: "file:///voice.m4a",
};
const sample = {
  purpose: "speaker" as const,
  id: pending.clipId,
  speakerProfileId: profile.id,
  localUri: pending.localUri,
  durationMs: 20000,
  sizeBytes: 32000,
  mimeType: "audio/mp4",
};

test("conversation recording requires a server-confirmed voice registration, including after restart", () => {
  assert.throws(() => assertCanRecordConversation(emptyLibrary()), /声を登録/);
  assert.throws(
    () =>
      assertCanRecordConversation({
        ...emptyLibrary(),
        speakerProfiles: [profile],
      }),
    /声を登録/,
  );
  const ready = {
    ...profile,
    status: "ready" as const,
    sampleId: sample.id,
    modelVersion: "model-v1",
  };
  assert.doesNotThrow(() =>
    assertCanRecordConversation(
      JSON.parse(
        JSON.stringify({ ...emptyLibrary(), speakerProfiles: [ready] }),
      ),
    ),
  );
});

test("conversation recording accepts only the speakers selected for that memory", () => {
  const readyA = {
    ...profile,
    status: "ready" as const,
    sampleId: "sample-a",
    modelVersion: "model-v1",
  };
  const readyB = {
    ...readyA,
    id: "speaker-b",
    name: "れん",
  };
  const state = {
    ...emptyLibrary(),
    speakerProfiles: [readyA, readyB],
  };

  assert.doesNotThrow(() => assertCanRecordConversation(state, [readyA.id]));
  assert.throws(
    () => assertCanRecordConversation(state, ["speaker-missing"]),
    /選んでください/,
  );
});

test("voice capture and native completion stay outside conversation drafts", () => {
  const state = {
    ...emptyLibrary(),
    speakerProfiles: [profile],
    pendingRecording: pending,
  };
  const captured = clipFromRecording(pending, sample);
  assert.deepEqual(captured, sample);
  const saved = addSavedClip(state, captured);
  assert.deepEqual(saved.drafts, []);
  assert.deepEqual(saved.songs, []);
  assert.equal(saved.pendingRecording, null);
  assert.deepEqual(saved.speakerProfiles?.[0].sample, sample);
  assert.deepEqual(addSavedClip(saved, captured), saved);
});

test("interrupted voice enrollment recovers only into its speaker profile", () => {
  const state = {
    ...emptyLibrary(),
    speakerProfiles: [profile],
    pendingRecording: pending,
  };
  const failed = restoreRecording(state, null);
  assert.equal(failed.pendingRecording, null);
  assert.deepEqual(failed.recoveryFiles, [pending]);
  assert.deepEqual(failed.drafts, []);
  const recovered = addSavedClip(failed, sample);
  assert.deepEqual(recovered.recoveryFiles, []);
  assert.deepEqual(recovered.speakerProfiles?.[0].sample, sample);
});

test("profile refresh preserves local rerecordings and an existing active voice", () => {
  const ready = {
    ...profile,
    status: "ready" as const,
    sampleId: "previous",
    modelVersion: "model-v1",
    sample,
  };
  const state = { ...emptyLibrary(), speakerProfiles: [ready] };
  const refreshed = mergeSpeakerProfiles(state, [{ ...ready, name: "葵" }]);
  assert.equal(refreshed.speakerProfiles?.[0].name, "葵");
  assert.deepEqual(refreshed.speakerProfiles?.[0].sample, sample);
  assert.doesNotThrow(() => assertCanRecordConversation(refreshed));
});

test("conversation names use the saved identification and legacy labels still render", () => {
  const utterance = {
    id: "u1",
    clipId: "c1",
    startMs: 0,
    endMs: 1000,
    speaker: "spk_1",
    text: "こんにちは",
  };
  assert.equal(speakerLabel(utterance), "spk_1");
  assert.equal(
    speakerLabel({
      ...utterance,
      speakerProfileId: profile.id,
      speakerName: profile.name,
    }),
    "あおい",
  );
});

test("voice registration waits for an explicit recording action and shows time remaining", () => {
  const waiting = speakerUi.speakerSampleState(undefined, "off", 0);
  assert.equal(waiting.phase, "empty");
  assert.equal(waiting.canRegister, false);
  const recording = speakerUi.speakerSampleState(undefined, "recording", 7250);
  assert.equal(recording.phase, "recording");
  assert.equal(recording.remainingSeconds, 13);
  assert.equal(recording.progress, 0.3625);
  assert.equal(recording.canRegister, false);
});

test("a previous sample cannot be registered while a replacement is recording or saving", () => {
  for (const phase of ["preparing", "recording", "saving"] as const) {
    assert.equal(
      speakerUi.speakerSampleState(sample, phase, 20000).phase,
      phase,
    );
    assert.equal(
      speakerUi.speakerSampleState(sample, phase, 20000).canRegister,
      false,
    );
  }
});

test("saved and recovered voice recordings lead to preview before registration", () => {
  const recovered = JSON.parse(JSON.stringify(sample));
  const view = speakerUi.speakerSampleState(recovered, "off", 0);
  assert.equal(view.phase, "review");
  assert.equal(view.canRegister, true);
});

test("short or oversized voice recordings require rerecording in the UI", () => {
  for (const invalid of [
    { ...sample, durationMs: 9000 },
    { ...sample, durationMs: 31000 },
    { ...sample, sizeBytes: 6 * 1024 * 1024 },
  ]) {
    const view = speakerUi.speakerSampleState(invalid, "off", 0);
    assert.equal(view.phase, "invalid");
    assert.equal(view.canRegister, false);
    assert.ok(view.issue);
  }
});

test("voice registration timer never becomes negative after the target duration", () => {
  const view = speakerUi.speakerSampleState(undefined, "recording", 21000);
  assert.equal(view.remainingSeconds, 0);
  assert.equal(view.progress, 1);
});
