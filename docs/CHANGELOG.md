# 変更履歴

新しいものを上に、1変更1行で書く（日付 JST・版・内容・検証）。詳細はPRとコミットに残す。

- 2026/11/07 v2026.11.07.5：スマホ幅（700px以下）の「締めまで」「コアボ」を10px→12px（`--font-meta` 経由の10px指定が優先されていたため要素側で12pxに）。check合格、test:extra は typography-balance-1000 以外合格、Chromium エミュレーション 280〜844px ではみ出しなし。
- 2026/11/07 docs/CODEMAP.md（コード地図）追加。`npm run pages:prepare` 追加、`npm run check` に生成物の不一致検出と版更新忘れの注意を追加。`test:extra` の出力を合否のみにし、結果ファイルを自動で戻す。
- 2026/11/07 .claude/settings.json を追加（検証コマンドの許可リスト、data/borders.json の手編集禁止）。
- 2026/11/07 開発ルール整理：docs を現状（HANDOVER）・要望（REQUESTS）・履歴（本ファイル）・archive に分割。`npm run check`・`npm run version:bump` を追加。
- 2026/11/07 テスト：vite系10本・Playwright画面系3本を `bash scripts/test-extra.sh` で実行可能に（typography-balance-1000 のみ不合格）。offline-v2-sw-50 の期待リストを SW 定数から読む形に修正（50/50）。
- 2026/11/07 v2026.11.07.4：過去ボーダー画面の表示要素11種を復元。シンプルメニュー小部品を44pxに（高さ640px以上）。
- 2026/11/07 v2026.11.07.3：アプリ名を「ポコメーター番長」に変更。
- 2026/11/07 v2026.11.07.2：ホーム画面アイコンをメーター型に変更。
- 2026/11/07 取得元を2系統化（ONE CARAT の記事本文＋月別表画像）。10/19〜11/03 の47日分を表画像から補完。
- 2026/11/07 GitHub Pages＋Actions へ移行。CI の計算テストは acorn@8.15.0 を一時導入して実行。
- 2026/11/06 Sitesソース（取得コミット3c0e6c8）を取り込み。
