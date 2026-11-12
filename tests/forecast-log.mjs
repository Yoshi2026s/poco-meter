// 日々の予想と実際の記録（automation/record-forecast.mjs）の最小テスト。ネットワーク不要。
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recordForecasts, closeEnd, summarize, LOG_SCHEMA} from '../automation/record-forecast.mjs';
import {forecastBundle} from '../automation/build-meter-factors.mjs';
import {engine} from './calculator-harness.mjs';

const html = readFileSync(new URL('../calculator/index.html', import.meta.url), 'utf8');
// 11/1〜11/11：S2 の ±0 は 100,000、+1 は 200,000、+2 は 300,000（22時締め）
const records = [];
for (let d = 1; d <= 11; d++) records.push({date: `2026-11-${String(d).padStart(2, '0')}`, close: '22', ranks: {S2: [100000, 200000, 300000], E: [10, 20, 30]}});
const borders = {records};
const factors = {generatedAt: '2026-11-11T20:00:00.000Z', weekday: {}};

// 締めの時刻：22時締めはその日22時、24時締めは翌0時（JST）
assert.equal(closeEnd('2026-11-12', '22'), Date.parse('2026-11-12T22:00:00+09:00'));
assert.equal(closeEnd('2026-11-12', '24'), Date.parse('2026-11-13T00:00:00+09:00'));

// 1回目（11/12 05:00）：最新日の翌日（11/12）を予想して記録。E帯は対象外。
const first = recordForecasts({borders, events: null, factors, backtest: null, html, log: null, now: Date.parse('2026-11-12T05:00:00+09:00')});
assert.deepEqual(first.added, ['2026-11-12|22']);
const entry = first.log.entries['2026-11-12|22'];
assert.equal(first.log.schema, LOG_SCHEMA);
assert.deepEqual(entry.forecasts.S2.map(f => f[0]), [100000, 200000, 300000], '一定値の系列は同じ値を予想');
assert.equal(entry.forecasts.E, undefined);
assert.equal(entry.actual, null);

// 同じ日の2回目（17:00）：記録済みの予想は書き換えない
const again = recordForecasts({borders, events: null, factors: {...factors, generatedAt: 'x'}, backtest: null, html, log: first.log, now: Date.parse('2026-11-12T17:00:00+09:00')});
assert.deepEqual(again.added, []);
assert.equal(again.log.entries['2026-11-12|22'].dataGeneratedAt, factors.generatedAt);

// 締めを過ぎてから初めて動いたときは、その日を記録しない
const late = recordForecasts({borders, events: null, factors, backtest: null, html, log: null, now: Date.parse('2026-11-12T22:30:00+09:00')});
assert.deepEqual(late.added, []);

// 翌朝：11/12 の結果が入ったら答え合わせし、11/13 を新しく記録。欠損（0）は答え合わせから外す。
const next = {records: [...records, {date: '2026-11-12', close: '22', ranks: {S2: [110000, 0, 270000]}}]};
const second = recordForecasts({borders: next, events: null, factors, backtest: null, html, log: first.log, now: Date.parse('2026-11-13T05:00:00+09:00')});
assert.deepEqual(second.checked, ['2026-11-12|22']);
assert.deepEqual(second.added, ['2026-11-13|22']);
assert.deepEqual(second.log.entries['2026-11-12|22'].actual.S2, [110000, null, 270000]);
const s = second.log.summary;
assert.equal(s.checkedDays, 1); assert.equal(s.firstDate, '2026-11-12');
assert.equal(s.overall.n, 2, '欠損を除いた2件');
assert.equal(s.overall.within10, 100, '+10%と-10%はどちらも±10%以内');
assert.equal(s.bySeries['22|S2|0'].n, 1);
assert.deepEqual(summarize({}, '2026-11-13').overall, {n: 0});

// 公開用の予想データには、直近の答え合わせ済みの記録と集計だけが入る
const bundle = forecastBundle(factors, null, '2026-11-13', {before: 0, after: 0, log: second.log});
assert.equal(bundle.record.recent.length, 1);
assert.equal(bundle.record.recent[0].date, '2026-11-12');
assert.equal(bundle.record.bySeries['22|S2|0'].within10, 100);

// パネルの表示：前回の答え合わせと、記録開始からの的中
const e = engine('2026-11-13T12:00:00+09:00');
const text = e.aoRecordText(bundle, '22', 'S2', 0, '2026-11-13');
assert.match(text, /前回の答え合わせ（11\/12）：予想 100K → 実際 110K（\+10%・±10%以内）/);
assert.match(text, /日々の記録（11\/12〜・1日）：±10%以内 100%/);
assert.equal(e.aoRecordText(bundle, '22', 'S2', 1, '2026-11-13'), '', '欠損の系列は表示しない');
assert.match(e.aoRecordText({record: {firstDate: null, recent: [], bySeries: {}}}, '22', 'S2', 0, '2026-11-13'), /記録を始めました/);
assert.equal(e.aoRecordText(null, '22', 'S2', 0, '2026-11-13'), '');
// 予想データが36時間を超えて古いか
assert.equal(e.forecastDataStale({generatedAt: '2026-11-11T00:00:00Z'}, Date.parse('2026-11-13T00:00:00Z')), true);
assert.equal(e.forecastDataStale({generatedAt: '2026-11-12T12:00:00Z'}, Date.parse('2026-11-13T00:00:00Z')), false);
console.log('forecast-log ok');
