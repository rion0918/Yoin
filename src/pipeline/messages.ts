const explanations: Record<string, string> = {
  route_not_found: "現在この操作を利用できません。時間をおいてお試しください。",
  unauthorized: "ログインを確認できません。もう一度ログインしてください。",
  authentication_not_configured:
    "現在サービスを利用できません。時間をおいてお試しください。",
  account_not_allowed:
    "このGoogleアカウントはまだ利用できません。招待されたアカウントでログインしてください。",
  account_deleted: "アカウントの削除を受け付けています。",
  recent_login_required: "削除するには、もう一度Googleで本人確認してください。",
  authentication_unavailable:
    "ログインを確認できません。時間をおいてお試しください。",
  lyric_revision_conflict:
    "歌詞の版が更新されています。保存済みの歌詞を確認してください。",
  lyrics_not_ready: "歌詞の準備がまだ完了していません。",
  invalid_lyrics:
    "歌詞は16ブロック・合計6000文字までです。空の歌詞も確認してください。",
  invalid_lyric_source:
    "歌詞の元になった会話を確認できません。保存済みの歌詞から確認してください。",
  audio_duration_limit: "一つの記録に残せる音声は合計60分までです。",
  clip_conflict_or_audio_limit:
    "音声の登録内容や合計時間を確認してください。一つの記録は合計60分までです。",
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
    "友達の声を判別できませんでした。音声は残っています。準備をもう一度実行してください。",
  invalid_speaker_embedding:
    "声の特徴を保存できませんでした。もう一度録音してください。",
  empty_audio:
    "音声が見つかりません。会話を録音するか音声を取り込んでください。",
  ai_budget_exhausted:
    "現在、新しい曲を作れません。音声と歌詞は保存されています。",
  provider_cost_exceeded_reservation:
    "現在、新しい曲を作れません。音声と歌詞は保存されています。",
  invalid_ai_budget:
    "現在、新しい曲を作れません。音声と歌詞は保存されています。",
  generated_lyrics_differ:
    "曲の歌詞が確認した内容と異なるため、完成できませんでした。音声と歌詞は保存されています。",
  provider_outcome_unconfirmed:
    "曲の受付を確認できませんでした。音声と歌詞は保存されています。この状態では作り直せません。時間をおいて状況を確認してください。",
  media_service_busy:
    "曲の生成サービスが混み合っています。Googleへの送信は始まっていません。少し時間をおいて、もう一度お試しください。",
  provider_not_configured:
    "曲の生成サービスを準備できませんでした。Googleへの送信は始まっていません。時間をおいてもう一度お試しください。",
  media_service_not_configured:
    "曲の生成サービスへ接続できませんでした。Googleへの送信は始まっていません。時間をおいてもう一度お試しください。",
  media_signing_not_configured:
    "曲の生成サービスの接続を準備できませんでした。Googleへの送信は始まっていません。設定を確認してください。",
  provider_not_submitted:
    "曲の生成を開始できませんでした。Googleへの送信は始まっていません。時間をおいてもう一度お試しください。",
  saved_transcription_unavailable:
    "回復できる文字起こしの応答が見つかりません。元音声は保存されています。追加の送信は行っていません。",
  saved_transcription_source_changed:
    "元音声と保存済み応答を照合できません。追加の送信は行っていません。",
  transcript_review_conflict:
    "文字起こしの確認状態が更新されています。記録を開き直してください。",
  invalid_transcript_fingerprint: "文字起こしの確認情報を読み取れません。",
  audio_review_expired:
    "音声と文字起こしは保存されています。確認期限が過ぎました。もう一度処理を始めると、保存済みの文字起こしを使います。",
  draft_not_ready: "この記録は処理中です。保存した生成状況を確認してください。",
  invalid_speaker_selection:
    "選んだ友達を確認できません。友達の声の登録を確認して、もう一度選んでください。",
  speaker_selection_unavailable:
    "この記録に選んだ友達が見つかりません。友達の声の登録を確認して、新しい記録を作成してください。",
  draft_speaker_selection_conflict:
    "この記録の参加者を確認できません。新しい記録を作成してください。",
  expired_or_invalid_media_url:
    "再生リンクの期限が切れました。もう一度再生を押してください。",
};

export function explainError(value: string): string {
  if (explanations[value]) return explanations[value];
  return /^[a-z_]+$/.test(value)
    ? "処理を続けられませんでした。音声と歌詞は保存されています。時間をおいて状況を確認してください。"
    : value;
}
