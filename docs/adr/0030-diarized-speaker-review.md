# ADR 0030: 話者ラベルのない会話を声の区間で集約して候補を確認する

Date: 2026-10-13

## Status

Proposed

2026-10-13のチャットでこの実装計画の実施を指示された。計画に従い、品質受け入れと配布判断を分離し、記録はProposedに保つ。

## Context

[ADR 0027](0027-match-unlabelled-utterances.md)の個別照合では、156発話中146発話が最低3秒を満たさなかった。登録人数を話者数とみなすと未登録の声まで誤って名付ける。

## Decision

新規準備ジョブに照合方式、WeSpeakerモデル、pyannote segmentation 3.0 INT8のSHA-256、閾値、区間長・有声音量・segmentationの設定、確認必須を固定保存する。公開sherpa-onnx配布モデルと同梱MITライセンスを保持し、話者数はnumClusters=-1で自動推定する。同一声の複数の非重複区間を集めて照合し、単一声かつ十分な区間被覆の発話だけへ候補を適用する。短い応答も同じ声の十分な音声から照合できる。混在、重なり、確度不足、有声音不足は未特定にする。モデル・取得等の障害は保存した文字起こしを失わず確認待ちにする。新規ジョブは候補の有無を問わず歌詞作成前に確認する。自動候補も変更・解除でき、時刻不明の全文区間へ一括割当てしない。既存ジョブは設定NULLを従来方式として再開し、有料文字起こしキャッシュは維持する。

## Consequences

短い発話の確認を助けるが、別録音での識別品質とCloud Run資源内の性能は未合格。初期閾値は暫定であり、独立した調整用録音で固定し別録音で80%発話・90%有音時間、誤名付け0件を検証する。未達では配布を止める。詳細は[検証記録](../recording-completion-validation.md)。

API参照: [sherpa-onnx v1.13.8公式Node例](https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.8/nodejs-addon-examples/test_offline_speaker_diarization.js)。モデル配布アーカイブはDockerfileでSHA-256を検証し、MITライセンスをリポジトリとコンテナに保持する。
