import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, pageEngine, plain } from './calculator-harness.mjs';

// 現在値の読み取り表示・桁違い／減少の確認・メッセージ内の「取り消し」。
// DOMの代用品での検証で、実機の表示確認ではない。
const key = 'pococha-meter-calc-v1';
const page = (settings = {}, capabilities = {}) => pageEngine({ ...plain(engine().state),
  seedVer: 3, seedVer13: 1, snapshotVersion: '2026-10-02-v3', goalDefaultsVersion: 1,
  target: '5000000', current: '0', coreCount: '40', ...settings }, capabilities);
const saved = p => JSON.parse(p.stored.get(key));
const input = (p, id, value) => { p.element(id).value = value; p.element(id).dispatchEvent(new Event('input')); };
const press = (p, id) => p.element(id).dispatchEvent({ type: 'keydown', key: 'Enter', keyCode: 13, isComposing: false, preventDefault() {} });
const undoButton = msg => msg.childNodes.find(node => node.className === 'msg-undo');

test('C01 入力中に読み取った値を表示する', () => {
  const p = page(); p.element('currentMini').focus(); input(p, 'currentMini', '123.4万');
  assert.match(p.element('miniActionMsg').textContent, /^読み取り：1,234,000 pt（約123\.4万）$/);
  input(p, 'currentMini', ''); assert.equal(p.element('miniActionMsg').textContent, '');
});
test('C02 確認不要な確定では読み取り表示を消す', () => {
  const p = page({ current: '100000' }); p.element('currentMini').focus(); input(p, 'currentMini', '150K'); press(p, 'currentMini');
  assert.equal(saved(p).current, '150000'); assert.equal(p.element('miniActionMsg').textContent, '');
});
test('C03 前回の10倍以上は桁の確認を出し、値は書き換えない', () => {
  const p = page({ current: '100000' }); p.element('currentMini').focus(); input(p, 'currentMini', '1000000'); press(p, 'currentMini');
  const msg = p.element('miniActionMsg');
  assert.equal(saved(p).current, '1000000'); assert.match(msg.textContent, /桁を確認：前回 100,000 ptの10倍以上/); assert.match(msg.className, /warn/);
  const b = undoButton(msg); assert.ok(b); assert.equal(b.textContent, '取り消し');
  b.onclick(); assert.equal(saved(p).current, '100000'); assert.equal(p.element('currentMini').value, '100,000');
});
test('C04 前回より少ない値は確認を出す（サブメニューの入力欄）', () => {
  const p = page({ current: '500000' }); p.element('currentTop').focus(); input(p, 'currentTop', '50000'); press(p, 'currentTop');
  const msg = p.element('currentActionMsg');
  assert.equal(saved(p).current, '50000'); assert.match(msg.textContent, /前回 500,000 ptより少ない値/); assert.equal(msg.className, 'toast warn');
  undoButton(msg).onclick(); assert.equal(saved(p).current, '500000');
});
test('C05 前回0・今回0・同じ値では確認を出さない', () => {
  for (const [before, after] of [['0', '9999999'], ['500000', '0'], ['500000', '500K']]) {
    const p = page({ current: before }); p.element('currentMini').focus(); input(p, 'currentMini', after); press(p, 'currentMini');
    assert.doesNotMatch(p.element('miniActionMsg').textContent, /確認/, `${before}→${after}`);
  }
});
test('C06 ＋ボタン後のメッセージに取り消しがあり、短く振動する', () => {
  const calls = []; const p = page({ current: '1000' }, { navigator: { vibrate: ms => { calls.push(ms); return true; } } });
  p.element('miniAdd100k').click();
  const msg = p.element('miniActionMsg'); assert.equal(saved(p).current, '101000'); assert.deepEqual(calls, [12]);
  const b = undoButton(msg); assert.ok(b); b.onclick(); assert.equal(saved(p).current, '1000'); assert.match(msg.textContent, /直前の値に戻しました/);
});
test('C07 変化がない操作では取り消しも振動も出さない', () => {
  const calls = []; const p = page({ current: '0' }, { navigator: { vibrate: ms => { calls.push(ms); return true; } } });
  p.element('miniSub1k').click(); assert.equal(saved(p).current, '0'); assert.equal(calls.length, 0); assert.equal(undoButton(p.element('miniActionMsg')), undefined);
});
test('C08 振動に対応しない端末でも操作できる', () => {
  const p = page({ current: '1000' }); p.element('miniAdd1k').click(); assert.equal(saved(p).current, '2000');
});
