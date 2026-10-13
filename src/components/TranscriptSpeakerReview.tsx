import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type {
  DraftDocument,
  SpeakerProfile,
  TranscriptSpeakerAssignment,
} from "../../shared/contracts";
import { colors } from "../design/tokens";
import { formatTime } from "../domain/session";
import {
  canAssignTranscriptSpeaker,
  removeTranscriptSpeakerAssignment,
  speakerLabel,
  transcriptReviewSpeakers,
  updateTranscriptSpeakerAssignment,
} from "../pipeline/speakers";
import { ActionButton } from "./ActionButton";

export function TranscriptSpeakerReview({
  draft,
  speakers,
  assignments,
  onAssignmentsChange,
}: {
  draft: DraftDocument;
  speakers: SpeakerProfile[];
  assignments: TranscriptSpeakerAssignment[];
  onAssignmentsChange: (assignments: TranscriptSpeakerAssignment[]) => void;
}) {
  const [activeUtteranceId, setActiveUtteranceId] = useState<string | null>(
    null,
  );
  const options = transcriptReviewSpeakers(speakers, draft.speakerProfileIds);
  const profilesById = new Map(options.map((profile) => [profile.id, profile]));
  const assignmentsByUtterance = new Map(
    assignments.map((assignment) => [
      assignment.utteranceId,
      assignment.speakerProfileId,
    ]),
  );
  return (
    <View testID="transcript-speaker-review">
      <Text style={styles.instructions}>
        原音と発話を確認してください。話者がわかる行は参加者を割り当てられます。名前がわからない行は、未特定のまま歌詞へ進めます。
      </Text>
      {draft.utterances.map((utterance) => {
        const assignedId =
          assignmentsByUtterance.get(utterance.id) ??
          utterance.speakerProfileId;
        const assignedName =
          profilesById.get(assignedId ?? "")?.name ?? utterance.speakerName;
        const canAssign = canAssignTranscriptSpeaker(utterance);
        const label =
          assignedName ??
          (canAssign
            ? utterance.speaker === "unknown"
              ? "話者未特定"
              : "名前未設定"
            : speakerLabel(utterance));
        const selecting = activeUtteranceId === utterance.id;
        return (
          <View key={utterance.id} style={styles.row}>
            <Text style={styles.time}>
              {utterance.timingIssues?.length
                ? "区間全体"
                : formatTime(utterance.startMs / 1000)}
            </Text>
            <View style={styles.content}>
              <Text style={styles.text}>
                {label} · 「{utterance.text}」
              </Text>
              {canAssign && options.length > 0 && (
                <>
                  <ActionButton
                    label={
                      assignedName
                        ? `話者を変更（現在 ${assignedName}）`
                        : "この発話の話者を選ぶ"
                    }
                    onPress={() =>
                      setActiveUtteranceId(selecting ? null : utterance.id)
                    }
                    style={styles.assignButton}
                    testID={`assign-speaker-${utterance.id}`}
                  >
                    <Text style={styles.assignLabel}>
                      {assignedName ? `${assignedName} · 変更` : "話者を選ぶ"}
                    </Text>
                    <Feather
                      name={selecting ? "chevron-up" : "user-plus"}
                      size={16}
                      color={colors.ink}
                    />
                  </ActionButton>
                  {selecting && (
                    <View style={styles.options}>
                      {assignmentsByUtterance.has(utterance.id) && (
                        <ActionButton
                          label="話者の割り当てを解除して未特定に戻す"
                          onPress={() => {
                            onAssignmentsChange(
                              removeTranscriptSpeakerAssignment(
                                assignments,
                                utterance.id,
                              ),
                            );
                            setActiveUtteranceId(null);
                          }}
                          style={styles.option}
                        >
                          <Text style={styles.optionLabel}>
                            未特定のままに戻す
                          </Text>
                        </ActionButton>
                      )}
                      {options.map((profile) => (
                        <ActionButton
                          key={profile.id}
                          label={`${profile.name}さんに割り当てる`}
                          onPress={() => {
                            onAssignmentsChange(
                              updateTranscriptSpeakerAssignment(
                                assignments,
                                utterance.id,
                                profile.id,
                              ),
                            );
                            setActiveUtteranceId(null);
                          }}
                          style={styles.option}
                        >
                          <Text style={styles.optionLabel}>{profile.name}</Text>
                        </ActionButton>
                      ))}
                    </View>
                  )}
                </>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  instructions: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 22,
    marginBottom: 18,
  },
  row: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 14,
  },
  time: {
    width: 74,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 24,
  },
  content: { flex: 1, gap: 4 },
  text: { color: colors.ink, fontSize: 15, lineHeight: 25 },
  assignButton: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
  },
  assignLabel: { color: colors.ink, fontSize: 12, fontWeight: "600" },
  options: { gap: 4, paddingVertical: 4 },
  option: {
    minHeight: 40,
    paddingHorizontal: 10,
    justifyContent: "center",
    backgroundColor: colors.quiet,
    borderRadius: 10,
  },
  optionLabel: { color: colors.ink, fontSize: 13 },
});
