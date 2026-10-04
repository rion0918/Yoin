import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
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
            chunk.durationMs <= 1501000 && chunk.mimeType === "audio/mp4",
        ),
      );
      assert.equal(chunks.length, expectedCount);
      assert.ok(chunks.every((size) => size > 0 && size < 16 * 1024 * 1024));
    } finally {
      if (media) await new Promise((resolve) => media.close(resolve));
      if (source) await new Promise((resolve) => source.close(resolve));
      await rm(directory, { recursive: true, force: true });
    }
  });
