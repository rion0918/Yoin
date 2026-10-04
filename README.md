# Yoin

会話から生まれた曲を、日時・場所・元の会話と一緒に聴き返すアプリです。

ルートは Expo / React Native の実装、`prototype/` は承認済みデザインの Web プロトタイプです。ライブラリ、会話の記録、完成した曲と思い出の3画面を実装しています。

## 起動

`pop-reminder/` と同じ Nix Flakes の方式で、開発ツールを `flake.lock` に固定しています。安定版の Nixpkgs 26.05 と Node.js 24 LTS を使い、アプリの依存関係は npm / `package-lock.json` で管理します。

現在のロックを macOS（Apple Silicon）で確認したバージョン:

| ツール | バージョン |
| :----- | :--------- |
| Node.js | 24.21.0 LTS |
| npm | 11.19.0（Node.js に同梱） |
| JDK | 17.0.19 LTS |
| FFmpeg | 8.1.2 |

Nix を導入し、`nix-command` と `flakes` を有効にした端末で実行します。

```sh
nix develop
npm ci
npm start
```

direnv を使っている場合は、このフォルダで一度 `direnv allow` を実行すると `.envrc` から同じ環境を自動で読み込めます。direnv は必須ではありません。

背景録音は `npm run android:device` で作るdevelopment buildで確認します。`npm run web` は同じReact Nativeコードの画面確認用で、録音・端末ファイルの取り込みはネイティブ版を使います。

Android SDK、エミュレーター、Xcode は別途インストールします。`ANDROID_HOME` が設定済みならその値を使い、未設定なら macOS は `~/Library/Android/sdk`、Linux は `~/Android/Sdk` を参照します。

ツールを更新するときは `nix flake update` でロックを更新し、`nix flake check --all-systems` と下記の検証を新しい Nix 環境で実行します。Nix ファイルの整形は `nix fmt flake.nix` で行います。採用理由は [ADR 0006](docs/adr/0006-nix-development-environment.md) に記録しています。

## 実装範囲

- 白いライブラリの＋から、名前入力なしで新しい記録を開く。
- 同じ位置のボタンで開始・停止・再開し、途中の会話を保持する。
- 戻る操作で録音区間を確定し、途中記録を再開できる。未録音の空記録は破棄する。
- 音声をdocuments、下書き・歌詞・生成ジョブをSQLiteへ保存する。
- 仕上げ時に名前と音声を確認し、文字起こし・出典付き歌詞を準備する。
- 歌詞を確認・修正してから曲を作り、実音源を持つ曲をライブラリへ追加する。
- 歌詞ごとの日時・場所とアイコンから、その歌詞の元になった会話を開く。
- 元の会話の区間を聴き、曲の再生位置を保持して曲へ戻る。

実音声とCloudflare Workers / Workflows / private R2 / D1 / FFmpeg Containersへの接続コードを実装しています。Googleの3モデルは品質検証の候補で、実APIの試聴とAndroid実機の60分録音は未検証です。サンプル曲を実生成の成功として表示しません。

設定・品質検証・Androidの受け入れ手順は [音声パイプラインのセットアップ](docs/audio-pipeline-setup.md) を参照してください。APIキーと音声はGitに含めません。AI検証の累積上限は10ドルで、PoCからサーバーへ残額を引き継ぎます。

実施したチェックと未確認項目は [検証記録](docs/audio-pipeline-verification.md) にまとめています。

## 検証

`nix develop` または direnv で開いた Nix 環境内で実行します。

```sh
npm run format
npm run lint
npm run check
npm run typecheck
npm test
npm run backend:typecheck
npm run backend:test
npm --prefix backend run test:media
npm run export
```

Biomeは本実装と設定を検証します。保護された参照プロトタイプと生成物は対象外です。テストは停止・復旧・出典・歌詞確認・通信切断・累積予算を確認します。バックエンドはCloudflareの実テストbindingで認証・D1・R2を検証し、AI応答はテスト用に置き換えます。実歌唱品質と端末の背景録音はテスト件数に含めず、別途実際に確認します。

## CodeRabbit による PR レビュー

[CodeRabbit の GitHub App](https://github.com/apps/coderabbitai) を `rion0918/Yoin` にインストールすると、公開リポジトリとして無料レビューを利用できます。インストール時は対象リポジトリに `Yoin` を選択します。公開するだけでは連携は有効になりません。

[`.coderabbit.yaml`](.coderabbit.yaml) で、日本語の自動レビューと追加コミットのレビューを有効にしています。`main` 向けの通常 PR が対象で、Draft PR は自動レビューしません。レビュー基準には、CodeRabbit が標準で検出するルートと `prototype/` の `AGENTS.md` を使います。

連携後は通常 PR を開き、CodeRabbit のレビューが投稿されることを確認します。既存 PR の全差分をレビューし直す場合は、PR に `@coderabbitai full review` とコメントします。詳細は[公式セットアップ手順](https://docs.coderabbit.ai/getting-started/quickstart)と[レビューコマンド](https://docs.coderabbit.ai/guides/commands)を参照してください。


## 設計の参照

- [ADR 運用ガイド・一覧](docs/adr/README.md)
- [承認済み画面](prototype/design/library-recording-flow.png)
- [Expo版のデザイン・動作検証](design-qa.md)
- [プロトタイプの操作・デザイン検証](prototype/design-qa.md)
- [Expo公式ドキュメント](https://docs.expo.dev/)
- [Biome公式ドキュメント](https://biomejs.dev/)
