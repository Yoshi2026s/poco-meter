#!/usr/bin/env bash
# 統合前の標準チェック（CIの「メーター計算・ボーダー保存の検証」と同じテスト＋公開物の作成）。
# 使い方：npm run check   （出力は合否のみ。失敗したテストだけログ末尾を表示）
# - acorn は版を固定してリポジトリ外の一時フォルダーへ入れる（package.json は変えない。test-extra.sh と共用）。
# - 画面系の重いテストは含めない。UIを変えたときは別に `npm run test:extra` を実行する。
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
tools="${POCOCHA_TEST_TOOLS:-${TMPDIR:-/tmp}/poco-meter-test-tools}"
log="${TMPDIR:-/tmp}/poco-meter-check"
mkdir -p "$log"
if [[ ! -d "$tools/node_modules/acorn" ]]; then
  npm install --prefix "$tools" --no-save --no-audit --no-fund acorn@8.15.0 >/dev/null 2>&1 || { echo "NG: acorn を準備できません"; exit 1; }
fi
export NODE_PATH="$tools/node_modules${NODE_PATH:+:$NODE_PATH}"
failed=0
run() {
  local name="$1"; shift
  if "$@" >"$log/$name.log" 2>&1; then echo "ok  $name"; else echo "NG  $name"; tail -n 20 "$log/$name.log"; failed=1; fi
}
run pages-borders+table-channel node --test tests/pages-borders.mjs tests/table-channel.mjs
for t in calculation-engine periods-default-rank items-core-input border-write-auth history-search meter-sources always-on-forecast forecast-log; do run "$t" node "tests/$t.mjs"; done
run pages-build node scripts/build-pages.mjs --out="$log/_site"
# 生成物（過去ボーダー・E帯）が元ファイルと一致するか。不一致なら元に戻して知らせる。
gen=(calculator/border-history.html calculator/e-border.html)
for f in "${gen[@]}"; do cp "$f" "$log/$(basename "$f").bak"; done
if node scripts/prepare-e-border.mjs >"$log/prepare.log" 2>&1 && node scripts/prepare-history-page.mjs >>"$log/prepare.log" 2>&1; then
  stale=0
  for f in "${gen[@]}"; do cmp -s "$f" "$log/$(basename "$f").bak" || stale=1; cp "$log/$(basename "$f").bak" "$f"; done
  if [[ $stale == 0 ]]; then echo "ok  generated-pages"; else echo "NG  generated-pages（テンプレート等の変更が生成物に未反映。npm run pages:prepare の結果をコミット）"; failed=1; fi
else
  for f in "${gen[@]}"; do cp "$log/$(basename "$f").bak" "$f"; done
  echo "NG  generated-pages"; tail -n 20 "$log/prepare.log"; failed=1
fi
# ツール本体を変えたのに版が同じなら知らせる（既定ブランチとの差分で判定）
base=$(git merge-base HEAD 'origin/(root)' 2>/dev/null || true)
if [[ -n "$base" ]] && [[ -n "$(git diff --name-only "$base" -- calculator/)" ]] && ! git diff "$base" -- scripts/build-pages.mjs | grep -q '^+export const PAGES_VERSION'; then
  echo "注意 calculator/ を変更していますが PAGES_VERSION が同じです（npm run version:bump）"
fi
if [[ -n "$(git diff --name-only -- data/borders.json; git diff --cached --name-only -- data/borders.json)" ]]; then
  echo "注意 data/borders.json が変更されています（自動更新専用。意図した変更か確認）"
fi
[[ $failed == 0 ]] && echo "全チェック合格" || echo "不合格あり（ログ：$log）"
exit $failed
