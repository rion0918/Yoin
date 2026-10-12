import Slider from "@react-native-community/slider";
import { StyleSheet } from "react-native";
import { figmaColors } from "../design/figma";
import { colors } from "../design/tokens";
import { formatTime } from "../domain/session";

export type SeekSliderProps = {
  duration: number;
  position: number;
  onSeek: (seconds: number) => void;
  onScrub: (scrubbing: boolean) => void;
  dark?: boolean;
};

export function SeekSlider({
  duration,
  position,
  onSeek,
  onScrub,
  dark = false,
}: SeekSliderProps) {
  return (
    <Slider
      testID="playback-position"
      style={styles.scrubber}
      minimumValue={0}
      maximumValue={duration}
      step={1}
      value={position}
      onValueChange={onSeek}
      onSlidingStart={() => onScrub(true)}
      onSlidingComplete={(seconds) => {
        onSeek(seconds);
        onScrub(false);
      }}
      minimumTrackTintColor={dark ? figmaColors.rose : colors.ink}
      maximumTrackTintColor={dark ? figmaColors.inset : colors.line}
      thumbTintColor={dark ? figmaColors.rose : colors.ink}
      tapToSeek
      accessibilityRole="adjustable"
      accessibilityLabel="曲の再生位置"
      accessibilityValue={{
        min: 0,
        max: duration,
        now: Math.floor(position),
        text: `${formatTime(position)}、全体${formatTime(duration)}`,
      }}
    />
  );
}

const styles = StyleSheet.create({
  scrubber: {
    height: 44,
    marginTop: -11,
    marginBottom: -11,
    marginHorizontal: -8,
  },
});
