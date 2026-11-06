# ポコメーター番長

Pocochaの目標メーター計算・過去ボーダー管理ツールです。

- 公開先：https://yoshi2026s.github.io/poco-meter/
- 開発・正本：このリポジトリ（Yoshi2026s/poco-meter、既定ブランチ `(root)`）
- 開発環境：Claude Code（ChatGPTからもGitHub経由で共同編集可）
- [開発指示（Code・ChatGPT共通）](AGENTS.md)
- [引継ぎ資料](docs/HANDOVER.md)
- [自動取得の経緯](docs/AUTOMATION_CODE_HANDOVER.md)

## 仕組み

| 部分 | 場所 |
| --- | --- |
| 画面の元ファイル | `calculator/`（計算画面・過去ボーダー・E帯・算出方法・SW） |
| 公開用の加工 | `scripts/build-pages.mjs` → `_site/`（コミットしない） |
| ボーダーデータ | `data/borders.json`（自動更新専用） |
| 自動更新 | `.github/workflows/border-update.yml`（毎日 05:07・17:07 JST、手動実行も可） |
| 公開 | `.github/workflows/pages.yml`（push と自動更新のあとに GitHub Pages へ） |
| 取得処理 | `automation/update-borders-json.mjs`（取得元の検証は `lib/border-source.mjs`） |
| アイコン | `calculator/meter-icon.svg`（`scripts/meter-icon-svg.mjs` で生成）。ホーム画面用PNG（180・192・512）は同じ図形を描画して `calculator/offline-assets.mjs` に格納 |

利用者の履歴・設定・E帯データは各端末のブラウザーに保存されます。サーバーへは送りません。
旧Sites（https://poco-meter.freefreelife2000.chatgpt.site/）からの移行は、旧Sitesで「保存・出力」→JSONバックアップを保存し、新しいURLで読み込みます。

## ローカルでの確認

```bash
node --test tests/pages-borders.mjs
```

```bash
node scripts/build-pages.mjs --out=_site
```

リポジトリは公開されています。秘密情報、認証トークン、利用者データ、アクセスログはコミットしないでください。

## 履歴

2026/11/06 にSitesの正規ソース（取得コミット3c0e6c8）を取り込み、2026/11/07 に GitHub Pages ＋ GitHub Actions の構成へ移行しました。
旧ツールの案内と旧Sites向け資料はGit履歴と `docs/legacy-source/` に残っています。現在の公開・同期先として使用しないでください。
