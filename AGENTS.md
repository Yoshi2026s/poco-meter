# ポコメーター番長 開発指示

Claude Code と ChatGPT（Codex など）の共通指示です。

## 対象と現状（2026/11/07）
- このリポジトリはポコメーター番長専用。**正本はこのGitHubリポジトリ**（既定ブランチ `(root)`）。
- 公開先：GitHub Pages https://yoshi2026s.github.io/poco-meter/ （計算画面・過去ボーダー・E帯・算出方法）。
- ボーダーは GitHub Actions「ボーダー自動更新」が毎日 05:00・17:00 JST に取得元（one-carat.com）から取得し、`data/borders.json` に保存する。
- 旧Sites（https://poco-meter.freefreelife2000.chatgpt.site/）は更新しない。署名キー・Sites API・旧ChatGPTタスクは使わない（旧タスクは無効のまま）。
- 現状・未解決は docs/HANDOVER.md、画面・計算の要望は docs/REQUESTS.md。旧資料は docs/archive/・docs/legacy-source/（参照のみ・実行しない）。

## 共同編集のルール（Code・ChatGPT共通）
- 変更はこのリポジトリへのコミットかPRで行う。Sitesや別の場所で編集しない。
- 作業前に最新を取り込み、他の人の未マージ変更を上書きしない。強制pushはしない。
- `data/borders.json` は自動更新専用。手で編集しない（修正が必要なら理由を残して別PR）。
- 画面の元ファイルは `calculator/`。公開用の加工は `scripts/build-pages.mjs` が行う。公開物（`_site/`）はコミットしない。
- ツール本体を変えたら `npm run version:bump` で `PAGES_VERSION`（画面の「最終更新バージョン」）を更新する。データ更新だけでは変えない。
- push すると「GitHub Pages 公開」が自動で動く。公開の確認は実際のURLで行う。

## 変更方針
- 日本語で報告し、全体レイアウト・既存機能・保存データを維持する。
- 名称はポコメーター番長。制作者ロゴはYoshi1012、最下段左寄せ、ブルー×ブラック系。
- 端末の保存キー（`pococha-meter-calc-v1` など）とデータ形式を不用意に変更しない。移行時は復元手段を用意する。
- 欠損日を0や他の締め時間の値で埋めない。取得元のアクセス制限を回避しない（403は再試行しない）。
- サブエージェントへの委任はユーザーの明示依頼がある場合のみ。
- 実施していないテストや回数を完了扱いにしない。

## 検証
- 統合前の標準チェック：`npm run check`（CIと同じ計算・保存・Pages系テスト＋公開物の作成。出力は合否のみ）。Node 22以上。
- ネットワークも依存も不要な最小テスト：`npm test`。
- UI・CSSを変えたとき：`npm run test:extra`（vite系・Playwright画面系。Playwright と Chromium は既存のものを使う）。
- 取得元を追加するときは、利用規約・robots.txt・転載可否を先に確認する（HAISHIN LAB は無断転載禁止のため不使用）。表画像の読み取り値は、既知の日と全一致した画像からのみ採用し、自信度の低い値は推測で埋めない。
- スマホ変更では縦持ち、小画面、横持ち、低い画面で操作・保存・再読込後の復元を検証。エミュレーションと物理端末を区別する。
- 締め時間ごとに異なる既知データを用いて計算を検証。同値を機械的に異なる数字へ変えない。

## 資料の更新ルール（読む量を増やさないため）
- docs/HANDOVER.md は「今の状態」だけを書き、古くなった記述は書き換える（追記で伸ばさない）。
- 変更ごとに docs/CHANGELOG.md の先頭へ1行（日付・版・内容・検証）。詳細はPR本文とコミットに書く。
- 検証レポートや結果JSONを新しく docs/ 直下に増やさない。残す必要があればPR本文か docs/archive/ へ。
- docs/archive/・docs/legacy-source/ は過去の記録。書き換えない。

## 大きいファイルの扱い（トークン節約）
- 全体を読まない：`calculator/border-history.html`（1.2MB、389行目が埋め込みデータ1行）、`calculator/index.html`（540KB、2528行目が長い1行）、`calculator/offline-assets.mjs`（26行目が画像データ1行）、`data/borders.json`、`pnpm-lock.yaml`、`tsconfig.tsbuildinfo`、`SOURCE_MANIFEST.json`。
- 検索で行番号を特定し、必要な範囲だけ読む。長い行は `cut -c1-300` や `rg --max-columns 300` で切る。
- `.ignore` で旧資料・大きいデータを検索対象から外している。対象にしたいときはパスを直接指定する。
- データの確認は全文表示せず `node -e` 等で件数・該当日だけ取り出す。

## 統合・公開・保全
- 開発修正の調査、実装、検証、コミット、PR、マージはユーザー承認範囲。
- 秘密情報・利用者データの新規公開、強制push、保護解除、復元不能な削除は禁止。リポジトリは公開。
- 新たな費用・外部データ送信は承認を得る。
- 停止済み定期実行を勝手に再開しない。新しい定期実行の追加は承認を得る。
- 変更内容、検証、統合、公開を分け、コミット・公開URL・未確認点を報告する。
