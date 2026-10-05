# Google Play内部テストの配布準備

[目次](README.md)へ。認証と保存は[ADR 0014](adr/0014-firebase-account-isolation.md)、配布方法は[ADR 0015](adr/0015-google-play-internal-distribution.md)のProposed判断として記録する。以下の外部設定・デプロイ・ビルド・アップロードは、それぞれ変更内容を確認し、個別の実行指示後に行う。

## 成果物と未実施の設定

- `app.config.ts` / `eas.json`: Android `playInternal`、store配布、AAB、自動versionCode、development clientなし。APIとFirebaseプロジェクトはビルドで固定する。
- `0004_accounts_and_budget.sql`: UID状態と独立費用台帳。既存の実費・未確定予約をそのまま複写し、削除後も金額・試行状態を残す。
- Worker: Firebase JWT検証、許可された検証済みGoogleメール、UIDによるAPI・署名URL・コールバックの所有者検証、削除Workflow。
- Cloud Run: サービス用Bearer認証を必須とする `POST /accounts/delete`。Firebase Admin SDKは実行サービスアカウントのADCを使用する。

この変更ではFirebase追加、Googleログイン有効化、証明書登録、IAM変更、EASプロジェクト登録、サービス反映、Playアップロードを実施していない。`google-services.json` と `EAS_PROJECT_ID` は未用意で、署名済みAABはまだない。現在クラウドで動いている旧固定トークン版とは互換性がないため、Workerを更新してから配布アプリを使う。

## Firebase・Google・EASの準備

1. Firebase Consoleで**既存** `yoin-app-20261004`（Google Cloud番号 `300039436163`）へFirebaseを追加する。AuthenticationのGoogleを有効にする。
2. Androidアプリを `com.rion0918.yoin` として登録する。Web OAuthクライアントが含まれる `google-services.json` を取得する。APIキー・プロジェクトID・OAuth client IDは非秘密設定だが、別プロジェクトのファイルを使わない。サービスアカウントの秘密鍵は入れない。
3. 開発証明書、EASのアップロード証明書、Play Consoleの **App integrity → App signing** のPlay App Signing証明書のSHA-1/SHA-256をFirebaseへ登録する。PlayでインストールするアプリはPlayの証明書で検証する。設定更新後のJSONを再取得する。[Expoの署名案内](https://docs.expo.dev/guides/google-authentication/)
4. EASの既存プロジェクトを確認して接続する。未作成の場合のみ作成し、返されたUUIDを `EAS_PROJECT_ID` に設定する。EAS production環境には `GOOGLE_SERVICES_JSON` をfile変数、`EAS_PROJECT_ID` を通常変数として登録する。API URLとFirebase IDは `eas.json` の値と一致させる。Google認証の実装は[React Native Firebaseのガイド](https://rnfirebase.io/auth/social-auth)に従う。
5. ローカル開発では `.env.local.example` の非秘密設定とJSONファイルを用意し、ネイティブアプリを再ビルドする。ローカルWorkerを使う場合だけ `EXPO_PUBLIC_API_URL=http://localhost:8787` にしてビルドし、ADB転送を行う。画面で設定を変更しない。Firebase未設定の環境でのExpo exportはJSバンドル検証に限る。

配布設定の評価例（外部書き込みなし）:

```sh
EAS_BUILD_PROFILE=playInternal npx expo config --type public
```

HTTPS URL、Firebase project ID・プロジェクト番号・アプリID・API設定、Android package、Web OAuth client、EAS project ID、JSONファイルが不足・不一致なら停止する。EAS `playInternal` の設定がそろった後のビルドコマンドは `eas build --platform android --profile playInternal`。AABはdevelopment buildと違いMetro接続を必要としない。[Expoの配布形式](https://docs.expo.dev/build-reference/apk/)

## 許可アカウントと削除権限

WorkerのSecret `ALLOWED_TESTER_EMAILS` に、許可メールのJSON配列を秘密入力または権限600のファイルから登録する。例のメールや実際の許可リストを公開ログへ表示しない。認証設定不足は503、許可外・未検証メールは403で拒否する。Firebase UIDをデータの所有者にし、Googleメールを所有者キーにしない。署名・issuer・audience・期限の契約は[Firebaseの検証仕様](https://firebase.google.com/docs/auth/admin/verify-id-tokens)に基づく。旧 `TESTER_TOKEN_SHA256` は新Workerで使用しない。旧端末データは新UIDへ移管しない。

既存Cloud Runの実行サービスアカウント `yoin-audio@yoin-app-20261004.iam.gserviceaccount.com` へ、`firebaseauth.users.delete` **だけ**を含むプロジェクトのカスタム役割を追加する。Owner、Editor、Firebase Authentication Adminは付与しない。[必要権限の一覧](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseauth)、[Admin SDKの削除](https://firebase.google.com/docs/auth/admin/manage-users)。既存の実行ID・秘密情報は保持し、鍵ファイルを作成しない。

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
