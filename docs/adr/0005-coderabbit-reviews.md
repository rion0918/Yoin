# ADR 0005: PR レビューに CodeRabbit を使用する

Date: 2026-10-04

## Status

Accepted

採用確認: 2026-10-04 のチャットで、ユーザーがリポジトリを公開したうえで、このプロジェクトで CodeRabbit によるレビューを利用できるようにすることを指示した。

## Context

Yoin は公開 GitHub リポジトリであり、ユーザーが CodeRabbit によるコードレビューの導入を指定した。PR レビューの設定と、GitHub 側で必要な連携手順をリポジトリに残す必要がある。

## Decision

CodeRabbit の GitHub App を `rion0918/Yoin` に連携し、[`.coderabbit.yaml`](../../.coderabbit.yaml) で日本語の PR 自動レビューを設定する。通常 PR と追加コミットのレビューを有効にし、Draft PR は自動レビューの対象にしない。

既存の `AGENTS.md` は CodeRabbit の標準のコードガイドライン検出を利用し、レビュー指示を別の設定に重複させない。[ADR 0004](0004-biome-checks.md) の Biome・型検査・テストは引き続き実行する。導入手順とレビューの確認方法は [README](../../README.md#coderabbit-による-pr-レビュー) に記載する。

採用根拠はユーザーの指定であり、今回ほかのレビューサービスとの比較検討は行っていない。

## Consequences

- 利点: 公開リポジトリ向けの無料レビューを利用でき、PR の変更に対する日本語のフィードバックを得られる。設定をコードと一緒に管理できる。
- 受け入れる欠点: GitHub App の認可と外部サービスへの連携が必要になる。AI の指摘には誤りや見落としがあり、既存のチェックと人による判断も必要になる。公開リポジトリの無料レビューにも利用制限がある。

設定は [CodeRabbit の公式スキーマ](https://coderabbit.ai/integrations/schema.v2.json) で検証し、連携後に実際の PR でレビューの投稿を確認する。
