import {
  type LibraryDocument,
  type LocalSpeakerSample,
  MAX_SPEAKER_SAMPLE_BYTES,
  MAX_SPEAKER_SAMPLE_MS,
  MIN_SPEAKER_SAMPLE_MS,
  SPEAKER_SAMPLE_MS,
  type SpeakerProfile,
  type Utterance,
} from "../../shared/contracts.ts";
import type { RecorderPhase } from "../platform/types.ts";

export function speakerSampleState(
  sample: LocalSpeakerSample | undefined,
  recorderPhase: RecorderPhase,
  elapsedMs: number,
) {
  const remainingSeconds = Math.max(
    0,
    Math.ceil((SPEAKER_SAMPLE_MS - elapsedMs) / 1000),
  );
  const progress = Math.max(0, Math.min(1, elapsedMs / SPEAKER_SAMPLE_MS));
  let phase:
    | "empty"
    | "invalid"
    | "review"
    | "preparing"
    | "recording"
    | "saving" = "empty";
  let issue: string | undefined;
  if (
    recorderPhase === "preparing" ||
    recorderPhase === "recording" ||
    recorderPhase === "saving"
  ) {
    phase = recorderPhase;
  } else if (sample) {
    if (sample.durationMs < MIN_SPEAKER_SAMPLE_MS)
      issue = "録音が短いため、もう一度20秒ほど話してください。";
    else if (sample.durationMs > MAX_SPEAKER_SAMPLE_MS)
      issue = "録音が長すぎます。20秒ほどで録り直してください。";
    else if (sample.sizeBytes > MAX_SPEAKER_SAMPLE_BYTES)
      issue = "録音ファイルが大きすぎます。録り直してください。";
    phase = issue ? "invalid" : "review";
  }
  return {
    phase,
    remainingSeconds,
    progress,
    canRegister: phase === "review",
    issue,
  };
}

export function hasRegisteredSpeaker(state: LibraryDocument) {
  return (state.speakerProfiles ?? []).some(
    (profile) =>
      profile.status === "ready" && profile.sampleId && profile.modelVersion,
  );
}

export function assertCanRecordConversation(state: LibraryDocument) {
  if (!hasRegisteredSpeaker(state))
    throw new Error(
      "録音を始める前に、少なくとも1人の名前と声を登録してください。",
    );
}

export function mergeSpeakerProfiles(
  state: LibraryDocument,
  remote: SpeakerProfile[],
): LibraryDocument {
  const previous = state.speakerProfiles ?? [];
  return {
    ...state,
    speakerProfiles: [
      ...remote.map((profile) => ({
        ...profile,
        sample: previous.find((local) => local.id === profile.id)?.sample,
      })),
      ...previous.filter(
        (local) =>
          local.status === "pending" &&
          !remote.some((profile) => profile.id === local.id),
      ),
    ],
  };
}

export function speakerLabel(utterance: Utterance) {
  return utterance.speakerName || utterance.speaker;
}
