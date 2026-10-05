import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_AUDIO_BYTES,
  MAX_AUDIO_MS,
  UPLOAD_PART_BYTES,
} from "../../shared/contracts.ts";
import {
  audioPartRange,
  beginPreparedRecording,
  clipFromRecording,
  createSerialQueue,
  createSingleFlight,
  importedClip,
  shouldStopSpeakerRecording,
  validateInspection,
} from "./operations.ts";

test("recording anchors after preparation, persists before capture, and keeps the same source timestamp", async (t) => {
  const requestedAt = "2026-10-04T02:00:00.000Z";
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(requestedAt) });
  const order: string[] = [];
  const recorder = {
    uri: null as string | null,
    prepareToRecordAsync: async () => {
      order.push("prepared");
      t.mock.timers.tick(15000);
      recorder.uri = "file:///documents/a.m4a";
    },
    record: () => {
      order.push("capture");
    },
  };
  let savedAt = "";
  const prepared = await beginPreparedRecording(
    recorder,
    {
      clipId: "a",
      draftId: "d",
      recordedAt: requestedAt,
      timezone: "Asia/Tokyo",
    },
    async (pending) => {
      order.push("persisted");
      savedAt = pending.recordedAt;
    },
  );
  assert.deepEqual(order, ["prepared", "persisted", "capture"]);
  assert.equal(savedAt, "2026-10-04T02:00:15.000Z");
  assert.equal(prepared.recordedAt, savedAt);
  const clip = clipFromRecording(prepared, {
    durationMs: 1400,
    sizeBytes: 2400,
    mimeType: "audio/mp4",
  });
  assert.equal(clip.recordedAt, savedAt);
});

test("a failed pending-recording write prevents audio capture", async () => {
  let captured = false;
  const recorder = {
    uri: "file:///documents/a.m4a",
    prepareToRecordAsync: async () => {},
    record: () => {
      captured = true;
    },
  };
  await assert.rejects(
    beginPreparedRecording(
      recorder,
      {
        clipId: "a",
        draftId: "d",
        recordedAt: "2026-10-04T02:00:00.000Z",
        timezone: "Asia/Tokyo",
      },
      async () => {
        throw new Error("disk full");
      },
    ),
    /disk full/,
  );
  assert.equal(captured, false);
});

test("serialized persistence preserves order and a failed write does not block the next", async () => {
  const queue = createSerialQueue();
  const order: string[] = [];
  let release = () => {};
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = queue.run(async () => {
    order.push("first-start");
    await barrier;
    order.push("first-end");
  });
  const failed = queue.run(async () => {
    order.push("failed");
    throw new Error("disk full");
  });
  const failure = assert.rejects(failed, /disk full/);
  const last = queue.run(async () => {
    order.push("last");
  });
  await Promise.resolve();
  assert.deepEqual(order, ["first-start"]);
  release();
  await Promise.all([first, failure, last]);
  assert.deepEqual(order, ["first-start", "first-end", "failed", "last"]);
});

test("concurrent manual and native completion share exactly one stop operation", async () => {
  const gate = createSingleFlight();
  let stops = 0;
  let release = () => {};
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const finish = async () => {
    stops += 1;
    await barrier;
    return "saved-clip";
  };
  const manual = gate.run("clip-a", finish);
  const native = gate.run("clip-a", finish);
  assert.equal(manual, native);
  release();
  assert.deepEqual(await Promise.all([manual, native]), [
    "saved-clip",
    "saved-clip",
  ]);
  assert.equal(stops, 1);
});

test("failed completion can be retried without leaving a rejected gate", async () => {
  const gate = createSingleFlight();
  await assert.rejects(
    gate.run("clip-a", async () => {
      throw new Error("save failed");
    }),
    /save failed/,
  );
  assert.equal(await gate.run("clip-a", async () => "saved"), "saved");
});

test("speaker enrollment recordings stop at the requested twenty seconds", () => {
  const pending = {
    purpose: "speaker" as const,
    speakerProfileId: "speaker-a",
    clipId: "voice-a",
    recordedAt: "2026-10-05T00:00:00.000Z",
    timezone: "Asia/Tokyo",
    localUri: "file:///documents/voice-a.m4a",
  };
  assert.equal(shouldStopSpeakerRecording(pending, 19_999), false);
  assert.equal(shouldStopSpeakerRecording(pending, 20_000), true);
  assert.equal(
    shouldStopSpeakerRecording(
      { ...pending, purpose: undefined, draftId: "draft-a" },
      20_000,
    ),
    false,
  );
});

test("multipart reads use one bounded range and include the last partial part", () => {
  assert.deepEqual(
    audioPartRange(UPLOAD_PART_BYTES + 3, 1, UPLOAD_PART_BYTES),
    { offset: 0, length: UPLOAD_PART_BYTES },
  );
  assert.deepEqual(
    audioPartRange(UPLOAD_PART_BYTES + 3, 2, UPLOAD_PART_BYTES),
    { offset: UPLOAD_PART_BYTES, length: 3 },
  );
  assert.throws(() => audioPartRange(100, 0, 8), /区間/);
  assert.throws(() => audioPartRange(100, 14, 8), /区間/);
  assert.throws(() => audioPartRange(100, 1, UPLOAD_PART_BYTES + 1), /区間/);
});

test("audio inspection keeps real long recordings and rejects unreadable files without inventing duration", () => {
  const valid = { durationMs: 1400, sizeBytes: 2400, mimeType: "audio/mp4" };
  assert.deepEqual(validateInspection(valid), valid);
  assert.throws(() => validateInspection({ ...valid, durationMs: 0 }), /音声/);
  assert.throws(
    () => validateInspection({ ...valid, durationMs: Number.NaN }),
    /音声/,
  );
  assert.throws(() => validateInspection({ ...valid, sizeBytes: 0 }), /音声/);
  const longRecording = {
    ...valid,
    sizeBytes: MAX_AUDIO_BYTES + 1,
    durationMs: MAX_AUDIO_MS + 1,
  };
  assert.deepEqual(validateInspection(longRecording), longRecording);
});

test("recovered recordings use real metadata and cannot restore an unknown file", () => {
  const pending = {
    clipId: "a",
    draftId: "d",
    recordedAt: "2026-10-04T02:00:00.000Z",
    timezone: "Asia/Tokyo",
    localUri: "file:///documents/a.m4a",
  };
  const clip = clipFromRecording(pending, {
    durationMs: 843,
    sizeBytes: 1024,
    mimeType: "audio/mp4",
  });
  assert.equal(clip.durationMs, 843);
  assert.equal(clip.recordedAt, pending.recordedAt);
  assert.equal(clip.importedAt, null);
  assert.equal(clip.place, null);
  assert.throws(
    () =>
      clipFromRecording(
        { ...pending, localUri: null },
        { durationMs: 843, sizeBytes: 1024, mimeType: "audio/mp4" },
      ),
    /ファイル/,
  );
});

test("imports retain import time and never fabricate recording time or location", () => {
  const clip = importedClip(
    "a",
    "d",
    "file:///documents/a.mp3",
    { durationMs: 500, sizeBytes: 1000, mimeType: "audio/mpeg" },
    "2026-10-04T02:00:00.000Z",
    "Asia/Tokyo",
  );
  assert.equal(clip.recordedAt, null);
  assert.equal(clip.importedAt, "2026-10-04T02:00:00.000Z");
  assert.equal(clip.place, null);
  assert.equal(clip.durationMs, 500);
});
