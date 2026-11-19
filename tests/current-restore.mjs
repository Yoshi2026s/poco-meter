import test from 'node:test';
import assert from 'node:assert/strict';
import { pageEngine } from './calculator-harness.mjs';

// スマホで開くたびに現在値を0から始める仕様は変えず、同じ締めまでの前回入力を「前回値に戻す」で戻せること。
// DOMの代用品での検証で、実機の表示確認ではない。画面の時計は 2026-10-03 21:00 JST から始まる。
const KEY = 'pococha-meter-calc-v1', RESTORE = 'pococha-meter-current-restore-v1';
const phone = { matchMedia: q => ({ matches: /max-width:700px/.test(q) }) };
const at = Date.parse('2026-10-03T21:00:00+09:00');
const saved = (savedAt, current = '160000') => ({ target: '500000', current, currentSavedAt: savedAt, deadline: '22:00' });
const restoreButton = p => p.element('miniActionMsg').childNodes.find(node => node.id === 'restoreLastCurrent');
const memory = (entries) => { const m = new Map(entries); return { m, localStorage: { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) } }; };

test('R01 スマホ起動は0から始め、同じ締めまでの前回入力を戻せる', () => {
  const p = pageEngine(saved(at - 30 * 60e3 + 30e3), phone);
  assert.equal(p.element('currentMini').value, '0');
  assert.match(p.element('miniActionMsg').textContent, /^前回 160,000 pt（20:30入力）/);
  assert.equal(p.element('miniUndoCurrent').disabled, false);
  restoreButton(p).onclick();
  assert.equal(p.element('currentMini').value, '160,000');
  const s = JSON.parse(p.stored.get(KEY));
  assert.equal(s.current, '160000'); assert.equal(s.currentSavedAt, at - 30 * 60e3 + 30e3, '入力時刻も前回のものに戻す');
});
test('R02 前の締めの値は戻す候補にしない', () => {
  const p = pageEngine(saved(at - 25 * 3600e3), phone);
  assert.equal(p.element('currentMini').value, '0');
  assert.equal(p.element('miniActionMsg').textContent, '');
  assert.equal(p.element('miniUndoCurrent').disabled, true);
});
test('R03 何も入れずに開き直しても、同じ締めの間は前回入力を戻せる', () => {
  const first = memory([[KEY, JSON.stringify(saved(at - 30 * 60e3 + 30e3))]]);
  pageEngine(undefined, { ...phone, localStorage: first.localStorage });
  assert.equal(JSON.parse(first.m.get(KEY)).current, '0');
  const p = pageEngine(undefined, { ...phone, localStorage: first.localStorage });
  assert.match(p.element('miniActionMsg').textContent, /^前回 160,000 pt（20:30入力）/);
  restoreButton(p).onclick();
  assert.equal(JSON.parse(first.m.get(KEY)).current, '160000');
});
test('R04 0の前回入力や壊れた候補は使わない', () => {
  const zero = pageEngine(saved(at - 30 * 60e3, '0'), phone);
  assert.equal(zero.element('miniActionMsg').textContent, '');
  const bad = memory([[KEY, JSON.stringify(saved(at - 30 * 60e3, '0'))], [RESTORE, '{"version":1,"value":"-5","savedAt":1}']]);
  const p = pageEngine(undefined, { ...phone, localStorage: bad.localStorage });
  assert.equal(p.element('miniActionMsg').textContent, '');
});
test('R05 PC幅では従来どおり前回値を残し、候補も出さない', () => {
  const p = pageEngine(saved(at - 30 * 60e3 + 30e3));
  assert.equal(p.element('current').value, '160,000');
  assert.equal(p.element('miniActionMsg').textContent, '');
  assert.equal(p.stored.has(RESTORE), false);
});
test('R06 案内は10秒で消え、その後も「戻す」で前回入力に戻せる', () => {
  const p = pageEngine(saved(at - 30 * 60e3 + 30e3), phone);
  p.flushTimers(10000);
  assert.equal(p.element('miniActionMsg').textContent, '');
  assert.equal(p.element('miniUndoCurrent').disabled, false);
  p.element('miniUndoCurrent').onclick();
  assert.equal(p.element('currentMini').value, '160,000');
  assert.equal(JSON.parse(p.stored.get(KEY)).current, '160000');
});
