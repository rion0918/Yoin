import assert from "node:assert/strict";
import test from "node:test";
import type { SongDocument } from "../../shared/contracts.ts";
import { searchCompletedSongs } from "./librarySearch.ts";

const song = (id: string, title: string, createdAt: string) =>
  ({ id, title, createdAt }) as SongDocument;

test("completed-title search uses a partial match and newest completion first", () => {
  const songs = [
    song("old", "京都、三人旅", "2026-09-01T00:00:00.000Z"),
    song("other", "海辺の午後", "2026-10-03T00:00:00.000Z"),
    song("new", "もう一度、京都", "2026-10-04T00:00:00.000Z"),
  ];
  assert.deepEqual(
    searchCompletedSongs(songs, "京都").map((value) => value.id),
    ["new", "old"],
  );
  assert.deepEqual(
    searchCompletedSongs(songs, " 海 ").map((value) => value.id),
    ["other"],
  );
  assert.deepEqual(searchCompletedSongs(songs, "大阪"), []);
  assert.deepEqual(
    searchCompletedSongs(songs, "").map((value) => value.id),
    ["new", "other", "old"],
  );
});
