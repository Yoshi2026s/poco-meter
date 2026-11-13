// 通常表示の予想・イベントカード（旧 常時表示パネル）の予想ボーダー（画面に載る meterForecast・forecastDayISO）を、実際の画面スクリプトから取り出して検証する。
import assert from 'node:assert/strict';
import {engine, pageEngine, html} from './calculator-harness.mjs';
import {forecastBundle} from '../automation/build-meter-factors.mjs';

const e = engine('2026-11-12T14:00:00+09:00');
const log = {};
// 11/1〜11/11：S2 の ±0 は 100,000 固定、+1 は 200,000 固定。11/5 は欠損。
for (let d = 1; d <= 11; d++) if (d !== 5) log[`2026-11-${String(d).padStart(2, '0')}`] = {S2: [100000, 200000, 300000]};

// 予想データ無し：基準値をそのまま出す（S帯：一定値ならその値）
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
// 補正：締め時間×ランク帯の model のうち、use* が真のものだけ掛ける。幅は model の p25・p75。
{
  const bundle = {
    model: {'24': {S: {useWeekday: true, weekday: {'木': -0.6}, useCalendar: true, calendar: {'payday10-next': {pct: 1.2, label: '10日払いの翌日'}}, useEvent: true, event: {middle: 0.2, last: 1.7}, p25: -11.6, p75: 3.7},
      A: {useWeekday: false, weekday: {'木': 50}, useCalendar: true, calendar: {'payday10-next': {pct: 1.2, label: '10日払いの翌日'}}, useEvent: false, p25: -5, p75: 4}}},
    days: {'2026-11-12': {tags: ['payday10-next'], events: [{type: 'big', ranks: ['S2'], phase: 'last'}, {type: 'collab', ranks: ['S2', 'A1'], phase: 'last'}]}},
  };
  const f = e.meterForecast(log, '2026-11-12', 'S2', 0, '24', bundle);
  const ratio = (1 - 0.006) * 1.012 * 1.017;
  assert.ok(Math.abs(f.value - 100000 * ratio) < 1e-6);
  assert.deepEqual([...f.reasons.map(r => r.label)], ['木曜日', '10日払いの翌日', '大型イベント最終日']);
  assert.ok(Math.abs(f.low - f.value * (1 - 0.116)) < 1e-6 && Math.abs(f.high - f.value * 1.037) < 1e-6);
  assert.equal(f.inRange, true);
  // 使わない補正（A帯の曜日）と、大型でないイベントは掛けない
  const a1 = e.meterForecast({...Object.fromEntries(Object.entries(log).map(([d]) => [d, {A1: [50000, 1, 1]}]))}, '2026-11-12', 'A1', 0, '24', bundle);
  assert.deepEqual([...a1.reasons.map(r => r.label)], ['10日払いの翌日']);
  assert.ok(Math.abs(a1.low - a1.value * 0.95) < 1e-6);
}
// 基準値：D帯は直近ほど重い指数加重平均、それ以外は指数加重中央値（前日まで最大42日）
{
  const vals = [130, null, 100, 100, 100, 100, 100]; // [0]=前日
  const d = e.forecastBase(vals, 'D1', 0);
  let ex = 100; for (const x of [100, 100, 100, 100, 100, 130]) ex = 0.5 * x + 0.5 * ex; // 古い順に初期値=最古7件の中央値から
  assert.ok(Math.abs(d - ex) < 1e-9, 'D帯は前日の跳ねに強く寄る');
  assert.equal(e.forecastBase(vals, 'S2', 1), 100, 'S2の+1は外れ値1日に引っぱられない');
  assert.equal(e.forecastBase([200, 200, 100, 100, 100], 'A1', 1), 100);
  assert.equal(e.forecastBase([null, null], 'C1', 0), null);
  // S6は直近重視（α0.5）、S1〜S5の±0はやや直近重視（α0.3）、S帯の+1・+2はゆっくり（α0.05）
  assert.equal(e.forecastBase([200, 200, 100, 100, 100], 'S6', 2), 200);
  assert.equal(e.forecastBase([200, 200, 100, 100, 100], 'S2', 0), 200);
  assert.equal(e.forecastBase([200, 200, 100, 100, 100], 'S2', 1), 100);
  assert.equal(e.forecastBase([200, 200, 100, 100, 100], 'A1', 0), 100, 'A帯の±0は変えない');
  const dlog = {}; for (let d2 = 1; d2 <= 11; d2++) dlog[`2026-11-${String(d2).padStart(2, '0')}`] = {D1: [d2 === 11 ? 4000 : 2000, 1, 1]};
  const fd = e.meterForecast(dlog, '2026-11-12', 'D1', 0, '24', null);
  assert.equal(fd.method, '指数加重平均'); assert.ok(fd.value > 2900 && fd.value < 3100);
}
// 自信度は10段階：±10%以内の割合を10%刻みで★に（1〜10に収める）
assert.equal(e.forecastStars({within10: 66.1}, {n: 14}), 7);
assert.equal(e.forecastStars({within10: 98}, {n: 14}), 10);
assert.equal(e.forecastStars({within10: 2}, {n: 14}), 1);
assert.equal(e.forecastStars(null, {n: 12}), 3);
assert.equal(e.forecastStars(null, {n: 6}), 2);
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
  // 本日のイベラス：最終日（1日だけの開催も含む）を別に持つ
  assert.equal(b.days['2026-11-29'].lasts.length, 1);
  assert.equal(b.days['2026-11-12'].lasts.length, 0);
  const one = forecastBundle(factors, {events: [{title: '1日', url: 'w', type: 'event', confidence: 'high', ranks: [], periods: [{start: '2026-11-12', end: '2026-11-12', endTime: '23:59', ranks: []}]}]}, '2026-11-12', {before: 0, after: 0});
  assert.equal(one.days['2026-11-12'].lasts[0].endTime, '23:59');
  assert.equal(one.days['2026-11-12'].events[0].ends, true);
  // 答え合わせの要約：締め時間×ランク帯の的中率だけを入れる
  const acc = forecastBundle(factors, events, '2026-11-12', {before: 0, after: 0, backtest: {period: {from: '2026-01-01', to: '2026-11-11'}, overall: {within10: 63, medianAbsErr: 6, n: 9, extra: 1}, byGroup: {'24|S': {within10: 58.5, within20: 75, medianAbsErr: 7.1, inRange: 42, days: 300, n: 5000, bias: 5}}}}).accuracy;
  assert.deepEqual(acc.byGroup['24|S'], {within10: 58.5, within20: 75, medianAbsErr: 7.1, inRange: 42, days: 300, n: 5000});
  assert.equal(e.forecastAccuracy({accuracy: acc}, '24', 'S2', 0).within10, 58.5);
  assert.equal(e.forecastAccuracy({accuracy: acc}, '24', 'A1', 0), null);
  // ランク×ボーダーの的中率があれば優先（30日分未満なら帯の値）
  const acc2 = {...acc, bySeries: {'24|S6|0': {within10: 37.1, medianAbsErr: 17.9, days: 300}, '24|S2|0': {within10: 90, medianAbsErr: 1, days: 10}}};
  assert.equal(e.forecastAccuracy({accuracy: acc2}, '24', 'S6', 0).within10, 37.1);
  assert.equal(e.forecastAccuracy({accuracy: acc2}, '24', 'S6', 0).scope, 'series');
  assert.equal(e.forecastAccuracy({accuracy: acc2}, '24', 'S2', 0).within10, 58.5);
  const accB = forecastBundle(factors, events, '2026-11-12', {before: 0, after: 0, backtest: {period: {}, overall: {}, byGroup: {}, bySeries: {'24|S6|0': {within10: 37.1, medianAbsErr: 17.9, days: 300, n: 900}}}}).accuracy;
  assert.deepEqual(accB.bySeries['24|S6|0'], {within10: 37.1, medianAbsErr: 17.9, days: 300});
}

// 答え合わせ：画面の meterForecast を取り出して使い、補正値は検証期間より前のデータだけで作る
{
  const {backtest, loadMeterForecast} = await import('../automation/backtest-forecast.mjs');
  assert.equal(typeof loadMeterForecast(html), 'function');
  const records = [];
  for (let t = Date.parse('2025-12-01'); t <= Date.parse('2026-01-20'); t += 864e5) records.push({date: new Date(t).toISOString().slice(0, 10), close: '24', ranks: {A1: [100000, 200000, 300000]}});
  const r = backtest({records}, null, html, {from: '2026-01-01'});
  assert.equal(r.period.trainTo, '2025-12-31');
  assert.equal(r.overall.n, 20 * 3);
  assert.equal(r.overall.within5, 100);
  assert.equal(r.overall.medianAbsErr, 0);
}

// 画面：常時表示パネルは通常表示に統合した。予想・イベントのカードは通常表示（#mini）の中にあり、別画面のパネルは無い。
for (const id of ['mainForecastCard', 'mainEventsCard', 'aoForecast', 'aoAccuracy', 'aoRecord', 'aoLast', 'aoEvents', 'aoTomorrow']) assert.ok(html.includes(`id="${id}"`), id);
assert.ok(html.includes('<h2 class="main-card-head ao-last-head" id="aoLastHead">本日のイベラス（最終日）</h2>'));
assert.ok(!html.includes('id="alwaysOn"') && !html.includes('id="aoCurrentInput"'), '別画面のパネルと二重の現メーター欄は無い');
assert.ok(html.indexOf('id="mini"') < html.indexOf('id="mainForecastCard"') && html.indexOf('id="mainForecastCard"') < html.indexOf('id="mainTools"'), '予想カードは残りアイテムの目安の下・ツールの上');
// 常時表示モード：ボタンで切り替え、上部の帯に終了ボタン。初期表示では帯は隠れている。
assert.match(html, /id="alwaysOnOpen" aria-pressed="false">常時表示モード</);
assert.ok(html.includes('<div class="ao-mode-bar" id="aoModeBar" hidden><span id="aoWake" role="status"></span><button type="button" id="alwaysOnClose">常時表示を終了</button></div>'));
assert.ok(html.includes('html.always-on-mode :is(header.card,#mainTools,#mainSubMenus,#miniGoalMenu,#itemsWindow,footer'));
// 初めて開いた端末でボーダー読込中の間は「記録0日分」ではなく読込中と出す
assert.ok(html.includes("if(f.status!=='ok'&&liveBorderBusy){aoSet('aoForecast','読込中…')"));
{
  const page = pageEngine(undefined);
  assert.ok(page, 'ページ初期化（予想・イベントのカードを含む）が例外なく終わる');
}
// イベントの表示名と内容：見出しを優先（「開催期間」等は外す）し、種類と対象を添える
assert.equal(e.aoEventName({title: 'POCO LAND 10周年祭 開催決定！', label: 'ポコキャラバン10周年祭 開催期間'}), 'ポコキャラバン10周年祭');
assert.equal(e.aoEventName({title: 'POCO LAND 10周年祭 開催決定！', label: 'POCO LAND 10周年祭'}), 'POCO LAND 10周年祭');
assert.match(e.aoEventName({title: '＼新規ライバー限定イベント／『Kimono MUSE』創刊号専属モデル選抜イベント#2', label: '準決勝'}), /^Kimono MUSE 準決勝$/);
assert.match(e.aoEventName({title: '【予告】『ar』年間モデルオーディション', label: '決勝'}), /^ar 決勝$/);
assert.equal(e.aoEventKind({type: 'big', audience: ['ボイス']}), '・大型イベント・ボイス');
assert.equal(e.aoEventKind({type: 'newcomer', audience: ['新規ライバー']}), '・新規ライバー向け');
// 別の記事に載った同じイベント（名前と期間が同じ）は1件にまとめる
{
  const evs = {events: [
    {title: 'A記事', url: 'a', type: 'event', confidence: 'high', ranks: [], periods: [{start: '2026-11-12', end: '2026-11-14', label: '冬祭り 開催期間', ranks: []}]},
    {title: 'B記事', url: 'b', type: 'event', confidence: 'high', ranks: [], periods: [{start: '2026-11-12', end: '2026-11-14', label: '冬祭り', ranks: []}]}]};
  const b2 = forecastBundle({weekday: {}}, evs, '2026-11-12', {before: 0, after: 2});
  assert.equal(b2.days['2026-11-12'].events.length, 1);
  assert.equal(b2.days['2026-11-14'].lasts.length, 1);
}
// スマホ幅の起動：通常は現メーターを0から始める。常時表示モード（#always-on）のまま読み込み直したときは、
// 同じ締め時間の区切りで保存した現メーターを残す（前の区切りの値は残さない）。
{
  const phone = {matchMedia: q => ({matches: /max-width:700px/.test(q)})};
  const at = Date.parse('2026-10-03T21:00:00+09:00');
  const saved = (savedAt) => ({target: '500000', current: '160000', currentSavedAt: savedAt, deadline: '22:00'});
  const loc = hash => ({hash, pathname: '/', search: ''});
  const kept = pageEngine(saved(at - 30 * 60e3), {...phone, location: loc('#always-on')});
  assert.equal(kept.element('current').value, '160,000', 'パネルを開いたまま読み込み直すと現メーターを残す');
  const normal = pageEngine(saved(at - 30 * 60e3), {...phone, location: loc('')});
  assert.equal(normal.element('current').value, '0', '通常のスマホ起動は従来どおり0から');
  const old = pageEngine(saved(at - 25 * 3600e3), {...phone, location: loc('#always-on')});
  assert.equal(old.element('current').value, '0', '前の締め時間の区切りで保存した値は残さない');
}
// 予想データの作成日時はJSTで表示する
assert.equal(e.aoDataTime({generatedAt: '2026-11-12T08:05:00.000Z'}), '予想データ 11/12 17:05 作成。');
assert.equal(e.aoDataTime(null), '');
// 必要ペースは通常表示の「必要ペース」（1時間あたり・10分あたり）に一本化した
assert.ok(html.includes('id="perHour"') && !html.includes('id="aoPace"'));
// 通常表示：目標値の下にメーター予想の行がある（目標値の欄の中、操作ボタンの前）
assert.match(html, /id="targetMini"[\s\S]{0,600}id="miniForecast"/);
// 目標値・現在値の操作ボタンは見出し行に並べる（ボタンだけの行を作らない）
assert.match(html, /<label for="targetMini">目標値<\/label><span class="mini-label-actions">[\s\S]{0,200}id="restoreTargetMini"[\s\S]{0,300}id="openMiniTargetDetails"[\s\S]{0,300}id="resetTargetMini"/);
assert.match(html, /<label for="currentMini">現在値<\/label><span class="mini-label-actions">[\s\S]{0,200}id="miniUndoCurrent"[\s\S]{0,200}id="resetCurrentMini"/);
assert.ok(!html.includes('class="mini-target-actions"'), 'ボタンだけの行は無い');
{
  const page = pageEngine(undefined);
  const el = page.element('miniForecast');
  assert.ok(el && el.hidden === false && /^予想 /.test(el.textContent), '起動時に目標値の下へ予想の行を出す（記録が無ければ「予想 —」）');
}
console.log('always-on-forecast ok');
