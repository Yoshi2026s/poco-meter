# コード地図（どこを読めばよいか）

全体を検索する前にここで当たりを付ける。行番号は 2026/11/07 時点の目安なので、`grep -n 関数名` で確かめてから必要範囲だけ読む。

## 公開（GitHub Pages）に使うもの
| 役割 | 編集する元ファイル | 備考 |
| --- | --- | --- |
| 計算画面 | `calculator/index.html` | 下の「index.html の中身」参照 |
| 過去ボーダー画面 | `calculator/history-page-template.html`・`history-core.mjs`・`history-ui.mjs` | `calculator/border-history.html` は生成物。編集後 `npm run pages:prepare` |
| E帯画面 | `calculator/e-border-template.html`・`e-border-core.mjs`・`e-border-store.mjs`・`e-border-async.mjs`・`e-border-ui.mjs` | `calculator/e-border.html` は生成物。同上 |
| 算出方法 | `calculator/calculation-methods.html` | |
| オフライン（SW） | `calculator/sw.js`・`offline-assets.mjs`（manifest・アイコンPNG） | アイコン図形は `scripts/meter-icon-svg.mjs` |
| 公開用の加工 | `scripts/build-pages.mjs`（`PAGES_VERSION`）→ `scripts/prepare-github-meter.mjs`・`lib/browser-security.mjs`（CSPハッシュ） | Sites専用部分（統計送信・管理リンク等）をここで外す |
| メーター予想の情報源 | `automation/collect-events.mjs`（公式noteからイベントの事実だけ収集）・`automation/build-meter-factors.mjs`（曜日・給料日・暦・イベントの普段比） | データは `data/events.json`・`data/meter-factors.json`。公開時に `forecastBundle` で `data/meter-forecast.json` を作る。テストは `tests/meter-sources.mjs`・`tests/always-on-forecast.mjs` |
| ボーダー取得 | `automation/update-borders-json.mjs`（①記事本文：`lib/border-source.mjs`、②表画像：`automation/table-reader.mjs`） | データは `data/borders.json`（手編集禁止）、補完記録は `data/border-provenance.json` |
| 定期実行・公開 | `.github/workflows/border-update.yml`・`pages.yml`・`calculator-tests.yml` | |

旧Sites（Next.js・Cloudflare）用で、Pages版では使わないもの：`app/`・`components/`・`hooks/`・`db/*.ts`・`drizzle/`・`deployment/`・`github-sync/`・`lib/` の contact・visitor・connector 系など。直す必要がない限り読まない。

## index.html の中身（行は目安）
| 範囲 | 内容 |
| --- | --- |
| 21–1655 | CSS（最後の `<style>` 末尾の「2026-11 main screen」がメイン画面の最新の見た目） |
| 1656–2039 | 画面のHTML（`#mini` がシンプルメニュー＝メイン画面。`#itemsWindow`（アイテム目安）・`#mainTools`（コピー・換算・ペース）を含む。直後の `#mainSubMenus` が補助メニューの各セクション。`#fullMeterMenu` は非表示の内部状態） |
| 2040–2103 | `simple-menu-controller`（アイテム目安の表示、状態バー、互換用 `window.pocochaMainMenus`） |
| 2104–3807 | 本体スクリプト |
| 3811–3913 | アクセス統計（Pages版の作成時に外す） |

本体スクリプトの主な関数（`grep -n "function 名前" calculator/index.html`）：
- 常時表示パネル：`meterForecast`・`forecastDayISO`・`renderAlwaysOn`・`openAlwaysOn`・`loadForecastData`（本体スクリプト末尾、`meterContext` の直前）
- 保存・復元：`packStoredState`・`unpackStoredState`・`recoverStoredState`・`save`（2127〜2200）
- 時刻・締め：`jstNow`・`meterWindow`・`renderDeadlineCountdown`（2439〜2455）、`syncClose`・`commitClose`（3490〜）
- ボーダー同期：`mergeLiveBorders`・`syncLiveBorders`（2546〜2614）
- 目標計算：`statsForWindow`・`targetCalc`・`refreshAutomaticTarget`（2631〜2800）、`rangeFor`・`avgFor`（2821〜2845）
- 表示更新：`update`（3173）、`renderBorders`（2845）、`renderDailyBorders`（2919）
- 取り込み・バックアップ：`parseBorders`〜`commitRows`（3009〜3120）
- 入力欄：`setCurrent`・`applyManualGoal`・`changeCore`（3295〜3430）
- メニュー開閉：`setSectionCollapsed`・`applyCollapsedPreferences`（3510〜）

## 端末の保存キー（変えない）
`pococha-meter-calc-v1`（本体）・`pococha-meter-display-v1`・`pococha-meter-hud-v1`・`pococha-meter-items-window-v1`・`pococha-e-display-v1`・`pococha-e-drafts-v1`・`pococha-meter-history-v1`・`pococha-meter-history-theme-v1`・`pococha-site-time-v1`（ほか常時表示パネルの予想データの写し `pococha-meter-forecast-v1`）

## テストの選び方
- 計算：`tests/calculation-engine.mjs`、締め時間別：`tests/cutoff-reference-target.mjs`
- 公開物・ボーダー：`tests/pages-borders.mjs`、表画像：`tests/table-channel.mjs`
- 過去ボーダー画面：`tests/history-page-ui.mjs`・`tests/history-independent.mjs`
- E帯：`tests/e-*.mjs`、オフライン：`tests/offline-*.mjs`
- 画面の見た目・スマホ幅：`npm run test:extra`
