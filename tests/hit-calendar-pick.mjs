import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, pageEngine, plain } from './calculator-harness.mjs';

// 的中率カレンダーの中でランク帯・ボーダー・締め時間を切り替えると、その系列の数値に変わる（メイン画面の設定は変えない）。
// 代用品の textContent='' は子要素を消さないため、最後に描いた31日分を見る。DOMの代用品での検証で、実機の表示確認ではない。画面の時計は 2026-10-03 21:00 JST から始まる。
const hist = close => ({ schema: 'poco-meter-forecast-history-v2', close, from: '2026-10-01', to: '2026-10-02', unit: 0.1,
  dates: ['2026-10-01', '2026-10-02'],
  series: { 'S2|0': close === '22' ? [50, -150] : [10, 20], 'A1|0': close === '22' ? [-30, 40] : [300, 310], 'S2|1': [-90, 120] } });
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
async function openPage() {
  const urls = [];
  const p = pageEngine({ ...plain(engine().state), seedVer: 3, seedVer13: 1, snapshotVersion: '2026-10-02-v3', goalDefaultsVersion: 1,
    target: '1000000', current: '0', deadline: '22:00', rank: 'S2', analysisBorder: 0, pick: 0 },
    { fetch: async url => { urls.push(url); const m = String(url).match(/forecast-history-(\d+)\.json/); if (!m) return { ok: false, status: 404 };
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => hist(m[1]) }; } });
  const cal = p.element('hitCalendar'); cal.open = true; cal.dispatchEvent(new Event('toggle')); await flush(); p.tick(1000);
  return { p, urls };
}
const change = (p, id, value) => { p.element(id).value = value; p.element(id).dispatchEvent(new Event('change')); };
const sum = p => p.element('hitCalSummary').textContent;
const cells = p => p.element('hitCalGrid').childNodes.filter(n => /ao-cal-day/.test(n.className)).slice(-31).slice(0, 2).map(n => n.childNodes.at(-1).textContent);

test('C01 開いたときはメイン画面のランク・ボーダー・締め時間で表示する', async () => {
  const { p } = await openPage();
  assert.equal(p.element('hitCalRank').value, 'S2'); assert.equal(p.element('hitCalBorder').value, '0'); assert.equal(p.element('hitCalClose').value, '22');
  assert.match(sum(p), /^S2 ±0・22時締め：±10%以内 1\/2日/); assert.deepEqual(cells(p), ['+5%', '-15%']);
});
test('C02 ランク帯を切り替えるとその系列の数値に変わり、メイン画面の設定は変えない', async () => {
  const { p } = await openPage();
  const before = p.stored.get('pococha-meter-calc-v1');
  change(p, 'hitCalRank', 'A1'); await flush();
  assert.match(sum(p), /^A1 ±0・22時締め/); assert.deepEqual(cells(p), ['-3%', '+4%']);
  assert.equal(p.stored.get('pococha-meter-calc-v1'), before); assert.equal(p.element('rank').value, 'S2');
});
test('C03 締め時間を切り替えるとその締めの履歴を読み、数値が変わる', async () => {
  const { p, urls } = await openPage();
  change(p, 'hitCalRank', 'A1'); change(p, 'hitCalClose', '13'); await flush(); p.tick(1000); await flush();
  assert.ok(urls.some(u => /forecast-history-13\.json/.test(u)));
  assert.match(sum(p), /^A1 ±0・13時締め：±10%以内 0\/2日/); assert.deepEqual(cells(p), ['+30%', '+31%']);
});
test('C04 ボーダーを切り替えるとその系列の数値に変わる', async () => {
  const { p } = await openPage();
  change(p, 'hitCalBorder', '1'); await flush();
  assert.match(sum(p), /^S2 \+1・22時締め/); assert.deepEqual(cells(p), ['-9%', '+12%']);
});
test('C05 メイン画面の設定を変えたらカレンダーもそれに合わせ直す', async () => {
  const { p } = await openPage();
  change(p, 'hitCalRank', 'A1'); await flush();
  change(p, 'rank', 'S1'); p.tick(1000);
  assert.equal(p.element('hitCalRank').value, 'S1'); assert.match(sum(p), /^S1 ±0・22時締め/);
});
