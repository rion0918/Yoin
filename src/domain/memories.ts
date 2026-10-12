import type { SongDocument } from "../../shared/contracts.ts";
import { sourceContext } from "../pipeline/library.ts";

function memoryDate(song: SongDocument) {
  return (
    song.clips
      .filter((clip) => clip.recordedAt)
      .map((clip) => sourceContext(clip).date)
      .sort()[0] ?? null
  );
}

export function memoryGroups(songs: SongDocument[]) {
  const groups: { key: string; label: string; songs: SongDocument[] }[] = [];
  const sorted = [...songs].sort((a, b) =>
    (memoryDate(b) ?? "").localeCompare(memoryDate(a) ?? ""),
  );
  for (const song of sorted) {
    const date = memoryDate(song);
    const key = date?.slice(0, 7) ?? "unknown";
    let group = groups.find((value) => value.key === key);
    if (!group) {
      group = {
        key,
        label: date
          ? `${date.slice(0, 4)}年${Number(date.slice(5, 7))}月`
          : "日時の記録なし",
        songs: [],
      };
      groups.push(group);
    }
    group.songs.push(song);
  }
  return groups;
}

export function memoryWords(song: SongDocument): {
  text: string;
  kind: "conversation" | "lyrics";
} | null {
  const words = song.utterances.find((utterance) => utterance.text.trim());
  if (words) return { text: words.text, kind: "conversation" };
  const lyrics = song.lyrics.blocks.find((block) => block.text.trim());
  return lyrics
    ? { text: lyrics.text.trim().split("\n")[0], kind: "lyrics" }
    : null;
}

export function memoryPlaces(song: SongDocument) {
  const clips = [...song.clips].sort((a, b) =>
    (a.recordedAt ?? "").localeCompare(b.recordedAt ?? ""),
  );
  return [
    ...new Set(
      clips.flatMap((clip) => {
        if (clip.place) return [clip.place];
        return (clip.locationSummary?.places ?? []).map((place) => place.name);
      }),
    ),
  ];
}
