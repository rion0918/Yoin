import assert from "node:assert/strict";
import test from "node:test";
import type { SpeakerProfile } from "../../shared/contracts.ts";
import { ApiError, createApi } from "./api.ts";

test("a lost generation response is never automatically sent twice", async () => {
  let requests = 0;
  const api = createApi(
    { apiUrl: "https://test.invalid", token: "tester" },
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
    /同じ処理ID/,
  );
  assert.equal(requests, 1);
});
test("invalid auth and stale revisions are reported without starting another operation", async () => {
  const api = createApi(
    { apiUrl: "https://test.invalid", token: "tester" },
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
    { apiUrl: "https://test.invalid", token: "tester" },
    async () => Response.json({ error: "unauthorized" }, { status: 401 }),
  );
  await assert.rejects(api.songs(), /検証用トークン/);
});
test("missing speaker API reports an unsupported server instead of invalid connection settings", async () => {
  const api = createApi(
    { apiUrl: "https://test.invalid", token: "tester" },
    async () => Response.json({ error: "route_not_found" }, { status: 404 }),
  );
  await assert.rejects(
    api.createSpeaker("speaker-a", "あおい"),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 404 &&
      error.message ===
        "接続先がこの機能に対応していません。サーバーの更新状況を確認してください。",
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
    { apiUrl: "https://test.invalid", token: "tester" },
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
    { apiUrl: "https://test.invalid", token: "tester" },
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
    { apiUrl: "https://test.invalid", token: "tester" },
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
    { apiUrl: "https://test.invalid", token: "tester" },
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
