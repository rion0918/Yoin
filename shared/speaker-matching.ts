import { SPEAKER_MODEL_VERSION, type Utterance } from "./contracts.ts";
export const SEGMENTATION_SHA256 =
  "d582f4b4c6b48205de7e0643c57df0df5615a3c176189be3fc461e9d18827b5d";
export const SPEAKER_MATCHING_CONFIG = {
  version: 2,
  method: "diarization",
  embeddingModel: SPEAKER_MODEL_VERSION,
  segmentationModel: `pyannote-segmentation-3.0-int8-${SEGMENTATION_SHA256}`,
  clusteringThreshold: 0.5,
  windowShiftRatio: 0.1,
  minDurationOn: 0.2,
  minDurationOff: 0.5,
  minimumAudioMs: 10_000,
  maximumAudioMs: 30_000,
  minimumSpeechMs: 2_000,
  rmsThreshold: 0.012,
  matchMinimum: 0.65,
  matchMargin: 0.1,
  minimumCoverage: 0.9,
  reviewRequired: true,
} as const;
export type SpeakerMatchingConfig = typeof SPEAKER_MATCHING_CONFIG;

export function canAssignSpeaker(utterance: Utterance) {
  return (
    utterance.speaker !== "話者未確認" &&
    utterance.endMs > utterance.startMs &&
    (!utterance.timingIssues?.length ||
      utterance.timingIssues.every(
        (issue) => issue.correction === "clamped_end",
      ))
  );
}
