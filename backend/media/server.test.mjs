import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import test from "node:test";
import { promisify } from "node:util";
import { createMediaServer } from "./server.mjs";

const execFile = promisify(execFileCallback);
const token = "private-media-test-credential-at-least-thirty-two-bytes";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function holdRequest(server, base, path, headers) {
  const received = new Promise((resolve) => {
    server.once("request", resolve);
  });
  const request = httpRequest(new URL(path, base), {
    method: "POST",
    headers: { ...headers, "Content-Length": "2" },
  });
  const response = new Promise((resolve) => {
    request.once("response", resolve);
    request.once("error", resolve);
  });
  request.flushHeaders();
  await received;
  return { request, response };
}

test("media service rejects invalid credentials without fetching audio", async () => {
  const server = createMediaServer({ token, origin: "https://yoin.test" });
  const base = await listen(server);
  try {
    const response = await fetch(`${base}/inspect`, {
      method: "POST",
      body: "{}",
    });
    assert.equal(response.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("media service marks missing provider configuration as not submitted", async () => {
  const server = createMediaServer({ token, origin: "https://yoin.test" });
  const base = await listen(server);
  try {
    const response = await fetch(`${base}/music`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("X-Provider-Not-Submitted"), "true");
    assert.deepEqual(await response.json(), {
      error: "provider_not_configured",
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("media service marks busy paid requests as not submitted", async () => {
  const server = createMediaServer({
    token,
    origin: "https://yoin.test",
    apiKey: "test",
    providerFetch: () => new Promise(() => {}),
  });
  const base = await listen(server);
  const active = await holdRequest(server, base, "/probe", {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  });
  try {
    const response = await fetch(`${base}/music`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Provider-Attempt": "music-job",
      },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("X-Provider-Not-Submitted"), "true");
    assert.deepEqual(await response.json(), { error: "media_service_busy" });
    active.request.end("{}");
    const firstResponse = await active.response;
    assert.equal(firstResponse.statusCode, 422);
    firstResponse.resume();
  } finally {
    if (!active.request.writableEnded) active.request.end("{}");
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("media service does not mark a concurrent request for the active attempt as unsubmitted", async () => {
  const server = createMediaServer({
    token,
    origin: "https://yoin.test",
    apiKey: "test",
  });
  const base = await listen(server);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-Provider-Attempt": "music-job",
  };
  const active = await holdRequest(server, base, "/music", headers);
  try {
    const response = await fetch(`${base}/music`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("X-Provider-Not-Submitted"), null);
    await response.body?.cancel();
    active.request.end("{}");
    const firstResponse = await active.response;
    assert.equal(firstResponse.statusCode, 503);
    firstResponse.resume();
  } finally {
    if (!active.request.writableEnded) active.request.end("{}");
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

for (const durationSeconds of [1560, 3600])
  test(`FFmpeg splits a ${durationSeconds / 60}-minute recording with original offsets and probes duration`, {
    skip: !process.env.FFMPEG_BIN || !process.env.FFPROBE_BIN,
  }, async () => {
    const directory = await mkdtemp(join(tmpdir(), "yoin-media-test-"));
    const audio = join(directory, "recording.m4a");
    const chunks = [];
    let media;
    let source;
    try {
      await execFile(
        process.env.FFMPEG_BIN,
        [
          "-nostdin",
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          "anullsrc=r=16000:cl=mono",
          "-t",
          String(durationSeconds),
          "-c:a",
          "aac",
          "-b:a",
          "16k",
          audio,
        ],
        { timeout: 120_000 },
      );
      source = createServer(async (request, response) => {
        if (request.method === "GET") {
          response.writeHead(200, {
            "Content-Length": String((await stat(audio)).size),
          });
          await pipeline(createReadStream(audio), response);
          return;
        }
        let bytes = 0;
        for await (const chunk of request) bytes += chunk.length;
        const index = Number(request.url.split("?")[0].split("/").at(-1));
        chunks[index] = bytes;
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            key: `processed/private-tester/job/clip/${index}.m4a`,
          }),
        );
      });
      const origin = await listen(source);
      media = createMediaServer({
        token,
        origin,
        ffmpeg: process.env.FFMPEG_BIN,
        ffprobe: process.env.FFPROBE_BIN,
      });
      const base = await listen(media);
      const response = await fetch(`${base}/inspect`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sourceUrl: `${origin}/media/clip?signature=test`,
          uploadUrls: [0, 1, 2].map(
            (index) =>
              `${origin}/internal/chunks/job/clip/${index}?signature=test`,
          ),
        }),
      });
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      assert.equal(result.durationMs, durationSeconds * 1000);
      const expectedCount = Math.ceil(durationSeconds / 1500);
      assert.equal(result.chunks.length, expectedCount);
      assert.equal(result.chunks[0].offsetMs, 0);
      assert.ok(
        result.chunks[1].offsetMs >= 1500000 &&
          result.chunks[1].offsetMs < 1501000,
      );
      assert.ok(
        result.chunks.every(
          (chunk) =>
            chunk.durationMs <= 1501000 &&
            chunk.mimeType === "audio/mp4" &&
            Array.isArray(chunk.activityRanges),
        ),
      );
      assert.equal(
        result.chunks.flatMap((chunk) => chunk.activityRanges).length,
        0,
      );
      assert.equal(chunks.length, expectedCount);
      assert.ok(chunks.every((size) => size > 0 && size < 16 * 1024 * 1024));
    } finally {
      if (media) await new Promise((resolve) => media.close(resolve));
      if (source) await new Promise((resolve) => source.close(resolve));
      await rm(directory, { recursive: true, force: true });
    }
  });

test("FFmpeg counts background noise above the configured activity threshold", {
  skip: !process.env.FFMPEG_BIN,
}, async () => {
  const result = await execFile(
    process.env.FFMPEG_BIN,
    [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "info",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=16000:duration=60",
      "-af",
      "volume=0:enable='between(t,0,30)',silencedetect=noise=-50dB:d=0.25",
      "-f",
      "null",
      "-",
    ],
    { timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  const { activityRangesFromSilenceLog } = await import("./activity.mjs");
  const ranges = activityRangesFromSilenceLog(result.stderr, 60_000);
  assert.equal(ranges.length, 1);
  assert.ok(ranges[0].startMs >= 29_000 && ranges[0].startMs <= 31_000);
  assert.ok(ranges[0].endMs >= 59_000);
});
