# Google Play内部テストの配布準備

[目次](README.md)へ。認証と保存は[ADR 0014](adr/0014-firebase-account-isolation.md)、配布方法は[ADR 0015](adr/0015-google-play-internal-distribution.md)のProposed判断として記録する。以下の外部設定・デプロイ・ビルド・アップロードは、それぞれ変更内容を確認し、個別の実行指示後に行う。

## 成果物と未実施の設定

### 2026-10-12 の反映前確認

- EAS の `@rion0918/yoin` は作成済み。ID は `0a037905-c629-4edb-aaac-ef7a96b8bd5c` で、`app.json` に保存されている。配布検査はこの既存IDを使用し、`EAS_PROJECT_ID` が指定された場合だけ上書きする。
- EAS の直近の完了ビルドは `ccf90a15-10fb-42d7-8c58-c792b9a56d8a`、`playInternal`、versionCode `2`、`0.1.0`。Play Console の既存Yoinアプリも内部テストとして存在する。以下の10月7日の「未作成」記述を現在の状態として扱わない。
- リモートWorkerの最新配置は2026-10-05の `b20b0915-94ec-4b71-9df4-00109bde048e`。D1の `0005`〜`0008` は未適用であり、現行アプリ・APIの配置前に番号順で適用する。
- Workerの累積AI枠は `8.733897` USD。D1の確定費用 `1.285975` USD、照合待ち予約 `1.20` USD は試行集計と一致する。音楽生成の成功試行1件、`ready` の生成ジョブ1件、完成曲1件を確認した。端末操作と品質の受け入れ結果は別に記録する。
- 2026-10-12のユーザー指示により、必要な変更をPRへまとめ、mainのCIから反映する。反映後の接続確認と新しいPlayビルド・内部テストの結果は[検証記録](audio-pipeline-verification.md)へ追加する。

### 2026-10-07 の反映前の記録（現況は上記を参照）

- Firebase の Android 設定はローカルに存在し、配布用プロファイルの API URL・プロジェクト ID を与えた検証では Firebase 設定の照合を通過する。EAS は `rion0918` でログイン済みだが、Yoin のプロジェクト ID は未接続で、配布設定はそこで停止する。
- 実環境 Worker には `ALLOWED_TESTER_EMAILS`、Firebase 設定、アカウント削除 Workflow の binding が存在する。Worker の無認証拒否と Cloud Run の health は確認済み。
- D1 の `0004` は適用済み。`0005_draft_speaker_profiles.sql`、`0006_recording_locations.sql`、`0007_audio_processing_review.sql` が未適用で、最新のアプリ・Worker に必要なスキーマをまだ持たない。
- 手元の APK はデバッグ版、arm64、target API 36。Android を Expo 設定から再生成し、位置権限を含むローカル AAB のビルドも成功した。この AAB は開発署名で、Play 用の署名付き AAB と Play App Signing の証明書によるログインは未確認。
- Play Console の `Rion.Design` アカウントは登録済みで、全アプリ一覧に Yoin はない。EAS の `@rion0918/yoin` も読み取り確認では未作成。既存の別アプリには変更を加えていない。
- プライバシーポリシーとログイン前・設定画面の導線を準備済み。開発者名は `Rion.Design`、問い合わせ先はユーザー指定の `rion.developer.apps@gmail.com`。公開は Worker 更新後に確認する。
- ローカルの linux/amd64 音声イメージで health 200、私有 8 API の無認証 401、話者モデルの 256 次元読み込みを確認した。Docker の配布許可一覧に `activity.mjs` を追加した。話者識別の精度や実 AI の品質を示す検査ではない。
- PoC は移管済み、移管額 `8.733897` USD。D1 の台帳は確定費用 `1.285975` USD、照合待ち予約 `1.20` USD で元の試行集計と一致する。予算設定・台帳・未確定予約は変更していない。

以下の未実施記述は 2026-10-05 の実装時点の記録として読む。現在の外部状態は反映直前にも照合する。

- `app.config.ts` / `eas.json`: Android `playInternal`、store配布、AAB、自動versionCode、development clientなし。APIとFirebaseプロジェクトはビルドで固定する。
- `0004_accounts_and_budget.sql`: UID状態と独立費用台帳。既存の実費・未確定予約をそのまま複写し、削除後も金額・試行状態を残す。
- Worker: Firebase JWT検証、許可された検証済みGoogleメール、UIDによるAPI・署名URL・コールバックの所有者検証、削除Workflow。
- Cloud Run: サービス用Bearer認証を必須とする `POST /accounts/delete`。Firebase Admin SDKは実行サービスアカウントのADCを使用する。

この変更ではFirebase追加、Googleログイン有効化、証明書登録、IAM変更、EASプロジェクト登録、サービス反映、Playアップロードを実施していない。`google-services.json` と `EAS_PROJECT_ID` は未用意で、署名済みAABはまだない。現在クラウドで動いている旧固定トークン版とは互換性がないため、Workerを更新してから配布アプリを使う。

## Firebase・Google・EASの準備

1. Firebase Consoleで**既存** `yoin-app-20261004`（Google Cloud番号 `300039436163`）へFirebaseを追加する。AuthenticationのGoogleを有効にする。
2. Androidアプリを `com.rion0918.yoin` として登録する。Web OAuthクライアントが含まれる `google-services.json` を取得する。APIキー・プロジェクトID・OAuth client IDは非秘密設定だが、別プロジェクトのファイルを使わない。サービスアカウントの秘密鍵は入れない。
3. 開発証明書、EASのアップロード証明書、Play Consoleの **App integrity → App signing** のPlay App Signing証明書のSHA-1/SHA-256をFirebaseへ登録する。PlayでインストールするアプリはPlayの証明書で検証する。設定更新後のJSONを再取得する。[Expoの署名案内](https://docs.expo.dev/guides/google-authentication/)
4. `app.json` の既存EASプロジェクトIDを使用する。別のIDへの上書きが必要な場合だけ `EAS_PROJECT_ID` を設定する。EAS production環境には `GOOGLE_SERVICES_JSON` をfile変数として登録する。API URLとFirebase IDは `eas.json` の値と一致させる。Google認証の実装は[React Native Firebaseのガイド](https://rnfirebase.io/auth/social-auth)に従う。
5. ローカル開発では `.env.local.example` の非秘密設定とJSONファイルを用意し、ネイティブアプリを再ビルドする。ローカルWorkerを使う場合だけ `EXPO_PUBLIC_API_URL=http://localhost:8787` にしてビルドし、ADB転送を行う。画面で設定を変更しない。Firebase未設定の環境でのExpo exportはJSバンドル検証に限る。

配布設定の評価例（外部書き込みなし）:

```sh
EAS_BUILD_PROFILE=playInternal npx expo config --type public
```

HTTPS URL、Firebase project ID・プロジェクト番号・アプリID・API設定、Android package、Web OAuth client、EAS project ID、JSONファイルが不足・不一致なら停止する。AABはdevelopment buildと違いMetro接続を必要としない。[Expoの配布形式](https://docs.expo.dev/build-reference/apk/)

## versionCode の自動照合とビルド

`eas.json` の `appVersionSource: remote` と `playInternal.autoIncrement: true` は EAS remote versionCode を進めますが、Play Console 側の値は読み取りません。[Expo の version 管理](https://docs.expo.dev/tutorial/eas/manage-app-versions/)。そこで `scripts/android-play-internal.mjs` が Google Play Developer API の [track](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks/list) と [App Bundle](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.bundles/list) から versionCode を取得し、次の EAS 番号が Play の最大値を超える場合だけビルドを開始します。照会では一時 edit を作成しますが、内容を変更・commit せず、取得後に削除します。EAS の値が古い・未初期化・API照会に失敗した場合は、重複の可能性があるビルドを止めます。自動照合を通す配布ビルドでは、以後 `eas build` を直接実行せず次の npm script を使います。

1. [Google Play Developer API の手順](https://developers.google.com/android-publisher/getting_started)に従い API を有効にし、Play Console に登録したサービスアカウントへ Yoin のアプリ情報を読む権限を付ける。
2. サービスアカウント JSON 鍵をリポジトリ外に安全に保存し、`.env.local` の `GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_FILE` にその絶対パスを設定する。鍵ファイル自体をコミットしたり、EAS のアプリビルド環境へ登録したりしない。
3. `npm run android:check-play-version` で照合のみを行う。成功したら `npm run android:build:play-internal` が同じ照合を再実行してからAABを作る。

Play の最大値が EAS の次番号以上なら、エラーに表示された値を使い `npx eas-cli build:version:set --platform android --profile playInternal` で EAS remote の基準値を Play 最大値へ合わせ、その後もう一度照合する。照合とビルドの間に、別の手動アップロードや別のリリース環境から versionCode が登録される競合までは排除できないため、Play 用ビルドは同じ EAS プロジェクトから行う。

## 許可アカウントと削除権限

WorkerのSecret `ALLOWED_TESTER_EMAILS` に、許可メールのJSON配列を秘密入力または権限600のファイルから登録する。例のメールや実際の許可リストを公開ログへ表示しない。認証設定不足は503、許可外・未検証メールは403で拒否する。Firebase UIDをデータの所有者にし、Googleメールを所有者キーにしない。署名・issuer・audience・期限の契約は[Firebaseの検証仕様](https://firebase.google.com/docs/auth/admin/verify-id-tokens)に基づく。旧 `TESTER_TOKEN_SHA256` は新Workerで使用しない。旧端末データは新UIDへ移管しない。

内部テスターは18歳以上で、録音と外部処理の目的を確認した利用者に限定する。[Gemini API の利用条件](https://ai.google.dev/gemini-api/terms)では18歳未満を対象とする、または18歳未満がアクセスする可能性の高い API client は許可されない。一般公開と年齢を広げる判断は、この内部配布の対象に含めない。

既存Cloud Runの実行サービスアカウント `yoin-audio@yoin-app-20261004.iam.gserviceaccount.com` へ、`firebaseauth.users.delete` **だけ**を含むプロジェクトのカスタム役割を追加する。Owner、Editor、Firebase Authentication Adminは付与しない。[必要権限の一覧](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseauth)、[Admin SDKの削除](https://firebase.google.com/docs/auth/admin/manage-users)。既存の実行ID・秘密情報は保持し、鍵ファイルを作成しない。

## プライバシーと位置権限の申告

公開 URL は `https://yoin-private-api.h-rion-0910.workers.dev/privacy`。静的文書の読み取りだけを未認証で提供し、アプリのログイン画面と設定から開く。公開前に内容を確認し、Worker 更新後に HTTP 200 と実表示を確認する。[ADR 0019](adr/0019-public-privacy-policy.md)に提案を記録する。

バックグラウンド位置情報を要求する AAB では、Play Console の権限申告・必要性の説明・動画を確認する。動画には、位置情報 ON、取得範囲の説明、権限選択、未取得時の画面ロック中取得と通知、取得または停止による終了を含める。位置 OFF・拒否でも録音できることも検証する。採用済みの条件付き取得を、申告準備だけのために変更しない。

- [位置情報の公式申告要件](https://support.google.com/googleplay/android-developer/answer/9799150?hl=ja)
- [内部テストも対象となる権限申告](https://support.google.com/googleplay/android-developer/answer/9214102?hl=ja)

### フォアグラウンドサービスの申告案

ローカル AAB の実マニフェストには `microphone`、`mediaPlayback`、`location` が含まれる。Android 14 以降を対象とするため、各タイプの用途、延期・中断時の影響、利用者が開始する操作と動作を示す動画を [Play の申告要件](https://support.google.com/googleplay/android-developer/answer/13392821?hl=ja)に沿って確認する。以下は説明案であり、配布用 AAB と実機の動作を照合してから提出する。

| タイプ | 実装に沿った用途・中断時の影響 | 動画で確認すること |
| :--- | :--- | :--- |
| `microphone` | 利用者が開始した会話を、画面ロック中や他アプリ使用中も録音する。開始の延期や中断は、その場の会話の欠落につながる。利用者の停止で録音を終了・保存する。 | 録音開始、録音通知、ロック中の継続、通知またはアプリからの停止、保存した音声の再生 |
| `mediaPlayback` | 利用者が再生した完成曲や全区間の音声を、バックグラウンドでも聴く。再生が延期・中断されると、要求した音声を継続して聴けなくなる。区間指定の元会話再生は、アプリが非表示になると一時停止する。 | 完成曲の再生開始、バックグラウンド再生、通知の再生操作、一時停止の反映 |
| `location` | 位置 ON と許可を選んだ会話録音で、初回位置が未取得のときだけ、アプリが非表示でも最初の位置の取得を試みる。延期・中断は録音地点を残せない原因になる。取得または録音停止・位置 OFF で終了する。 | 利用範囲の説明、権限選択、未取得時の非表示状態と位置通知、初回取得または停止後の位置更新終了 |

位置を使わなくても録音はできるため、位置なしではアプリ全体が使用不能になるとは申告しない。バックグラウンド位置情報の必要性について承認を得られるかは、申告・動画・実機確認を含めて未確認である。

## 反映順と照合

1. 既存Workerの `AI_BUDGET_USD`、PoCのhandoff、D1の `provider_attempts` の実費・未確定予約を照合する。設定値 `8.733897` を10へ戻さない。許可リストSecret、Firebaseプロジェクト、Cloud Run実行IDと最小権限、EAS設定・署名を確認する。確認結果は金額と状態だけを記録する。
2. D1をバックアップして `0004` を番号順に適用する。適用直前の `provider_attempts` の合計額と状態別件数を記録し、直後の `budget_ledger` と一致することを確認する。旧 `private-tester` のD1/R2データは保持する。
3. 検証済みCloud Runイメージを反映する。既存 `GEMINI_API_KEY`、`MEDIA_SERVICE_TOKEN`、`MEDIA_ORIGIN` を変更せず、healthと無認証の `/accounts/delete` が401になることを確認する。有料POSTを確認用に繰り返さない。
4. Workerを反映し、`DELETE_ACCOUNT` bindingとFirebase設定を確認する。2つの許可Googleアカウントで本人情報・一覧・ID指定・再生・声の分離を確認する。
5. AABを作成する。Google Play内部テストへアップロードしてテスターを指定し、Playからインストールしたアプリでログインと主要操作を確認する。

GitHub ActionsのPR/mainチェックは継続する。本番反映はmainの手動 `workflow_dispatch` のみ。設定と予算を照合してからD1、Cloud Run、Workerの順に進む。Firebase・IAM・EAS・Playの設定はActionsから自動作成しない。D1適用後の再実行では既存migrationを再適用せず、予算台帳を初期化しない。

## アカウント削除の確認と再開

`GET /account` は本人のUID・メール・名前・状態を返す。`POST /account/deletion` は5分以内のGoogle再認証を要求する。受付が不明なら端末データを残し、再ログイン時に状態を取得して同じ削除Workflowを再開する。受付後は録音・通信・再生を終了し、本人の端末データを消す。

削除中は新規APIと署名URL・音声コールバックを拒否する。Workflowは既存prepare/generate Workflowの履歴を削除し、Firebaseユーザー、未完了multipart、本人のR2音声・特徴量・生成結果、D1の会話・歌詞・曲・話者・個人に紐づく試行を消す。途中失敗は同じWorkflowのステップを再試行する。再試行上限に達した場合は同じ削除要求でerrored Workflowを再開する。既存Workflowを再生成したり台帳を消して復旧しない。

削除完了後24時間は拒否記録を保持し、その後に拒否記録と削除Workflow自身の状態を消す。独立台帳には金額・試行状態・会話やジョブのIDと無関係なランダムIDを残す。元の試行との対応は削除対象の `provider_attempts` にだけ保存する。結果不明の予約は本人の削除や再登録で解放しない。削除失敗・生成中の削除・遅延コールバック・24時間後の履歴消去は実サービスでも確認する。

## 受け入れ記録

[内部テスト](internal-testing.md)の2アカウントと実機の表を埋める。静的チェック、モック、FFmpeg、JS export、Worker dry-run、署名AAB、実機、Play、実AI品質は別々の結果として[検証記録](audio-pipeline-verification.md)へ残す。
