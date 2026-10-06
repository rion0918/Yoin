import type {
  AudioClip,
  AudioLocationSummary,
  DraftDocument,
  LibraryDocument,
  LocalDraft,
  LyricBlock,
  SavedRecording,
  SongDocument,
} from "../../shared/contracts.ts";
import { createLocalLocationSummary } from "./location.ts";

export function createLocalDraft(
  id: string,
  createdAt: string,
  speakerProfileIds: string[] = [],
): LocalDraft {
  const date = new Date(createdAt);
  return {
    id,
    title: `${date.getMonth() + 1}月${date.getDate()}日からの記録`,
    createdAt,
    speakerProfileIds,
    locationEnabled: false,
    clips: [],
    utterances: [],
    lyrics: null,
    status: "local",
    jobId: null,
    error: null,
  };
}

export function addSavedClip(
  state: LibraryDocument,
  clip: SavedRecording,
): LibraryDocument {
  if (clip.purpose === "speaker") {
    if (
      !(state.speakerProfiles ?? []).some(
        (profile) => profile.id === clip.speakerProfileId,
      )
    )
      throw new Error("登録する話者が見つかりません。");
    return {
      ...state,
      pendingRecording:
        state.pendingRecording?.clipId === clip.id
          ? null
          : state.pendingRecording,
      recoveryFiles: state.recoveryFiles?.filter(
        (pending) => pending.clipId !== clip.id,
      ),
      speakerProfiles: (state.speakerProfiles ?? []).map((profile) =>
        profile.id === clip.speakerProfileId
          ? { ...profile, sample: clip }
          : profile,
      ),
    };
  }
  const locationRoute = clip.locationRoute;
  const savedClip = { ...clip };
  delete savedClip.locationRoute;
  const withLocation = (next: LibraryDocument): LibraryDocument => {
    if (!locationRoute) return next;
    const existing = next.locationRoutes ?? [];
    if (existing.some((item) => item.route.clipId === locationRoute.clipId))
      return next;
    return {
      ...next,
      locationRoutes: [
        ...existing,
        {
          route: locationRoute,
          summary: createLocalLocationSummary(locationRoute),
          preparedForUpload: false,
          uploaded: false,
        },
      ],
    };
  };
  const draft = state.drafts.find((value) => value.id === savedClip.draftId);
  if (!draft) throw new Error("記録が見つかりません。");
  if (draft.clips.some((value) => value.id === savedClip.id))
    return state.pendingRecording?.clipId === clip.id
      ? withLocation({ ...state, pendingRecording: null })
      : withLocation(state);
  return withLocation({
    ...state,
    recoveryFiles: state.recoveryFiles?.filter(
      (pending) => pending.clipId !== savedClip.id,
    ),
    pendingRecording:
      state.pendingRecording?.clipId === savedClip.id
        ? null
        : state.pendingRecording,
    drafts: state.drafts.map((value) =>
      value.id === savedClip.draftId
        ? { ...value, clips: [...value.clips, savedClip], error: null }
        : value,
    ),
  });
}

export function markLocationUploaded(
  state: LibraryDocument,
  clipId: string,
  summary: AudioLocationSummary,
): LibraryDocument {
  const { routeObjectKey: _routeObjectKey, ...localSummary } = summary;
  return {
    ...state,
    locationRoutes: (state.locationRoutes ?? []).map((entry) =>
      entry.route.clipId === clipId
        ? { ...entry, summary: localSummary, uploaded: true }
        : entry,
    ),
    drafts: state.drafts.map((draft) => ({
      ...draft,
      clips: draft.clips.map((clip) =>
        clip.id === clipId ? { ...clip, locationSummary: summary } : clip,
      ),
    })),
    songs: state.songs.map((song) => ({
      ...song,
      clips: song.clips.map((clip) =>
        clip.id === clipId ? { ...clip, locationSummary: summary } : clip,
      ),
    })),
  };
}

export function mergeRemoteDraft(
  state: LibraryDocument,
  remote: DraftDocument,
): LibraryDocument {
  return {
    ...state,
    drafts: state.drafts.map((local) =>
      local.id !== remote.id
        ? local
        : {
            ...local,
            ...remote,
            clips: remote.clips.map((clip) => ({
              ...clip,
              localUri:
                local.clips.find((value) => value.id === clip.id)?.localUri ??
                "",
              upload: local.clips.find((value) => value.id === clip.id)?.upload,
            })),
          },
    ),
  };
}

export function restoreRecording(
  state: LibraryDocument,
  recovered: SavedRecording | null,
): LibraryDocument {
  if (!state.pendingRecording) return state;
  if (recovered) return addSavedClip(state, recovered);
  const pending = state.pendingRecording;
  return {
    ...state,
    pendingRecording: null,
    recoveryFiles: pending.localUri
      ? [...(state.recoveryFiles ?? []), pending]
      : state.recoveryFiles,
    drafts: state.drafts.map((draft) =>
      pending.purpose !== "speaker" && draft.id === pending.draftId
        ? {
            ...draft,
            error:
              "前回の録音は中断されました。再生できる音声を復元できませんでした。元ファイルの参照は端末内に保持しています。",
          }
        : draft,
    ),
  };
}

export function editLyricBlock(
  draft: LocalDraft,
  id: string,
  text: string,
): LocalDraft {
  if (!draft.lyrics) return draft;
  return {
    ...draft,
    lyrics: {
      ...draft.lyrics,
      blocks: draft.lyrics.blocks.map((block) =>
        block.id === id ? { ...block, text } : block,
      ),
    },
  };
}

export function completeSong(
  state: LibraryDocument,
  song: SongDocument,
): LibraryDocument {
  if (
    !song.audioId ||
    !Number.isFinite(song.durationMs) ||
    song.durationMs <= 0
  )
    throw new Error("完成した曲の音声を確認できません。");
  if (state.songs.some((value) => value.id === song.id)) return state;
  return {
    ...state,
    drafts: state.drafts.filter((value) => value.id !== song.draftId),
    songs: [song, ...state.songs],
  };
}

export function sourceContext(
  clip: AudioClip,
  offsetMs = 0,
): { date: string; time: string; place: string } {
  if (!clip.recordedAt)
    return { date: "日時不明", time: "", place: clip.place || "場所不明" };
  const date = new Date(Date.parse(clip.recordedAt) + offsetMs);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: clip.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (name: string) =>
    parts.find((part) => part.type === name)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
    place: clip.place || clip.locationSummary?.places[0]?.name || "場所不明",
  };
}

export function blockContext(
  document: DraftDocument | SongDocument,
  block: LyricBlock,
) {
  const utterance = document.utterances.find(
    (value) => value.id === block.sourceUtteranceIds[0],
  );
  const clip = document.clips.find((value) => value.id === utterance?.clipId);
  return clip
    ? sourceContext(clip, utterance?.startMs ?? 0)
    : { date: "日時不明", time: "", place: "場所不明" };
}

export function songDate(song: SongDocument): string {
  const dates = [
    ...new Set(
      song.clips
        .filter((clip) => clip.recordedAt)
        .map((clip) => sourceContext(clip).date),
    ),
  ].sort();
  if (!dates.length) return "録音日時不明";
  return dates.length === 1
    ? dates[0].replaceAll("-", ".")
    : `${dates[0].replaceAll("-", ".")} - ${dates[dates.length - 1].replaceAll("-", ".")}`;
}
