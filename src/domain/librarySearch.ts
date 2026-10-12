import type { SongDocument } from "../../shared/contracts.ts";

export function searchCompletedSongs(songs: SongDocument[], query: string) {
  const title = query.trim().toLocaleLowerCase();
  return [...songs]
    .filter((song) => song.title.toLocaleLowerCase().includes(title))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
