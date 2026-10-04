import { memoryFixtures, originalSong } from "./fixtures.ts";
import type { Clip, Draft, Song } from "./types.ts";

export { originalSong } from "./fixtures.ts";

function japanDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((name) => parts.find((part) => part.type === name)?.value)
    .join("-");
}

export function createDraft(id: string, now: Date): Draft {
  const date = japanDate(now);
  const [month, day] = date.slice(5).split("-").map(Number);
  return { id, title: `${month}月${day}日からの記録`, date, clips: [] };
}

export function appendClip(
  draft: Draft,
  startedAt: number,
  endedAt: number,
): Draft {
  const started = new Date(startedAt);
  const date = japanDate(started);
  const time = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(started);
  const source = memoryFixtures[draft.clips.length % memoryFixtures.length];
  const id = `${draft.id}-${draft.clips.length}`;
  const clip: Clip = {
    id,
    seconds: Math.max(1, Math.floor((endedAt - startedAt) / 1000)),
    date,
    time,
    place: source.place,
    memory: { ...source, id, date, time },
  };
  return { ...draft, clips: [...draft.clips, clip] };
}

export function finishDraft(draft: Draft, title: string): Song {
  if (draft.clips.length === 0) throw new Error("残した会話がありません。");
  const name = title.trim();
  if (!name) throw new Error("思い出の名前を入力してください。");
  const firstDate = draft.clips[0].date;
  const lastDate = draft.clips[draft.clips.length - 1].date;
  const date =
    firstDate === lastDate
      ? displayDate(firstDate)
      : `${displayDate(firstDate)} - ${firstDate.slice(0, 4) === lastDate.slice(0, 4) ? displayDate(lastDate).slice(5) : displayDate(lastDate)}`;
  return {
    id: `song-${draft.id}`,
    title: name,
    trackTitle: name,
    date,
    contextDate: firstDate,
    sourceClips: [...draft.clips],
    memories: draft.clips.map((clip, index) => ({
      ...clip.memory,
      id: clip.id,
      date: clip.date,
      time: clip.time,
      place: clip.place,
      sourceClipId: clip.id,
      startsAt: Math.round(
        42 + (index * 132) / Math.max(2, draft.clips.length),
      ),
    })),
    duration: originalSong.duration,
  };
}

export function savedSeconds(draft: Draft): number {
  return draft.clips.reduce((sum, clip) => sum + clip.seconds, 0);
}

export function formatTime(seconds: number): string {
  const value = Math.floor(seconds);
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

export function displayDate(date: string): string {
  return date.replaceAll("-", ".");
}
