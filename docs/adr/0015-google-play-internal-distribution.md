# ADR 0015: Google Play内部テスト用の配布ビルドを使用する

Date: 2026-10-05

## Status

Proposed。2026-10-05にユーザーが本計画の実装を指示した。計画の指定に従い、ADRの採用状態はProposedのまま記録する。

## Context

開発用ビルドにはMetro接続が必要で、端末だけで内部テストできない。[ADR 0013](0013-github-actions-cicd.md)のmainへのpush時の自動デプロイから、今回の移行では外部設定・デプロイ・Playアップロードを成果物確認後の個別指示で行う前提へ変更する。

## Decision

EASの `playInternal` プロファイルを `distribution: store`、`developmentClient: false`、Android App Bundle、自動versionCode更新にする。パッケージ名は `com.rion0918.yoin` を維持する。APIのHTTPS URLとFirebaseの非秘密設定をビルド時に固定し、Firebaseプロジェクト・Androidパッケージ・Web OAuthクライアント・EASプロジェクト設定が不足または不一致なら配布ビルドを失敗させる。 さらに、配布ビルド前に Google Play Developer API から既存 versionCode を読み、EAS の次番号が Play の最大値を超えることを確認する。不一致や照会失敗時はビルドを止める。配布ビルドでは専用 npm script を使い、EAS remote の自動採番を維持する。

開発、アップロード、Play App Signingの証明書をGoogle認証設定へ登録する。反映は予算・設定照合、D1移行、Cloud Run、Worker、配布アプリの順とする。PRとmainの検証は続け、デプロイは個別指示後のmainの `workflow_dispatch` のみとする。EASビルド作成とPlayアップロードも個別に実行する。

開発ビルドを配布する案は開発PCへの依存が残るため採用しない。APK直接配布はGoogle Play内部テストという対象に合わせて採用しない。

## Consequences

- 利点: 開発PCを使わずにテストでき、署名済み配布版でGoogleログインを検証できる。設定不足と移行順の誤りを事前に検出できる。
- 受け入れる欠点: EAS、Play Console、Google Play Developer API のサービスアカウント、署名・OAuthの設定が必要になる。照合からビルドまでの間に別経路からアップロードされる競合は防げない。Expo exportは署名済みAABの成功を証明せず、実機・Play配布後の受け入れ確認が残る.

[配布と運用の手順](../play-internal-release.md)を参照する。0013の検証基盤は継続し、採用確認後にデプロイの前提変更を履歴に反映する。
