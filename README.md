# Yoin

会話から生まれた曲を、日時・場所・元の会話と一緒に聴き返すアプリです。

## 前提環境

- [Nix](https://nixos.org/download/)を導入し、`nix-command` と `flakes` を有効にしてください。Node.js・npm・JDK・FFmpegはリポジトリのロックから用意します。
- Androidを起動する場合は、Android StudioでSDKを用意し、USBデバッグを有効にした実機、または起動済みのエミュレーターを接続してください。

## 環境を立ち上げる

```sh
git clone https://github.com/rion0918/Yoin.git
cd Yoin
nix develop
npm ci
```

以降のコマンドは、Yoin直下のNix環境で実行します。

## Webで画面を確認する

```sh
npm run web
```

Expoが表示するURLをブラウザーで開きます。Webは画面確認用で、録音・端末ファイルの取り込みはAndroid版を使います。

## Androidで起動する

```sh
npm run android:device
```

接続した端末を選び、development buildをビルド・インストールします。Android用コマンドは接続先を `127.0.0.1` に固定し、ADB転送でMetroへ接続します。実機はUSB接続を維持してください。開発用アプリの起動・操作にはMetroへの接続が必要です。Expo Goではバックグラウンド録音を確認できません。

PC・端末の再起動後は、Nix環境で `npm run android` を実行すると、再ビルドせずにMetroとADB転送を起動して接続し直せます。詳細は[Androidの開発接続](docs/development.md#androidの開発接続)を参照してください。

Google認証のネイティブ設定を[配布準備](docs/play-internal-release.md)に従って用意してください。Google Play内部テスト用AABは `playInternal` プロファイルを使用し、配布版の起動にはMetroや開発PCを必要としません。

詳しい環境設定、バックエンド接続、内部テストは[ドキュメントの目次](docs/README.md)から参照してください。
