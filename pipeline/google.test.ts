import assert from "node:assert/strict";
import test from "node:test";
import {
  createLyrics,
  GoogleProviderError,
  generateMusic,
  parseTranscription,
  transcribeAudio,
} from "./google.ts";

const apiKey = "test-key";
const usage = {
  total_input_tokens: 1000,
  total_output_tokens: 100,
  total_thought_tokens: 10,
};
const utterances = [
  {
    id: "u1",
    clipId: "c1",
    startMs: 10,
    endMs: 2000,
    speaker: "spk_1",
    text: "京都にまた来よう",
  },
];
function response(content: unknown[]) {
  return {
    status: "completed",
    steps: [{ type: "model_output", content }],
    usage,
  };
}
function mockFetch(
  responses: Response[],
  calls: { url: string; body: unknown }[],
) {
  return (async (input, init) => {
    calls.push({ url: String(input), body: init?.body });
    const next = responses.shift();
    assert.ok(next);
    return next;
  }) as typeof globalThis.fetch;
}
function uploadResponses() {
  return [
    new Response(null, {
      headers: {
        "x-goog-upload-url":
          "https://generativelanguage.googleapis.com/upload/session/test",
      },
    }),
    Response.json({
      file: {
        uri: "https://generativelanguage.googleapis.com/v1beta/files/f1",
        state: "ACTIVE",
      },
    }),
  ];
}
test("STT uses documented word_info and preserves the original clip offset", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const data = response([
    {
      type: "text",
      text: "京都にまた来よう",
      annotations: [
        {
          type: "word_info",
          text: "京都に",
          speaker: "spk_1",
          start_offset: "0.100s",
          end_offset: "0.900s",
        },
        {
          type: "word_info",
          text: "また来よう",
          speaker: "spk_1",
          start_offset: "1.000s",
          end_offset: "2.000s",
        },
      ],
    },
  ]);
  const result = await transcribeAudio({
    bytes: new Uint8Array([1, 2]),
    mimeType: "audio/m4a",
    clipId: "clip-a",
    offsetMs: 60000,
    apiKey,
    fetch: mockFetch([...uploadResponses(), Response.json(data)], calls),
  });
  assert.equal(result.utterances.length, 1);
  assert.equal(result.utterances[0]?.startMs, 60100);
  assert.equal(result.utterances[0]?.endMs, 62000);
  assert.equal(result.utterances[0]?.clipId, "clip-a");
  assert.equal(result.utterances[0]?.text, "京都にまた来よう");
  const request = JSON.parse(String(calls.at(-1)?.body));
  assert.equal(request.model, "gemini-3.5-transcribe");
  assert.deepEqual(
    request.generation_config.transcription_config.mode.timestamp_granularities,
    ["word"],
  );
  assert.ok(result.costUsd > 0);
});
test("STT normalizes zero-based colon speakers into the existing temporary labels", async () => {
  const raw = response([
    {
      type: "text",
      annotations: Array.from({ length: 8 }, (_, index) => ({
        type: "word_info",
        text: "会話",
        speaker: `spk:${index}`,
        start_offset: `${index}s`,
        end_offset: `${index + 0.5}s`,
      })),
    },
  ]);
  const calls: { url: string; body: unknown }[] = [];
  const result = await transcribeAudio({
    bytes: new Uint8Array([1]),
    mimeType: "audio/wav",
    clipId: "source",
    offsetMs: 60000,
    apiKey,
    fetch: mockFetch([...uploadResponses(), Response.json(raw)], calls),
  });
  assert.deepEqual(
    result.utterances.map((item) => item.speaker),
    Array.from({ length: 8 }, (_, index) => `spk_${index + 1}`),
  );
  assert.equal(result.utterances[0]?.startMs, 60000);
  assert.equal(result.utterances[7]?.endMs, 67500);
  assert.equal(
    calls.filter((call) => call.url.endsWith("/interactions")).length,
    1,
  );
});
test("saved completed transcriptions can be parsed without credentials or another request", () => {
  const raw = response([
    {
      type: "text",
      annotations: [
        {
          type: "word_info",
          text: "また来よう",
          speaker: "spk:0",
          start_offset: "0.200s",
          end_offset: "1.100s",
        },
        {
          type: "word_info",
          text: "うん",
          speaker: "spk_8",
          start_offset: "1.200s",
          end_offset: "1.500s",
        },
      ],
    },
  ]);
  const original = structuredClone(raw);
  const result = parseTranscription(raw, { clipId: "saved", offsetMs: 60000 });
  assert.deepEqual(result.utterances, [
    {
      id: "saved:u:60200:1",
      clipId: "saved",
      startMs: 60200,
      endMs: 61100,
      speaker: "spk_1",
      text: "また来よう",
    },
    {
      id: "saved:u:61200:2",
      clipId: "saved",
      startMs: 61200,
      endMs: 61500,
      speaker: "spk_8",
      text: "うん",
    },
  ]);
  assert.equal(result.costUsd, (1000 * 2 + 110 * 12) / 1_000_000);
  assert.deepEqual(result.usage, {
    model: "gemini-3.5-transcribe",
    costSource: "reported_tokens",
    raw,
  });
  assert.deepEqual(raw, original);
});
test("offline parsing retains response, source offset and speaker validation", () => {
  const options = { clipId: "saved", offsetMs: 0 };
  assert.throws(() => parseTranscription(null, options), /invalid_response/);
  assert.throws(
    () =>
      parseTranscription({ ...response([]), status: "in_progress" }, options),
    /unknown/,
  );
  assert.throws(
    () => parseTranscription(response([]), { clipId: "saved", offsetMs: -1 }),
    /input/,
  );
  for (const speaker of ["spk:8", "spk:-1", "spk:00", "spk:1.0", "spk_0"]) {
    assert.throws(
      () =>
        parseTranscription(
          response([
            {
              type: "text",
              annotations: [
                {
                  type: "word_info",
                  text: "会話",
                  speaker,
                  start_offset: "0s",
                  end_offset: "1s",
                },
              ],
            },
          ]),
          options,
        ),
      /invalid_response/,
    );
  }
});
test("STT rejects missing provenance annotations instead of inventing source timestamps", async () => {
  await assert.rejects(
    transcribeAudio({
      bytes: new Uint8Array([1]),
      mimeType: "audio/wav",
      clipId: "c",
      offsetMs: 0,
      apiKey,
      fetch: mockFetch(
        [
          ...uploadResponses(),
          Response.json(response([{ type: "text", text: "unknown timing" }])),
        ],
        [],
      ),
    }),
  );
});
test("STT rejects invalid speaker and reversed word intervals", async () => {
  for (const word of [
    { speaker: "Aoi", start_offset: "0s", end_offset: "1s" },
    { speaker: "spk_1", start_offset: "2s", end_offset: "1s" },
  ]) {
    await assert.rejects(
      transcribeAudio({
        bytes: new Uint8Array([1]),
        mimeType: "audio/wav",
        clipId: "c",
        offsetMs: 0,
        apiKey,
        fetch: mockFetch(
          [
            ...uploadResponses(),
            Response.json(
              response([
                {
                  type: "text",
                  annotations: [{ type: "word_info", text: "hello", ...word }],
                },
              ]),
            ),
          ],
          [],
        ),
      }),
    );
  }
});
test("lyric generation validates source IDs with a JSON schema request", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const blocks = [
    { id: "verse", text: "また京都で会おう", sourceUtteranceIds: ["u1"] },
  ];
  const result = await createLyrics({
    utterances,
    apiKey,
    fetch: mockFetch(
      [
        Response.json(
          response([{ type: "text", text: JSON.stringify({ blocks }) }]),
        ),
      ],
      calls,
    ),
  });
  assert.deepEqual(result.blocks, blocks);
  assert.equal(
    JSON.parse(String(calls[0]?.body)).response_format.mime_type,
    "application/json",
  );
  await assert.rejects(
    createLyrics({
      utterances,
      apiKey,
      fetch: mockFetch(
        [
          Response.json(
            response([
              {
                type: "text",
                text: JSON.stringify({
                  blocks: [
                    { ...blocks[0], sourceUtteranceIds: ["fabricated"] },
                  ],
                }),
              },
            ]),
          ),
        ],
        [],
      ),
    }),
  );
});
test("lyrics retain all long source IDs after an enum-rejecting provider response", async () => {
  const clipId = "d7f3ce05-99d0-4822-980f-313253df5bd6";
  const sources = Array.from({ length: 73 }, (_, index) => ({
    id: `${clipId}:u:${index * 3000 + 200}:${index + 1}`,
    clipId,
    startMs: index * 3000 + 200,
    endMs: index * 3000 + 2200,
    speaker: index % 2 === 0 ? "spk_1" : "spk_2",
    text: `記録${index + 1}`,
  }));
  const blocks = Array.from({ length: 7 }, (_, index) => ({
    id: `verse-${index + 1}`,
    text: "交わした言葉を覚えている",
    sourceUtteranceIds: sources
      .slice(index * 11, (index + 1) * 11)
      .map((item) => item.id),
  }));
  const firstBlock = blocks[0];
  assert.ok(firstBlock);
  let calls = 0;
  const fetch = (async (_input, init) => {
    calls++;
    const request = JSON.parse(String(init?.body));
    assert.deepEqual(JSON.parse(request.input).utterances, sources);
    const sourceSchema =
      request.response_format.schema.properties.blocks.items.properties
        .sourceUtteranceIds.items;
    if (Array.isArray(sourceSchema.enum))
      return Response.json(
        { error: { code: "invalid_request" } },
        { status: 400 },
      );
    return Response.json(
      response([{ type: "text", text: JSON.stringify({ blocks }) }]),
    );
  }) as typeof globalThis.fetch;
  const result = await createLyrics({ utterances: sources, apiKey, fetch });
  assert.equal(calls, 1);
  assert.deepEqual(result.blocks, blocks);
  assert.deepEqual(
    result.blocks.flatMap((block) => block.sourceUtteranceIds),
    sources.map((item) => item.id),
  );
  await assert.rejects(
    createLyrics({
      utterances: sources,
      apiKey,
      fetch: mockFetch(
        [
          Response.json(
            response([
              {
                type: "text",
                text: JSON.stringify({
                  blocks: [
                    {
                      ...firstBlock,
                      sourceUtteranceIds: [
                        ...firstBlock.sourceUtteranceIds,
                        `${clipId}:u:999999:999`,
                      ],
                    },
                  ],
                }),
              },
            ]),
          ),
        ],
        [],
      ),
    }),
    (error: unknown) =>
      error instanceof GoogleProviderError &&
      error.stage === "lyrics" &&
      error.kind === "invalid_response",
  );
});
test("music sends only approved lyrics and returns validated MP3 and provider lyrics", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const bytes = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
  const result = await generateMusic({
    blocks: [
      { id: "verse", text: "また京都で会おう", sourceUtteranceIds: ["u1"] },
    ],
    apiKey,
    fetch: mockFetch(
      [
        Response.json(
          response([
            { type: "text", text: "また京都で会おう" },
            {
              type: "audio",
              mime_type: "audio/mp3",
              data: Buffer.from(bytes).toString("base64"),
            },
          ]),
        ),
      ],
      calls,
    ),
  });
  assert.deepEqual(result.bytes, bytes);
  assert.equal(result.mimeType, "audio/mpeg");
  assert.equal(result.costUsd, 0.08);
  assert.equal(result.returnedLyrics, "また京都で会おう");
  const request = JSON.parse(String(calls[0]?.body));
  assert.equal(request.model, "lyria-3.5");
  assert.ok(request.input.includes("また京都で会おう"));
  assert.ok(!request.input.includes("sourceUtteranceIds"));
});
test("provider rejection and ambiguous network error never trigger a second paid request", async () => {
  let count = 0;
  const failing = (async () => {
    count++;
    throw new Error("secret-key transcript may appear here");
  }) as typeof globalThis.fetch;
  await assert.rejects(
    generateMusic({
      blocks: [{ id: "v", text: "hello", sourceUtteranceIds: ["u1"] }],
      apiKey,
      fetch: failing,
    }),
    (error: unknown) =>
      error instanceof Error && !error.message.includes("secret-key"),
  );
  assert.equal(count, 1);
  count = 0;
  const rejected = (async () => {
    count++;
    return Response.json(
      { error: { message: "private transcript" } },
      { status: 404 },
    );
  }) as typeof globalThis.fetch;
  await assert.rejects(
    createLyrics({ utterances, apiKey, fetch: rejected }),
    (error: unknown) =>
      error instanceof Error && !error.message.includes("private transcript"),
  );
  assert.equal(count, 1);
});

test("PROCESSING upload is checked by a Files GET before exactly one paid transcription", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const raw = response([
    {
      type: "text",
      annotations: [
        {
          type: "word_info",
          text: "また来よう",
          speaker: "spk_1",
          start_offset: "0.1s",
          end_offset: "1s",
        },
      ],
    },
  ]);
  const upload = uploadResponses();
  upload[1] = Response.json({
    file: {
      name: "files/f1",
      uri: "https://generativelanguage.googleapis.com/v1beta/files/f1",
      state: "PROCESSING",
    },
  });
  const active = Response.json({
    name: "files/f1",
    uri: "https://generativelanguage.googleapis.com/v1beta/files/f1",
    state: "ACTIVE",
  });
  await transcribeAudio({
    bytes: new Uint8Array([1]),
    mimeType: "audio/wav",
    clipId: "c",
    offsetMs: 0,
    apiKey,
    fetch: mockFetch([...upload, active, Response.json(raw)], calls),
  });
  assert.equal(calls.length, 4);
  assert.equal(
    calls[2]?.url,
    "https://generativelanguage.googleapis.com/v1beta/files/f1",
  );
  assert.equal(
    calls.filter((call) => call.url.endsWith("/interactions")).length,
    1,
  );
});

test("a singing request without returned lyrics is not reported as a completed vocal song", async () => {
  await assert.rejects(
    generateMusic({
      blocks: [{ id: "v", text: "また来よう", sourceUtteranceIds: ["u1"] }],
      apiKey,
      fetch: mockFetch(
        [
          Response.json(
            response([
              {
                type: "audio",
                mime_type: "audio/mp3",
                data: Buffer.from([0x49, 0x44, 0x33, 4]).toString("base64"),
              },
            ]),
          ),
        ],
        [],
      ),
    }),
    /invalid_response/,
  );
});

test("usage output and thought tokens are separate and both charged once", async () => {
  const blocks = [{ id: "v", text: "また来よう", sourceUtteranceIds: ["u1"] }];
  const raw = {
    ...response([{ type: "text", text: JSON.stringify({ blocks }) }]),
    usage: {
      total_input_tokens: 7,
      total_output_tokens: 20,
      total_thought_tokens: 22,
      total_tokens: 49,
    },
  };
  const result = await createLyrics({
    utterances,
    apiKey,
    fetch: mockFetch([Response.json(raw)], []),
  });
  assert.equal(result.costUsd, (7 * 0.3 + (20 + 22) * 2.5) / 1_000_000);
});

test("nonempty text with zero reported output tokens retains the stage reservation", async () => {
  const reportedUsage = {
    total_input_tokens: 6001,
    total_output_tokens: 0,
    total_thought_tokens: 0,
  };
  const raw = {
    ...response([
      {
        type: "text",
        text: "また来よう",
        annotations: [
          {
            type: "word_info",
            text: "また来よう",
            speaker: "spk:0",
            start_offset: "0.200s",
            end_offset: "1.100s",
          },
        ],
      },
    ]),
    usage: reportedUsage,
  };
  const transcribed = parseTranscription(raw, { clipId: "saved", offsetMs: 0 });
  assert.equal(transcribed.costUsd, 0.6);
  assert.deepEqual(transcribed.usage, {
    model: "gemini-3.5-transcribe",
    costSource: "reservation",
    raw,
  });
  assert.deepEqual(raw.usage, reportedUsage);

  const blocks = [{ id: "v", text: "また来よう", sourceUtteranceIds: ["u1"] }];
  const lyricsRaw = {
    ...response([{ type: "text", text: JSON.stringify({ blocks }) }]),
    usage: reportedUsage,
  };
  const lyrics = await createLyrics({
    utterances,
    apiKey,
    fetch: mockFetch([Response.json(lyricsRaw)], []),
  });
  assert.equal(lyrics.costUsd, 0.5);
  assert.deepEqual(lyrics.usage, {
    model: "gemini-3.5-flash-lite",
    costSource: "reservation",
    raw: lyricsRaw,
  });
});

test("word_info rejects unsupported speakers, malformed seconds and out-of-chunk sources", async () => {
  for (const fields of [
    { speaker: "spk_9", start_offset: "0s", end_offset: "1s" },
    { speaker: "spk_1", start_offset: "00:01", end_offset: "2s" },
    { speaker: "spk_1", start_offset: "-1s", end_offset: "2s" },
    { speaker: "spk_1", start_offset: "0s", end_offset: "1501.001s" },
  ]) {
    await assert.rejects(
      transcribeAudio({
        bytes: new Uint8Array([1]),
        mimeType: "audio/wav",
        clipId: "c",
        offsetMs: 0,
        apiKey,
        fetch: mockFetch(
          [
            ...uploadResponses(),
            Response.json(
              response([
                {
                  type: "text",
                  annotations: [
                    { type: "word_info", text: "hello", ...fields },
                  ],
                },
              ]),
            ),
          ],
          [],
        ),
      }),
      /invalid_response/,
    );
  }
});

test("speaker changes retain distinct ordered source utterances, including spk_8", async () => {
  const words = [
    { speaker: "spk_8", text: "また", start_offset: "2s", end_offset: "2.5s" },
    { speaker: "spk_1", text: "See", start_offset: "0s", end_offset: "0.3s" },
    { speaker: "spk_1", text: "you", start_offset: "0.4s", end_offset: "1s" },
    {
      speaker: "spk_8",
      text: "来よう",
      start_offset: "2.6s",
      end_offset: "3s",
    },
  ].map((word) => ({ type: "word_info", ...word }));
  const result = await transcribeAudio({
    bytes: new Uint8Array([1]),
    mimeType: "audio/wav",
    clipId: "source",
    offsetMs: 60000,
    apiKey,
    fetch: mockFetch(
      [
        ...uploadResponses(),
        Response.json(response([{ type: "text", annotations: words }])),
      ],
      [],
    ),
  });
  assert.deepEqual(
    result.utterances.map((utterance) => [
      utterance.speaker,
      utterance.text,
      utterance.startMs,
      utterance.endMs,
    ]),
    [
      ["spk_1", "See you", 60000, 61000],
      ["spk_8", "また来よう", 62000, 63000],
    ],
  );
  assert.equal(
    new Set(result.utterances.map((utterance) => utterance.id)).size,
    2,
  );
});

test("PROCESSING timeout performs no paid transcription and does not reupload", async () => {
  const originalNow = Date.now;
  let now = 1000;
  Date.now = () => now;
  try {
    const upload = uploadResponses();
    const file = {
      name: "files/f1",
      uri: "https://generativelanguage.googleapis.com/v1beta/files/f1",
      state: "PROCESSING",
    };
    upload[1] = Response.json({ file });
    const calls: { url: string; body: unknown }[] = [];
    const originalFetch = mockFetch([...upload, Response.json(file)], calls);
    const fetch = (async (input, init) => {
      if (init?.method === "GET") now += 60000;
      return originalFetch(input, init);
    }) as typeof globalThis.fetch;
    await assert.rejects(
      transcribeAudio({
        bytes: new Uint8Array([1]),
        mimeType: "audio/wav",
        clipId: "c",
        offsetMs: 0,
        apiKey,
        fetch,
      }),
      /unknown/,
    );
    assert.equal(calls.length, 3);
    assert.equal(
      calls.filter((call) => call.url.endsWith("/interactions")).length,
      0,
    );
  } finally {
    Date.now = originalNow;
  }
});

test("AAC frame padding at the 25 minute split preserves source timestamps", async () => {
  const raw = response([
    {
      type: "text",
      annotations: [
        {
          type: "word_info",
          text: "また来よう",
          speaker: "spk_1",
          start_offset: "1499.5s",
          end_offset: "1500.064s",
        },
      ],
    },
  ]);
  const result = await transcribeAudio({
    bytes: new Uint8Array([1]),
    mimeType: "audio/m4a",
    clipId: "padded",
    offsetMs: 1500000,
    apiKey,
    fetch: mockFetch([...uploadResponses(), Response.json(raw)], []),
  });
  assert.equal(result.utterances[0]?.startMs, 2999500);
  assert.equal(result.utterances[0]?.endMs, 3000064);
});
