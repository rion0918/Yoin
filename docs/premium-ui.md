# Yoin: 小さな記憶のギャラリー

Date: 2026-10-08

## この刷新の判断

ユーザーがSetlogやInstagramのようなリッチな体験と、プロのデザイナーとしての全面刷新を依頼した。デザインの質問はせず、判断を委任する指示に従った。[最初の設計](ui-refresh.md)から、文字と線だけでは触れたくなる素材・奥行きが弱いと判断した。既存のExpo / React Native、表示データ、音声・非同期生成・同意の境界を確認し、表示層を再構成した。

コンセプトは「小さな記憶のギャラリー」。大きな会話のひとこと、記録日、一緒にいた人に、光の表紙を添える。曲の一覧より、過ごした一日を開いて見返す体験を中心にする。HomeとMemoriesは一つの既存Libraryルートにまとめる。

`design-taste-frontend`を必須で使用し、DESIGN_VARIANCE 8 / MOTION_INTENSITY 5 / VISUAL_DENSITY 4。画面ごとに構図と素材を変え、手触りを増やしながら操作の密度は抑える。Web用の既定技術やマーケティングページの規則は、モバイル・実データ・既存プロダクト制約に合わせる。追加のUI依存は導入しない。

## 素材と構図

| 画面 | 主役と触り方 |
| --- | --- |
| Home / Memories | 光の表紙、紙のような日付、実会話のひとこと。参加者・場所を添え、録音した現地年月で積み重ねる。黒い「今日を残す」を下部に一つ固定する。 |
| Recording | 白い紙面、細い大きな時間、折り重なる白い帯。止めるたびに実際の保存区間を帯へ反映する。位置・取り込みと開始停止は下部、保存会話は下へ続く。 |
| Generating | その日の帯から実際の歌詞へつなぐ。送信・準備段階で歌詞がなければ保存日時や会話を示す。実態のない進捗率や即時文字起こしを作らない。 |
| Memory Detail | 光の表紙から白い歌詞の紙面へ移る。歌詞のそばに日時・場所・会話の入口を置き、下部の再生・シークは常に触れる。 |
| 仕上げ・編集・設定 | 紙面とグラファイトの操作を共通にする。入力内容、話者選択、位置の説明、元音声、エラーと受付不明の扱いを維持する。 |

白は`#ffffff`、文字は`#202321`、補助文字は`#676d69`。補助面は淡い灰緑、色は完成した思い出の画像に集約する。日本語はsystem sans、会話と歌詞は大きく、時刻は等幅数字。左右24px、最大本文幅520px、画像の角丸24、補助面14、主操作32を基準にする。画像上の日時・操作には白い面を敷き、文字のコントラストを画像のピクセルに依存させない。

表紙の穏やかなパララックスはスクロールに追随し、元の会話へ戻る感覚を支える。言葉の出現、押下のspring、記録状態の点滅は短い反応として使う。Reduced Motionでは移動・出現・点滅を止める。画面遷移とシートの既存のネイティブ境界を保つ。Hapticsと同期歌詞は追加していない。

## 画像の生成記録

保存先: [`assets/memory-light.png`](../assets/memory-light.png)。内蔵`image_gen`で新規生成した1枚をプロジェクトへコピーし、React NativeのImageで切り取って使う。画像編集・架空の旅行写真・ユーザー写真の代替は行っていない。思い出IDの文字コード和で4通りの切り取りを選び、ホームと詳細で同じ表紙を維持する。これは装飾であり、季節・感情・参加者を推測した生成ではない。

最終プロンプト:

```text
Use case: stylized-concept. Asset type: original abstract cover material for Yoin, a premium mobile memory app about conversations that become a song. Create one square 2048x2048 sophisticated photographic artwork, a close-up of overlapping translucent thin silk membranes and softly rippled water refracting afternoon light. A single flowing ribbon of soft coral vermilion winds diagonally through deep moss, smoke-grey, and pale luminous silver regions. Sensual analog photograph with fine film grain, delicate physical imperfections, selective focus, elegant shadows, rich pigment, believable optical softness. Composition is layered but restrained, organic flowing folds with wide calm regions suitable for different crops. It should feel like the air of a day remembered, a premium contemporary gallery print, emotional and playful without being cute. Keep the light material and deep color in the same image; enough contrast and detailed texture to be striking in a small mobile cover. Not an actual place or an event photograph, purely abstract. NO text, numbers, letters, UI, device, person, building, logo, watermark, hard panel divisions, purple neon, rainbow gradients, shiny 3D blobs, generic digital gradient. Output only one full-bleed artwork.
```

## 参照の扱い

[Setlogの公式掲載画面](https://apps.apple.com/jp/app/setlog/id6587576438)と[MetaのInstagramブランド設計](https://www.meta.com/design-at-meta/blog/the-new-instagram-brand-identity/)を参照した。大きく扱う内容と操作の軽さが魅力を作ると読み取り、Yoinでは実会話・日時・歌詞の出典関係に置き換えた。この判断は参照からの推論であり、両アプリのUI・配色・ロゴをコピーしていない。

共通の判断は[Proposed ADR 0021](adr/0021-memory-gallery.md)。画面と確認した操作、検証の限界は[今回の検証記録](../qa/premium-refresh/README.md)を参照する。
