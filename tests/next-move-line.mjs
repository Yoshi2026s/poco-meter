import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, pageEngine, plain } from './calculator-harness.mjs';

// メーター上部の「今の一手」1行（#nextMove）。DOMの代用品での検証で、実機の表示確認ではない。
// 画面の時計は 2026-10-03 21:00 JST から始まる。
const page = (settings = {}, capabilities = {}) => pageEngine({ ...plain(engine().state),
  seedVer: 3, seedVer13: 1, snapshotVersion: '2026-10-02-v3', goalDefaultsVersion: 1,
  target: '1000000', current: '400000', coreCount: '40', deadline: '22:00', ...settings }, capabilities);
const main = p => p.element('nextMoveMain').textContent;
const line = p => ({ textContent: p.element('nextMoveMain').textContent + p.element('nextMoveDetail').textContent, dataset: p.element('nextMove').dataset });

test('N01 必要ペースと締めの日時・残り時間を1行で出す', () => {
  const p = page({ currentSavedAt: Date.parse('2026-10-03T20:59:00+09:00') });
  assert.equal(line(p).textContent, 'あと 600K → 1時間 600K ペース（10/3 22:00締め・残り1時間0分）');
  assert.equal(line(p).dataset.tone, '');
});
test('N02 0時締めは前日の24:00と表示する', () => {
  const p = page({ deadline: '00:00', currentSavedAt: Date.parse('2026-10-03T20:59:00+09:00') });
  assert.match(line(p).textContent, /（10\/3 24:00締め・残り3時間0分）$/);
});
test('N03 締め30分以内は急ぎの表示に切り替える', () => {
  const p = page({ currentSavedAt: Date.parse('2026-10-03T20:59:00+09:00') });
  p.setNow('2026-10-03T21:50:00+09:00'); p.tick(1000);
  assert.match(line(p).textContent, /^締め10分前・あと 600K（10\/3 22:00締め）$/); assert.equal(line(p).dataset.tone, 'urgent');
});
test('N04 達成時は達成と締めまでの残りを出す', () => {
  const p = page({ current: '1000000', currentSavedAt: Date.parse('2026-10-03T20:59:00+09:00') });
  assert.equal(line(p).textContent, '目標達成！（10/3 22:00締め・残り1時間0分）'); assert.equal(line(p).dataset.tone, 'done');
});
test('N05 目標未設定では入力を促す', () => {
  const p = page({ target: '', current: '0' });
  assert.equal(line(p).textContent, '目標値を入れると必要ペースを表示（10/3 22:00締め・残り1時間0分）');
});
test('N06 締めを過ぎた古い現在値は入れ直しを最優先で促す', () => {
  const p = page({ currentSavedAt: Date.parse('2026-10-03T20:59:00+09:00') });
  p.setNow('2026-10-03T22:05:00+09:00'); p.tick(1000);
  assert.equal(line(p).textContent, '締め後です：現在値を入れ直して（Pocochaの現在値を確認。次は10/4 22:00締め）'); assert.equal(line(p).dataset.tone, 'warn');
});
test('N07 オフライン中は保存済みボーダーで計算していることを添える', () => {
  const p = page({ currentSavedAt: Date.parse('2026-10-03T20:59:00+09:00') }, { navigator: { onLine: false } });
  assert.match(main(p), / ／ オフライン$/); assert.match(line(p).textContent, / 保存済みボーダーで計算$/); assert.equal(line(p).dataset.tone, 'warn');
});
test('N09 小さい画面で出す本文は短い1行に収まる長さ', () => {
  const p = page({ currentSavedAt: Date.parse('2026-10-03T20:59:00+09:00') });
  assert.equal(main(p), 'あと 600K → 1時間 600K ペース');
});
test('N08 1行の表示は保存データを変えない', () => {
  const p = page({ currentSavedAt: Date.parse('2026-10-03T20:59:00+09:00') });
  const before = p.stored.get('pococha-meter-calc-v1'); p.tick(1000);
  assert.equal(p.stored.get('pococha-meter-calc-v1'), before);
});
