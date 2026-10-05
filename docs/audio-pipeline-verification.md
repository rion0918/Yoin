# 音声パイプラインの検証記録

[ドキュメントの目次](README.md)へ

## 2026-10-05 Google Play内部テスト向けの実装確認

Googleログイン、UIDごとの端末・サーバーデータ分離、アカウント削除、個人情報を含まない累積費用台帳、Play内部テスト用の配布設定を実装しました。接続設定の入力画面を削除し、初回の流れをログイン、名前・声の登録、ライブラリに変更しています。今回の外部設定変更・D1移行・Cloud Run/Workerのデプロイ・Playへのアップロードは行っていません。以前の配置記録は下に実施時の状態として保持します。

| 確認 | 結果 | 確認できた範囲・制約 |
| :--- | :--- | :--- |
| `npm run check`・`npm run typecheck`・`npm run backend:typecheck` | 成功 | Nix環境。アプリ・配布設定・バックエンドの静的確認 |
| `npm test` | 97/97成功 | IDトークン取得、認証失敗時の有料POST再送防止、UID別保存キー、切り替え時の遅延応答・録音停止待ち、配布設定の不足・不一致を含む |
| `npm run backend:test` | 55/55成功 | 署名・発行元・対象プロジェクト・期限・Google認証・検証済み許可メール、通常API・署名音声URL・話者・コールバックの所有者、削除と音声送信・Workflow作成の競合、未作成・消去済みWorkflowの扱い、削除後の費用保持・全利用者共通上限を確認。Google署名キーと応答はテスト用に置き換え、D1/R2はテストbinding |
| `npm --prefix backend run test:media` | 9/9成功、スキップ0 | NixのFFmpeg/FFprobeで26分・60分の合成音声を処理。Firebase削除の内部APIは認証・入力・冪等性を確認し、Firebase Adminの呼び出しは置き換え |
| `npm run export` | 成功 | Android・iOS・WebのExpo export。署名付きAABやAndroid実機での起動の確認ではない |
| Worker `deploy --dry-run` | 成功 | 準備・生成・アカウント削除の3つのWorkflowを含むbundleを確認。実環境へは未反映 |
| `actionlint`・`shellcheck scripts/ci-verify.sh`・`git diff --check` | 成功 | 手動反映の順序とCI設定を静的確認。GitHub Actions自体は未実行 |
| `EAS_BUILD_PROFILE=playInternal npx expo config --type public` | 必須設定の不足で意図どおり失敗 | `google-services.json` が未配置。設定済みfixtureでは配布設定の検証が成功することを単体テストで確認 |

認証、利用者分離、遅延応答、削除、費用保持、配布設定の回帰テストは、実装前にRED、実装後にGREENを確認しました。有料AIは呼び出していません。既存の開発テストデータと未確定予約を新しいUIDへ自動移管・初期化していません。

PRレビューで費用台帳のIDと削除再開の2点を修正しました。費用台帳はランダムIDを使用し、会話・ジョブ由来の試行IDとの対応は削除対象の試行テーブルにだけ保存します。削除途中に実費が判明した場合も、独立した台帳IDで金額を保持します。Workflowの不存在エラーだけを除外し、一時的なlookup障害は削除ステップの再試行へ返します。どちらもREDからGREENを確認しました。不存在の扱いは[CloudflareのAPI契約](https://developers.cloudflare.com/workflows/build/workers-api/#get)と使用中のSDK実装を確認していますが、実クラウドでの削除再開は未確認です。

残る作業は[Play内部テストの配布・運用手順](play-internal-release.md)に記載しています。Firebase Authenticationの有効化、3種類の署名証明書、`google-services.json`、EASプロジェクトID、テスター許可リスト、Cloud Run実行アカウントのFirebase削除権限は未設定です。実費・予約の照合、D1移行とサービス反映の後に署名付きAABを作成する必要があります。

2つの実Googleアカウントでの分離、Nitro/Credential Managerによるログイン・キャンセル・再認証、再起動後の下書き復元、オフライン録音・取り込み・バックグラウンド録音・再生はAndroid実機で未確認です。削除途中の通信失敗・生成中の削除・削除済みトークン・遅延コールバック、削除Workflowの実行履歴消去・24時間後の拒否記録消去、Firebaseアカウントの実削除も実環境で未確認です。Play配布後の確認と実AI品質・長時間録音の受け入れは、自動チェックの成功と分けて記録します。

## 2026-10-05 話者登録・識別の実装状況

話者登録とチャンク単位の識別を追加し、D1、Cloud Run、Workerの順に反映しました。実機で2人を登録して別内容の日本語会話から曲完成まで進める受け入れ確認は未完了です。

| 対象 | 結果 | 制約 |
| :--- | :--- | :--- |
| Biome・アプリ型チェック・バックエンド型チェック | 成功 | 変更した実装の静的確認 |
| アプリテスト | 89/89成功 | 録音分離・復旧・登録条件・話者名表示・未対応APIのエラー表示、登録UIの状態・残り時間・短い音声の除外など。実端末の録音品質は対象外 |
| バックエンドテスト | 38/38成功 | D1/R2テストbinding。所有者・登録・再登録・照合・再試行を確認 |
| 音声サービステスト | 8/8成功。実ONNXモデルでも256次元の有限な特徴量を取得 | 26分・60分のFFmpeg分割、短い発話の除外、話者照合ロジック。実推論の入力は10秒の合成波形で、日本語の本人識別精度は未確認 |
| D1 | `0003_speaker_profiles.sql` を2026-10-05にリモート適用 | 既存の予算台帳を保持 |
| Cloud Run・Worker | 2026-10-05に更新。Cloud Runのhealthと、既存の認証による登録・識別APIへの到達を確認 | 無効入力への422応答で確認。実音声の登録・識別は未確認 |
| Android | 2026-10-05に最新APKをSM_F971Cへビルド・インストールして起動し、初回の話者登録画面を確認。クラウド更新後、端末の保存済み接続情報による `GET /speakers` のHTTP 200をWorkerの一時ログで確認。Metro接続中 | 実音声の登録と2人の日本語会話テストは未実施。確認ログでは認証情報を表示せず、確認後に削除 |

話者追加時の「処理を続けられませんでした」という表示は、更新前のWorkerに話者APIがなく、`route_not_found` が接続設定を案内する汎用エラーになったことが原因でした。未対応の接続先を明示する回帰テストをREDにしてから表示を修正し、GREENを確認しました。

同日に登録UIを名前入力、録音、確認、完了へ分けました。名前保存だけではマイクを開始せず、録音中は20秒までの残り時間を表示し、必要な操作をシート下部へ固定しています。既存の登録・保存契約に従う画面改善で、ADR 0012はProposedのままです。UI状態の5テストをREDからGREENにし、実コンポーネントを音声・通信を置き換えた390×844の環境で操作して、録音開始・停止・試聴・登録完了・同行者追加・短い音声の録り直し・登録エラー・名前変更・閉じる前の停止を確認しました。曲の再生中にも登録音声の試聴操作を正しく表示することを確認しました。Androidでは保存済み17秒の登録音声が確認画面へ復元されることと、名前入力時にキーボードの上へ入力欄と「次へ」を表示できることを確認しました。UI検証の登録成功は実APIでの本人識別精度の確認ではありません。

ローカルのDocker Desktopは内部ストレージI/Oエラーでビルドに失敗したため、ユーザーの許可を受けて秘密情報・録音データを含まない10ソースファイル（16KB）をYoin管理用Cloud Shellへ送信し、linux/amd64イメージをビルドしました。モデルのチェックサムと、1vCPU・1GiBでの実推論を確認してから既存サービスを更新しました。Cloud Runは `yoin-audio-00002-vcf` が100%のトラフィックを受け、イメージdigestは `sha256:a433d7a891ccc4c2d3f45d267c727321d91770709d363a8e5687c783ca4cd79c`、WorkerのVersion IDは `0211d522-3f4e-40a6-8aac-7761870a55fe` です。キャッシュ削除や端末データの初期化は行わず、既存のAI累積台帳と予算設定 `8.733897` ドルを保持しました。今回の反映確認で有料AIを呼び出していません。

## 現在の確認状況

2026-10-04時点。以下は同日に実施した検証の記録です。文書の整理に伴って、アプリ起動・実AI呼び出し・実機テストを再実施したものではありません。

| 対象 | 現在の状態 | 内部テストを始める前に必要なこと |
| :--- | :--- | :--- |
| 実装と自動チェック | アプリ74件・バックエンド33件・音声サービス4件が成功。型チェック・Biome・export・Android APKビルドも成功 | 実機や実APIの品質確認とは区別する |
| クラウド接続 | Worker・Workflows・D1・R2・Cloud Runを配置。26分の合成音声で送信・分割・保存・認証を確認 | Androidからの接続と実音声での操作確認 |
| クラウドの実AI生成 | **AI予算0**。有料処理の前に停止し、試行は0件 | PoCの試聴、残予算移管、対象Workerでの有効化 |
| ローカルPoC | 4分の公開会話から歌詞案・編集・約2分7秒のMP3を生成 | 試聴による歌唱・読み・元会話との一致の確認 |
| Android実機 | APKビルドまで。録音・生成・再生の受け入れは未確認 | Metro接続、短い会話の完走、長時間録音・復旧 |
| AI累積予算 | 10ドルから予約込み約1.27ドルを計上、残額約8.73ドル。サーバーへ未移管 | 保持中の予約とGoogleの実請求を照合し、残額のみ移す |

既知の品質問題は、文字起こしの固有名詞の誤認と、歌詞案への出典にない情景・曖昧な主体の追加です。手動レビューで修正しましたが、モデル品質の受け入れは未達です。3人・雑音あり・旅行会話、歌唱の一致、クラウドでの実AI生成、Android実機の長時間録音・中断・復旧は未確認です。

現在は予算0での接続・停止確認を始められます。一連の曲生成を含む内部テストは、[PoCの試聴と残予算移管](audio-pipeline-setup.md#ローカルpocと試聴)を終えてから、[開始条件と操作手順](internal-testing.md)に従って実施してください。

## 配置リソース

2026-10-04に配置・確認した環境です。設定・更新の手順は[セットアップと運用](audio-pipeline-setup.md#cloud-runとcloudflareへの配置)を参照してください。秘密の値は記載しません。

| リソース | 配置先・設定 |
| :--- | :--- |
| Cloudflareアカウント | `h.rion.0910@gmail.com` / `3b7d7afda6c8bf0aa72256c171dd5f04`、Workers Free |
| Worker / アプリの接続先 | `yoin-private-api` / `https://yoin-private-api.h-rion-0910.workers.dev` |
| Workflows | `yoin-prepare`、`yoin-generate` |
| D1 | `yoin` / `ab04f764-9fc9-4cc2-9444-5f54a5a71057`、APAC。0001〜0003適用済み（0003は2026-10-05） |
| R2 | `yoin-private-audio`、Standard、公開 `r2.dev` 無効 |
| Google Cloud | `Yoin` / `yoin-app-20261004`、番号 `300039436163`。同じメールアカウントで管理 |
| 請求先 | ユーザーが選んだ「請求先アカウント」（末尾89B51A） |
| Cloud Run | `yoin-audio`、東京 `asia-northeast1` / `https://yoin-audio-300039436163.asia-northeast1.run.app` |
| 実行設定 | 1vCPU・1GiB、最小0・最大1、同時処理1、900秒、CPU throttling有効・startup boost無効 |
| 実行アカウント | `yoin-audio@yoin-app-20261004.iam.gserviceaccount.com`、プロジェクトの管理権限なし |
| Artifact Registry | 東京の `yoin-runtime`。初回イメージはローカルでビルドしてpush。Cloud Build経路は未実行 |
| AI有効化 | Workerの `AI_BUDGET_USD=0`。Googleキーは音声サービス側、Workerには登録しない |

以下に、実施時の条件・結果・制約を残します。

2026-10-04に実施。公開の日本語会話4分を実Google APIへ送り、文字起こし→出典付き歌詞案→歌詞修正→約2分7秒のMP3生成まで確認しました。Cloudflare Worker・WorkflowsとCloud Runも配置し、26分の合成音声による接続確認が成功しました。クラウドのAI予算は0で、クラウドでの実AI生成、歌唱品質の試聴、Android実機での受け入れは未完了です。

## 実施した確認

開発環境はmacOS Apple Silicon。確認時のNixロックでNode.js 24.21.0 LTS・npm 11.19.0・JDK 17.0.19・FFmpeg 8.1.2を使用しました。新しい環境は[開発ガイド](development.md#開発環境)に従い、ロックから用意します。

| 確認 | 結果 | 確認できた範囲 |
| :--- | :--- | :--- |
| `npm test` | 74/74成功 | 録音の開始・停止・保存処理、下書き復旧、出典と日時、歌詞確認の応答喪失、再生位置保持、APIアダプター、累積予算、設定ファイル生成。実応答の話者形式・不整合なusage・73件の出典IDの回帰テストを含む。SDK・Googleの応答を置き換えたテストも含む |
| `npm run backend:test` | 33/33成功 | ローカルD1・R2テストbindingで認証、所有者、multipart、Range再生、歌詞版、重複ジョブ、予算予約、受付不明の再送防止、Workflow処理、署名callback、実行権排他、Workersのリダイレクト制御。Googleと音声処理応答は置き換え |
| `npm --prefix backend run test:media` | 4/4成功 | 実Docker・FFmpegによる検査・分割。生成した26分・60分の音声で元ファイルのoffsetと入力上限を確認。Google応答は置き換えて生成物と結果保存の順序も確認 |
| ローカル接続 | 成功 | Wranglerから認証付き送信、ネイティブWorkflow、FFmpeg Container、署名付き元音声取得・分割音声のprivate R2保存まで接続。予算0で `ai_budget_exhausted` となり、有料API受付は0件 |
| Biome・型チェック | 成功 | アプリ、検証スクリプト、バックエンド |
| Expo export | 成功 | Android・iOS・Web |
| Android debug build | 成功 | NixのJDK17と既存SDK36でAPK作成。マイク・通知・foreground serviceの権限と録音通知からの停止処理を確認 |
| Wrangler dry-run・実配置 | 成功 | Containersを除いたWorkers Free構成とWorkflowsをバンドルし、実配置 |
| ブラウザー画面確認 | 成功 | 幅390pxで空ライブラリ、新規記録、接続設定、未録音時の操作、ネイティブ専用取り込みの説明を確認 |

状態変更を扱うテストは失敗する状態を確認してから実装し、成功へ進めました。保護された `prototype/` は変更していません。ローカル確認用WorkerとContainerは停止済みです。クラウドの配置は稼働しています。

Android APKは `android/app/build/outputs/apk/debug/app-debug.apk` にあります。開発用なので起動・操作にはMetroを使います。APKのビルド成功は、実端末での録音や再生の成功を意味しません。

## 公開音声による実API確認

ユーザーの「どこかから拾ってきて調べて、それを使って」という指示に従い、[声庭（Koniwa）](https://github.com/koniwa/koniwa)が公開する尼崎市のラジオ対話を使用しました。音声・テキストのライセンスは[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)、権利者は兵庫県尼崎市です。[エピソード情報](https://github.com/koniwa/koniwa/blob/master/data/amagasaki/amagasaki__2011_08_17.json)は「いなむら市長の『ひと咲き まち咲き あまがさき』／忍たま乱太郎デジタルスタンプ&クイズラリー」です。旅行の実録音ではなく、2人の公開ラジオ対話を使った動作確認です。

原音声の30秒〜270秒を抜粋し、16kHz・モノラルWAVへ変換しました。出典・権利表示・変更内容・SHA256を `.local/fixtures/koniwa/source.json` に保存しています。番組のファイル名にある日付は録音日時として扱わず、録音日時・場所は不明のままです。

| 実呼び出し | 確認した結果 |
| :--- | :--- |
| Gemini 3.5 Transcribe | 4分の入力から73発話、仮の話者2ラベル、元音声内の時刻を取得。応答の `spk:0` 形式を既存の `spk_1` 形式へ正規化し、保存済み応答を再解析。音声の再送はしていない |
| Gemini 3.5 Flash-Lite | 出典IDを持つ7ブロックの歌詞案を取得。最初のJSON SchemaはHTTP 400。モデルの簡単な入力が成功することを確認し、出典IDのenum列挙だけを省いた同じ会話入力で成功。全出典IDの事後検証は維持 |
| 歌詞レビュー | 会話にない午後・青空・拍手・秋風を除去。投球がワンバウンドだったこと、投手が語り手とは別人であること、神社訪問が伝聞であることを修正 |
| Lyria 3.5 | レビュー版と、投手の主体を明示した修正版をそれぞれ1回生成。最終版は実測127,399ms、44.1kHz・ステレオのMP3。生成処理は32,983ms。入力・返却歌詞・API応答・実音源を保存 |
| 最終生成物の照合 | 構造マーカーだけを除いた返却歌詞は指定した21行と完全一致。26出典参照（23一意ID）は元音声内に存在。MP3をFFmpegで最後までデコードできた。実際の試聴・歌唱一致は未確認 |

最終試行は `.local/poc/koniwa-reviewed/`、最初の試行と診断結果は `.local/poc/koniwa-first/` にあります。文字起こしと歌詞案は再利用し、歌詞を修正した2回目では音楽生成だけを呼び出しました。最終版の歌詞と出典は `lyrics-review.md`、実音源は `music.mp3`、返却歌詞は `returned-lyrics.txt` です。`song.json` は `qualityVerified:false` のままで、API成功を試聴合格として記録していません。

文字起こしには「忍たま」「乱太郎」「始球式」などの誤認があり、固有名詞の精度は受け入れ未達です。歌詞案にも出典にない情景や主体の曖昧さがあったため、元会話との照合と歌詞レビューが必要です。3人・環境雑音・旅行会話はまだ試していません。

累積台帳上の使用見込みは約1.27ドル（予約額込み）、10ドルからの残額は約8.73ドルです。文字起こしのusageでは非空の出力に対して出力トークンが0と報告されたため、0.60ドルを保守的に計上し、最初の歌詞HTTP 400の0.50ドル予約も保持しています。これはGoogleの実請求額ではなく、診断・音楽2回を含む予算管理値です。実請求との照合とサーバーへの残額移管は未実施です。

## Cloudflareへの配置準備

現在の設計は[構成・設計](audio-pipeline-architecture.md)、配置済みリソースは[上の配置情報](#配置リソース)にまとめています。Cloud Runへの移行は[ADR 0011](adr/0011-cloudflare-free-audio-runtime.md)で採用済みです。以下の準備記録と実配置を区別します。

2026-10-04に、ユーザーが指定した `h.rion.0910@gmail.com` のアカウントでWranglerのログインを確認し、配置先を設定しました。

- D1 `yoin` をAPACに作成し、`0001_initial.sql` を適用。リモートのテーブル一覧でスキーマを確認。
- R2 `yoin-private-audio` を作成。公開 `r2.dev` URLが無効であることを確認。
- `wrangler.jsonc` にアカウントID、実D1 ID、配置予定URLを設定。AI予算は0で、PoC台帳と残額は引き継ぎ前のまま保持。
- テスター認証とメディア処理の秘密情報をGit管理外・権限600のファイルに準備。秘密の値は記録・ログへ出していない。
- Biomeと `wrangler deploy --dry-run` が成功。Workerのbundleとlinux/amd64のFFmpeg Containerイメージを確認。

このアカウントはWorkers Freeで、Cloudflare Containers APIはWorkers Paidが必要として旧構成の配置を拒否しました。有料プランの契約は行っていません。その後、Containers依存を除いたCloud Run構成を配置しました。API URLは `https://yoin-private-api.h-rion-0910.workers.dev` です。

## Cloud Run構成への移行確認

ユーザーの2026-10-04の「ではクラウドらんで」に従い、ADR 0011をAccepted、ADR 0007をSupersededにしました。FFmpeg・3つのGoogleアダプター・モデル・合計60分と25分分割は維持しています。

- 新しい回帰テストで失敗を確認後、署名付きcallback、実行権のD1排他取得、音源・生応答の外部処理、結果保存前の応答禁止を実装。
- アプリ・Googleアダプター・予算・設定の74件、バックエンドの31件、音声サービスの4件のテストが成功。型チェックとBiomeも成功。
- 音声サービスの4件は、NixのFFmpegとCloud Run用linux/amd64イメージの両方で成功。26分・60分入力の分割・offset・実時間の検査を確認。有料APIは置き換えで実課金なし。
- linux/amd64イメージ `yoin-audio:cloud-run` のビルドと起動が成功。公開 `/health` が200、未認証 `/music` が401。
- 100発話×2区間を使い、50クエリの上限を模したテストで失敗を確認後、発話保存を1SQLへ変更して成功。
- Containers・Durable Object・コンテナーライブラリの依存を削除。無料Workers構成のdry-runが成功し、bundleは53.67KiB、gzip12.20KiB。
- Cloud Buildの送信対象を7ファイルに限定し、`.local`・秘密情報・音声・アプリ本体を送らないことを公式SDKの `list-files-for-upload` で確認。
- Google Cloud SDKは固定Nixパッケージ565.0.0から取得。最初のOAuth操作は自動承認審査で拒否されたが、その後ユーザーの支援で認証が完了し、指定アカウントをCLIで確認した。
- D1の0002追加列を実データベースに適用済み。最初のWrangler実行が7403で失敗したため、指定アカウント・実D1を直接読取し、アクセスを確認して再試行すると成功。

上記は移行時のローカル確認です。実クラウドの確認を以下に記録します。既存PoCの予算台帳は保持し、クラウドAI予算0のままです。

## 実クラウドへの配置と接続確認

- Google Cloudプロジェクト `Yoin` / `yoin-app-20261004`（番号300039436163）を作成。ユーザーが選んだ「請求先アカウント」（末尾89B51A）を関連付け、billingEnabledを確認。
- 東京にArtifact Registry `yoin-runtime` と、管理権限を付与しない実行用サービスアカウント `yoin-audio` を作成。検証済みイメージを直接pushしたため、初回配置でCloud Buildは実行していない。
- イメージのダイジェスト `sha256:c1f101d81a690b8b8bbbb38bccb3910176c06495faf0142ec2e2197901896eff` を固定し、Cloud Run `yoin-audio` / `yoin-audio-00001-dtj` を配置。1vCPU・1GiB・最小0・最大1・同時処理1・900秒、CPU throttling有効・startup boost無効を確認。
- Cloud Run URL: `https://yoin-audio-300039436163.asia-northeast1.run.app`。`/health` は200で `ok`、5つの処理ルートは未認証で401。専用サービスアカウントへのプロジェクトIAM権限付与は0件。
- Cloudflareへ3つの秘密情報の名前だけを確認して登録。GoogleキーはWorkerへ登録していない。`yoin-private-api`・`yoin-prepare`・`yoin-generate` を配置。修正版Workerのバージョンは `bd2726da-db1d-493d-bcbf-47c53b35153e`。
- 初回の実Workflowは、Workersが `redirect: error` を受け付けず停止した。実Workerと同じテスト実行環境で2件のREDを確認し、`manual` と既存の非2xx拒否へ変更して33件GREEN。302を追従せず認証情報を転送しないことも確認し、再配置した。
- 26分・3,244,390 bytesの合成AAC音声で、下書き作成、multipart送信、完了の重複要求、署名URLによる元音声のSHA256一致、128 bytesのRange再生、期限切れ・改ざん403を確認。
- 修正版の準備WorkflowはCloud RunのFFmpegで変換・分割し、R2へ2区間を保存。D1の検査結果は元時間1,560,000ms、区間0はoffset 0 / 1,500,032ms、区間1はoffset 1,500,032 / 60,032ms。
- 文字起こしの前に `ai_budget_exhausted` で停止し、D1の `provider_attempts` は0件。停止した状態をAPIから再取得でき、同じ冪等キーの再要求は同じジョブIDを返した。Cloud Runの `/probe` も同じ実時間とサイズを返した。
- `wrangler tail` で今回のHTTP処理のCPU時間1〜10msを確認し、CPU超過は0件。クリップ登録は10ms、分割音声保存は最大8msだった。これは今回の合成音声とメタデータの測定で、長い発話の保存・返却、有料ステップ、全入力の無料枠適合を証明しない。Workflow全体のtrace値はステップごとのCPU値として扱わない。

署名URLを含む検証ログは非公開の `.local/cloud-smoke/` に保存し、チャット・Gitには載せていません。

## 残る受け入れ確認

[内部テストの操作・長時間録音・復旧・品質評価](internal-testing.md)は未完了です。特に、実MP3の試聴と歌詞・元会話の照合、Android実機での完走と連続60分録音、クラウドでの実AI生成と結果回復が残っています。有料Workflowステップ・長い発話の保存と返却のCPU時間も未確認です。

次は生成曲の試聴です。品質確認後に[残予算の移管](audio-pipeline-setup.md#残予算の移管)とAI有効化を行い、内部テストの各結果を日付・条件付きで記録します。Googleの日本語音楽品質と商用条件の確認までは候補モデルの本採用を確定しません。実音声・秘密情報・試行結果はGit管理外の `.local/` に保存します。

## 2026-10-04の基盤費用の概算

2026-10-04の公式料金を確認した概算。下記の処理時間・送信量は仮定であり、配置後の実請求額や課金上限を表さない。Googleの認識・歌詞・曲生成APIとCloudflareの使用料は含めない。

次の仮定を置く。

- Cloud Runのリクエスト課金、最小インスタンス0、最大1、1vCPU・1GiB。Tier 1の単価を使用する。
- 1回の音声処理について、外部APIの応答待ち・開始・終了等も含む課金時間を合計10分と仮定。音声の長さと課金時間は同じとは限らない。
- 1回の外部送信を約65MBと仮定。60分の64kbps分割音声は約28.8MBで、R2保存とGoogleへの送信で約57.6MB。既存PoCの曲は約3.06MBで、その他の保存を含む参考値である。
- 通信は全量を0.12ドル/GiBとして計算し、通信の無料分を差し引かない。実料金は地域・宛先・経路で変わる。
- 同じ請求先アカウントの他プロジェクトで無料枠を使っていない。実行無料枠は月18万vCPU秒、36万GiB秒、200万リクエスト。

| 月の音声処理回数 | 実行費 | 外部通信費 | 合計例 |
| :--- | ---: | ---: | ---: |
| 10回 | 0ドル | 約0.07ドル | 約0.07ドル |
| 100回 | 0ドル | 約0.73ドル | 約0.73ドル |
| 1000回 | 約10.68ドル | 約7.26ドル | 約17.94ドル |

イメージ保存・ビルド・ログ・秘密情報の保管等は別枠。配置したFFmpegイメージの展開後サイズは約244MiBで、Artifact Registryの `imageSizeBytes` も約244MiBだった。単一イメージは0.5GiB無料枠内に収まる見込みだが、請求先で共有する保管量・実請求は未確認。超過保管の目安は0.10ドル/GiB-month（0.5GiB超過で約0.05ドル/月）。Cloud Buildの無料枠はdefault poolのe2-standard-2で月2500分で、他のビルド方式へ同じ枠を適用しない。今回の初回配置ではローカルの検証済みイメージを使用し、Cloud Buildは実行していない。

個人検証の少ない回数であれば、基盤のみ月0〜1ドル程度が候補になる。ただし上の処理時間と送信量の仮定に依存する。最小0・最大1は料金の厳密な上限ではなく、Cloud Runの待機中もリクエスト処理中の割当CPU・メモリは課金時間に含まれる。既存のAI累積10ドル予算は基盤費を含まない。

根拠: [Cloud Run料金](https://cloud.google.com/run/pricing)、[通信料金](https://cloud.google.com/vpc/network-pricing)、[Artifact Registry料金](https://cloud.google.com/artifact-registry/pricing)、[Cloud Build料金](https://cloud.google.com/build/pricing)。
