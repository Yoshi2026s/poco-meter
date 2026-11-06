#!/usr/bin/env bash
# 依存が必要な追加テスト（CSS解析のvite系・Playwrightの画面系）を実行する。
# 使い方：bash scripts/test-extra.sh [出力フォルダー]
# - acorn・vite・Noto Sans JP は版を固定して、リポジトリ外の一時フォルダーへ入れる（package.json は変えない）。
# - Playwright と Chromium は既に入っているものを使う。場所は NODE_PATH（playwright を含む node_modules）と
#   POCOCHA_CHROMIUM（Chromium本体、未指定なら Playwright の既定）で指定できる。
# - mobile-usability-10000 が書き換える docs/mobile-usability-10000-result.json は終了時に元に戻す（残すときは POCOCHA_KEEP_RESULTS=1）。
# - 出力は合否のみ。全体で8分ほどかかる。
# - typography-balance-1000 は既知の不合格あり（docs/HANDOVER.md 参照）。
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
tools="${POCOCHA_TEST_TOOLS:-${TMPDIR:-/tmp}/poco-meter-test-tools}"
out="${1:-${TMPDIR:-/tmp}/poco-meter-test-out}"
if [[ ! -d "$tools/node_modules/vite" || ! -d "$tools/node_modules/@fontsource/noto-sans-jp" ]]; then
  npm install --prefix "$tools" --no-save --no-audit --no-fund \
    acorn@8.15.0 vite@8.0.16 @fontsource/noto-sans-jp@5.2.9 >/dev/null || exit 1
fi
export NODE_PATH="$tools/node_modules${NODE_PATH:+:$NODE_PATH}"
mkdir -p "$out"
failed=0
# 出力は合否だけ。失敗したテストはログ末尾を表示する（全文は $out/logs/）。
mkdir -p "$out/logs"
known="typography-balance-1000.mjs"   # 既知の不合格（docs/HANDOVER.md）。合否は変えず、表示だけ区別する
run() { local n; n=$(basename "$2"); local l="$out/logs/$n.log"
  if "$@" >"$l" 2>&1; then echo "ok  $2"
  elif [[ " $known " == *" $n "* ]]; then echo "NG  $2（既知）"; failed=1
  else echo "NG  $2"; tail -n 20 "$l"; failed=1; fi; }
for t in compact-menus color-state-regressions custom-display hud-focus-errors native-select-contrast \
  reference-colors theme-visibility-100 theme-cascade-cached typography-balance-1000 mobile-usability-10000; do
  run node "tests/$t.mjs"
done
if node -e "require.resolve('playwright')" 2>/dev/null; then
  run node tests/hud-items-browser.cjs
  run node tests/record-display-browser.cjs
  run node tests/phone-layout-browser.cjs "$out"
else
  echo "NG: playwright が見つかりません（NODE_PATH に playwright を含む node_modules を指定）"; failed=1
fi
# mobile-usability-10000 が書き換える結果ファイル（所要時間など）は、POCOCHA_KEEP_RESULTS=1 でなければ元に戻す
[[ "${POCOCHA_KEEP_RESULTS:-}" == 1 ]] || git checkout -q -- docs/mobile-usability-10000-result.json 2>/dev/null
[[ $failed == 0 ]] && echo "全テスト合格" || echo "不合格あり（ログ：$out/logs）"
exit $failed
