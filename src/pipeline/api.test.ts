import assert from "node:assert/strict";
import test from "node:test";
import type { SpeakerProfile } from "../../shared/contracts.ts";
import { ApiError, createApi } from "./api.ts";

test("uses a fresh Firebase token for each JSON request and binary upload", async () => {
  let tokens = 0;
  const headers: string[] = [];
  const api = createApi(
    {
      apiUrl: "https://test.invalid",
      getIdToken: async () => `firebase-${++tokens}`,
    },
    async (_url, options) => {
      headers.push(new Headers(options?.headers).get("Authorization") ?? "");
      return Response.json([]);
    },
  );
  await api.songs();
  await api.uploadPart("clip", "upload", 1, new Uint8Array([1]));
  await api.uploadSpeakerSample("speaker", "sample", new Uint8Array([1]));
  assert.deepEqual(headers, [
    "Bearer firebase-1",
    "Bearer firebase-2",
    "Bearer firebase-3",
  ]);
});

test("uploads and retrieves location routes with owner authentication", async () => {
  const timestamp = Date.parse("2026-10-06T00:00:00.000Z");
  const route = {
    version: 1 as const,
    draftId: "draft-a",
    clipId: "clip-a",
    recordedAt: new Date(timestamp).toISOString(),
    endedAt: new Date(timestamp + 60_000).toISOString(),
    segments: [
      {
        startedAt: timestamp,
        endedAt: timestamp + 60_000,
        samples: [
          {
            latitude: 34.66871,
            longitude: 135.50131,
            accuracy: 24,
            timestamp,
          },
        ],
      },
    ],
  };
  const requests: { url: string; method: string; body: unknown }[] = [];
  const api = createApi(
    { apiUrl: "https://test.invalid", getIdToken: async () => "tester" },
    async (url, options) => {
      requests.push({
        url: String(url),
        method: options?.method ?? "GET",
        body: options?.body,
      });
      return Response.json({
        summary: {
          startLocation: route.segments[0].samples[0],
          endLocation: route.segments[0].samples[0],
          representativeLocations: route.segments[0].samples,
          places: [],
          routeObjectKey: "locations/owner/draft-a/clip-a/location.json",
        },
      });
    },
  );
  const body = { route, representativeTimestamps: [timestamp], places: [] };
  const uploaded = await api.uploadLocation("clip-a", body);
  assert.equal(
    uploaded.summary.routeObjectKey,
    "locations/owner/draft-a/clip-a/location.json",
  );
  assert.equal(requests[0].method, "PUT");
  assert.equal(requests[0].url, "https://test.invalid/clips/clip-a/location");
  assert.equal(requests[0].body, JSON.stringify(body));
  await api.location("clip-a");
  assert.equal(requests[1].method, "GET");
});

test("a lost generation response is never automatically sent twice", async () => {
  let requests = 0;
  const api = createApi(
    { apiUrl: "https://test.invalid", getIdToken: async () => "tester" },
    async (_url, options) => {
      requests++;
      assert.equal(
        options?.body,
        JSON.stringify({ revision: 3, idempotencyKey: "same-operation" }),
      );
      assert.equal(
        new Headers(options?.headers).get("Authorization"),
        "Bearer tester",
      );
      throw new TypeError("network unavailable");
    },
  );
  await assert.rejects(
    api.generate("draft", 3, "same-operation"),
    /音声と歌詞/,
  );
  assert.equal(requests, 1);
});
test("invalid auth and stale revisions are reported without starting another operation", async () => {
  const api = createApi(
    { apiUrl: "https://test.invalid", getIdToken: async () => "tester" },
    async () =>
      Response.json({ error: "歌詞の版が古いです。" }, { status: 409 }),
  );
  await assert.rejects(
    api.generate("draft", 1, "same-operation"),
    (error: unknown) => error instanceof ApiError && error.status === 409,
  );
});

test("server authentication errors explain the next action in Japanese", async () => {
  const api = createApi(
    { apiUrl: "https://test.invalid", getIdToken: async () => "tester" },
    async () => Response.json({ error: "unauthorized" }, { status: 401 }),
  );
  await assert.rejects(api.songs(), /ログイン/);
});
test("missing speaker API reports an unsupported server instead of invalid connection settings", async () => {
  const api = createApi(
    { apiUrl: "https://test.invalid", getIdToken: async () => "tester" },
    async () => Response.json({ error: "route_not_found" }, { status: 404 }),
  );
  await assert.rejects(
    api.createSpeaker("speaker-a", "あおい"),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 404 &&
      error.message ===
        "現在この操作を利用できません。時間をおいてお試しください。",
  );
});
test("multipart progress uses the server ETag and reads only the requested bytes", async () => {
  const speaker: SpeakerProfile = {
    id: "speaker-a",
    name: "あおい",
    status: "pending",
    sampleId: null,
    modelVersion: null,
  };
  const requests: { url: string; method: string; body?: unknown }[] = [];
  const api = createApi(
    { apiUrl: "https://test.invalid", getIdToken: async () => "tester" },
    async (url, options) => {
      requests.push({
        url: String(url),
        method: options?.method ?? "GET",
        body: options?.body,
      });
      if (String(url) === "https://test.invalid/speakers")
        return Response.json([speaker]);
      if (
        String(url) ===
        "https://test.invalid/speakers/speaker-a/samples/voice-a/audio"
      )
        return Response.json({
          id: "voice-a",
          speakerProfileId: "speaker-a",
          status: "uploaded",
        });
      return Response.json(speaker);
    },
  );
  assert.deepEqual(await api.speakers(), [speaker]);
  const audio = new Uint8Array([1, 2, 3]);
  await api.uploadSpeakerSample("speaker-a", "voice-a", audio);
  assert.deepEqual(
    requests.map(({ method }) => method),
    ["GET", "PUT"],
  );
  assert.equal(
    requests[1].url,
    "https://test.invalid/speakers/speaker-a/samples/voice-a/audio",
  );
  assert.deepEqual(new Uint8Array(requests[1].body as ArrayBuffer), audio);
});

test("speaker profile changes use authenticated JSON requests", async () => {
  const requests: { url: string; method: string; body: unknown }[] = [];
  const api = createApi(
    { apiUrl: "https://test.invalid", getIdToken: async () => "tester" },
    async (url, options) => {
      requests.push({
        url: String(url),
        method: options?.method ?? "GET",
        body: options?.body,
      });
      return Response.json({ deleted: true });
    },
  );
  await api.createSpeaker("speaker-a", "あおい");
  await api.renameSpeaker("speaker-a", "葵");
  await api.deleteSpeaker("speaker-a");
  assert.deepEqual(
    requests.map(({ method }) => method),
    ["POST", "PATCH", "DELETE"],
  );
  assert.deepEqual(JSON.parse(requests[0].body as string), {
    id: "speaker-a",
    name: "あおい",
  });
});

test("speaker enrollment can resolve a lost success response by reading the profile", async () => {
  let requests = 0;
  const api = createApi(
    { apiUrl: "https://test.invalid", getIdToken: async () => "tester" },
    async (url) => {
      requests++;
      if (String(url).endsWith("/enroll"))
        throw new TypeError("network unavailable");
      return Response.json({
        id: "speaker-a",
        name: "あおい",
        status: "ready",
        sampleId: "voice-a",
        modelVersion: "model-v1",
      });
    },
  );
  await assert.rejects(api.enrollSpeaker("speaker-a", "voice-a"));
  assert.equal(requests, 1);
  assert.equal((await api.speaker("speaker-a")).status, "ready");
});

test("multipart progress uses the server ETag and reads only the requested bytes", async () => {
  const api = createApi(
    { apiUrl: "https://test.invalid", getIdToken: async () => "tester" },
    async (url, options) => {
      assert.equal(
        String(url),
        "https://test.invalid/clips/c1/parts/2?uploadId=upload-1",
      );
      assert.deepEqual(
        new Uint8Array(options?.body as ArrayBuffer),
        new Uint8Array([3, 4]),
      );
      return Response.json({ partNumber: 2, etag: "confirmed" });
    },
  );
  assert.deepEqual(
    await api.uploadPart("c1", "upload-1", 2, new Uint8Array([3, 4])),
    { partNumber: 2, etag: "confirmed" },
  );
});

test("logout aborts a request waiting for an ID token before it can submit", async () => {
  const controller = new AbortController();
  let release: (token: string) => void = () => {};
  let submissions = 0;
  const api = createApi(
    {
      apiUrl: "https://test.invalid",
      signal: controller.signal,
      getIdToken: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    },
    async () => {
      submissions++;
      return Response.json({});
    },
  );
  const pending = api.generate("draft", 1, "operation");
  controller.abort();
  release("old-token");
  await assert.rejects(pending);
  assert.equal(submissions, 0);
});
test("a paid POST rejected by authentication is not retried", async () => {
  let submissions = 0;
  const api = createApi(
    { apiUrl: "https://test.invalid", getIdToken: async () => "token" },
    async () => {
      submissions++;
      return Response.json({ error: "unauthorized" }, { status: 401 });
    },
  );
  await assert.rejects(api.generate("draft", 1, "operation"), ApiError);
  assert.equal(submissions, 1);
});
