# ポコメーター番長

Pocochaの目標メーター計算・過去ボーダー管理ツールです。個人が制作した非公式ツールで、Pococha および運営会社とは関係ありません。

- 公開先：https://yoshi2026s.github.io/poco-meter/
- 開発・正本：このリポジトリ（Yoshi2026s/poco-meter、既定ブランチ `(root)`）
- 開発環境：Claude Code（ChatGPTからもGitHub経由で共同編集可）
- [開発指示（Code・ChatGPT共通）](AGENTS.md)
- [引継ぎ資料（現状）](docs/HANDOVER.md)／[要望・仕様メモ](docs/REQUESTS.md)／[変更履歴](docs/CHANGELOG.md)
- [自動取得の経緯](docs/AUTOMATION_CODE_HANDOVER.md)
- 利用条件：[LICENSE](LICENSE)（サイトの利用は自由。コード・データの無断転載・再配布は禁止）

## 仕組み

| 部分 | 場所 |
| --- | --- |
| 画面の元ファイル | `calculator/`（計算画面・過去ボーダー・E帯・算出方法・SW） |
| 公開用の加工 | `scripts/build-pages.mjs` → `_site/`（コミットしない） |
| ボーダーデータ | `data/borders.json`（自動更新専用） |
| 自動更新 | `.github/workflows/border-update.yml`（毎日 05:00・17:00 JST、手動実行も可） |
| 公開 | `.github/workflows/pages.yml`（push と自動更新のあとに GitHub Pages へ） |
| 取得処理 | `automation/update-borders-json.mjs`。ONE CARAT を2系統で確認：①記事本文の前日分（検証は `lib/border-source.mjs`）、②月別の表画像（`automation/table-reader.mjs`。3日以上前の欠けた日だけを補い、既知の日と全一致した画像だけを使う）。②で補った日・取得元に無い日は `data/border-provenance.json` に記録 |
| 取得元の方針 | ボーダーは ONE CARAT（ライバーキャンパス）の公開記事の数値を取得し、各行に出典リンクを付けています。転載の許諾は得ていません。取得元から求めがあれば公開を止めます。HAISHIN LAB は規約で無断転載が禁止されているため使わない（許可を得た場合のみ追加を検討） |
| アイコン | `calculator/meter-icon.svg`（`scripts/meter-icon-svg.mjs` で生成）。ホーム画面用PNG（180・192・512）は同じ図形を描画して `calculator/offline-assets.mjs` に格納 |

利用者の履歴・設定・E帯データは各端末のブラウザーに保存され、制作者のサーバーへは送りません（アクセス数だけ GoatCounter で集計、Cookie なし）。E帯の画像読取用データ（約30MB）は初回にこのサイトから取得し、ブラウザーに保存して再利用します。
旧Sites（https://poco-meter.freefreelife2000.chatgpt.site/）からの移行は、旧Sitesで「保存・出力」→JSONバックアップを保存し、新しいURLで読み込みます。

## 旧Sites版の名残（現行の公開には使わない）

次のフォルダー・ファイルは旧 ChatGPT Sites 版（Next.js＋DB）の名残です。GitHub Pages に公開されるのは `scripts/build-pages.mjs` が `_site/` に出力する画面（`calculator/` から作るHTML・SW・アイコン）と `data/` の一部JSON、E帯の画像読取用に同梱した `calculator/ocr/`（tesseract.js と言語データ。ハッシュ固定・Apache-2.0、`calculator/ocr/NOTICE.md`）だけで、これらは公開されません。

| 場所 | 現在の扱い |
| --- | --- |
| `app/`・`components/`・`hooks/`・`examples/` | 不使用（旧Sites版の画面・部品） |
| `db/` | テスト・生成で参照（過去ボーダーの元データ。`scripts/prepare-history-page.mjs` と各テストが読む） |
| `drizzle/` | テストで参照（旧DBの定義をテスト用の一時DBに使う） |
| `deployment/` | テストで参照（`tests/cloudflare-pages-migration.mjs`） |
| `.openai/` | 不使用（旧Sitesの公開設定。`vite.config.ts` から読まれるが公開・本番操作には使わない） |
| `docs/legacy-source/`・`docs/archive/`・`SECURITY-20261018.md` | 旧Sites時代の記録（参照のみ・書き換えない）。署名キーの導出手順やセキュリティ点検の未対応項目は旧Sites用で、現行の公開（GitHub Pages）には当てはまらない。旧Sitesの書き込み用キーは廃止済みで、GitHub Secrets にも登録はない |
| `npm start` | 旧Sites用で、現在は使えない。公開は `npm run pages:build`／GitHub Actions、確認は `npm run check` |

## ローカルでの確認

```bash
npm run check
```

```bash
npm run test:extra
```

```bash
npm run pages:build
```

ツール本体を変えたときは版を更新します（データ更新だけでは不要）。

```bash
npm run version:bump
```

リポジトリは公開されています。秘密情報、認証トークン、利用者データ、アクセスログはコミットしないでください。

## 履歴

2026/11/06 にSitesの正規ソース（取得コミット3c0e6c8）を取り込み、2026/11/07 に GitHub Pages ＋ GitHub Actions の構成へ移行しました。
旧ツールの案内と旧Sites向け資料はGit履歴と `docs/legacy-source/` に残っています。現在の公開・同期先として使用しないでください。
