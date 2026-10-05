# ADR 0013: GitHub Actionsで検証と本番デプロイを行う

Date: 2026-10-05

## Status

Accepted

採用確認: 2026-10-05 のチャットで、ユーザーが CI/CD の実装計画を承認した。

## Context

Yoin は Expo アプリに加えて Cloudflare Workers・D1 と Cloud Run の音声処理サービスを運用している。各領域の検証を PR ごとに行い、main から一貫した順番で本番へ配置する必要がある。単一テスター向けの既存環境で AI 予算と保存データを保持し、PR 由来のコードに本番の認証権限を渡さないことが制約である。

## Decision

GitHub Actions で Biome、型検査、既存テスト、Expo の bundle、Workers の dry-run、linux/amd64 の Cloud Run コンテナーを確認する。actionlint でworkflowを、ShellCheck でCIスクリプトを検査する。main への反映だけを本番配置の対象とし、配置ジョブでは Google Cloud OIDC と本番 Environment を使う。Cloudflare には対象アカウントに限定した API トークンを使用する。

検証済みコンテナーを同じ実行内で Artifact Registry へ渡し、Cloud Run、疎通確認、D1 マイグレーション、Worker の順で配置する。Worker の現在の `AI_BUDGET_USD` がリポジトリの値と一致しない場合は、いずれの本番サービスも変更せず停止する。main は PR と `verify` 成功を必須にし、force push と branch deletion を禁止する。GitHub・Google Cloud・Cloudflare の設定方法は[運用手順](../audio-pipeline-setup.md#github-actionsの本番配置設定)に記録する。

ユーザーは本実装計画で、単一テスター環境、main からの自動配置、配置前の D1 マイグレーション、自動テスト・ビルドを採用した。Android/iOS 配布、実機 E2E、実 AI の品質検証、依存脆弱性の必須ゲートは今回の決定に含めない。

## Consequences

- 利点: PR で変更の品質と配置可能性を検証でき、成功した変更だけを対象環境へ自動配置できる。Google Cloud の長期鍵を GitHub に保管せずに済む。
- 受け入れる欠点: Google Cloud Workload Identity Federation、Cloudflare API token、GitHub Environment と main protection の初期設定・管理が必要になる。Cloud Run のイメージと Cloudflare のデプロイ自体の費用は別途発生し得る。
- 確認: 部分失敗では後続サービスを更新せず、配置の再実行は同じコミットを検証してから行う。D1 の破壊的変更は自動巻き戻しせず、別途相談する。
