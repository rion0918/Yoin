# 音声処理の設定・デプロイ・運用

[ドキュメントの目次](README.md)へ

単一テスター向けの接続手順です。アプリの起動は[README](../README.md)、端末の導入・操作確認は[内部テスト](internal-testing.md)を参照してください。実際の配置先と有効化状況は[検証記録](audio-pipeline-verification.md#現在の確認状況)で管理します。

## 作業の前提と順番

コマンドは、別に指定した場合を除きリポジトリ直下のNix環境で実行します。別ターミナルにも同じ環境を適用してください。

```sh
nix develop
npm ci
npm --prefix backend ci
```

ローカル音声処理にはDocker Desktop等のDocker実行環境、クラウド配置にはGoogle Cloud SDKとCloudflare / Google Cloudの権限が必要です。SDKはこのリポジトリのflakeに含まれないため、[公式の導入手順](https://docs.cloud.google.com/sdk/docs/install)で準備します。

1. Google APIを設定し、ローカルPoCで短い会話と生成曲を確認する。
2. ローカルPoCを終了し、実績・未確定予約を保持して残予算を引き継ぐ。
3. ローカルバックエンド、またはクラウドの一方に接続を設定する。
4. [内部テストの開始条件](internal-testing.md#開始条件)と実際の設定を確認して端末で試す。

AI予算0での接続確認と、有料APIを使う確認は区別します。リポジトリの既定値0は文字起こし・曲生成を開始しません。基盤の料金はAI累積10ドルとは別です。

## Google APIの設定

1. [Google AI StudioのAPIキー画面](https://aistudio.google.com/apikey)を開き、Yoin検証用のプロジェクトを選びます。既存キーを使うか、Create API keyから作成します。
2. プロジェクトのBilling Tierを確認します。FreeならSet up billingから有料設定を行います。支払い・規約同意は自分で行ってください。新しいPrepayアカウントは最低5ドルの入金が必要で、既存アカウントでは表示が異なる場合があります。[Googleの設定手順](https://ai.google.dev/gemini-api/docs/billing)
3. Yoin直下に `.env.local.example` をコピーして `.env.local` を作り、エディタで `GEMINI_API_KEY=` の後にキーを保存します。キーをチャットへ貼らず、Gitにも含めません。アプリの `EXPO_PUBLIC_*` には置きません。[APIキーの扱い](https://ai.google.dev/gemini-api/docs/api-key)
4. 最初の試聴は3〜5分の日本語会話で行います。2人、3人、雑音ありの違いを確認します。話者ラベル `spk_1` などは仮ラベルで、人名を自動推測しません。

有料音楽生成の候補はLyria 3.5です。日本語の聞き取りやすさ・地名人名の読み・編集歌詞の歌唱は未確認で、利用できない場合も自動で他の有料サービスへ切り替えません。[音楽生成の仕様](https://ai.google.dev/gemini-api/docs/music-generation)

## ローカルPoCと試聴

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

## 残予算の移管

PoCの品質確認を終え、実行プロセスが終了していることを確認してから、次を一度実行します。

```sh
npm run poc -- handoff
```

`.local/poc/budget.json` の実績と未確定予約を10ドルから差し引き、`.local/ai-budget-handoff.json` に移管額を固定します。以後PoCでの新規有料呼び出しは停止します。後で予約が安く確定しても移管額を増やしません。台帳と `.local/` は保持してください。

### 新しいローカル接続を作る場合

引き継ぎファイルが存在し、下記の3ファイルがまだない環境で実行します。

```sh
npm run setup:local
```

[設定スクリプト](../scripts/setup-local.mjs)は次を権限600で作ります。既存ファイルがある場合は失敗し、上書きしません。

| ファイル | 内容 |
| :--- | :--- |
| `backend/.dev.vars` | Workerの認証・署名・接続先と引き継いだAI予算 |
| `.local/media.env` | 音声サービスのBearerトークン、callback元、空のGoogleキー欄 |
| `.local/tester-token.txt` | 端末へ設定する元トークン |

`.local/media.env` の `GEMINI_API_KEY=` をエディタで設定します。キーや元トークンをチャット・ログへ表示しません。

### 既存の接続・クラウドへ移す場合

既存トークンや台帳を削除して `setup:local` をやり直さないでください。既存の認証設定を保持し、handoffの `remainingUsd` を対象Workerの `AI_BUDGET_USD` に設定します。クラウドでは `backend/wrangler.jsonc` の `vars` を更新して再配置します。移管額はそのサーバーで使う累積枠であり、再配置時に10ドルへ戻しません。

ローカルD1でも有料処理を実行していた場合は、`provider_attempts` とGoogle Usageで確定費用・未確定予約を照合し、その分も差し引いてクラウドへ移します。同じ残額をローカル・クラウドへ割り当てて並行実行しないでください。

クラッシュ後のロックは、前のPoCプロセスが終了したことを確認してから `.run.lock` / `budget.json.lock` だけ解除します。受付不明の予約や台帳は保持します。[結果不明時の確認](#障害と結果不明の確認)へ進んでください。

## 接続設定の一覧

| 設定 | 配置する場所 | 用途 |
| :--- | :--- | :--- |
| API URL・元テスタートークン | 端末の接続設定 / SecureStore | Workersへの認証 |
| `TESTER_TOKEN_SHA256` | Workerの秘密情報 | 元トークンのSHA256 |
| `MEDIA_SIGNING_SECRET` | Workerの秘密情報 | 期限付き音声・callback URLのHMAC |
| `MEDIA_SERVICE_TOKEN` | Workerと音声サービスの秘密情報 | Cloud Run処理ルートのBearer認証。同じ値を設定 |
| `GEMINI_API_KEY` | PoCの `.env.local`、音声サービスの環境変数 | Google API認証。Worker・端末には置かない |
| `AI_BUDGET_USD` | Workerのvars | 移管後の累積AI枠。初回配置は0 |
| `PUBLIC_API_URL` | Workerのvars | アプリが使うWorker URL |
| `MEDIA_SERVICE_URL` | Workerのvars | ローカル音声サービスまたはCloud Run URL |
| `MEDIA_API_URL` | ローカルWorkerの `.dev.vars` | DockerからWorkerへ戻るURL。クラウドでは設定しない |
| `MEDIA_ORIGIN` | 音声サービスの環境変数 | 許可する署名URLのorigin |

## ローカルバックエンド

[残予算の移管](#残予算の移管)で設定を用意し、Dockerを起動します。リポジトリ直下から、音声サービスを起動します。

```sh
docker build --platform linux/amd64 -f backend/media/Dockerfile -t yoin-audio:local .
docker run --rm -p 127.0.0.1:8080:8080 --env-file .local/media.env yoin-audio:local
```

別のNixターミナルで、同じリポジトリ直下からローカルD1を適用し、Workerを起動します。

```sh
npm --prefix backend run migrate:local
npm run backend:dev
```

| 接続 | URL |
| :--- | :--- |
| アプリ→Worker | `http://localhost:8787` |
| Worker→音声サービス | `http://127.0.0.1:8080` |
| Docker→Worker | `http://host.docker.internal:8787` |

`backend/.dev.vars` の `MEDIA_SERVICE_URL`、`MEDIA_API_URL` と、`.local/media.env` の `MEDIA_ORIGIN` を対応させます。上記はDocker Desktopのホスト接続を前提にします。別のDocker環境ではホスト名の解決を確認し、callback元と署名URLのoriginを揃えてください。

ローカルD1・R2・Workflowsを使います。Dockerのビルド送信対象は[Dockerfileのignore](../backend/media/Dockerfile.dockerignore)で限定し、秘密情報・音声を含めません。端末のUSB転送と接続設定は[内部テスト](internal-testing.md#androidへの導入と接続設定)を参照してください。

## Cloud RunとCloudflareへの配置

[ADR 0011](adr/0011-cloudflare-free-audio-runtime.md)に従い、Workers FreeにAPI・D1・非公開R2・Workflowsを置き、Cloud RunにFFmpegとGoogleアダプターを置きます。[実際の配置情報](audio-pipeline-verification.md#配置リソース)を確認し、既存環境の更新か新規構築かを判断して作業します。

### Google Cloudの準備

Google Cloud SDKで意図したアカウントへログインし、作業するYoin専用プロジェクトIDを指定します。次の変数はこのターミナルで以降のコマンドに使います。

```sh
gcloud auth login
gcloud auth list
YOIN_PROJECT_ID=YOUR_YOIN_PROJECT
```

新規構築の場合のみ、専用プロジェクトを作成し、利用者が選んだ請求先を関連付けます。請求先IDはGoogle Cloudで確認し、支払い・規約同意を確認してから実行します。

```sh
YOIN_BILLING_ACCOUNT_ID=YOUR_BILLING_ACCOUNT_ID
gcloud projects create "$YOIN_PROJECT_ID" --name=Yoin
gcloud billing projects link "$YOIN_PROJECT_ID" --billing-account="$YOIN_BILLING_ACCOUNT_ID"
```

新規構築の場合に、必要なAPI・東京のDockerリポジトリ・実行アカウントを準備します。既存リソースは再作成しません。

```sh
gcloud services enable run.googleapis.com artifactregistry.googleapis.com iam.googleapis.com --project="$YOIN_PROJECT_ID"
gcloud artifacts repositories create yoin-runtime --project="$YOIN_PROJECT_ID" --location=asia-northeast1 --repository-format=docker
gcloud iam service-accounts create yoin-audio --project="$YOIN_PROJECT_ID" --display-name='Yoin audio runtime'
```

実行アカウントにはGoogle Cloudリソースの管理権限を付与しません。Google APIは既存のAPIキーで認証します。

### イメージとCloud Run

リポジトリ直下で、初回配置でも使ったローカルビルド→Artifact Registryへのpushを行います。Docker実行環境と上記のプロジェクト・リポジトリが必要です。

```sh
gcloud auth configure-docker asia-northeast1-docker.pkg.dev
docker build --platform linux/amd64 -f backend/media/Dockerfile -t yoin-audio:local .
docker tag yoin-audio:local "asia-northeast1-docker.pkg.dev/$YOIN_PROJECT_ID/yoin-runtime/audio:latest"
docker push "asia-northeast1-docker.pkg.dev/$YOIN_PROJECT_ID/yoin-runtime/audio:latest"
```

push結果の `sha256:...` を使い、`YOIN_RUNTIME_IMAGE` に完全なイメージ参照を設定します。次のプレースホルダーは実際のダイジェストへ置き換えてください。

```sh
YOIN_RUNTIME_IMAGE="asia-northeast1-docker.pkg.dev/$YOIN_PROJECT_ID/yoin-runtime/audio@sha256:YOUR_DIGEST"
```

Git管理外・権限600の `.local/cloud-run-env.json` に `GEMINI_API_KEY`、`MEDIA_SERVICE_TOKEN`、`MEDIA_ORIGIN` を用意します。`MEDIA_ORIGIN` は対象WorkerのHTTPS origin、トークンはWorkerと同じ値にします。秘密の値は引数へ直接書かず、このファイルから登録します。

ファイルの形式は次のJSONです。プレースホルダーをエディタで置き換え、`chmod 600 .local/cloud-run-env.json` で権限を制限します。`.local` がなければ先に `mkdir -p .local` で作ります。

```json
{
  "GEMINI_API_KEY": "YOUR_GOOGLE_API_KEY",
  "MEDIA_SERVICE_TOKEN": "YOUR_SHARED_RUNTIME_TOKEN",
  "MEDIA_ORIGIN": "https://YOUR_WORKER.workers.dev"
}
```

```sh
gcloud run deploy yoin-audio --project="$YOIN_PROJECT_ID" --region=asia-northeast1 \
  --image="$YOIN_RUNTIME_IMAGE" \
  --service-account="yoin-audio@$YOIN_PROJECT_ID.iam.gserviceaccount.com" \
  --cpu=1 --memory=1Gi --min=0 --max=1 --concurrency=1 --timeout=900s \
  --cpu-throttling --no-cpu-boost --allow-unauthenticated \
  --env-vars-file=.local/cloud-run-env.json
```

外部HTTPSから到達できる入口と、処理APIのBearer認証を使います。`/inspect`、`/probe`、`/transcribe`、`/lyrics`、`/music` は認証必須、公開 `/health` は `ok` だけを返します。管理者はサービス設定の環境変数を参照できます。

配置結果のURLをWorkerの `MEDIA_SERVICE_URL` に設定します。Cloud Buildを使う場合は別途API・ビルド実行アカウントの権限が必要です。[ビルド設定](../backend/media/cloudbuild.yaml)と[公式の権限説明](https://docs.cloud.google.com/build/docs/securing-builds/configure-access-for-cloud-build-service-account)を参照してください。この経路の実行確認は[検証記録](audio-pipeline-verification.md)に記録します。

### Cloudflareの準備と配置

リポジトリ直下から `cd backend` し、Wranglerでアカウントを確認します。以降この節のコマンドはbackend内で実行します。

```sh
cd backend
npx wrangler whoami
```

必要なら `npx wrangler login` でログインします。[wrangler.jsonc](../backend/wrangler.jsonc) の `account_id`、D1 ID、R2名、API URL、Cloud Run URLが意図した配置先に対応することを確認します。このリポジトリの設定は既存のYoin環境を指しています。

新しいアカウントへ構築する場合のみ、D1・R2を作成して設定のIDと名前を置き換えます。

```sh
npx wrangler d1 create yoin
npx wrangler r2 bucket create yoin-private-audio
```

R2の公開 `r2.dev` URLを無効にし、公開カスタムドメインも設定しません。初回は `AI_BUDGET_USD=0`、クラウドでは `MEDIA_API_URL` を設定せず `PUBLIC_API_URL` を使います。

既存トークンのSHA256、32文字以上の署名秘密、Cloud Runと同じサービス用トークンを登録します。値は端末・Worker・Cloud Runの対応を確認し、秘密入力または権限600のファイルを使います。

```sh
npx wrangler secret put TESTER_TOKEN_SHA256
npx wrangler secret put MEDIA_SIGNING_SECRET
npx wrangler secret put MEDIA_SERVICE_TOKEN
npx wrangler d1 migrations apply yoin --remote
npx wrangler deploy
```

GoogleキーをWorkerへ登録しません。`0002_audio_runtime.sql` は有料試行の実行権を排他取得するための列を追加します。移管後の有料APIを有効化する場合は[残予算の移管](#残予算の移管)に従ってvarsを更新します。

## 配置後の確認

- 対象アカウント・プロジェクト、イメージのダイジェスト、Cloud Runのリソース・認証設定を確認する。
- 未認証APIの拒否、音声送信、署名URL・Range・期限切れ、実FFmpeg分割、ジョブ状態取得を確認する。
- 予算0の試験では、有料APIの前で停止し、新規有料試行が作られないことを確認する。
- AI有効化後は[内部テスト](internal-testing.md)に従い、実音源・歌詞・保存結果と無料WorkerのCPUを確認する。
- 実際に確認した結果だけを[検証記録](audio-pipeline-verification.md)へ日付付きで残す。

## 障害と結果不明の確認

| 状況 | 確認と扱い |
| :--- | :--- |
| 認証失敗 | 接続先、元トークンとSHA256、Cloud Run用トークンの一致を確認 |
| `ai_budget_exhausted` | 設定された累積枠と、D1の費用・未確定予約を確認。台帳を初期化して回避しない |
| 音声検査失敗 | 元音声の署名期限・実ファイル・callbackのorigin・保存先を確認 |
| `needs_reconciliation` / `provider_outcome_unconfirmed` | 同じ有料POSTを再送せず、D1の試行と予約、R2の結果・生応答、Google Usageを照合 |
| 予約額を超えた見積もり | 新しい有料呼び出しを止め、usageと請求を照合 |
| 結果は保存済みだがHTTP応答を失った | 同じ試行の回復用結果を使う。手動でclaim列を消して再実行しない |

ジョブ状態はアプリとAPIから確認します。Workerの `wrangler tail` とCloud Runログを調べる場合、署名URL・認証情報・音声・Googleの生応答を公開ログや不具合本文へ貼らないでください。詳細な回復の契約は[構成・設計](audio-pipeline-architecture.md#有料試行と結果回復)を参照してください。

## 費用と保存量の確認

Workers Freeを維持しますが、R2の超過利用やGoogle Cloud、Google APIには料金があり得ます。Cloud Runはリクエスト課金・最小0・最大1・同時処理1で開始し、厳密な料金上限とは扱いません。基盤とAIの費用を分けて確認します。

元音声・分割音声・生成曲・試行結果が蓄積します。現行実装には保存総量の料金上限や自動削除がないため、R2の保存量と操作回数、Artifact Registryの保管量、Cloud Runの実行・通信、Google Usageを確認します。無料枠はアカウント・請求先の他の利用と共有されます。

過去の概算は[2026-10-04の記録](audio-pipeline-verification.md#2026-10-04の基盤費用の概算)、利用時の単価・制限は[Workers](https://developers.cloudflare.com/workers/platform/limits/)、[D1](https://developers.cloudflare.com/d1/platform/pricing/)、[R2](https://developers.cloudflare.com/r2/pricing/)、[Cloud Run](https://cloud.google.com/run/pricing)、[Artifact Registry](https://cloud.google.com/artifact-registry/pricing)、[Google API](https://ai.google.dev/gemini-api/docs/pricing)の公式情報で確認してください。
