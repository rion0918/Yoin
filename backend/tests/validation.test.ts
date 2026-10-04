import { describe, expect, it } from "vitest";
import { transcribeAudio } from "../../pipeline/google.ts";
import { validateBlocks, validateUtterances } from "../validation.ts";

describe("provider transcript validation", () => {
  it("accepts the adapter's source-qualified utterance ID", async () => {
    const clipId = "c42c9fa2-974c-4b90-8766-d92b0c4f408d";
    const responses = [
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
      Response.json({
        status: "completed",
        steps: [
          {
            type: "model_output",
            content: [
              {
                type: "text",
                text: "またここに来よう。",
                annotations: [
                  {
                    type: "word_info",
                    text: "またここに来よう。",
                    speaker: "spk_1",
                    start_offset: "0.100s",
                    end_offset: "0.500s",
                  },
                ],
              },
            ],
          },
        ],
        usage: {
          total_input_tokens: 1000,
          total_output_tokens: 100,
          total_thought_tokens: 10,
        },
      }),
    ];
    const result = await transcribeAudio({
      bytes: new Uint8Array([1, 2]),
      mimeType: "audio/mp4",
      clipId,
      offsetMs: 0,
      apiKey: "test-key",
      fetch: async () => {
        const response = responses.shift();
        if (!response) throw new Error("Unexpected provider request");
        return response;
      },
    });
    expect(result.utterances[0]).toMatchObject({
      id: `${clipId}:u:100:1`,
      clipId,
      startMs: 100,
      endMs: 500,
    });
    expect(validateUtterances(result.utterances, clipId, 600)).toEqual(
      result.utterances,
    );
  });

  it("rejects speech extending past the actual source duration", () => {
    const utterance = {
      id: "clip_u1",
      clipId: "clip",
      startMs: 100,
      endMs: 601,
      speaker: "話者 1",
      text: "またここに来よう。",
    };
    expect(() => validateUtterances([utterance], "clip", 600)).toThrow(
      "invalid_number",
    );
  });
});

it("rejects review edits beyond the music provider's lyric limits", () => {
  const source = [
    {
      id: "clip:u:0:1",
      clipId: "clip",
      startMs: 0,
      endMs: 100,
      speaker: "話者 1",
      text: "旅の会話",
    },
  ];
  expect(() =>
    validateBlocks(
      Array.from({ length: 17 }, (_, index) => ({
        id: `verse-${index}`,
        text: "歌詞",
        sourceUtteranceIds: [source[0].id],
      })),
      source,
    ),
  ).toThrow("invalid_lyrics");
  expect(() =>
    validateBlocks(
      Array.from({ length: 4 }, (_, index) => ({
        id: `verse-${index}`,
        text: "あ".repeat(1501),
        sourceUtteranceIds: [source[0].id],
      })),
      source,
    ),
  ).toThrow("invalid_lyrics");
});

it("accepts the provider's internal lyric IDs and a long block within its total limit", () => {
  const source = [
    {
      id: "clip:u:0:1",
      clipId: "clip",
      startMs: 0,
      endMs: 100,
      speaker: "話者 1",
      text: "旅の会話",
    },
  ];
  const block = {
    id: "chorus:1",
    text: "あ".repeat(3000),
    sourceUtteranceIds: [source[0].id],
  };
  expect(validateBlocks([block], source)).toEqual([block]);
});
