# Yoin Agent Guide

## ADR の参照と記録

- 作業前に [ADR 運用ガイド・一覧](docs/adr/README.md) と、変更対象に関係する Accepted ADR を確認する。
- 複数のモジュールに影響する判断、長く効く制約、後から採用理由を知る必要がある選択は、[テンプレート](docs/adr/template.md)を使って Proposed ADR として記録する。Accepted への変更はユーザーの採用確認後に行う。すでに確認済みの判断を記録する場合は、その確認を Status 節に残す。
- 実装と Accepted ADR の矛盾や判断の変更が必要な場合は、変更前に理由を提示して相談する。採用後の判断変更は新しい ADR に記録し、旧記録を Superseded にして相互リンクする。
- PR には関連 ADR と、相談に利用した Discussion のリンクを記載する。ADR が不要な場合は理由を短く記載する。Discussion は必要な相談にだけ使い、投稿は個別の指示を受けて行う。

## 現在の構成

- `prototype/` は React/Vite の UI 検証用プロトタイプ。本実装は [ADR 0002](docs/adr/0002-react-native-app.md) に従って React Native を使用する。
- プロトタイプを変更する際は、[prototype/AGENTS.md](prototype/AGENTS.md) の編集範囲とランタイム契約を守る。
