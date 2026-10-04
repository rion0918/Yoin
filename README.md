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

接続した端末を選び、development buildをビルド・インストールします。開発用アプリの起動・操作にはMetroへの接続が必要です。Expo Goではバックグラウンド録音を確認できません。

詳しい環境設定、バックエンド接続、内部テストは[ドキュメントの目次](docs/README.md)から参照してください。
