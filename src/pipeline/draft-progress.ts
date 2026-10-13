import type { DraftDocument } from "../../shared/contracts.ts";
export function draftProgress(
  draft: Pick<
    DraftDocument,
    | "status"
    | "error"
    | "jobKind"
    | "jobStage"
    | "musicRecoveryAvailable"
    | "transcriptRecoveryAvailable"
  >,
) {
  if (draft.musicRecoveryAvailable)
    return {
      label: "保存済み曲を復旧",
      description:
        "曲と確認済み歌詞は保存されています。保存済みの曲を検査して完成処理を再開できます。追加の曲生成は行いません。",
    };
  if (draft.status === "needs_reconciliation") {
    if (draft.error === "generated_lyrics_differ")
      return {
        label: "生成歌詞の相違を確認",
        description:
          "返された歌詞が確認済みの歌詞と一致しません。音源と歌詞は保持されています。保存結果を確認するまで完成処理と再生成を停止しています。",
      };
    if (draft.transcriptRecoveryAvailable)
      return {
        label: "保存済み文字起こしを復旧",
        description:
          "元音声と応答は保存されています。保存済みの応答から復旧し、話者と内容を確認できます。",
      };
    return {
      label: "処理の受付確認が必要",
      description:
        "サービスの受付結果を確認できません。二重課金を防ぐため再送を停止しています。元音声と保存済みの内容は保持されています。受付結果の確認が必要です。",
    };
  }
  if (draft.status === "needs_audio_review")
    return {
      label: "話者と内容を確認",
      description: draft.error
        ? "話者照合で障害が発生しました。文字起こしと元音声は保存されています。発話を聴き、話者候補を変更・解除して確認できます。"
        : "発話を聴いて、自動判定された名前も確認・変更できます。わからない声は未特定のまま進められます。",
    };
  if (draft.status === "local" || draft.status === "uploading")
    return {
      label: "送信を続ける",
      description:
        "録音は端末に保存されています。この記録を開いて送信を続けられます。",
    };
  if (draft.status === "waiting_review")
    return {
      label: "歌詞を確認",
      description: "歌詞と歌唱用の読みを確認して、曲作りへ進めます。",
    };
  if (draft.status === "updating_readings")
    return {
      label: "歌詞の読みを更新中",
      description:
        "変更した歌詞の読みを更新しています。終わったら確認・修正できます。",
    };
  if (draft.status === "generating")
    return {
      label:
        draft.jobStage === "recovering_music" ||
        draft.jobStage === "inspect_generated_audio"
          ? "保存済みの曲を検査中"
          : "曲を生成中",
      description:
        "確認済みの歌詞から曲を仕上げています。画面を閉じても続きを確認できます。",
    };
  if (draft.status === "preparing")
    return {
      label:
        draft.jobStage === "identifying_speakers"
          ? "話者候補を照合中"
          : draft.jobStage === "creating_lyrics"
            ? "歌詞を作成中"
            : "文字起こしを処理中",
      description:
        "保存した会話を処理しています。完了後に話者と内容、歌詞を確認できます。",
    };
  if (draft.status === "failed")
    return {
      label: "保存した内容から再開",
      description:
        "処理が停止しました。保存済みの内容は残っています。この記録を開いて停止原因を確認できます。",
    };
  return { label: "曲が完成", description: "完成した曲を再生できます。" };
}
