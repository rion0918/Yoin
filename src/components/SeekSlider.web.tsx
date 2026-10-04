import { formatTime } from "../domain/session";
import type { SeekSliderProps } from "./SeekSlider";

export function SeekSlider({
  duration,
  position,
  onSeek,
  onScrub,
}: SeekSliderProps) {
  return (
    <input
      type="range"
      data-testid="playback-position"
      min={0}
      max={duration}
      step={1}
      value={Math.floor(position)}
      aria-label="曲の再生位置"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={Math.floor(position)}
      aria-valuetext={`${formatTime(position)}、全体${formatTime(duration)}`}
      onChange={(event) => onSeek(Number(event.currentTarget.value))}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        onScrub(true);
      }}
      onPointerUp={() => onScrub(false)}
      onPointerCancel={() => onScrub(false)}
      onBlur={() => onScrub(false)}
      onKeyDown={() => onScrub(true)}
      onKeyUp={() => onScrub(false)}
      style={{
        display: "block",
        width: "100%",
        height: 44,
        margin: "-11px 0",
        padding: 0,
        accentColor: "#9c5d2e",
        touchAction: "none",
      }}
    />
  );
}
