# ADR 0006: Nixで安定版の開発環境を固定する

Date: 2026-10-04

## Status

Accepted

採用確認: 2026-10-04 のチャットで、ユーザーが `pop-reminder/` を参照して「このフォルダを参考にnixでバージョン管理をこのプロダクトでもします。バージョンは安定版で」と指示した。

## Context

Yoin は Expo / React Native アプリであり、Node.js、npm、Android向けJDKを開発環境で使用する。端末ごとの差を抑え、同じツールで起動・検証できるようにする必要がある。

参照プロジェクトの `pop-reminder/flake.nix` と `.envrc` は Nix Flakes と direnv による開発環境を用意している。参照元は `nixpkgs-unstable` と pnpm を使用しているが、ユーザーは安定版を指定し、Yoin は npm と `package-lock.json` を使用している。

## Decision

[flake.nix](../../flake.nix)、[flake.lock](../../flake.lock)、[.envrc](../../.envrc)で開発環境を管理する。nixpkgs は安定版の `nixos-26.05` を選び、Node.js 24 LTSと同梱npm、JDK17を使用する。入力のリビジョンを `flake.lock` に固定し、正確なパッチバージョンはロックから決まるものとする。

Node.js は24.12以上を使用する。Expo SDK57のNode要件を満たし、既存の `node --test` によるTypeScriptテストを安定した型除去機能で実行できるため、このLTS系列を選ぶ。[Expo SDK対応表](https://docs.expo.dev/versions/latest/)、[Node.jsのTypeScript実行仕様](https://nodejs.org/download/release/v24.16.0/docs/api/typescript.html)を参照する。

JDK17はローカルのAndroidネイティブビルドに使用する。Expo SDK57のAndroidビルド環境もJava17を使用する。[Expoのビルド環境](https://docs.expo.dev/build-reference/infrastructure/)を参照する。Android SDK、Xcode、エミュレーターはホストに別途用意し、このflakeでは管理しない。

JavaScript依存関係は既存の `package-lock.json` と `npm ci` で固定する。参照元のpnpmへ移行せず、Expo CLI、Biome、TypeScriptもプロジェクトの依存関係を使用する。

Nixを導入した端末で `nix develop` を使用する。direnvは任意とし、利用する場合は `.envrc` の `use flake` で同じ環境を読み込む。Nix未導入の端末では先に導入する必要がある。

更新時は `nix flake update`、`nix flake check` の順に実行し、Nix環境内で `npm ci`、`npm run check`、`npm run typecheck`、`npm test`、`npm run export` を確認する。Nixファイルの書式は `nix fmt flake.nix`、アプリの書式はBiomeで確認する。

## Consequences

- 利点: Node.js、npm、JDKの版をロックした環境で開発・検証できる。既存のnpm依存関係とコマンドを維持し、direnvを使わない端末でも同じ環境に入れる。
- 受け入れる欠点: Nixの導入と初回の取得が必要になる。安定版nixpkgsとロックの更新を継続して管理する必要があり、Android SDKやXcodeなどホストのネイティブ環境は別途維持する。

ツールを更新したときはロックの変更と検証結果を合わせて確認する。
