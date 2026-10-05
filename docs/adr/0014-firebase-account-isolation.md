# ADR 0014: FirebaseのGoogle認証とUID単位の保存・削除を使用する

Date: 2026-10-05

## Status

Proposed。2026-10-05にユーザーが本計画の実装を指示した。計画の指定に従い、ADRの採用状態はProposedのまま記録する。

## Context

[ADR 0009](0009-local-durable-drafts.md)では端末に接続先と単一テスターのトークンを保存していた。Google Play内部テストでは接続情報を入力させず、複数の利用者の会話・曲・声を分離する必要がある。[ADR 0013](0013-github-actions-cicd.md)の単一テスター前提も変更する。既存の開発データと累積AI予算は保持する。

## Decision

Firebase Authenticationを既存Google Cloudプロジェクトに追加し、React Native FirebaseとCredential Managerに対応するNitro Google Sign-Inを使用する。Workerは署名、発行元、対象プロジェクト、期限、Googleプロバイダーと検証済みメールの許可リストを確認し、メールでなくUIDを所有者にする。IDトークン更新はSDKに任せ、有料POSTを認証更新のために再送しない。

SQLiteと確定した端末音声をUIDごとに保存する。録音停止・保存後に通信と再生を終了してログアウトする。旧セッションの応答は保存・表示へ反映しない。同じUIDの下書きは端末から、曲・話者はサーバーから取得する。旧 `yoin.db` と音声・SecureStore設定は隔離して保持し、自動移管しない。未送信下書きの端末間同期は行わない。

削除は直近のGoogle本人確認後に受付し、専用Workflowで既存Workflowの履歴、D1、R2、Firebaseユーザーを削除する。Cloud Runの内部APIと実行IDの `firebaseauth.users.delete` のみを持つカスタム役割を使い、サービスアカウントのキーを配布しない。削除中の処理を拒否し、24時間は削除済みUIDを拒否する。費用と未確定予約は所有者・会話・音声を含まない独立台帳に残す。新規登録や人数追加で累積予算を戻さない。

固定トークンと共有所有者は製品向けの本人識別・削除に対応できないため継続しない。認証基盤を自作する案は採用せず、SDKのセッション管理を使用する。

## Consequences

- 利点: 接続情報の手入力がなくなり、所有者検証を通常API・署名URL・コールバックへ一貫して適用できる。削除後も費用上限を維持できる。
- 受け入れる欠点: Firebase、証明書、許可アカウントとCloud Run権限の運用が必要になる。端末内だけの下書きは別端末で復元できない。削除の実サービス再開・競合は内部テストで確認する。

実装と手順は[配布準備](../play-internal-release.md)、受け入れ条件は[内部テスト](../internal-testing.md)を参照する。0009のSQLite・Documents保存そのものは継続する。採用確認後に0009・0013の該当前提からの変更を履歴に反映する。
