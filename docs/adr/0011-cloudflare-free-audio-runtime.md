# ADR 0011: Cloudflare無料プラン向けに音声処理の実行先を分離する

Date: 2026-10-04

## Status

Accepted

ユーザーは2026-10-04のチャットで、Cloudflareの無料運用、音声認識の精度維持、デプロイと構成の再確認を指定した。ユーザーは同日のチャットで「ではクラウドらんで」と指示し、Cloud Runの利用を採用した。配置済みかどうかは検証記録で別に確認する。

## Context

[ADR 0007](0007-cloudflare-audio-pipeline.md)の実装はCloudflare ContainersでFFmpegによる検査・変換・25分単位の分割を行う。指定アカウントはWorkers Freeで、Containers APIはWorkers Paidが必要として拒否した。Containersの設定を削除するだけでは準備・生成の処理は成立しない。

Workers FreeはCPU時間10ms・メモリ128MBの制約があり、音源のJSON解析、Base64復号、複製、結果の保存も負荷になる。現行 `generateMusic` に合成MP3応答を渡したNode.js 24での確認では、1MBで約72ms、3MBで約163msのCPU時間だった。これはWorkerでの実測ではなく、外部処理への分離が必要かを判断するための補助的な証拠である。

ユーザーは音声認識等の外部API費用を許容し、精度を落としたくないと指定した。安価なモデルへの変更、音声の実時間検査の省略、録音時間の短縮を無料化の手段にしない。

## Decision

CloudflareにはWorkers API、D1、非公開R2、Workflowsを残す。FFmpegとGoogle APIアダプターの実行を、認証付きのNode.js音声処理サービス（Google Cloud Run）へ移す。同じFFmpeg処理と `gemini-3.5-transcribe`、`gemini-3.5-flash-lite`、`lyria-3.5` を維持する。

WorkflowはD1で有料試行を予約した後に音声処理サービスを呼ぶ。元音声の取得、処理済み音声・生成MP3・有料試行結果の保存には、用途・所有者・ジョブ・試行を検証した期限付きURLを使う。大きな音源とGoogleの音源入り応答はWorkerで展開せず、音声処理サービスからR2へ送る。Workerには必要なメタデータを返す。

[ADR 0010](0010-google-audio-quality-trial.md)の累積10ドル、予約額の保持、残額だけの移管を維持する。結果不明の有料試行は再送しない。HTTP応答を受け取れない場合も、保存済みの試行結果との照合で回復できるようにする。予算制御をCloud Runのメモリ上だけに移さない。

Cloud Runはリクエスト課金、最小インスタンス0、最大1、同時処理1で始める。無料枠はあるが、請求設定、ビルド、イメージ保管、インターネットへの送信、超過利用等の費用はCloudflareと別に扱う。h.rion.0910@gmail.comで管理する新しいYoin専用プロジェクトへ配置する。

検討した他案は、Cloudflare Workers Paidへの加入（無料運用の指定に合わない）、APIと保存のみの配置（音声から曲までの目的を満たさない）、端末への前処理移動（既存のバックグラウンド録音・長時間音声・アプリ終了後の処理に影響する）、Mac上の常駐処理（端末の起動・接続に運用が依存する）である。

## Consequences

- 利点: Cloudflareの有料プランへ加入せず、現在の認識モデルと音声検査・分割を維持する構成を採用する。
- 受け入れる欠点: 2つのサービス間の認証・秘密情報・料金・障害を管理する。Cloud Runの無料枠がCloudflareの無料運用を保証するわけではない。
- 留意点: R2の無料枠はアカウント内の他の利用と共有され、超過料金がある。Cloudflareの無料プランという名称だけでは請求0を保証しない。
- 留意点: 同じモデルと前処理を維持しても、実際の認識・歌唱品質を保証しない。既存の試聴・固有名詞・複数人・雑音・Android実機の受け入れは必要。
- 確認: 外部POSTを模したテストで予約と結果不明の扱いを確認し、認証・アップロード・署名URL・25分の分割・生成物保存・ジョブ復帰を実サービスで確認する。Cloudflare無料枠のCPU・メモリ・サブリクエストを実測する。

公式仕様: [Workers制限](https://developers.cloudflare.com/workers/platform/limits/)、[Workflows料金](https://developers.cloudflare.com/workflows/reference/pricing/)、[R2料金](https://developers.cloudflare.com/r2/pricing/)、[Cloud Run料金](https://cloud.google.com/run/pricing)、[Cloud Runの配置前提](https://docs.cloud.google.com/run/docs/quickstarts/deploy-container)。
