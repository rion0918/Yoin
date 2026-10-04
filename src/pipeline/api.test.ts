import assert from "node:assert/strict";
import test from "node:test";
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
