# Yoinドキュメント

[リポジトリのREADME](../README.md)へ

## 初めて開発する人へ

1. [README](../README.md)で環境を用意し、アプリを起動する。
2. [プロダクト仕様](product-spec.md)で体験と制約を把握する。
3. [構成・設計](audio-pipeline-architecture.md)で処理とデータの関係を理解する。
4. [開発ガイド](development.md)でコードの入口・検証・PRの流れを確認する。
5. 音声処理に接続する場合は[設定・デプロイ・運用](audio-pipeline-setup.md)へ進む。

## 内部テストをする人へ

1. [検証記録の現在の確認状況](audio-pipeline-verification.md#現在の確認状況)で、使える部分と未確認事項を確認する。
2. [プロダクト仕様](product-spec.md)で期待する体験を確認する。
3. [内部テスト](internal-testing.md)の開始条件を満たし、端末設定と操作確認を行う。
4. 結果を記録し、確認できた範囲を[検証記録](audio-pipeline-verification.md)へ反映する。

## 文書一覧

| 文書 | 内容 |
| :--- | :--- |
| [プロダクト仕様](product-spec.md) | 録音から再生まで、元会話との対応、日時・場所、入力上限、対応端末 |
| [構成・設計](audio-pipeline-architecture.md) | 構成図、データ、状態遷移、認証、予算と結果回復の契約 |
| [開発ガイド](development.md) | コードの入口、開発環境、検証、ツール更新、PR、起動時の対処 |
| [設定・デプロイ・運用](audio-pipeline-setup.md) | Google設定、PoC、残予算移管、ローカルバックエンド、クラウド配置、障害確認 |
| [内部テスト](internal-testing.md) | 開始条件、Android接続、操作と期待結果、録音・復旧・品質評価、不具合記録 |
| [検証記録](audio-pipeline-verification.md) | 日付付きの実績、配置情報、既知の問題、未確認事項 |
| [ADR一覧](adr/README.md) | 採用済み判断とその理由・履歴 |

## 文書を更新するとき

- 仕様は現在のコード、手順は実際の設定・コマンドに合わせる。
- 検証実績には日付と確認範囲を残す。実装・モックテスト・実API・実機の確認を区別する。
- 手順は担当文書を更新し、関連文書からリンクする。テスト件数や現在の配置情報は検証記録で管理する。
- 判断の変更は[ADRの運用](adr/README.md)に従う。

デザインの資料は[開発ガイドの参照先](development.md#デザインの参照)から辿れます。
