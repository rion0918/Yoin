# 音声から曲を作る検証手順

この実装は単一テスター用です。実APIの歌声品質とAndroidの60分録音は、以下の手順で実際に確認してから受け入れます。Webは画面確認用です。録音・ファイル取り込みから生成・再生までの受け入れはAndroid development buildで行います。

## 1. 開発環境

Yoinのフォルダで実行します。

```sh
nix develop
npm ci
npm --prefix backend ci
```

Node、npm、JDK、音声検査のFFmpegはNixで固定しています。Android SDKとDocker Desktopはホストに必要です。

## 2. Googleの有料APIを設定する

1. [Google AI StudioのAPIキー画面](https://aistudio.google.com/apikey)を開き、Yoin検証用のプロジェクトを選びます。既存キーを使うか、Create API keyから作成します。
2. プロジェクトのBilling Tierを確認します。FreeならSet up billingから有料設定を行います。支払い・規約同意は自分で行ってください。新しいPrepayアカウントは最低5ドルの入金が必要で、既存アカウントでは表示が異なる場合があります。[Googleの設定手順](https://ai.google.dev/gemini-api/docs/billing)
3. Yoin直下に `.env.local.example` をコピーして `.env.local` を作り、エディタで `GEMINI_API_KEY=` の後にキーを保存します。キーをチャットへ貼らず、Gitにも含めません。アプリの `EXPO_PUBLIC_*` には置きません。[APIキーの扱い](https://ai.google.dev/gemini-api/docs/api-key)
4. 最初の試聴は3〜5分の日本語会話で行います。2人、3人、雑音ありの違いを確認します。話者ラベル `spk_1` などは仮ラベルで、人名を自動推測しません。

有料音楽生成の候補はLyria 3.5です。日本語の聞き取りやすさ・地名人名の読み・編集歌詞の歌唱は未確認で、利用できない場合も自動で他の有料サービスへ切り替えません。[音楽生成の仕様](https://ai.google.dev/gemini-api/docs/music-generation)

## 3. 先に短い音声で試聴する

`--audio` は手元の会話音声の絶対パスに置き換えます。日時が分からなければ `--recorded-at` を省略します。ファイルの更新日時は録音日時に使いません。場所も省略できます。

```sh
npm run poc -- prepare \
  --audio /absolute/path/conversation.m4a \
  --out .local/poc/first \
  --place 京都 \
  --recorded-at '2026-10-04T09:00:00+09:00'
```

`.local/poc/first/transcript.json` と `approved-lyrics.json` を確認します。後者の各ブロックの `text` を修正し、`sourceUtteranceIds` は実在する発話IDを保持してください。会話にない出来事を追加しないことも確認します。

```sh
npm run poc -- generate --run .local/poc/first
```

`music.mp3` を聴き、`returned-lyrics.txt` と編集した歌詞を比較します。最後まで聴けること、修正した言葉が歌われること、思い出の取り違えがないことが品質の受け入れ条件です。`song.json` の `qualityVerified:false` は実行成功だけでは変更されません。

音源・指定歌詞・API応答・処理時間・料金は `.local/poc/` に保存されます。既存runの再実行は完了結果を再利用し、受付結果が不明な有料処理は再送しません。別の試行を行う場合は別の `--out` を指定し、累積予算の範囲で実行します。

料金はAPIのusageと料金表による見積もりです。本文があるのに出力トークン数が0となる応答では、実請求を断定せず、その段階の予約上限を `costUsd` に計上します。`usage.costSource` が `reservation` の場合がこれに該当します。保存したraw応答とAI Studioの請求実績を照合し、未確認の金額を減らして再試行しないでください。

## 4. 合計10ドルの残額をサーバーへ引き継ぐ

品質確認を終えてPoCの実行プロセスを終了してから、次を一度実行します。

```sh
npm run poc -- handoff
npm run setup:local
```

handoffは `.local/poc/budget.json` の実績と未確定予約を10ドルから差し引き、`.local/ai-budget-handoff.json` に残額を固定します。以後PoCでの新しい有料処理は停止します。後で予約が安く確定してもサーバー予算を増やしません。`.local/` や台帳を削除・初期化すると累積管理が失われるため保持してください。

設定スクリプトは `backend/.dev.vars` と `.local/tester-token.txt` を権限600で作り、秘密の値はコンソールへ表示しません。既存設定は上書きしません。`backend/.dev.vars` の `GEMINI_API_KEY=` だけエディタで設定してください。AI予算には引き継いだ残額を使います。リポジトリのWorker既定予算は0で、明示設定するまで課金処理を開始しません。

未確定処理の予約額を消して再試行しないでください。クラッシュ後にロックが残った場合は、前のPoCプロセスが終了したことを確認してから `.run.lock` / `budget.json.lock` のみ手動で解除します。台帳・予約は残します。Google側の実利用もAI StudioのUsageで確認します。この台帳は、このYoin実装の呼び出しを管理します。

## 5. Cloudflareをローカルで確認する

Docker Desktopを起動し、別のターミナルでNix環境へ入ります。

```sh
npm --prefix backend run migrate:local
npm run backend:dev
```

ローカルD1・R2・WorkflowsとFFmpeg Containerを使います。サーバーは `http://localhost:8787` です。AI試行はローカルかクラウドのどちらか一方を選び、両方へ同じ残額を割り当てて並行課金しないでください。クラウドへ移行する前に、ローカル利用・未確定予約をD1の `provider_attempts` とGoogle Usageで確認し、その分も差し引きます。

設定スクリプトは、端末から再生する `PUBLIC_API_URL=http://localhost:8787` と、DockerからWorkerへ戻る `MEDIA_API_URL=http://host.docker.internal:8787` を分けています。Docker内のlocalhostはWorkerではないため、後者が必要です。クラウドではMEDIA_API_URLを設定せず、配置先のPUBLIC_API_URLを共通で使います。

## 6. Cloudflare開発環境へ配置する

既存アカウントでWranglerにログインします。ContainersはWorkers Paidプランが必要で、利用料は今回のAI10ドル予算とは別です。[Containers導入手順](https://developers.cloudflare.com/containers/get-started/)

```sh
cd backend
npx wrangler login
npx wrangler d1 create yoin
npx wrangler r2 bucket create yoin-private-audio
```

`wrangler.jsonc` のD1 `database_id` を作成結果へ置き換えます。R2は公開アクセスを有効にしません。`PUBLIC_API_URL` には配置先の `https://yoin-private-api.<あなたのsubdomain>.workers.dev` を指定します。`AI_BUDGET_USD` はPoC・ローカル利用を差し引いた残額に設定し、配置のたびにこの値を維持してください。

次は端末・エディタで値を確認し、Wranglerの対話入力で登録します。入力値をチャットやコマンド履歴に貼りません。

```sh
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put TESTER_TOKEN_SHA256
npx wrangler secret put MEDIA_SIGNING_SECRET
npx wrangler secret put MEDIA_SERVICE_TOKEN
npx wrangler d1 migrations apply yoin --remote
npx wrangler deploy
```

各Secretの値はローカル設定と対応させます。端末へ入れるのは `.local/tester-token.txt` の元トークンで、Workerへ入れるのは `backend/.dev.vars` のSHA256です。音声は所有者確認後の短期署名URLでだけ再生します。再生URLも他人へ共有しません。

## 7. Android development buildで確認する

1. 端末の開発者向けオプションでUSBデバッグを有効にし、USB接続します。端末上のPC許可は自分で確認します。`adb devices -l` で `device` と表示されることを確認します。
2. Yoin直下でNix環境から実行します。

```sh
npm run android:device
```

Expo Goでは今回の背景録音設定を検証できません。ネイティブ設定を変えたらdevelopment buildを作り直します。SDKやライセンスが未準備の場合はAndroid Studioで対象SDKを用意します。[development build](https://docs.expo.dev/develop/development-builds/introduction/)、[expo-audio](https://docs.expo.dev/versions/v57.0.0/sdk/audio/)

ローカルWorkerを使う実機では、別ターミナルで次を実行します。

```sh
adb reverse tcp:8787 tcp:8787
adb reverse tcp:8081 tcp:8081
```

アプリのライブラリ右上の設定を開き、URLは `http://localhost:8787`（クラウドならWorkerのHTTPS URL）、トークンは `.local/tester-token.txt` の内容を入力します。トークンは端末のSecureStoreに保存されます。

## 8. 受け入れ記録

- ファイル取り込み→任意の場所→仕上げる→歌詞レビュー→1ブロックを編集→曲生成→最後まで実再生。
- 歌詞の会話アイコンで、正しい元発話・録音時刻・場所を確認し、その区間を聴く。曲の位置を保持して曲に戻る。歌詞同期・歌詞ジャンプは対象外。
- 再起動後に下書き、編集歌詞、生成ジョブ、完成曲へ戻る。バックエンドはアプリを閉じても処理を続ける。
- オフライン録音→停止保存→復帰して送信。送信を途中で切り、同じmultipart進行から再開。連打で曲の二重生成がない。
- Androidでロック・他アプリ使用を含む連続60分録音→通知から停止→同じ音声を再生。通話中断、強制終了も別に確認する。
- 無音・旧歌詞版・存在しない出典・不正認証・API失敗・受付不明で、音声を失わず説明が表示される。受付不明を自動再生成しない。

復元時は実ファイルを検査し、再生できる録音だけを下書きへ戻します。再生できなかったファイル参照は `recoveryFiles` に保持して次起動で再検査します。壊れたファイルの修復は保証せず、録音中の表示だけを復元することはしません。

合計60分までが生成入力の範囲です。60分を超えて録音したファイルも端末に保持しますが、この検証では送信・生成を拒否します。GPS、公開共有、会員登録、課金、iPhone実機受け入れ、自動ジャケット生成は次の段階です。
