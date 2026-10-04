export type PlaybackState = {
  target: "none" | "song" | "source";
  positionMs: number;
  durationMs: number;
};
export type PlaybackEvent =
  | { type: "selectSong"; durationMs: number }
  | { type: "playSong" }
  | { type: "playSource"; currentMs: number }
  | { type: "closeSource" }
  | { type: "time"; positionMs: number }
  | { type: "seek"; positionMs: number };
export function initPlayback(): PlaybackState {
  return { target: "none", positionMs: 0, durationMs: 0 };
}
export function playbackTransition(
  state: PlaybackState,
  event: PlaybackEvent,
): PlaybackState {
  const position = (value: number) =>
    Math.max(0, Math.min(state.durationMs, value));
  switch (event.type) {
    case "selectSong":
      return { target: "none", positionMs: 0, durationMs: event.durationMs };
    case "playSong":
      return { ...state, target: "song" };
    case "playSource":
      return {
        ...state,
        target: "source",
        positionMs:
          state.target === "song"
            ? position(event.currentMs)
            : state.positionMs,
      };
    case "closeSource":
      return state.target === "source" ? { ...state, target: "none" } : state;
    case "time":
      return state.target === "song"
        ? { ...state, positionMs: position(event.positionMs) }
        : state;
    case "seek":
      return { ...state, positionMs: position(event.positionMs) };
  }
}
