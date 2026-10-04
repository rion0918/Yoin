# ADR 0003: React Nativeアプリの実装基盤にExpoを使用する

Date: 2026-10-04

## Status

Accepted

採用確認: 2026-10-04 のチャットで、ユーザーが「Expoで進める」を選択した。

## Context

[ADR 0002](0002-react-native-app.md)で本実装のフレームワークを React Native に決めた。承認済みの3画面を実装するにあたり、Expo と React Native CLI のどちらを基盤にするかは未決定だった。

## Decision

Expo と TypeScript を本実装の基盤に使用する。公式の TypeScript テンプレートに合わせた依存関係で、リポジトリのルートにアプリを置く。`prototype/` は承認済みデザインと操作の参照として保持する。

Expo は端末での確認とネイティブ機能の導入を進めやすい構成として提案し、ユーザーが採用した。iOS／Android のプロジェクトを直接管理する React Native CLI も選択肢として提示したが、今回は選択されなかった。

この実装では承認済み画面と操作を既存のサンプルデータで再現する。実録音・永続保存・楽曲生成サービスの選定は別の判断とする。

## Consequences

- 利点: ひとつの React Native 実装を Expo で起動し、端末表示と画面操作を確認できる。
- 受け入れる欠点: Expo SDK に対応する依存関係を維持する必要がある。Expo Go の範囲を超えるネイティブ機能には開発ビルドが必要になる。
