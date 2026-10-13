import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type {
  DraftDocument,
  SpeakerProfile,
  TranscriptSpeakerAssignment,
  Utterance,
} from "../../shared/contracts";
import { colors } from "../design/tokens";
import { formatTime } from "../domain/session";
import {
  canAssignTranscriptSpeaker,
  removeTranscriptSpeakerAssignment,
  speakerLabel,
  transcriptReviewSpeakers,
  transcriptReviewSummary,
  updateTranscriptSpeakerAssignment,
} from "../pipeline/speakers";
import { ActionButton } from "./ActionButton";

export function TranscriptSpeakerReview({
  draft,
  speakers,
  assignments,
  onAssignmentsChange,
  activePlaybackUtteranceId,
  sourcePlaying,
  busy,
  onPlayUtterance,
  onStopUtterance,
}: {
  draft: DraftDocument;
  speakers: SpeakerProfile[];
  assignments: TranscriptSpeakerAssignment[];
  onAssignmentsChange: (assignments: TranscriptSpeakerAssignment[]) => void;
  activePlaybackUtteranceId: string | null;
  sourcePlaying: boolean;
  busy: boolean;
  onPlayUtterance: (utterance: Utterance) => void;
  onStopUtterance: () => void;
}) {
  const [selectingUtteranceId, setSelectingUtteranceId] = useState<
    string | null
  >(null);
  const options = transcriptReviewSpeakers(speakers, draft.speakerProfileIds);
  const summary = transcriptReviewSummary(draft.utterances, assignments);
  const profilesById = new Map(options.map((profile) => [profile.id, profile]));
  const assignmentsByUtterance = new Map(
    assignments.map((assignment) => [
      assignment.utteranceId,
      assignment.speakerProfileId,
    ]),
  );
  return (
    <View testID="transcript-speaker-review">
      <View style={styles.guide}>
        <Text style={styles.guideHeading}>
          {summary.assignableCount
            ? `話者を自動判定できなかった発話が${summary.assignableCount}件あります`
            : "発話者を判定しました"}
        </Text>
        <Text style={styles.instructions}>
          {summary.assignableCount
            ? "下の発話を一つずつ再生し、声がわかる行だけ録音参加者を選んでください。わからない発話は未割当のまま歌詞に含められます。"
            : "発話内容を確認し、下のボタンから歌詞作成へ進んでください。"}
        </Text>
        {summary.assignableCount > 0 && (
          <Text style={styles.progress}>
            未割当 {summary.unresolvedCount}件 · 割当済 {summary.assignedCount}
            件
          </Text>
        )}
      </View>
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
        const selecting = selectingUtteranceId === utterance.id;
        const playing =
          sourcePlaying && activePlaybackUtteranceId === utterance.id;
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
              {canAssign && (
                <>
                  <ActionButton
                    label={
                      playing
                        ? "この発話の再生を止める"
                        : `${label}の発話を再生する`
                    }
                    onPress={() => {
                      if (playing) onStopUtterance();
                      else onPlayUtterance(utterance);
                    }}
                    disabled={busy}
                    style={styles.listenButton}
                    testID={`listen-utterance-${utterance.id}`}
                  >
                    <Feather
                      name={playing ? "square" : "play"}
                      size={14}
                      color={colors.ink}
                    />
                    <Text style={styles.listenLabel}>
                      {playing
                        ? "この発話を停止"
                        : utterance.timingIssues?.length
                          ? "録音全体を聴く"
                          : `${formatTime(utterance.startMs / 1000)}から聴く`}
                    </Text>
                  </ActionButton>
                  {options.length > 0 ? (
                    <>
                      <ActionButton
                        label={
                          assignedName
                            ? `話者を変更（現在 ${assignedName}）`
                            : "この発話の話者を選ぶ"
                        }
                        onPress={() =>
                          setSelectingUtteranceId(
                            selecting ? null : utterance.id,
                          )
                        }
                        style={styles.assignButton}
                        testID={`assign-speaker-${utterance.id}`}
                      >
                        <Text style={styles.assignLabel}>
                          {assignedName
                            ? `${assignedName} · 変更`
                            : "話者を選ぶ"}
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
                                setSelectingUtteranceId(null);
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
                                setSelectingUtteranceId(null);
                              }}
                              style={styles.option}
                            >
                              <Text style={styles.optionLabel}>
                                {profile.name}
                              </Text>
                            </ActionButton>
                          ))}
                        </View>
                      )}
                    </>
                  ) : (
                    <Text style={styles.instructions}>
                      この記録で選んだ参加者の声が見つからないため、話者名を付けずに進めます。
                    </Text>
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
  guide: {
    marginBottom: 18,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.quiet,
    gap: 6,
  },
  guideHeading: {
    color: colors.ink,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "700",
  },
  instructions: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 22,
  },
  progress: {
    color: colors.ink,
    fontSize: 12,
    lineHeight: 20,
    fontWeight: "600",
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
  listenButton: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: colors.quiet,
  },
  listenLabel: { color: colors.ink, fontSize: 12, fontWeight: "600" },
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
