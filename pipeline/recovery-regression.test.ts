import assert from "node:assert/strict";
import test from "node:test";
import { singingLyricsMatch } from "../shared/music.ts";
import { parseTranscription } from "./google.ts";

const blocks = [
  {
    id: "a",
    text: "朝の道",
    section: "verse" as const,
    singingText: "あさのみち",
    sourceUtteranceIds: ["u"],
  },
];
test("observed Lyria section markers do not change exact singing lyrics", () => {
  assert.equal(singingLyricsMatch(blocks, "[[A0]][Verse 1]アサノミチ"), true);
  for (const returned of [
    "[[A0]]あさのみちへ",
    "あさのみ",
    "[[自由]]あさのみち",
    "[[AA0]]あさのみち",
    "[説明]あさのみち",
  ])
    assert.equal(singingLyricsMatch(blocks, returned), false);
});
for (const overflow of [63, 100, 101])
  test(`end overflow ${overflow}ms preserves appropriate review granularity`, () => {
    const raw = {
      status: "completed",
      steps: [
        {
          type: "model_output",
          content: [
            {
              type: "text",
              text: "朝。またね。",
              annotations: [
                {
                  type: "word_info",
                  text: "朝。",
                  start_offset: "0.1s",
                  end_offset: "1s",
                  speaker: "spk:0",
                },
                {
                  type: "word_info",
                  text: "またね。",
                  start_offset: "9.9s",
                  end_offset: `${(10000 + overflow) / 1000}s`,
                  speaker: "spk:1",
                },
              ],
            },
          ],
        },
      ],
      usage: { total_input_tokens: 100, total_output_tokens: 100 },
    };
    const result = parseTranscription(raw, {
      clipId: "c",
      offsetMs: 0,
      durationMs: 10000,
    });
    assert.equal(result.utterances.length, overflow <= 100 ? 2 : 1);
    assert.equal(result.utterances.at(-1)?.endMs, 10000);
    assert.equal(
      result.utterances.at(-1)?.timingIssues?.[0]?.endOffset,
      `${(10000 + overflow) / 1000}s`,
    );
    if (overflow <= 100)
      assert.equal(result.utterances[0]?.timingIssues, undefined);
  });

for (const [start, end] of [
  [3.9, 1.1],
  [10, 10],
  [10.05, 10.06],
])
  test(`invalid start/reversed ${start}/${end} retains the whole source`, () => {
    const raw = {
      status: "completed",
      steps: [
        {
          type: "model_output",
          content: [
            {
              type: "text",
              text: "全文",
              annotations: [
                {
                  type: "word_info",
                  text: "全文",
                  start_offset: `${start}s`,
                  end_offset: `${end}s`,
                },
              ],
            },
          ],
        },
      ],
      usage: { total_input_tokens: 10, total_output_tokens: 10 },
    };
    const result = parseTranscription(raw, {
      clipId: "c",
      offsetMs: 0,
      durationMs: 10000,
    });
    assert.equal(result.utterances[0]?.speaker, "話者未確認");
    assert.equal(result.utterances[0]?.startMs, 0);
    assert.equal(result.utterances[0]?.endMs, 10000);
    assert.equal(
      result.utterances[0]?.timingIssues?.[0]?.correction,
      undefined,
    );
  });

test("zero-length word annotations keep their original valid grouping", () => {
  const raw = {
    status: "completed",
    steps: [
      {
        type: "model_output",
        content: [
          {
            type: "text",
            text: "朝です",
            annotations: [
              {
                type: "word_info",
                text: "朝",
                start_offset: "0.1s",
                end_offset: "1s",
              },
              {
                type: "word_info",
                text: "です",
                start_offset: "1s",
                end_offset: "1s",
              },
            ],
          },
        ],
      },
    ],
    usage: { total_input_tokens: 10, total_output_tokens: 10 },
  };
  const result = parseTranscription(raw, {
    clipId: "c",
    offsetMs: 0,
    durationMs: 10000,
  });
  assert.equal(result.utterances[0]?.text, "朝です");
  assert.equal(result.utterances[0]?.timingIssues, undefined);
});
