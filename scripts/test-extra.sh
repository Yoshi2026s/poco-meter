#!/usr/bin/env bash
# 依存が必要な追加テスト（CSS解析のvite系・Playwrightの画面系）を実行する。
# 使い方：bash scripts/test-extra.sh [出力フォルダー]
# - acorn・vite・Noto Sans JP は版を固定して、リポジトリ外の一時フォルダーへ入れる（package.json は変えない）。
# - Playwright と Chromium は既に入っているものを使う。場所は NODE_PATH（playwright を含む node_modules）と
#   POCOCHA_CHROMIUM（Chromium本体、未指定なら Playwright の既定）で指定できる。
# - mobile-usability-10000 は docs/mobile-usability-10000-result.json を書き換える（所要時間など）。不要なら git checkout で戻す。
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
run() { echo "## $*"; if "$@"; then echo "ok: $*"; else echo "NG: $*"; failed=1; fi; }
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
exit $failed
