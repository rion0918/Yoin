import {
  appendClip,
  createDraft,
  finishDraft,
  originalSong,
} from "./session.ts";
import type { Draft, Song } from "./types.ts";

export type SessionState = {
  drafts: Draft[];
  songs: Song[];
  recorder: { draftId: string; startedAt: number } | null;
};

export type SessionEvent =
  | { type: "create"; id: string; now: number }
  | { type: "start"; id: string; now: number }
  | { type: "stop"; now: number }
  | { type: "leave"; id: string; now: number }
  | { type: "finish"; id: string; title: string; now: number };

export function initialSession(): SessionState {
  return { drafts: [], songs: [originalSong], recorder: null };
}

export function reduceSession(
  state: SessionState,
  event: SessionEvent,
): SessionState {
  switch (event.type) {
    case "create":
      return {
        ...state,
        drafts: [...state.drafts, createDraft(event.id, new Date(event.now))],
      };
    case "start":
      if (
        state.recorder ||
        !state.drafts.some((draft) => draft.id === event.id)
      )
        return state;
      return {
        ...state,
        recorder: { draftId: event.id, startedAt: event.now },
      };
    case "stop": {
      const recorder = state.recorder;
      if (!recorder) return state;
      return {
        ...state,
        drafts: state.drafts.map((draft) =>
          draft.id === recorder.draftId
            ? appendClip(draft, recorder.startedAt, event.now)
            : draft,
        ),
        recorder: null,
      };
    }
    case "leave": {
      const stopped =
        state.recorder?.draftId === event.id
          ? reduceSession(state, { type: "stop", now: event.now })
          : state;
      const draft = stopped.drafts.find((item) => item.id === event.id);
      if (!draft || draft.clips.length > 0) return stopped;
      return {
        ...stopped,
        drafts: stopped.drafts.filter((item) => item.id !== event.id),
      };
    }
    case "finish": {
      const stopped =
        state.recorder?.draftId === event.id
          ? reduceSession(state, { type: "stop", now: event.now })
          : state;
      const draft = stopped.drafts.find((item) => item.id === event.id);
      if (!draft || draft.clips.length === 0 || !event.title.trim())
        return stopped;
      return {
        ...stopped,
        drafts: stopped.drafts.filter((item) => item.id !== event.id),
        songs: [finishDraft(draft, event.title), ...stopped.songs],
      };
    }
  }
}
