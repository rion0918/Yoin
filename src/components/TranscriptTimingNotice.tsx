import { StyleSheet, Text, View } from "react-native";
import type { TranscriptTimingIssue } from "../../shared/contracts";
import { colors } from "../design/tokens";
import { formatTime } from "../domain/session";

export function TranscriptTimingNotice({
  issues,
}: {
  issues?: TranscriptTimingIssue[];
}) {
  if (!issues?.length) return null;
  return (
    <View style={styles.notice}>
      <Text style={styles.text}>
        認識時刻に不整合があります。全文と原音を保持しています。該当する音声区間全体が出典です。個々の発話時刻と話者名は未確認です。
      </Text>
      {issues.map((issue) => (
        <Text key={JSON.stringify(issue)} style={styles.text}>
          区間開始 {formatTime(issue.chunkOffsetMs / 1000)} · 「{issue.text}
          」の返された時刻: 開始 {issue.startOffset ?? "不明"} / 終了{" "}
          {issue.endOffset ?? "不明"}
        </Text>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  notice: { gap: 6, marginBottom: 12 },
  text: { color: colors.ink, fontSize: 13, lineHeight: 21 },
});
