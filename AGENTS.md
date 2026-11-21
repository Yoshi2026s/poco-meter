# ポコメーター番長 開発指示

Claude Code と ChatGPT（Codex など）の共通指示。

## 対象
- 正本はこのリポジトリ（既定ブランチ `(root)`）。公開は GitHub Pages https://yoshi2026s.github.io/poco-meter/ （計算画面・過去ボーダー・E帯・算出方法）。
- ボーダーは GitHub Actions「ボーダー自動更新」が毎日 05:00・17:00 JST に one-carat.com から取得し `data/borders.json` に保存する。
- 旧Sites（poco-meter.freefreelife2000.chatgpt.site）・署名キー・Sites API・旧ChatGPTタスクは使わない（旧タスクは無効のまま）。
- 読む順：docs/CODEMAP.md で場所を特定 → 現状・未解決は docs/HANDOVER.md、画面・計算の要望は docs/REQUESTS.md。旧資料 docs/archive/・docs/legacy-source/ は参照のみ・実行しない。

## 共同編集
- 変更はこのリポジトリへのコミットかPRで行う。作業前に最新を取り込み、他の未マージ変更を上書きしない。強制pushはしない。
- ブランチは Claude Code が `claude/<内容>`、ChatGPT（Codex）が `codex/<内容>`。`(root)` へ直接コミットしない。PRは `(root)` 宛て、本文は `.github/pull_request_template.md` の見出しに沿う。
- PRは squash でマージ（マージ後の作業ブランチは自動削除）。続けるときは `(root)` から作り直す。
- `data/borders.json` は自動更新専用。手で編集しない（修正が必要なら理由を残して別PR）。
- 画面の元ファイルは `calculator/`。公開用の加工は `scripts/build-pages.mjs`。公開物 `_site/` はコミットしない。
- `calculator/border-history.html`・`calculator/e-border.html` は生成物。テンプレートや `.mjs` を直したら `npm run pages:prepare` で作り直してコミット（`npm run check` が不一致を検出）。
- インラインscriptを変えたら `calculator/index.html` のCSPの sha256 も更新する（`security-management` テストが検出）。
- ツール本体を変えたら `npm run version:bump` で `PAGES_VERSION` を更新。データ・資料だけなら変えない。
- `calculator/ocr/` は手で変えない（SHA-256固定。版を上げるときは同フォルダーの NOTICE.md の手順に従い、実ブラウザで読取まで確認）。NOTICE.md も公開物でテストの照合対象。
- `.openai/hosting.json`・`TRANSFER_TO_CLAUDE.md` は旧Sites時代の記録。使わない。
- push すると「GitHub Pages 公開」が自動で動く。公開の確認は実際のURLで行う。

## ChatGPTで作業するとき
- 始める前に開いているPR・作業ブランチを確認。同じファイルを触る未マージPRがあれば、乗せずにマージを待つかユーザーに確認する。
- 端末がある（Codex など）：Node 22 以上で `npm run check`（acorn を一時フォルダーに入れるだけ。`pnpm install` 不要）。
- 端末がない（GitHubコネクターだけ）：変更は小さく1目的に。生成物2件と `PAGES_VERSION` は手で書き換えない。PRのCI「メーター計算・ボーダー保存の検証」の合否を基準にする（資料だけの変更ではCIは動かない）。実行できなかった手順（pages:prepare・version:bump・test:extra・スマホ表示確認）はPR本文「未確認・残作業」に書き、Claude Code か Codex で仕上げてからマージする。

## 変更方針
- 日本語で報告し、全体レイアウト・既存機能・保存データを維持する。
- 名称はポコメーター番長。制作者ロゴは Yoshi1012（ブルー×ブラック系）：メーター画面は最下段「免責事項」の右隣、他の画面は最下段左寄せ。
- 端末の保存キー（`pococha-meter-calc-v1` など）とデータ形式を不用意に変えない。移行時は復元手段を用意する。
- 欠損日を0や他の締め時間の値で埋めない。取得元のアクセス制限を回避しない（403は再試行しない）。
- サブエージェントへの委任はユーザーの明示依頼がある場合のみ。実施していないテストや回数を完了扱いにしない。

## 検証
- 統合前：`npm run check`（CIと同じ計算・保存・Pages系テスト＋公開物の作成、出力は合否のみ、約30秒）。最小は `npm test`。
- 関連テストだけ先に回すときは docs/CODEMAP.md「テストの選び方」。
- UI・CSSを変えたら `npm run test:extra`（vite系・Playwright画面系13本、約8分）。メイン画面の残りアイテムは `tests/hud-items-browser.cjs`（320〜700px）。
- スマホ変更は縦持ち・小画面・横持ち・低い画面で操作・保存・再読込後の復元を確認。エミュレーションと実機を区別し、ブラウザー名を書く。
- 締め時間ごとに異なる既知データで計算を検証。同値を機械的に異なる数字へ変えない。
- 取得元の追加は利用規約・robots.txt・転載可否を先に確認（HAISHIN LAB は無断転載禁止のため不使用）。表画像の読み取り値は既知の日と全一致した画像からのみ採用し、自信度の低い値は推測で埋めない。

## 資料の更新（読む量を増やさない）
- 作業後に docs/CHANGELOG.md の先頭へ1行（日付・版・内容・検証）。先頭10行だけ読んで追記する。20KBを超えたら古い日付の分を docs/archive/CHANGELOG-<期間>.md へ移す。
- 状態が変わったら docs/HANDOVER.md を書き換える（追記で伸ばさない）。「今の状態」だけ・200行20KB以内。版ごとの画面仕様・検証結果は書かない（PR本文とCHANGELOGへ）。見出しを検索して該当箇所だけ読む。
- 検証レポートや結果JSONを docs/ 直下に増やさない（PR本文か docs/archive/ へ）。docs/archive/・docs/legacy-source/ は書き換えない。

## 読む量を抑える
- 全体を読まない：`calculator/border-history.html`（1.2MB）、`calculator/index.html`（540KB、長い1行あり）、`calculator/offline-assets.mjs`、`data/*.json`、`db/*.json`、`pnpm-lock.yaml`、`tsconfig.tsbuildinfo`、`SOURCE_MANIFEST.json`、`calculator/ocr/` の `.js`・`.gz`。
- 検索で行番号を特定し必要な範囲だけ読む。長い行は `cut -c1-300`・`rg --max-columns 300`。データは `node -e` で件数・該当日だけ取り出す。
- `.ignore` で旧資料・大きいデータ・旧Sites版の不使用コード（app/・components/ など）を検索対象から外している。必要なときはパスを直接指定する。

## 統合・公開・保全
- 調査・実装・検証・コミット・PR・マージはユーザー承認範囲。
- 秘密情報・利用者データの新規公開、強制push、保護解除、復元不能な削除は禁止（リポジトリは公開）。新たな費用・外部データ送信、新しい定期実行の追加は承認を得る。停止済みの定期実行を勝手に再開しない。
- 報告では変更内容・検証・統合・公開を分け、コミット・公開URL・未確認点を書く。
