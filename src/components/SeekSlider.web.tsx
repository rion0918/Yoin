import { figmaColors } from "../design/figma";
import { colors } from "../design/tokens";
import { formatTime } from "../domain/session";
import type { SeekSliderProps } from "./SeekSlider";

export function SeekSlider({
  duration,
  position,
  onSeek,
  onScrub,
  dark = false,
}: SeekSliderProps) {
  const progress =
    duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0;
  return (
    <>
      {dark && (
        <style>{`.yoin-dark-seek::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:12px;height:12px;border-radius:50%;background:${figmaColors.rose};cursor:pointer}.yoin-dark-seek::-moz-range-thumb{width:12px;height:12px;border:0;border-radius:50%;background:${figmaColors.rose};cursor:pointer}`}</style>
      )}
      <input
        type="range"
        className={dark ? "yoin-dark-seek" : undefined}
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
          accentColor: dark ? figmaColors.rose : colors.ink,
          ...(dark
            ? {
                appearance: "none" as const,
                backgroundImage: `linear-gradient(to right, ${figmaColors.rose} ${progress}%, ${figmaColors.border} ${progress}%)`,
                backgroundPosition: "center",
                backgroundSize: "100% 4px",
                backgroundRepeat: "no-repeat",
                backgroundColor: "transparent",
              }
            : {}),
          touchAction: "none",
        }}
      />
    </>
  );
}
