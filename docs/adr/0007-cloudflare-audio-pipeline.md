# ADR 0007: 音声から曲までの非同期処理基盤にCloudflareを使用する

Date: 2026-10-04

## Status

Superseded

採用確認: 2026-10-04 のチャットで、ユーザーがCloudflareを使用する実装計画に対して「IMPLEMENT THIS PLAN」と指示した。

後継: [ADR 0011](0011-cloudflare-free-audio-runtime.md)。2026-10-04にCloudflare無料運用のためFFmpeg・Googleアダプターの実行先をCloud Runへ変更した。Workers・D1・R2・Workflowsと単一テスターの範囲は維持する。

## Context

録音を文字起こしし、元の会話に対応する歌詞を確認・編集してから曲を生成する。これらは端末上の画面操作や短いHTTP応答だけでは完結しない。アプリを閉じても処理状態を確認でき、外部APIの秘密鍵をアプリへ配布しない基盤が必要になる。

ユーザーはSupabase案からCloudflareへの変更を指定した。初期の対象は非公開の単一テスターであり、一般公開のアカウント基盤や共有サービスの設計は今回の範囲に含めない。

## Decision

WorkersをAPI入口、Workflowsを非同期処理、非公開R2を音声と成果物の保管、D1を所有者・下書き・ジョブ・歌詞リビジョン・有料API試行の記録に使用する。[構成](../../backend/wrangler.jsonc)と[処理](../../backend/workflows.ts)で管理する。

Workflowは2つに分ける。`prepare`は音声の検査、文字起こし、歌詞作成までを実行して確認待ちにする。`generate`は利用者が確認した歌詞リビジョンを入力として曲を生成する。APIはジョブIDを返し、アプリは状態を取得する。歌詞確認中に長時間のHTTP接続を維持しない。

ffmpeg / ffprobeによる音声の実時間検査・正規化・分割はCloudflare Containersで実行する。WorkersのJavaScript処理だけで音声の妥当性や実時間を推測しない。[メディア処理](../../backend/media/server.mjs)が分割区間の時刻を返し、文字起こしの時刻を元ファイルへ戻せるようにする。

テスター用Bearerトークンを固定の所有者に対応させ、音声は所有者を確認したAPIを通じて取得する。Googleの鍵はサーバー側だけに置く。有料APIの再実行と予算制御は[ADR 0010](0010-google-audio-quality-trial.md)に従う。[Workflowsの実行規則](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)を踏まえ、外部APIの成否が不明な試行を自動で再送しない。

## Consequences

- 利点: 確認・編集を挟む処理を端末の起動状態から分離できる。音声、処理状態、成果物を同じ基盤で管理し、元の会話と承認した歌詞の対応を残せる。
- 受け入れる欠点: Workers、Workflows、R2、D1、Containersの設定と運用が必要になる。デプロイ、実サービス間の疎通、外部APIの品質はローカルテストだけでは確認できない。Cloudflareの利用料金はAI試行予算とは別に発生する。

実サービスへの接続は単一テスターの範囲で検証する。公開認証・共有・課金へ広げる判断は、この記録の採用に含めない。
