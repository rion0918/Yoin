import assert from "node:assert/strict";
import test from "node:test";
import { createLocalDraft } from "./library.ts";
import { confirmLyrics } from "./lyrics.ts";

const blocks = [{ id: "b1", text: "編集した歌詞", sourceUtteranceIds: ["u1"] }];
test("a lost lyric-save acknowledgement recovers the exact server revision without another mutation", async () => {
  let writes = 0;
  const result = await confirmLyrics(
    {
      saveLyrics: async () => {
        writes++;
        throw new Error("connection lost");
      },
      draft: async () => ({
        ...createLocalDraft("d1", "2026-10-04T00:00:00Z"),
        lyrics: { revision: 3, blocks },
      }),
    },
    "d1",
    2,
    blocks,
  );
  assert.deepEqual(result, { revision: 3, blocks });
  assert.equal(writes, 1);
});
test("a stale revision with different server lyrics cannot approve or overwrite them", async () => {
  await assert.rejects(
    confirmLyrics(
      {
        saveLyrics: async () => {
          throw new Error("stale revision");
        },
        draft: async () => ({
          ...createLocalDraft("d1", "2026-10-04T00:00:00Z"),
          lyrics: { revision: 3, blocks: [{ ...blocks[0], text: "別の歌詞" }] },
        }),
      },
      "d1",
      2,
      blocks,
    ),
    /stale revision/,
  );
});
