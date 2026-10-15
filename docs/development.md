# 開発ガイド

[ドキュメントの目次](README.md)へ

アプリの初回起動は[README](../README.md)、音声処理への接続は[設定・デプロイ・運用](audio-pipeline-setup.md)を参照してください。

## コードの入口

| 場所 | 内容 |
| :--- | :--- |
| [App.tsx](../App.tsx)・[src](../src) | Expo / React Nativeアプリ。画面、端末操作、保存、API接続 |
| [セッション操作](../src/useSession.ts) | 録音・保存・送信・歌詞編集・状態復帰・再生をつなぐ |
| [shared](../shared) | アプリとバックエンドのデータ契約・入力上限 |
| [backend](../backend) | Workers API、D1、R2、Workflows、有料試行の予約 |
| [音声処理サービス](../backend/media) | Docker / Cloud Runで動くFFmpeg・Google呼び出し |
| [pipeline](../pipeline) | Googleアダプター、ローカルPoC、累積予算 |
| [scripts](../scripts) | 予算引き継ぎ後のローカル接続設定生成 |
| [prototype](../prototype) | React / Viteのデザイン参照。編集時は専用の[AGENTS.md](../prototype/AGENTS.md)に従う |

共有契約と現行の状態遷移は[構成・設計](audio-pipeline-architecture.md)を参照してください。

## 開発環境

[ADR 0006](adr/0006-nix-development-environment.md)に従い、安定版nixpkgsと `flake.lock` でNode.js 24 LTS・同梱npm・JDK17・FFmpegを固定します。Node.jsは24.12以上を使います。正確なパッチバージョンはロックから決まります。

各ターミナルで、リポジトリ直下から `nix develop` を実行します。direnvを使う場合は一度 `direnv allow` を実行し、`.envrc` の `use flake` から同じ環境へ入れます。

Android SDK・エミュレーターと、iOS向けのXcodeはホストに別途用意します。`ANDROID_HOME` が設定済みならその値を使い、未設定ならmacOSは `~/Library/Android/sdk`、Linuxは `~/Android/Sdk` を参照します。macOS Apple Siliconでの確認実績は[検証記録](audio-pipeline-verification.md)にあります。

バックエンドを開発・検証する場合は、ルートの依存関係に加えて次を実行します。

```sh
npm --prefix backend ci
```

このリポジトリはnpmと各 `package-lock.json` を使います。ルートの `npm ci` だけではbackendの依存関係は入りません。

## 起動方法

| 目的 | リポジトリ直下で実行するコマンド |
| :--- | :--- |
| Metroを起動 | `npm start` |
| Webの画面確認 | `npm run web` |
| Android開発用アプリをビルド・起動 | `npm run android:device` |
| インストール済みAndroidアプリへ再接続 | `npm run android` |
| Workersをローカル起動 | `npm run backend:dev`。事前設定とD1適用は[ローカルバックエンド](audio-pipeline-setup.md#ローカルバックエンド)を参照 |

各プロセスは別ターミナルで起動します。Android用コマンドはMetroも起動するので、別途 `npm start` を実行する必要はありません。API設定は[設定・デプロイ・運用](audio-pipeline-setup.md)を参照してください。

### Androidの開発接続

`npm run android` は接続済み端末ごとに `adb reverse tcp:8081 tcp:8081` を設定してから、Metroを `127.0.0.1:8081` 固定で起動します。端末が再起動してADB転送が消えた場合も、コマンドを実行し直せば設定されます。実機はUSB接続とUSBデバッグの許可が必要です。エミュレーターも同じ経路を使います。`npm run android:device` は初回ビルド・インストール用です。

PC・端末の再起動後は、エミュレーターを起動するか実機を接続し、Nix環境で次を実行してください。

```sh
npm run android
```

このターミナルは開いたままにします。端末の再起動で消えるADB転送を設定し直し、保存済みの古いLAN URLを使わずにアプリを開きます。ネイティブ設定・依存関係を変更した場合は `npm run android:device` で再ビルドしてください。

以前の `npm start` がMetroを起動している場合は、そのターミナルでCtrl+Cを押してからAndroid用コマンドを実行してください。開発用アプリはMetro停止中には起動できません。PCなしで使用する配布版については[Google Play内部テスト](play-internal-release.md)を参照してください。

## コードを検証する

Nix環境でリポジトリ直下から実行します。変更した範囲に応じて、バックエンドと音声処理の検証も行います。

```sh
npm run check
npm run typecheck
npm test
npm run backend:typecheck
npm run backend:test
npm --prefix backend run test:media
```

- Biomeの個別lintは `npm run lint`、書式を変更する場合は `npm run format` を使う。
- backendの検証にはbackend依存関係が必要。音声処理テストにはFFmpeg / ffprobeが必要で、Nix環境で用意される。
- ツール更新時は `npm run export` も確認する。
- Biomeは保護されたプロトタイプと生成物を対象から除外する。
- 自動テストでは外部AI応答を置き換える。件数の成功は実API品質・Android実機の受け入れを表さない。

確認結果と未確認事項は[検証記録](audio-pipeline-verification.md)に日付付きで残します。

## ツールを更新する

リポジトリ直下で、ロック更新→Nixの確認→新しい環境で依存関係と本実装の検証を行います。

```sh
nix flake update
nix flake check --all-systems
nix develop
npm ci
npm --prefix backend ci
npm run check
npm run typecheck
npm test
npm run backend:typecheck
npm run backend:test
npm --prefix backend run test:media
npm run export
```

Nixファイルの整形は `nix fmt flake.nix` を使います。更新したロックと確認結果を合わせてレビューします。

## PRとCodeRabbit

変更対象に関係するAccepted ADRを[一覧](adr/README.md)から読みます。判断の変更が必要なら実装前に相談し、ADR運用に従います。PRには関連ADR、新しいADRが不要ならその理由、実施した検証と未確認事項を記載します。Discussionを使った場合はリンクも記載します。

[CodeRabbitのGitHub App](https://github.com/apps/coderabbitai)を対象リポジトリに連携する必要があります。リポジトリの公開だけでは有効になりません。[設定](../.coderabbit.yaml)は日本語レビューと追加コミットのレビューを有効にしています。`main` 向けの通常PRが対象で、Draft PRは自動レビューしません。

レビュー基準にはルートと `prototype/` のAGENTS.mdを使います。連携後は実PRへのレビュー投稿で動作を確認します。既存PRの全差分を再レビューする場合のコメントは `@coderabbitai full review` です。

外部連携の手順は[CodeRabbit公式セットアップ](https://docs.coderabbit.ai/getting-started/quickstart)と[レビューコマンド](https://docs.coderabbit.ai/guides/commands)を参照してください。

## 起動時の問題への対処

| 状況 | 確認すること |
| :--- | :--- |
| `nix develop` が使えない | Nixの導入と `nix-command` / `flakes` の有効化を確認。設定例は下記 |
| Node.jsやJDKの版が違う | 新しいターミナルにもNix環境を適用。`node --version`、`npm --version`、`java -version` を確認 |
| Android端末が見つからない | `ANDROID_HOME`、USBデバッグ・端末上の許可、`adb devices -l` の状態を確認 |
| Android SDK・ライセンスのエラー | Android Studioでビルドが要求するSDKを導入し、表示されたライセンスを確認 |
| アプリがMetroへ接続できない | エミュレーターの起動、または実機のUSB接続を確認し、`npm run android` で[接続先とADB転送](#androidの開発接続)を設定し直す |
| 録音・取り込みが使えない | Webの制約を確認。Androidではマイク権限とdevelopment buildの使用を確認 |
| backendのコマンドが見つからない | `npm --prefix backend ci` の実行を確認 |
| `setup:local` が失敗する | [予算引き継ぎと既存設定](audio-pipeline-setup.md#残予算の移管)を確認。既存台帳や設定を削除してやり直さない |

Nixの実験的機能が無効な場合は、利用者の `~/.config/nix/nix.conf` に次を設定します。管理方法が端末で異なる場合は[Nixの設定仕様](https://nix.dev/manual/nix/stable/command-ref/conf-file.html)を参照してください。

```ini
experimental-features = nix-command flakes
```

## デザインの参照

- [承認済み画面](../prototype/design/library-recording-flow.png)
- [Expo版のUI検証](../design-qa.md)：サンプルデータでの画面検証時点の記録
- [プロトタイプの検証](../prototype/design-qa.md)

画面検証の記録と、実音声・実API・実機の[検証記録](audio-pipeline-verification.md)は確認範囲が異なります。
