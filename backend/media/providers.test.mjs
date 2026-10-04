import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createMediaServer } from "./server.mjs";

test("remote music is claimed once, streamed to storage, and cached before responding", async () => {
  const events = [];
  let claims = 0;
  const storage = createServer(async (request, response) => {
    const action = request.url.split("?")[0].split("/").at(-1);
    if (action === "claim" && claims++ > 0) {
      response.writeHead(409);
      response.end();
      return;
    }
    events.push(action);
    const buffers = [];
    for await (const part of request) buffers.push(part);
    const bytes = Buffer.concat(buffers);
    response.writeHead(200, { "Content-Type": "application/json" });
    if (action === "claim") response.end(JSON.stringify({ stage: "music" }));
    else if (action === "song") {
      assert.equal(bytes.toString(), "ID3song");
      response.end(
        JSON.stringify({
          audioId: "song-audio-job",
          key: "songs/private-tester/job.mp3",
          sizeBytes: bytes.length,
          mimeType: "audio/mpeg",
        }),
      );
    } else if (action === "raw") {
      assert.equal(JSON.parse(bytes).status, "completed");
      response.end(
        JSON.stringify({ key: "results/private-tester/music-job.raw.json" }),
      );
    } else {
      const result = JSON.parse(bytes);
      assert.equal(result.version, 1);
      assert.equal(result.usage.raw, undefined);
      response.end("{}");
    }
  });
  await new Promise((resolve) => storage.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${storage.address().port}`;
  const token = "t".repeat(64);
  let submissions = 0;
  const media = createMediaServer({
    token,
    origin,
    apiKey: "test",
    providerFetch: async () => {
      submissions++;
      events.push("provider");
      return Response.json({
        status: "completed",
        steps: [
          {
            type: "model_output",
            content: [
              {
                type: "audio",
                mime_type: "audio/mpeg",
                data: Buffer.from("ID3song").toString("base64"),
              },
              { type: "text", text: "また歩こう" },
            ],
          },
        ],
      });
    },
  });
  await new Promise((resolve) => media.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${media.address().port}`;
  const call = () =>
    fetch(`${base}/music`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        claimUrl: `${origin}/internal/attempts/music-job/claim?signature=test`,
        resultUrl: `${origin}/internal/attempts/music-job/result?signature=test`,
        rawUrl: `${origin}/internal/attempts/music-job/raw?signature=test`,
        songUploadUrl: `${origin}/internal/attempts/music-job/song?signature=test`,
        blocks: [
          { id: "verse", text: "また歩こう", sourceUtteranceIds: ["u1"] },
        ],
      }),
    });
  try {
    const response = await call();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).value.audioId, "song-audio-job");
    assert.deepEqual(events, ["claim", "provider", "song", "raw", "result"]);
    assert.equal((await call()).status, 422);
    assert.equal(submissions, 1);
  } finally {
    await Promise.all([
      new Promise((resolve) => media.close(resolve)),
      new Promise((resolve) => storage.close(resolve)),
    ]);
  }
});
