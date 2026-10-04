import { useCallback, useEffect, useRef, useState } from "react";
import {
  initialSession,
  reduceSession,
  type SessionEvent,
} from "./domain/store";

export function useSession() {
  const [state, setState] = useState(initialSession);
  const stateRef = useRef(state);
  const [liveSeconds, setLiveSeconds] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(42);
  const [duration, setDuration] = useState(204);
  const [scrubbing, setScrubbing] = useState(false);
  const sequence = useRef(0);

  const perform = useCallback((event: SessionEvent) => {
    const next = reduceSession(stateRef.current, event);
    stateRef.current = next;
    setState(next);
    return next;
  }, []);
  const pause = useCallback(() => {
    setPlaying(false);
    setScrubbing(false);
  }, []);
  const leave = useCallback(
    (id: string) => perform({ type: "leave", id, now: Date.now() }),
    [perform],
  );
  const stop = useCallback(
    () => perform({ type: "stop", now: Date.now() }),
    [perform],
  );
  const newRecording = () => {
    sequence.current += 1;
    const id = `draft-${Date.now()}-${sequence.current}`;
    pause();
    perform({ type: "create", id, now: Date.now() });
    return id;
  };
  const toggleRecording = (id: string) => {
    pause();
    if (stateRef.current.recorder?.draftId === id) stop();
    else perform({ type: "start", id, now: Date.now() });
  };
  const openSong = (songId: string) => {
    const song = stateRef.current.songs.find((item) => item.id === songId);
    if (!song) return;
    pause();
    setDuration(song.duration);
    setPosition(song.memories[0]?.startsAt ?? 0);
  };
  const seek = (seconds: number) =>
    setPosition(Math.max(0, Math.min(duration, seconds)));
  const togglePlayback = () => {
    if (position >= duration) setPosition(0);
    setPlaying((value) => !value);
  };

  useEffect(() => {
    const startedAt = state.recorder?.startedAt;
    if (startedAt === undefined) {
      setLiveSeconds(0);
      return;
    }
    const tick = () =>
      setLiveSeconds(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [state.recorder]);

  useEffect(() => {
    if (!playing || scrubbing) return;
    let previous = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - previous) / 1000;
      previous = now;
      setPosition((value) => Math.min(duration, value + elapsed));
    }, 250);
    return () => clearInterval(timer);
  }, [playing, duration, scrubbing]);

  useEffect(() => {
    if (position >= duration) pause();
  }, [position, duration, pause]);

  return {
    state,
    liveSeconds,
    playing,
    position,
    perform,
    pause,
    leave,
    stop,
    newRecording,
    toggleRecording,
    openSong,
    seek,
    togglePlayback,
    setPlaying,
    setScrubbing,
  };
}
