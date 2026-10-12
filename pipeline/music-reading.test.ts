import assert from "node:assert/strict";
import test from "node:test";
import { createLyrics, createReadings, generateMusic } from "./google.ts";

const block = {
  id: "verse",
  text: "三宮で十五の夢を見た",
  section: "verse" as const,
  singingText: "さんのみやでじゅうごのゆめをみた",
  sourceUtteranceIds: ["u1"],
};
test("full-length music audio can be decoded without overflowing validation", async () => {
  const audio = Buffer.alloc(4 * 1024 * 1024, 0x55);
  audio.set([0x49, 0x44, 0x33], 0);
  let calls = 0;
  const result = await generateMusic({
    apiKey: "test-key",
    blocks: [block],
    musicPreferences: { genre: "acoustic", vocal: "female" },
    generationVersion: 2,
    fetch: (async () => {
      calls++;
      return Response.json({
        status: "completed",
        steps: [
          {
            type: "model_output",
            content: [
              { type: "text", text: block.singingText },
              {
                type: "audio",
                mime_type: "audio/mpeg",
                data: audio.toString("base64"),
              },
            ],
          },
        ],
      });
    }) as typeof fetch,
  });
  assert.equal(calls, 1);
  assert.deepEqual(Buffer.from(result.bytes), audio);
  assert.equal(result.returnedLyrics, block.singingText);
});
test("new music inputs use approved readings and official lyric structure", async () => {
  let input = "";
  await generateMusic({
    apiKey: "test-key",
    blocks: [block, { ...block, id: "chorus", section: "chorus" }],
    musicPreferences: { genre: "jpop", vocal: "female" },
    generationVersion: 2,
    fetch: (async (_url, init) => {
      input = JSON.parse(String(init?.body)).input;
      return Response.json({
        status: "completed",
        steps: [
          {
            type: "model_output",
            content: [
              {
                type: "text",
                text: `${block.singingText}\n${block.singingText}`,
              },
              { type: "audio", mime_type: "audio/mp3", data: "SUQzBAAAAAAA" },
            ],
          },
        ],
      });
    }) as typeof fetch,
  } as Parameters<typeof generateMusic>[0] & {
    musicPreferences: { genre: string; vocal: string };
    generationVersion: number;
  });
  assert.match(input, /Lyrics:/);
  assert.match(input, /112 BPM/);
  assert.match(input, /\[Verse 1\]/);
  assert.match(input, /\[Chorus\]/);
  assert.ok(input.includes(block.singingText));
  assert.ok(!input.split("Lyrics:")[1]?.includes(block.text));
  assert.ok(!input.includes("sourceUtteranceIds"));
});
const utterances = [
  {
    id: "u1",
    clipId: "clip",
    startMs: 0,
    endMs: 500,
    speaker: "spk_1",
    text: "三宮で十五の夢を見た",
  },
];
function textResponse(value: unknown) {
  return Response.json({
    status: "completed",
    usage: { total_input_tokens: 100, total_output_tokens: 100 },
    steps: [
      {
        type: "model_output",
        content: [{ type: "text", text: JSON.stringify(value) }],
      },
    ],
  });
}
test("new lyrics return sections and readings from one source-backed call", async () => {
  let calls = 0;
  const result = await createLyrics({
    apiKey: "test",
    utterances,
    generationVersion: 2,
    musicPreferences: { genre: "bossa", vocal: "male" },
    fetch: (async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.generation_config.thinking_level, "high");
      assert.ok(
        body.response_format.schema.properties.blocks.items.required.includes(
          "singingText",
        ),
      );
      assert.match(body.system_instruction, /ボサノバ/);
      return textResponse({ blocks: [block] });
    }) as typeof fetch,
  });
  assert.deepEqual(result.blocks, [block]);
  assert.equal(calls, 1);
});
test("reading updates request only missing blocks and preserve hand-edited readings", async () => {
  const second = {
    ...block,
    id: "second",
    singingText: "さんのみやでじゅうごのゆめおみた",
  };
  const result = await createReadings({
    apiKey: "test",
    utterances,
    blocks: [{ ...block, singingText: undefined }, second],
    fetch: (async (_url, init) => {
      const input = JSON.parse(JSON.parse(String(init?.body)).input);
      assert.equal(
        JSON.parse(String(init?.body)).generation_config.thinking_level,
        "high",
      );
      assert.deepEqual(input.blocks, [{ id: block.id, text: block.text }]);
      return textResponse({
        readings: [{ id: block.id, singingText: block.singingText }],
      });
    }) as typeof fetch,
  });
  assert.deepEqual(result.blocks, [block, second]);
});
test("invalid reading responses and ambiguous failures never trigger another call", async () => {
  for (const bad of [
    [{ id: "unknown", singingText: "かな" }],
    [],
    [{ id: block.id, singingText: "三宮" }],
    [
      { id: block.id, singingText: block.singingText },
      { id: block.id, singingText: block.singingText },
    ],
  ]) {
    let calls = 0;
    await assert.rejects(
      createReadings({
        apiKey: "test",
        utterances,
        blocks: [{ ...block, singingText: undefined }],
        fetch: (async () => {
          calls++;
          return textResponse({ readings: bad });
        }) as typeof fetch,
      }),
    );
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(
    createReadings({
      apiKey: "test",
      utterances,
      blocks: [{ ...block, singingText: undefined }],
      fetch: (async () => {
        calls++;
        throw new Error("lost");
      }) as typeof fetch,
    }),
  );
  assert.equal(calls, 1);
});
test("missing readings stop new music before a paid request", async () => {
  let calls = 0;
  await assert.rejects(
    generateMusic({
      apiKey: "test-key",
      blocks: [{ ...block, singingText: undefined }],
      generationVersion: 2,
      musicPreferences: { genre: "acoustic", vocal: "auto" },
      fetch: (async () => {
        calls++;
        throw new Error("submitted");
      }) as typeof fetch,
    } as Parameters<typeof generateMusic>[0] & {
      generationVersion: number;
      musicPreferences: object;
    }),
  );
  assert.equal(calls, 0);
});
