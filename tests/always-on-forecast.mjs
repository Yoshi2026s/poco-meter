// 常時表示パネルの予想ボーダー（画面に載る meterForecast・forecastDayISO）を、実際の画面スクリプトから取り出して検証する。
import assert from 'node:assert/strict';
import {engine, pageEngine, html} from './calculator-harness.mjs';
import {forecastBundle} from '../automation/build-meter-factors.mjs';

const e = engine('2026-11-12T14:00:00+09:00');
const log = {};
// 11/1〜11/11：S2 の ±0 は 100,000 固定、+1 は 200,000 固定。11/5 は欠損。
for (let d = 1; d <= 11; d++) if (d !== 5) log[`2026-11-${String(d).padStart(2, '0')}`] = {S2: [100000, 200000, 300000]};

// 予想データ無し：直近の中央値をそのまま出す
{
  const f = e.meterForecast(log, '2026-11-12', 'S2', 0, '24', null);
  assert.equal(f.status, 'ok'); assert.equal(f.value, 100000); assert.equal(f.n, 10); assert.equal(f.low, null);
  assert.equal(e.meterForecast(log, '2026-11-12', 'S2', 1, '24', null).value, 200000);
}
// 記録が5日未満なら出さない（欠損を0で埋めない）
{
  const few = {'2026-11-10': {S2: [1, 1, 1]}, '2026-11-11': {S2: [1, 1, 1]}, '2026-11-09': {S2: [0, 0, 0]}};
  assert.deepEqual({...e.meterForecast(few, '2026-11-12', 'S2', 0, '24', null)}, {status: 'no-base', n: 2});
}
// 補正：曜日（ランク別を優先）×暦×大型イベント。幅は締め時間全体の曜日の p25・p75。
{
  const bundle = {
    weekday: {'24': {'木': {pct: -1.1, p25: -11.6, p75: 3.7}}},
    weekdayByRank: {'24': {S2: {'木': -0.6}}},
    calendar: {'24': {'payday10-next': {pct: 1.2, label: '10日払いの翌日'}}},
    event: {'24': {middle: {pct: 0.2}, last: {pct: 1.7}}},
    days: {'2026-11-12': {tags: ['payday10-next'], events: [{type: 'big', ranks: ['S2'], phase: 'last'}, {type: 'collab', ranks: ['S2'], phase: 'last'}]}},
  };
  const f = e.meterForecast(log, '2026-11-12', 'S2', 0, '24', bundle);
  const ratio = (1 - 0.006) * 1.012 * 1.017;
  assert.ok(Math.abs(f.value - 100000 * ratio) < 1e-6);
  assert.deepEqual([...f.reasons.map(r => r.label)], ['木曜日', '10日払いの翌日', '大型イベント最終日']);
  assert.ok(Math.abs(f.low - f.value * (1 - 0.116)) < 1e-6 && Math.abs(f.high - f.value * 1.037) < 1e-6);
  assert.equal(f.inRange, true);
  // 対象ランク外の大型イベントは補正しない
  const a1 = e.meterForecast({...Object.fromEntries(Object.entries(log).map(([d]) => [d, {A1: [50000, 1, 1]}]))}, '2026-11-12', 'A1', 0, '24', bundle);
  assert.deepEqual([...a1.reasons.map(r => r.label)], ['木曜日', '10日払いの翌日']);
}
assert.equal(e.forecastTrend(0.4), '普段どおり');
assert.equal(e.forecastTrend(2), 'やや高め ↑');
assert.equal(e.forecastTrend(-3.5), '低め ↓');

// 予想する日：24時締めは当日、13時締めは13時を過ぎたら翌日分
{
  e.state.deadline = '00:00'; assert.equal(e.forecastDayISO(Date.parse('2026-11-12T14:00:00+09:00')), '2026-11-12');
  e.state.deadline = '13:00'; assert.equal(e.forecastDayISO(Date.parse('2026-11-12T14:00:00+09:00')), '2026-11-13');
  assert.equal(e.forecastDayISO(Date.parse('2026-11-12T12:59:00+09:00')), '2026-11-12');
  e.state.deadline = '22:00'; assert.equal(e.forecastDayISO(Date.parse('2026-11-12T22:30:00+09:00')), '2026-11-13');
}

// 公開用の予想データ：insufficient を除き、日ごとの暦タグとイベントを持つ
{
  const factors = {generatedAt: 'x', coverage: {}, weekday: {'24': {'木': {pct: -1, p25: -5, p75: 4, days: 90}, '金': {pct: 9, days: 3, status: 'insufficient'}}},
    weekdayByRank: {'24': {S2: {'木': {pct: -0.6, n: 300, days: 90}, '金': {n: 0, status: 'insufficient'}}}},
    calendar: {'24': {'payday25-actual': {pct: -1.2, days: 22, label: '25日払いの実支給日'}, christmas: {pct: 3, days: 2, status: 'insufficient'}}},
    event: {'24': {'big-last': {pct: 1.7, days: 31}}}};
  const events = {events: [{title: '🌟POCO LAND', url: 'u', type: 'big', confidence: 'high', ranks: ['S2'], periods: [{start: '2026-11-07', end: '2026-11-29', ranks: []}]},
    {title: '記事のみ', url: 'v', type: 'notice', confidence: 'none', periods: []}]};
  const b = forecastBundle(factors, events, '2026-11-12', {before: 1, after: 20});
  assert.deepEqual(Object.keys(b.weekday['24']), ['木']);
  assert.deepEqual(b.weekdayByRank['24'].S2, {'木': -0.6});
  assert.deepEqual(Object.keys(b.calendar['24']), ['payday25-actual']);
  assert.deepEqual(Object.keys(b.days).length, 22);
  assert.equal(b.days['2026-11-12'].events[0].phase, 'middle');
  assert.deepEqual(b.days['2026-11-12'].events[0].ranks, ['S2']);
  assert.equal(b.days['2026-11-29'].events[0].phase, 'last');
  assert.equal(b.days['2026-11-30'].events.length, 0);
}

// 画面：入口ボタンとパネルがあり、初期表示ではパネルは閉じている。ページ初期化を通しても壊れない。
assert.match(html, /id="alwaysOnOpen"[^>]*>常時表示パネル</);
assert.match(html, /<div class="always-on" id="alwaysOn" role="dialog" aria-modal="true"[^>]*hidden>/);
// 初めて開いた端末でボーダー読込中の間は「記録0日分」ではなく読込中と出す
assert.ok(html.includes("if(f.status!=='ok'&&liveBorderBusy){aoSet('aoForecast','読込中…')"));
{
  const page = pageEngine(undefined);
  assert.ok(page, 'ページ初期化（パネルの登録を含む）が例外なく終わる');
}
console.log('always-on-forecast ok');
