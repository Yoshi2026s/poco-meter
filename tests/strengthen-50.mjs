import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { engine, pageEngine, plain, statsForValues, html } from './calculator-harness.mjs';

// 50 additional, named regression checks. The numerical harness extracts the
// shipped functions; interaction checks execute the entire shipped script.
const key = 'pococha-meter-calc-v1';
const baseline = () => ({ ...plain(engine().state), seedVer: 3, seedVer13: 1,
  snapshotVersion: '2026-10-02-v3', goalDefaultsVersion: 1 });
const page = (settings = {}) => pageEngine({ ...baseline(), target: '1001', current: '0', ...settings });
const saved = p => JSON.parse(p.stored.get(key));
const input = (p, id, value, type = 'input') => {
  p.element(id).value = value; p.element(id).dispatchEvent(new Event(type));
};
const button = (p, attr, value) => p.nodes.find(node => node.dataset[attr] === value);
const autoSettings = () => ({ pick: 0, period: '30d', log: {
  '2026-09-30': { S2: [100, 200, 300], S1: [10, 20, 30] },
  '2026-10-02': { S2: [300, 400, 500], S1: [30, 40, 50] },
}, log13: { '2026-10-02': { S2: [900, 1000, 1100] } }, provenance: {} });

test('C01 CR を含む数字・小数・単位を連結して受理しない', () => {
  const e = engine();
  for (const text of ['12\r500', '12\r.5K', '1\r万', '1\r\nK']) {
    assert.equal(e.readNumber(text), null, JSON.stringify(text));
  }
  assert.equal(e.readNumber('12.5\tK'), 12500);
  assert.equal(e.readNumber('1 万'), 10000);
});

test('C02 全角小数の各単位で半ポイントと入力上限の境界を正確に判定する', () => {
  const e = engine();
  const cases = [
    ['０．０００４９９Ｋ', 0], ['０．０００５Ｋ', 1],
    ['０．００００４９９万', 0], ['０．００００５万', 1],
    ['０．００００００４９９Ｍ', 0], ['０．００００００５Ｍ', 1],
    ['３６０２８７９７０１８９．６３９Ｋ', 360287970189639],
    ['３６０２８７９７０１８９．６３９５Ｋ', null]
  ];
  for (const [text, expected] of cases) assert.equal(e.readNumber(text), expected, text);
});

test('C03 上限付近の30日平均は安全整数を超える合計を失わず切り上げる', () => {
  const e = engine();
  const values = Array.from({length: 30}, (_, i) => 360287970189639 - i);
  const stats = statsForValues(e, values);
  // 30 × 360287970189639 − (0 + … + 29) = 10808639105688735。
  assert.equal(stats.n, 30);
  assert.equal(stats.sum, '10808639105688735');
  assert.ok(BigInt(stats.sum) > BigInt(Number.MAX_SAFE_INTEGER));
  // 平均 360287970189624.5 pt の1pt単位切り上げ。
  const candidate = e.targetCalc(stats, 'mean', 0, 1);
  assert.ok(candidate);
  assert.equal(candidate.target, 360287970189625);
});

test('C04 巨大な偶数件中央値の半ポイントを切り捨てず目標へ切り上げる', () => {
  const e = engine();
  const stats = statsForValues(e, [360287970189630, 360287970189631, 360287970189632, 360287970189633]);
  assert.equal(stats.median, 360287970189631.5);
  const candidate = e.targetCalc(stats, 'median', 0, 1);
  assert.ok(candidate);
  assert.equal(candidate.baseNumerator, '720575940379263');
  assert.equal(candidate.baseDenominator, '2');
  assert.equal(candidate.target, 360287970189632);
});

test('C05 p75 は同値が続く順位境界でも中央値や平均と混同しない', () => {
  const e = engine();
  const stats = statsForValues(e, [900, 400, 200, 400, 100, 200, 400, 200]);
  // 昇順8件の第6位は400。平均350、中央2件の平均は300。
  assert.equal(stats.n, 8);
  assert.equal(stats.mean, 350);
  assert.equal(stats.median, 300);
  assert.equal(stats.p75, 400);
  assert.equal(e.targetCalc(stats, 'p75', 0, 1).target, 400);
});

test('C06 0.1％上乗せと10000pt切り上げの直前・直後を区別する', () => {
  const e = engine();
  // 9990 × 1001 = 9999990、9991 × 1001 = 10000991。
  assert.ok(9990n * 1001n < 10000n * 1000n);
  assert.ok(9991n * 1001n > 10000n * 1000n);
  assert.equal(e.targetCalc(statsForValues(e, [9990]), 'mean', 0.1, 10000).target, 10000);
  assert.equal(e.targetCalc(statsForValues(e, [9991]), 'mean', 0.1, 10000).target, 20000);
  // 半ポイントの平均にも上乗せ後の境界判定を適用する。
  assert.equal(e.targetCalc(statsForValues(e, [9990, 9991]), 'mean', 0.1, 10000).target, 20000);
});

test('C07 負の微小値をゼロへ丸めた表示に負符号を残さない', () => {
  const e = engine();
  assert.equal(e.formatRatio(-1n, 10000n, 1, false, true), '0');
  assert.equal(e.formatRatio(-1n, 10000n, 1, true, false), '0.0');
  assert.equal(e.formatRatio(-499n, 1000n, 0, false, true), '0');
  assert.equal(e.formatRatio(-500n, 1000n, 0, false, true), '-1');
  assert.equal(e.fmtRemainingK(-0), '0');
  assert.equal(e.readNumber(-0), 0);
});

test('C08 残り1msの巨大な毎時ペースをBigIntのまま算出・表示する', () => {
  const e = engine();
  const expected = 360287970189639n * 3600000n;
  const observed = e.ceilPace(360287970189639, 3600000, 1);
  assert.equal(observed, expected);
  assert.ok(expected > BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal(e.fmtPaceK(observed), String(expected / 1000n) + 'K');
  assert.equal(e.fmtPaceK(observed + 1n), String(expected / 1000n) + '.001K');
});

test('C09 JST年跨ぎの24時締めと直近30日期間は境界で正しい日へ進む', () => {
  const e = engine();
  e.state.deadline = '00:00';
  e.state.asOfDate = '';
  const before = Date.parse('2026-12-31T14:59:59.999Z');
  const boundary = Date.parse('2026-12-31T15:00:00.000Z');
  const first = e.meterWindow(before);
  assert.equal(first.end, boundary);
  assert.equal(first.end - before, 1);
  assert.equal(first.start, Date.parse('2026-12-30T15:00:00.000Z'));
  const next = e.meterWindow(boundary);
  assert.equal(next.end, Date.parse('2027-01-01T15:00:00.000Z'));
  assert.equal(next.start, boundary);
  assert.equal(next.left, 1440);
  const jst = e.jstNow(boundary);
  assert.deepEqual([jst.y, jst.m, jst.d, jst.mins], [2027, 1, 1, 0]);
  const previousWindow = e.recentWindow(before), newWindow = e.recentWindow(boundary);
  assert.deepEqual([previousWindow.start, previousWindow.end], ['2026-12-01', '2026-12-30']);
  assert.deepEqual([newWindow.start, newWindow.end, newWindow.dates.length], ['2026-12-02', '2026-12-31', 30]);
});

test('C10 コア39→40の倍率境界で4アイテムの必要個数が最小数へ即変わる', () => {
  const e = engine();
  const cases = [
    {price: 55, remaining: 238, coins39: 56, coins40: 55},
    {price: 111, remaining: 480, coins39: 112, coins40: 111},
    {price: 1080, remaining: 4666, coins39: 1081, coins40: 1071},
    {price: 5555, remaining: 23998, coins39: 5556, coins40: 5505}
  ];
  for (const core of [39, 40]) {
    e.state.coreCount = String(core);
    const bonus = core === 39 ? 8 : 9;
    assert.equal(e.coreInfo().bonus, bonus);
    for (const c of cases) {
      const coins = e.needCoins(c.remaining), count = Number(e.itemRange(c.remaining, c.price));
      assert.equal(coins, core === 39 ? c.coins39 : c.coins40, `core=${core}, price=${c.price}`);
      assert.equal(count, core === 39 ? 2 : 1, `core=${core}, price=${c.price}`);
      // コイン数・アイテム数とも1つ減らすと不足することを独立に確認する。
      const weightedPoints = BigInt(c.remaining) * 25n, multiplier = BigInt(100 + bonus);
      assert.ok(BigInt(coins) * multiplier >= weightedPoints);
      assert.ok(BigInt(coins - 1) * multiplier < weightedPoints);
      assert.ok(count * c.price >= coins);
      assert.ok((count - 1) * c.price < coins);
    }
  }
});

test('C11 ラベル付き貼り付けで±0/+1/+2を保持', () => {
  assert.deepEqual(plain(engine().parseBorders('S2 [±0]100 [+1]200 [+2]300')), { S2: [100, 200, 300] });
});
test('C12 ラベルの表示順が違っても意味に対応', () => {
  assert.deepEqual(plain(engine().parseBorders('S2 [+2]300 [±0]100 [+1]200')), { S2: [100, 200, 300] });
});
test('C13 重複+1ラベルを拒否', () => {
  assert.throws(() => engine().parseImports('S2 [±0]100 [+1]200 [+1]300', '2026-10-02'));
  assert.throws(() => engine().parseImports('S2 ±0.5K +1.5K +2.5K', '2026-10-02'));
});
test('C14 +2欠落を値の順番で補完しない', () => {
  assert.throws(() => engine().parseImports('S2 [±0]100 [+1]200 300', '2026-10-02'));
  assert.throws(() => engine().parseImports('S2 [±0]100 [+1]200 300\nS2 100 200 300', '2026-10-02'));
  assert.throws(() => engine().parseImports('S2 100 200 300\nS2 400 500 600', '2026-10-02'));
});
test('C15 ラベルなし4値を黙って切り捨てない', () => {
  assert.throws(() => engine().parseImports('S2 100 200 300 400', '2026-10-02'));
});
test('C16 先頭小数点Kを貼り付けでも受理', () => {
  assert.deepEqual(plain(engine().parseImports('S2 .5K 1K 2K', '2026-10-02')[0].vals), [500, 1000, 2000]);
});
test('C17 全角先頭小数点と万単位を受理', () => {
  assert.deepEqual(plain(engine().parseImports('Ｓ２ ［±０］．５万 ［＋１］１万 ［＋２］２万', '2026-10-02')[0].vals), [5000, 10000, 20000]);
});
test('C18 CR改行CSVの2行が混ざらない', () => {
  const rows = engine().parseImports('2026-10-01,S2,100,200,300,22\r2026-10-02,S2,400,500,600,22', '2026-10-02');
  assert.equal(rows.length, 2); assert.equal(rows[1].date, '2026-10-02'); assert.deepEqual(plain(rows[1].vals), [400, 500, 600]);
});
test('C19 CRLFの見出し付きTSVを受理', () => {
  const rows = engine().parseImports('date\trank\tzero\tplus1\tplus2\tclose\r\n2026-10-02\tS2\t100\t200\t300\t13', '2026-10-02');
  assert.equal(rows.length, 1); assert.equal(rows[0].close, '13');
});
test('C20 誤ったラベルの取込で既存値を変更しない', () => {
  const e = engine(); const before = JSON.stringify(e.state);
  e.element('paste').value = 'S2 [±0]100 [+2]200 [+1]300'; e.element('logDate').value = '2026-10-02';
  e.element('importBtn').onclick(); assert.equal(JSON.stringify(e.state), before); assert.equal(e.element('importMsg').className, 'toast err');
});
test('C21 初回表示のS2・コア0と自動目標', () => {
  const p = pageEngine(); assert.equal(saved(p).rank, 'S2'); assert.equal(saved(p).coreCount, '0'); assert.equal(saved(p).pick, 0);
  assert.notEqual(p.element('remainExact').textContent, '目標未設定');
});
test('C22 保存された未設定目標を再読込で復活させない', () => {
  const p = page({ target: '', pick: '' }); assert.equal(p.element('remainExact').textContent, '目標未設定'); assert.equal(p.element('quickBorder').value, '');
});
test('C23 目標リセット後の保存と再読込', () => {
  const p = page(autoSettings()); button(p, 'reset', 'target').click();
  const reloaded = pageEngine(saved(p)); assert.equal(reloaded.element('remainExact').textContent, '目標未設定'); assert.equal(reloaded.element('target').value, '');
});
test('C24 リセットの取消で自動目標モードも復元', () => {
  const p = page(autoSettings()); const old = saved(p).target; button(p, 'reset', 'target').click(); p.element('undoTarget').click();
  assert.equal(saved(p).target, old); assert.equal(saved(p).pick, 0); assert.equal(p.element('remain').textContent, '200');
});
test('C25 明示した起動時デフォルト値設定を優先', () => {
  const defaults = { ...engine().standardGoalDefaults(), applyOnLoad: true };
  const p = page({ ...autoSettings(), target: '', pick: '', goalDefaults: plain(defaults) });
  assert.equal(saved(p).pick, 0); assert.equal(p.element('remain').textContent, '200');
});
test('C26 現在値の入力で残りとアイテムが即更新', () => {
  const p = page({ coreCount: '0' }); input(p, 'currentTop', '１０００');
  assert.equal(p.element('remain').textContent, '1'); assert.equal(p.element('coinNeed').textContent, '1'); assert.equal(p.element('dogcatNeed').textContent, '1 匹');
});
test('C27 目標値の入力で進捗と残りが即更新', () => {
  const p = page({ current: '500' }); input(p, 'target', '2K');
  assert.equal(p.element('remain').textContent, '1.5K'); assert.equal(p.element('pct').textContent, '25%'); assert.equal(p.element('fill').style.width, '25%');
});
test('C28 コア閾値の変更でコイン目安が即更新', () => {
  const p = page({coreCount:'40'}); assert.equal(p.element('coinNeed').textContent, '230'); input(p, 'coreCountTop', '４５');
  assert.equal(p.element('coinNeed').textContent, '228'); assert.equal(p.element('coreBonusTop').textContent, '110%');
});
test('C29 小型ランク選択を自動目標へ即反映', () => {
  const p = page(autoSettings()); input(p, 'quickRank', 'S1', 'change');
  assert.equal(saved(p).rank, 'S1'); assert.equal(p.element('remain').textContent, '20');
});
test('C30 小型ボーダー選択を自動目標へ即反映', () => {
  const p = page(autoSettings()); input(p, 'quickBorder', '2', 'change');
  assert.equal(saved(p).pick, 2); assert.equal(p.element('remain').textContent, '400');
});
test('C31 小型算出方法選択を即反映', () => {
  const p = page(autoSettings()); input(p, 'quickMethod', 'max', 'change');
  assert.equal(saved(p).targetMethod, 'max'); assert.equal(p.element('remain').textContent, '300');
});
test('C32 集計期間の変更で候補と目標が一致', () => {
  const p = page(autoSettings()); input(p, 'quickPeriod', 'month', 'change');
  assert.equal(saved(p).period, 'month'); assert.equal(p.element('remain').textContent, '300'); assert.match(p.element('candidateDifference').textContent, /同じ数値/);
});
test('C33 締め時刻の入力を対応するログへ反映', () => {
  const p = page(autoSettings()); input(p, 'deadline', '13:00');
  assert.equal(saved(p).deadline, '13:00'); assert.equal(p.element('remain').textContent, '900'); assert.equal(p.element('left').textContent, '16:00:00');
});
test('C34 手入力目標は分析条件変更で上書きしない', () => {
  const p = page(autoSettings()); input(p, 'target', '12.5K'); input(p, 'quickRank', 'S1', 'change');
  assert.equal(saved(p).target, '12500'); assert.equal(saved(p).pick, ''); assert.equal(p.element('remain').textContent, '12.5K');
});
test('C35 現在値の不正入力でも最後の計算を維持', () => {
  const p = page({ current: '500' }); input(p, 'currentTop', '1..2K');
  assert.equal(saved(p).current, '500'); assert.equal(p.element('remain').textContent, '501'); assert.match(p.element('inputStatus').textContent, /現在値.*直前の現在値 500 pt/);
});
test('C36 目標値の不正入力でも最後の目標を維持', () => {
  const p = page(); input(p, 'target', '1e3');
  assert.equal(saved(p).target, '1001'); assert.equal(p.element('remain').textContent, '1.001K'); assert.match(p.element('inputStatus').textContent, /目標値.*1,001 pt/);
});
test('C37 不正コア数で目安計算を変えない', () => {
  const p = page({coreCount:'40'}); input(p, 'coreCountTop', '40.5');
  assert.equal(saved(p).coreCount, '40'); assert.equal(p.element('coinNeed').textContent, '230'); assert.match(p.element('inputStatus').textContent, /コア数.*0〜1000/);
});
test('C38 IME変換中の未完成文字で値を消さない', () => {
  const p = page({ current: '500' }); p.element('currentTop').dispatchEvent(new Event('compositionstart')); input(p, 'currentTop', 'あ');
  assert.equal(saved(p).current, '500'); assert.equal(p.element('remain').textContent, '501');
  p.element('currentTop').value = '１０００'; p.element('currentTop').dispatchEvent(new Event('compositionend')); assert.equal(p.element('remain').textContent, '1');
});
test('C39 固定減算の実差分・0停止理由・取消', () => {
  const p = page({ current: '500' }); button(p, 'addtop', '-1000').click();
  assert.equal(saved(p).current, '0'); assert.match(p.element('currentActionMsg').textContent, /−500 pt.*0 ptで止め/);
  p.element('undoCurrent').click(); assert.equal(saved(p).current, '500'); assert.equal(p.element('remain').textContent, '501');
});
test('C40 固定加算とミニ加算の上限停止を説明', () => {
  const max = engine().MAX_VALUE; const p = page({ current: String(max - 1) }); button(p, 'addtop', '1000').click();
  assert.equal(saved(p).current, String(max)); assert.match(p.element('currentActionMsg').textContent, /＋1 pt.*上限/);
  p.element('miniAdd').click(); assert.match(p.element('currentActionMsg').textContent, /^0 pt.*上限/);
});
test('C41 形式が正しい上限超過は形式エラーと区別', () => {
  const p = page(); input(p, 'currentTop', String(engine().MAX_VALUE + 1));
  assert.match(p.element('inputStatus').textContent, /入力上限は 360,287,970,189,639 pt/); assert.equal(saved(p).current, '0');
  input(p, 'currentTop', '0'.repeat(300) + '1'); assert.match(p.element('inputStatus').textContent, /入力が長すぎます/);
  assert.doesNotMatch(p.element('inputStatus').textContent, /入力上限は/); assert.equal(saved(p).current, '0');
});
test('C42 複数欄エラーを項目名付きで重複なく表示', () => {
  const p = page(); input(p, 'current', '-1'); input(p, 'currentTop', '-1'); input(p, 'target', '-1');
  const message = p.element('inputStatus').textContent; assert.match(message, /現在値：/); assert.match(message, /目標値：/); assert.equal((message.match(/現在値：/g) ?? []).length, 1);
  input(p, 'currentTop', '1'); input(p, 'current', '1'); assert.doesNotMatch(p.element('inputStatus').textContent, /現在値：/);
});
test('C43 残りKの説明は1pt単位の正確な値', () => {
  const p = page(); assert.equal(p.element('remain').title, '残り 1,001 pt'); assert.equal(p.element('remain').getAttribute('aria-label'), '残り 1,001 pt');
});
test('C44 進捗の読み上げに現在・目標・残りの単位', () => {
  const p = page({ current: '1000' }); assert.equal(p.element('progressMeter').getAttribute('aria-valuetext'), '99.9％、現在1,000 pt、目標1,001 pt、残り1 pt');
});
test('C45 前日の現在値入力に日付を表示', () => {
  const p = page({ current: '1', currentSavedAt: Date.parse('2026-10-02T20:00:00+09:00') });
  assert.equal(p.element('currentSavedTime').textContent, '入力 10/2 20:00'); assert.equal(p.element('periodNotice').hidden, false);
});
test('C46 当日の現在値入力は時刻だけの小型表示', () => {
  const p = page({ currentSavedAt: Date.parse('2026-10-03T20:00:00+09:00') }); assert.equal(p.element('currentSavedTime').textContent, '入力 20:00');
});
test('C47 自動取得ボーダーの出典を開ける', () => {
  const source = 'https://one-carat.com/campus/archives/123';
  const p = page({ log: { '2026-10-02': { S2: [100, 200, 300] } }, provenance: { 22: { '2026-10-02': { S2: { origin: 'remote', source } } } } });
  const cells = p.element('analysisRows').children.flatMap(row => row.children); const links = cells.flatMap(cell => cell.children).filter(node => node.tagName === 'A');
  assert.equal(links.length, 1); assert.equal(links[0].href, source); assert.equal(links[0].rel, 'noopener noreferrer');
});
test('C48 設定元の長い説明へキーボードで到達', () => {
  const p = page(autoSettings()); assert.equal(p.element('appliedContext').getAttribute('tabindex'), '0'); assert.equal(p.element('appliedContext').title, p.element('appliedContext').textContent); assert.match(p.element('appliedContext').title, /S2/);
});
test('C49 エラー欄でもフォーカスを視認できる', () => {
  assert.match(html, /input\[aria-invalid="true"\]:focus\{box-shadow:0 0 0 3px #c64a3926\}/);
});
test('C50 全体の要素順序とレイアウトCSSを維持', () => {
  const expected = JSON.parse(fs.readFileSync(new URL('./layout-baseline.json', import.meta.url)));
  const hash = text => createHash('sha256').update(text).digest('hex');
  // The subsequent mobile usability request authorizes mobile sizing/wrapping
  // overrides. Later explicit logo/display-menu changes are also excluded;
  // the original layout rules and all remaining element order stay unchanged.
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')
    .replace(/\/\* mobile-usability:start \*\/[\s\S]*?\/\* mobile-usability:end \*\/\n?/, '')
    .replace(/\/\* display-settings:start \*\/[\s\S]*?\/\* display-settings:end \*\/\n?/, '')
    .replace(/\/\* typography-balance:start \*\/[\s\S]*?\/\* typography-balance:end \*\/\n?/, '')
    .replace(/\/\* phone-layout:start[^\n]*\*\/[\s\S]*?\/\* phone-layout:end \*\/\n?/, '')
    .replace(/\/\* compact-menus:start \*\/[\s\S]*?\/\* compact-menus:end \*\/\n?/, '')
    .replace(/\/\* simplified-save:start \*\/[\s\S]*?\/\* simplified-save:end \*\/\n?/, '')
    .replace(/\/\* offline-usability:start \*\/[\s\S]*?\/\* offline-usability:end \*\/\n?/, '')
    .replace('input[aria-invalid="true"]:focus{box-shadow:0 0 0 3px #c64a3926}', '');
  const body = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    // New local input errors are hidden in the normal layout. Ignore only
    // these two authorized descriptions; all original geometry/order remains.
    .replace(/<small id="(?:coreInputError|quickBufferError)"[^>]*><\/small>/g, '')
    // The phone HUD input is explicitly authorized and remains hidden on desktop.
    .replace(/<!-- phone-current:start -->[\s\S]*?<!-- phone-current:end -->/, '')
    .replace(/<!-- display-settings-menu:start -->[\s\S]*?<!-- display-settings-menu:end -->/, '')
    .replace(/<!-- offline-head:start -->[\s\S]*?<!-- offline-head:end -->/, '')
    .replace(/<!-- offline-menu:start -->[\s\S]*?<!-- offline-menu:end -->/, '')
    .replace(/<meta name="pococha-app" content="meter-offline-v1">/, '')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/g, '<svg/>');
  const tags = [...body.matchAll(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi)].map(m => m[1]);
  assert.equal(hash(css), expected.cssSha256); assert.equal(hash(JSON.stringify(tags)), expected.tagOrderSha256);
});
