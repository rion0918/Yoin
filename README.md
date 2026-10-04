# Yoin

会話から生まれた曲を、日時・場所・元の会話と一緒に聴き返すアプリです。

ルートは Expo / React Native の実装、`prototype/` は承認済みデザインの Web プロトタイプです。ライブラリ、会話の記録、完成した曲と思い出の3画面を実装しています。

## 起動

Node.js 26 で検証しています。依存関係をインストールし、Expo を起動します。

```sh
npm ci
npm start
```

`npm run ios` / `npm run android` で Expo Go をシミュレーター・エミュレーターで開きます。`npm run web` は同じ React Native コードの Web 確認用です。

## 実装範囲

- 白いライブラリの＋から、名前入力なしで新しい記録を開く。
- 同じ位置のボタンで開始・停止・再開し、途中の会話を保持する。
- 戻る操作で録音区間を確定し、途中記録を再開できる。未録音の空記録は破棄する。
- 仕上げ時に会話一覧と名前を確認し、完成した曲をライブラリに追加する。
- 歌詞ごとの日時・場所とアイコンから、その歌詞の元になった会話を開く。
- 会話シートを開いても再生状態を保持し、場面の位置へ移動できる。

録音・場所・会話・楽曲・再生は、画面と操作を検証するサンプルです。実際のマイク入力、位置取得、文字起こし、音楽生成、音声再生、永続保存、共有再生URLは接続していません。終了・再読み込みでライブラリは初期状態に戻ります。共有ボタンは曲の情報をOSの共有シートに渡します。

## 検証

```sh
npm run format
npm run lint
npm run check
npm run typecheck
npm test
npm run export
```

Biome は本実装と設定を検証します。保護された参照プロトタイプと生成物は対象外です。`npm test` は録音の停止・退出・仕上げ、重複操作、記録の分離、全会話の保持、日付またぎを検証します。

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
