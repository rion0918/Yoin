import { env, reset } from "cloudflare:test";
import { beforeEach, expect, it, vi } from "vitest";
import {
  SPEAKER_EMBEDDING_DIM,
  SPEAKER_MODEL_VERSION,
} from "../../shared/contracts.ts";
import { enrollSpeakerAudio } from "../media.ts";
import initialSchema from "../migrations/0001_initial.sql?raw";
import runtimeSchema from "../migrations/0002_audio_runtime.sql?raw";
import speakerSchema from "../migrations/0003_speaker_profiles.sql?raw";
import { handleSpeakers } from "../speakers.ts";
import type { Env } from "../types.ts";

vi.mock("../media.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../media.ts")>()),
  enrollSpeakerAudio: vi.fn(),
}));

let bindings: Env;

beforeEach(async () => {
  await reset();
  vi.resetAllMocks();
  bindings = { ...env, OWNER_ID: "private-tester" } as unknown as Env;
  await bindings.DB.batch(
    `${initialSchema}\n${runtimeSchema}\n${speakerSchema}`
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => bindings.DB.prepare(statement)),
  );
});

function jsonRequest(path: string, method: string, value: unknown) {
  return new Request(`https://yoin.test${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

async function createUploadedSample(speakerId: string, sampleId: string) {
  const created = await handleSpeakers(
    jsonRequest(`/speakers/${speakerId}/samples`, "POST", {
      id: sampleId,
      mimeType: "audio/mp4",
      sizeBytes: 3,
      durationMs: 20_000,
    }),
    bindings,
    "private-tester",
    `/speakers/${speakerId}/samples`,
  );
  expect(created?.status).toBe(201);
  const upload = await handleSpeakers(
    new Request(
      `https://yoin.test/speakers/${speakerId}/samples/${sampleId}/audio`,
      {
        method: "PUT",
        headers: { "Content-Length": "3" },
        body: "abc",
      },
    ),
    bindings,
    "private-tester",
    `/speakers/${speakerId}/samples/${sampleId}/audio`,
  );
  expect(upload?.status).toBe(200);
}

function embedding() {
  return {
    modelVersion: SPEAKER_MODEL_VERSION,
    embedding: Array.from({ length: SPEAKER_EMBEDDING_DIM }, (_, index) =>
      index === 0 ? 1 : 0,
    ),
    speechDurationMs: 12_000,
    sizeBytes: 3,
    durationMs: 20_000,
  };
}

it("preserves a ready voice if rerecord enrollment fails, then removes the superseded voice after success", async () => {
  const created = await handleSpeakers(
    jsonRequest("/speakers", "POST", { id: "speaker-a", name: "あおい" }),
    bindings,
    "private-tester",
    "/speakers",
  );
  expect(created?.status).toBe(201);

  await createUploadedSample("speaker-a", "sample-old");
  vi.mocked(enrollSpeakerAudio).mockResolvedValue(embedding());
  const firstEnrollment = await handleSpeakers(
    jsonRequest("/speakers/speaker-a/samples/sample-old/enroll", "POST", {}),
    bindings,
    "private-tester",
    "/speakers/speaker-a/samples/sample-old/enroll",
  );
  expect(firstEnrollment?.status).toBe(200);

  const renamed = await handleSpeakers(
    jsonRequest("/speakers/speaker-a", "PATCH", { name: "葵" }),
    bindings,
    "private-tester",
    "/speakers/speaker-a",
  );
  expect(await renamed?.json()).toMatchObject({
    id: "speaker-a",
    name: "葵",
    status: "ready",
    sampleId: "sample-old",
  });

  await createUploadedSample("speaker-a", "sample-new");
  vi.mocked(enrollSpeakerAudio).mockRejectedValueOnce(
    new Error("temporary matcher outage"),
  );
  await expect(
    handleSpeakers(
      jsonRequest("/speakers/speaker-a/samples/sample-new/enroll", "POST", {}),
      bindings,
      "private-tester",
      "/speakers/speaker-a/samples/sample-new/enroll",
    ),
  ).rejects.toThrow("temporary matcher outage");

  const stillReady = await handleSpeakers(
    new Request("https://yoin.test/speakers/speaker-a"),
    bindings,
    "private-tester",
    "/speakers/speaker-a",
  );
  expect(await stillReady?.json()).toMatchObject({
    status: "ready",
    sampleId: "sample-old",
  });
  expect(
    await bindings.AUDIO.head(
      "voices/private-tester/speaker-a/sample-old.json",
    ),
  ).not.toBeNull();

  vi.mocked(enrollSpeakerAudio).mockResolvedValue(embedding());
  const retriedEnrollment = await handleSpeakers(
    jsonRequest("/speakers/speaker-a/samples/sample-new/enroll", "POST", {}),
    bindings,
    "private-tester",
    "/speakers/speaker-a/samples/sample-new/enroll",
  );
  expect(retriedEnrollment?.status).toBe(200);
  expect(await retriedEnrollment?.json()).toMatchObject({
    status: "ready",
    sampleId: "sample-new",
  });
  expect(
    await bindings.DB.prepare(
      "SELECT id FROM speaker_samples WHERE id = 'sample-old'",
    ).first(),
  ).toBeNull();
  expect(
    await bindings.AUDIO.head(
      "voices/private-tester/speaker-a/sample-old.json",
    ),
  ).toBeNull();
  expect(
    await bindings.AUDIO.head(
      "voices/private-tester/speaker-a/sample-old.audio",
    ),
  ).toBeNull();
});
