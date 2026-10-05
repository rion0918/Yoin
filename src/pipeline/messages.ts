const explanations: Record<string, string> = {
  route_not_found:
    "接続先がこの機能に対応していません。サーバーの更新状況を確認してください。",
  unauthorized: "検証用トークンが一致しません。接続設定を確認してください。",
  authentication_not_configured:
    "サーバーに検証用トークンが設定されていません。",
  lyric_revision_conflict:
    "歌詞の版が更新されています。保存済みの歌詞を確認してください。",
  lyrics_not_ready: "歌詞の準備がまだ完了していません。",
  invalid_lyrics:
    "歌詞は16ブロック・合計6000文字までです。空の歌詞も確認してください。",
  invalid_lyric_source:
    "歌詞の元になった会話を確認できません。保存済みの歌詞から確認してください。",
  audio_duration_limit: "今回の検証は合計60分までの音声に対応しています。",
  clip_conflict_or_audio_limit:
    "音声の登録内容や合計時間を確認してください。今回の検証は60分までです。",
  unsupported_audio_format:
    "音声形式に対応していません。M4A・WAV・MP3などの音声を使ってください。",
  audio_upload_incomplete:
    "音声の送信がまだ完了していません。接続を確認して再開してください。",
  no_speech_detected:
    "会話を聞き取れませんでした。保存した音声を確認してください。",
  speaker_sample_too_short:
    "声の録音が短すぎます。10秒以上、できれば20秒ほど録音してください。",
  speaker_sample_silent:
    "声を確認できませんでした。静かな場所で話しながら録り直してください。",
  speaker_sample_metadata_mismatch:
    "登録音声の情報を確認できません。もう一度録音してください。",
  speaker_identification_failed:
    "話者の識別に失敗しました。音声は残っています。準備をもう一度実行してください。",
  invalid_speaker_embedding:
    "声の特徴を保存できませんでした。もう一度録音してください。",
  empty_audio:
    "音声が見つかりません。会話を録音するか音声を取り込んでください。",
  ai_budget_exhausted:
    "今回のAI検証予算が足りません。音声と歌詞は残っています。",
  provider_cost_exceeded_reservation:
    "AIの利用額が見積もりを超えたため、新しい生成を止めています。利用履歴を確認してください。",
  invalid_ai_budget: "サーバーのAI検証予算が設定されていません。",
  generated_lyrics_differ:
    "生成された曲の歌詞が、確認した歌詞と異なります。音源は保存して、自動再生成を止めています。",
  provider_outcome_unconfirmed:
    "AIの受付結果を確認できません。利用履歴を確認するまで自動再生成しません。",
  draft_not_ready: "この記録は処理中です。保存した生成状況を確認してください。",
  expired_or_invalid_media_url:
    "再生リンクの期限が切れました。もう一度再生を押してください。",
};

export function explainError(value: string): string {
  if (explanations[value]) return explanations[value];
  return /^[a-z_]+$/.test(value)
    ? "処理を続けられませんでした。記録の状態と接続設定を確認してください。"
    : value;
}
