# Yoin Agent Guide

## ADR の参照と記録

- 作業前に [ADR 運用ガイド・一覧](docs/adr/README.md) と、変更対象に関係する Accepted ADR を確認する。
- 複数のモジュールに影響する判断、長く効く制約、後から採用理由を知る必要がある選択は、[テンプレート](docs/adr/template.md)を使って Proposed ADR として記録する。Accepted への変更はユーザーの採用確認後に行う。すでに確認済みの判断を記録する場合は、その確認を Status 節に残す。
- 実装と Accepted ADR の矛盾や判断の変更が必要な場合は、変更前に理由を提示して相談する。採用後の判断変更は新しい ADR に記録し、旧記録を Superseded にして相互リンクする。
- PR には関連 ADR と、相談に利用した Discussion のリンクを記載する。ADR が不要な場合は理由を短く記載する。Discussion は必要な相談にだけ使い、投稿は個別の指示を受けて行う。

## 現在の構成

- ルートの `App.tsx` と `src/` は [ADR 0002](docs/adr/0002-react-native-app.md)・[ADR 0003](docs/adr/0003-expo-app.md) に従う Expo / React Native アプリ。`prototype/` は React/Vite の UI 検証用プロトタイプとデザイン参照。
- プロトタイプを変更する際は、[prototype/AGENTS.md](prototype/AGENTS.md) の編集範囲とランタイム契約を守る。

## 開発環境

- [ADR 0006](docs/adr/0006-nix-development-environment.md) に従い、安定版nixpkgsの `flake.lock` でNode.js 24 LTS・同梱npm・JDK17を固定する。Node.jsはTypeScriptテストの型除去機能が安定した24.12以上を使用する。
- Nix導入済みの端末では `nix develop` で環境に入る。direnvは任意で、利用する場合は `.envrc` の `use flake` を使う。Nix未導入の端末では導入が必要。Android SDK・Xcode・エミュレーターはホストに別途用意する。
- ツール更新は `nix flake update` → `nix flake check --all-systems` → Nix環境内で `npm ci` と本実装の検証を行う。Nixファイルの整形は `nix fmt flake.nix` で行う。

## 本実装の検証

- [ADR 0004](docs/adr/0004-biome-checks.md) に従い Biome で lint と format を行う。Nix環境内で `npm run check`、`npm run typecheck`、`npm test` を確認する。ツール更新時は `npm run export` も確認する。
- デザインと操作の参照は `prototype/design/library-recording-flow.png` と `prototype/design-qa.md`。ライブラリと記録は白ベース、完成した曲だけ色を持つ。
- 音声・永続保存・生成の方針はADR 0007〜0010に従う。実装コード・モックテストの成功を、実API品質やAndroid実機受け入れの成功と扱わない。手順と未確認事項は `docs/audio-pipeline-setup.md` を参照する。
- backend変更時は `npm run backend:typecheck`、`npm run backend:test`、音声処理変更時は `npm --prefix backend run test:media` も確認する。AIの有料POSTは無条件で再送せず、受付不明の予約額を保持する。PoCからサーバーへは残額だけ移管し、予算台帳を初期化しない。
