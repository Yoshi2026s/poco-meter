# ポコメーター番長 引継ぎ（現状）

更新日：2026/11/07（日本時間）

このファイルは「今の状態」だけを書く。経緯は [CHANGELOG.md](CHANGELOG.md)（1変更1行）と
[archive/HANDOVER-log-2026-11.md](archive/HANDOVER-log-2026-11.md)（11/06〜11/07 の詳細原文）にある。

## 構成
- 公開：GitHub Pages https://yoshi2026s.github.io/poco-meter/ （既定ブランチ `(root)` への push で自動公開）
- ボーダー：`data/borders.json`。GitHub Actions が毎日 05:00・17:00 JST に ONE CARAT から取得（記事本文＋月別表画像の2系統）。
- 旧Sites・署名キー・旧ChatGPTタスクは使わない。旧Sitesには新URLへの移転案内を掲示済み。
- 公開中のツール版：`scripts/build-pages.mjs` の `PAGES_VERSION`（v2026.11.07.6）。

## データの状態
- 初期値は旧Sites公開APIの1951件（〜2026-10-18）。10/19〜11/03 は月別表画像から補完済み（証跡 `db/backfill-2026-10-19-to-11-03-evidence.json`）。
- 欠け：10/31 13時（取得元の表が空欄）。3日経過前の日は自動更新の第2系統が後日補う。
- 補完した日・取得元に無い日は `data/border-provenance.json` に記録される。

## 未解決・ユーザー判断待ち
- typography-balance-1000 が不合格：「締めまで」「コアボ」の10pxは12pxに修正済み（v2026.11.07.5）。残りは項目名・個数の設計値の不一致（項目名：テスト期待13px@360px以下／実装14px、700px以下で overflow-wrap が anywhere でなく normal。個数：期待16px@700px以下／実装17px）。テストと実装のどちらに合わせるかはユーザー判断待ち。
- Safari固有の差・物理端末での表示は未確認（確認はすべて Chromium のエミュレーション）。

## 主なユーザー決定（覆さない）
- 使うのは「ボーダー自動更新」と「計算画面」。Pages版ではアクセス統計送信・管理ページリンク・Pocochaサーバー時刻を外す（時刻は端末時刻と明示）。
- HAISHIN LAB は規約で無断転載禁止のため取得元に使わない。
- シンプルメニューは全画面幅でメイン画面（固定表示ではなく通常配置、ON/OFFなし）。残りアイテム目安はその中に常時表示。その他のメニューはメイン画面のボタンで開き、右下の「シンプルメニューに戻る」で閉じる（v2026.11.07.6）。旧ON/OFFの保存キー `pococha-meter-hud-v1`・`pococha-meter-items-window-v1` は読まず、消さずに残す。
- メイン画面の主要ボタン・入力は44px以上、入力欄は16px以上（iOSの拡大防止）。
- スマホで開くと目標・現在が初期値に戻るのは既存仕様（storage-recovery-regressions）。

## 参照先
- 開発ルール・検証コマンド：[../AGENTS.md](../AGENTS.md)
- ファイルの場所・関数・テストの選び方：[CODEMAP.md](CODEMAP.md)
- 画面・計算の要望一覧：[REQUESTS.md](REQUESTS.md)
- 自動取得の経緯・403の経路：[AUTOMATION_CODE_HANDOVER.md](AUTOMATION_CODE_HANDOVER.md)
- 旧Sites時代の報告類：`archive/`（参照のみ。現行の指示ではない）
