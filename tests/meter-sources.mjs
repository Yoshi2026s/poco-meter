// メーター予想の情報源（イベント収集・補正値の集計）の最小テスト。ネットワーク不要。
import assert from 'node:assert/strict';
import {findPeriods, findRanks, classify} from '../automation/collect-events.mjs';
import {paydayOf, calendarTags, buildFactors} from '../automation/build-meter-factors.mjs';

// 期間：年あり・年なし・同日の時刻範囲・「より開催」・エントリ期間の区別
{
  const p = findPeriods('📅 開催期間：2026年10月9日(金) 12:00 〜 2026年10月13日(火) 23:59\n🏃 エントリ期間：2026年9月28日(月) 16:00 〜 2026年10月3日(土) 1:59', '2026-10-01T00:00:00+09:00');
  assert.deepEqual(p.map(x => [x.start, x.end, x.isEntry]), [['2026-10-09', '2026-10-13', false], ['2026-09-28', '2026-10-03', true]]);
  assert.equal(p[0].startTime, '12:00'); assert.equal(p[0].endTime, '23:59'); assert.equal(p[0].labeled, true);
  const q = findPeriods('👑 プレミアリーグ（S6〜B1）：2026年10月19日(月) 0:00 〜 23:59', '2026-10-01');
  assert.deepEqual([q[0].start, q[0].end], ['2026-10-19', '2026-10-19']);
  assert.ok(q[0].ranks.includes('S6') && q[0].ranks.includes('B1') && !q[0].ranks.includes('C3'));
  const r = findPeriods('2026年11月13日（金）より開催される「3色対抗 世代ウォーズ」。', '2026-11-10');
  assert.deepEqual([r[0].start, r[0].end], ['2026-11-13', null]);
  const y = findPeriods('開催期間：12/28(月)〜1/3(日)', '2026-12-01');
  assert.deepEqual([y[0].start, y[0].end], ['2026-12-28', '2027-01-03']);
}
// ランク：範囲・E帯を端にした範囲・「Aランク」・全ランク
assert.deepEqual(findRanks('C3〜E1'), ['D1', 'D2', 'D3', 'C1', 'C2', 'C3']);
assert.deepEqual(findRanks('対象：Aランク'), ['A1', 'A2', 'A3']);
assert.equal(findRanks('全ランク対象').length, 18);
assert.equal(classify('POCO LAND 2026 開催', ''), 'big');
assert.equal(classify('夏の熱狂をふたたび。「Pococha甲子園 2026」 開催決定！', ''), 'big');
assert.notEqual(classify('【ポコガチャ1周年企画】オリジナルきせかえアイテムコンテスト', ''), 'big');
assert.notEqual(classify('リアル花火大会を配信画面で楽しもう', ''), 'big');
assert.equal(classify('【全ミッション一覧】 10月差し入れお届けミッション', ''), 'mission');

// 給料日：土日祝なら前の営業日（2026-01-10 は土曜 → 1/9 金、2026-05-05 は祝日だが 5日払いは対象外）
assert.equal(paydayOf(2026, 1, 10), '2026-01-09');
assert.equal(paydayOf(2026, 10, 25), '2026-10-23'); // 25日が日曜
assert.equal(paydayOf(2026, 11, 20), '2026-11-20'); // 金曜
assert.ok(calendarTags('2026-10-23').includes('payday25-actual'));
assert.ok(calendarTags('2026-10-24').includes('payday25-next'));
assert.ok(calendarTags('2026-10-25').includes('payday25'));

// 集計：曜日で値が違う合成データで、曜日の補正の向きが合うこと。欠損（0）は使わないこと。
{
  const records = [];
  for (let t = Date.parse('2025-01-01'); t <= Date.parse('2025-06-30'); t += 864e5) {
    const d = new Date(t).toISOString().slice(0, 10), w = new Date(t).getUTCDay();
    const base = w === 6 ? 110 : 100;
    records.push({date: d, close: '24', ranks: {A1: [base * 1000, base * 2000, base * 3000], B1: [0, 0, 0]}});
  }
  const f = buildFactors({records}, null);
  assert.ok(f.weekday['24']['土'].pct > 5, '土曜が高い');
  assert.equal(f.weekday['24']['水'].pct, 0, '平日は普段どおり（中央値なので土曜の影響を受けない）');
  assert.equal(f.weekdayByRank['24'].B1['土'].n, 0, '0は欠損扱い');
  assert.equal(f.calendar['24'].christmas.status, 'insufficient');
}
console.log('meter-sources ok');
