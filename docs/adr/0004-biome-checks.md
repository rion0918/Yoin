# ADR 0004: 本実装のlintとformatにBiomeを使用する

Date: 2026-10-04

## Status

Accepted

採用確認: 2026-10-04 のチャットで、ユーザーが「biomeを使ってlintとfomatはしてください」と指示した。

## Context

Expo による本実装を開始するにあたり、コードの lint と format を継続して実行できるようにする必要がある。ユーザーは Biome の使用を指定した。

## Decision

本実装の lint と format に固定バージョンの Biome を使用し、ルートの `biome.json` で設定する。`npm run lint`、`npm run format`、`npm run check` を用意し、lint・書式・import 整理を確認する。

参照用の `prototype/` と生成物は対象から除外する。プロトタイプには保護されたランタイムと独自の検証手順があるため、この変更で書式を変更しない。新しいアプリのコードと設定は Biome の対象に含める。別の lint／format ツールの比較は今回行っていない。

## Consequences

- 利点: 本実装のコードに対して共通の lint・書式チェックを実行できる。
- 受け入れる欠点: 型の検証と実行時の振る舞いは Biome だけでは確認できず、TypeScript とテストを別に実行する必要がある。
