// メーター画面の「Pocochaイベントカレンダー」：data/event-days.json から月ごとの表を作る部分と、画面への組み込み。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {eventCalendarMonth, eventCalendarName, eventCalendarURL, eventSoonOrder, eventSpan, eventHours, validEventDays} from '../calculator/event-calendar.mjs';
import {calendarEventDays, forecastBundle, EVENTS_PER_DAY} from '../automation/build-meter-factors.mjs';
import {historyHalfDayDates} from '../calculator/history-core.mjs';

const events = {events: [
  {title: '【大型】冬祭り開催', url: 'https://report.pococha.com/n/a', type: 'big', confidence: 'high', ranks: ['S1', 'S2'], periods: [{start: '2026-01-02', end: '2026-01-04', label: '冬祭り', ranks: ['S1', 'S2'], startTime: '12:00', endTime: '23:59'}]},
  {title: '新春ミッション', url: 'https://www.pococha.com/ja/news/b', type: 'mission', confidence: 'high', ranks: [], periods: [{start: '2026-01-03', end: '2026-01-03', label: '新春ミッション', ranks: []}]},
  {title: 'Aランク応援', url: 'https://evil.example/c', type: 'event', confidence: 'high', ranks: ['A1'], periods: [{start: '2026-01-03', end: '2026-01-05', label: 'Aランク応援', ranks: ['A1']}]},
  {title: '期間不明', url: 'https://report.pococha.com/n/d', type: 'event', confidence: 'none', ranks: [], periods: [{start: '2026-01-03', end: '2026-01-03'}]}]};
const data = calendarEventDays(events, '2026-01-01', '2026-02-10');

test('月の表：開催中と最終日を日ごとに並べ、最終日・大型を先頭にする', () => {
  const m = eventCalendarMonth(data, '2026-01', '');
  assert.equal(m.cells.length % 7, 0);
  assert.equal(m.cells.filter(Boolean).length, 31);
  const day = d => m.cells.find(c => c && c.date === d);
  assert.deepEqual(day('2026-01-01').items, []);
  assert.deepEqual(day('2026-01-03').items.map(x => [x.name, x.last, x.type]), [['新春ミッション', true, 'mission'], ['冬祭り', false, 'big'], ['Aランク応援', false, 'event']]);
  assert.equal(day('2026-01-03').big, true);
  assert.equal(day('2026-01-04').lasts, 1);
  assert.equal(day('2026-01-04').items[0].endTime, '23:59');
  assert.equal(m.count, 3 + 1 + 3, '期間を検出できなかった記事は載せない（冬祭り3日・ミッション1日・Aランク応援3日）');
  assert.equal(m.covered, true);
});

test('並び順：イベラス（最終日）が近いもの、次に開催期間が短いものほど上', () => {
  const list = [
    {name: '長期・明後日まで', start: '2026-01-01', end: '2026-01-12'},
    {name: '1週間・明日まで', start: '2026-01-04', end: '2026-01-11'},
    {name: '1週間・5日後まで', start: '2026-01-08', end: '2026-01-15'},
    {name: '日付なし'},
    {name: '1日・半日', start: '2026-01-10', end: '2026-01-10', startTime: '12:00', endTime: '23:59'},
    {name: '1日', start: '2026-01-10'}];
  assert.deepEqual(list.slice().sort(eventSoonOrder('2026-01-10')).map(x => x.name), ['1日・半日', '1日', '1週間・明日まで', '長期・明後日まで', '1週間・5日後まで', '日付なし']);
  const longer = {events: [
    {title: '長期', url: 'https://report.pococha.com/n/l', type: 'big', confidence: 'high', ranks: [], periods: [{start: '2026-03-01', end: '2026-03-20', label: '長期', ranks: []}]},
    {title: '短期', url: 'https://report.pococha.com/n/s', type: 'mission', confidence: 'high', ranks: [], periods: [{start: '2026-03-05', end: '2026-03-07', label: '短期', ranks: []}]}]};
  const m = eventCalendarMonth(calendarEventDays(longer, '2026-03-01', '2026-03-31'), '2026-03', '');
  assert.deepEqual(m.cells.find(c => c && c.date === '2026-03-06').items.map(x => x.name), ['短期', '長期'], '種類（大型）よりイベラスの近さを優先');
});

test('ランクを選ぶと、そのランクが対象のものと対象ランク不明のものだけ残す', () => {
  const m = eventCalendarMonth(data, '2026-01', 'S2');
  const d3 = m.cells.find(c => c && c.date === '2026-01-03');
  assert.deepEqual(d3.items.map(x => [x.name, x.target]), [['新春ミッション', false], ['冬祭り', true]]);
  assert.equal(eventCalendarMonth(data, '2026-01', 'X9'), null);
});

test('公式ドメイン以外のリンクは出さない・範囲外の月は covered=false', () => {
  const m = eventCalendarMonth(data, '2026-01', '');
  const urls = m.cells.filter(Boolean).flatMap(c => c.items.map(x => x.url));
  assert.ok(urls.includes('https://report.pococha.com/n/a'));
  assert.ok(!urls.some(u => u.includes('evil')));
  assert.equal(eventCalendarURL('javascript:alert(1)'), '');
  assert.equal(eventCalendarURL('https://pococha.com.evil.example/'), '');
  assert.equal(eventCalendarMonth(data, '2026-04', '').covered, false);
  assert.equal(eventCalendarMonth({schema: 'x'}, '2026-01', ''), null);
  assert.equal(validEventDays(data), true);
});

test('段階名だけのラベルは記事タイトルの名前を前に付ける', () => {
  assert.equal(eventCalendarName({title: '『星空の祭典』開催のお知らせ', label: '決勝'}), '星空の祭典 決勝');
  assert.equal(eventCalendarName({title: '第3回 星空の祭典', label: '第2弾'}), '第3回 星空の祭典 第2弾');
  assert.equal(eventCalendarName({title: '冬祭り開催', label: '冬祭り 開催期間'}), '冬祭り');
});

test('メーター画面の「過去のボーダー表」リンクの直後に折りたたみで置き、過去のボーダー表には置かない', () => {
  const html = fs.readFileSync(new URL('../calculator/index.html', import.meta.url), 'utf8');
  const link = html.indexOf('id="mainHistoryLink"'), linkEnd = html.indexOf('</a>', link) + 4;
  assert.ok(link > 0);
  assert.equal(html.indexOf('<details class="event-cal-panel" id="eventCalendarPanel">'), linkEnd, 'スマホ縦の入口ボタンのすぐ下');
  assert.ok(html.includes("anchor=narrow?$('mainHistoryLink'):$('historyPortal')"), 'PC・横持ちは下部のリンクの下へ移す');
  assert.ok(html.includes('html.always-on-mode body #eventCalendarPanel{display:none!important}'), '常時表示モードでは隠す');
  assert.ok(html.includes("fetch('./data/event-days.json'"));
  const history = fs.readFileSync(new URL('../calculator/border-history.html', import.meta.url), 'utf8');
  assert.doesNotMatch(history, /eventCalendarPanel/);
  const build = fs.readFileSync(new URL('../scripts/build-pages.mjs', import.meta.url), 'utf8');
  assert.match(build, /EVENT_DAYS_AHEAD = 60/);
});

test('書き写した部品が元ファイルと一致し、画面のスクリプトから使える', async () => {
  const {eventCalendarBlock, BEGIN, END} = await import('../scripts/prepare-event-calendar.mjs');
  const html = fs.readFileSync(new URL('../calculator/index.html', import.meta.url), 'utf8');
  const src = fs.readFileSync(new URL('../calculator/event-calendar.mjs', import.meta.url), 'utf8');
  const block = html.slice(html.indexOf(BEGIN), html.indexOf(END) + END.length);
  assert.equal(block, eventCalendarBlock(src));
  const PocoEventCalendar = new Function(block.replace(BEGIN, '').replace(END, '') + '; return PocoEventCalendar;')();
  assert.equal(typeof PocoEventCalendar.createEventCalendar, 'function');
  assert.equal(PocoEventCalendar.eventCalendarMonth(data, '2026-01', '').count, 7);
});

test('第三者候補は正式イベントと同じに並べ（公式未確認の印なし）、同日の公式情報と重複させない', () => {
  const url = 'https://yotei.ember-w.com/events/2026-11/';
  const candidate = {name: 'デビューぽこトレ', date: '2026-01-03', startTime: '12:00', endTime: '23:59', rankRange: 'E1〜D3', url};
  const repeatedOfficial = {...candidate, name: '新春ミッション'};
  const result = calendarEventDays(events, '2026-01-01', '2026-02-10', [candidate, candidate, repeatedOfficial]);
  assert.deepEqual(result.days['2026-01-03'].e, data.days['2026-01-03'].e);
  assert.deepEqual(result.days['2026-01-03'].l, data.days['2026-01-03'].l);
  const displayed = eventCalendarMonth(result, '2026-01').cells.find(c => c?.date === '2026-01-03').items;
  const item = displayed.find(x => x.name === 'デビューぽこトレ');
  assert.deepEqual([item.last, item.startTime, item.endTime, item.rankRange, item.url], [true, '12:00', '23:59', 'E1〜D3', url], '1日だけの候補はその日が最終日（イベラス）');
  assert.equal(displayed.filter(x => x.candidate).length, 1);
  assert.equal(displayed.indexOf(item), 0, '候補を後ろに回さず、イベラスが近い順に並べる（23:59終了なので時刻なしの最終日より上）');
  assert.equal(eventCalendarURL(url), url);
  assert.equal(eventCalendarURL('https://github.com/Yoshi2026s/poco-meter/blob/HEAD/docs/pococha-event-sources.md#task-1'), 'https://github.com/Yoshi2026s/poco-meter/blob/HEAD/docs/pococha-event-sources.md#task-1');
  assert.equal(eventCalendarURL('https://example.com/x'), '');
  assert.equal(eventCalendarURL('https://yotei.ember-w.com.evil.example/'), '');
});

test('1日の開催中は最大 EVENTS_PER_DAY 件。最終日のものは数えず、開催中を押し出さない', () => {
  const ev = (n, start, end, type = 'event') => ({title: n, url: 'https://report.pococha.com/n/' + encodeURIComponent(n), type, confidence: 'high', ranks: [], periods: [{start, end, label: n, ranks: []}]});
  const many = {events: [
    ...Array.from({length: 6}, (_, i) => ev('最終日' + i, '2026-04-01', '2026-04-05', 'big')),
    ...Array.from({length: EVENTS_PER_DAY + 3}, (_, i) => ev('開催中' + i, '2026-04-01', '2026-04-20', i < 2 ? 'big' : 'notice'))]};
  const day = forecastBundle({weekday: {}}, many, '2026-04-05', {before: 0, after: 0}).days['2026-04-05'];
  assert.equal(day.events.filter(x => x.ends).length, 6, '最終日のものはすべて残す');
  assert.equal(day.events.filter(x => !x.ends).length, EVENTS_PER_DAY, '開催中は上限まで（最終日の件数に押し出されない）');
  assert.ok(day.events.filter(x => !x.ends).slice(0, 2).every(x => x.type === 'big'), '大型を優先して残す');
  assert.equal(day.lasts.length, 6);
});

test('期間の表示は月日に0を付けず、年が違う日付だけ年を付ける（メイン画面とそろえる）', () => {
  assert.equal(eventSpan({start: '2026-09-09', end: '2026-11-30'}, '2026-11-17'), '9/9〜11/30');
  assert.equal(eventSpan({start: '2026-11-11', end: '2027-02-22'}, '2026-11-17'), '11/11〜2027/2/22');
  assert.equal(eventSpan({start: '2026-11-13', end: '2026-11-17', endTime: '23:59'}, '2026-11-17'), '11/13〜11/17 23:59');
  assert.equal(eventSpan({start: '2026-11-17', end: '2026-11-17', startTime: '12:00', endTime: '23:59'}, '2026-11-17'), '11/17 12:00〜23:59');
});

// 同じ日の時刻つき開催の長さの印（メイン画面の aoTimeSpan と同じ区切り）。詳細の一覧に「半日」「公式未確認」の印が出る。
test('イベントカレンダーの半日・公式未確認の印', () => {
  assert.equal(eventHours({start: '2026-01-03', end: '2026-01-03', startTime: '12:00', endTime: '23:59'}), '半日');
  assert.equal(eventHours({start: '2026-01-03', startTime: '00:00', endTime: '23:59'}), '1日');
  assert.equal(eventHours({start: '2026-01-03', startTime: '20:00', endTime: '23:00'}), '3時間');
  assert.equal(eventHours({start: '2026-01-03', startTime: '21:00', endTime: '22:30'}), '1時間30分');
  assert.equal(eventHours({start: '2026-01-03', end: '2026-01-05', startTime: '12:00', endTime: '23:59'}), '', '複数日の開催には付けない');
  assert.equal(eventHours({start: '2026-01-03', end: '2026-01-03'}), '', '時刻が無ければ付けない');
  assert.equal(eventHours({start: '2026-01-03', startTime: '06:00', endTime: '23:00'}), '', '13〜23時間は付けない');
  const src = fs.readFileSync(new URL('../calculator/event-calendar.mjs', import.meta.url), 'utf8');
  assert.match(src, /eventHours\(x\), 'evc-tag hours'/);
  assert.match(src, /'公式未確認', 'evc-tag candidate'/);
  const html = fs.readFileSync(new URL('../calculator/index.html', import.meta.url), 'utf8');
  assert.match(html, /\.evc-tag\.hours\{/, 'index.html に印の色');
  assert.match(html, /e\.candidate\?'・公式未確認（第三者カレンダー掲載'/, 'メイン画面のイベント欄にも公式未確認と出す');
});

// 日付マスの「半日」の印：その日に半日イベント（同じ日の時刻つき、6〜13時間）があれば件数を数える
test('イベントカレンダーの日付マスに半日の印', () => {
  const half = {events: [
    {title: '半日A', url: 'https://www.pococha.com/ja/news/h1', type: 'item', confidence: 'high', ranks: [], periods: [{start: '2026-01-10', end: '2026-01-10', startTime: '12:00', endTime: '23:59', ranks: []}]},
    {title: '3時間B', url: 'https://www.pococha.com/ja/news/h2', type: 'event', confidence: 'high', ranks: [], periods: [{start: '2026-01-10', end: '2026-01-10', startTime: '20:00', endTime: '23:00', ranks: []}]},
    {title: '複数日C', url: 'https://www.pococha.com/ja/news/h3', type: 'event', confidence: 'high', ranks: [], periods: [{start: '2026-01-10', end: '2026-01-12', startTime: '12:00', endTime: '23:59', ranks: []}]}]};
  const cand = [{name: '半日候補D', date: '2026-01-10', startTime: '12:00', endTime: '23:59', url: 'https://yotei.ember-w.com/events/2026-01/'}];
  const month = eventCalendarMonth(calendarEventDays(half, '2026-01-01', '2026-01-31', cand), '2026-01');
  const day = d => month.cells.find(c => c && c.date === d);
  assert.equal(day('2026-01-10').half, 2, '公式の半日と公式未確認の半日を数え、3時間・複数日は数えない');
  assert.equal(day('2026-01-11').half, 0);
  const src = fs.readFileSync(new URL('../calculator/event-calendar.mjs', import.meta.url), 'utf8');
  assert.match(src, /if \(cell\.half\) b\.appendChild\(el\('span', '半日'/);
  assert.match(src, /legend\.appendChild\(el\('span', '半日', 'evc-tag hours'\)\)/);
});
test('対象ランクの無い候補でもカレンダーのデータを作れる', () => {
  const r = calendarEventDays({events: []}, '2026-01-01', '2026-01-31', [{name: 'ランク不明', date: '2026-01-05', end: '2026-01-06', url: 'https://yotei.ember-w.com/events/2026-01/'}]);
  assert.equal(r.list[r.days['2026-01-06'].c[0]].title, 'ランク不明');
  assert.deepEqual(r.list[r.days['2026-01-06'].c[0]].ranks, []);
});
test('メイン画面のイベント欄にも半日の印', () => {
  const html = fs.readFileSync(new URL('../calculator/index.html', import.meta.url), 'utf8');
  assert.match(html, /if\(\/（半日）\$\/\.test\(aoTimeSpan\(e\)\)\)\{var h=document\.createElement\('span'\);h\.className='ao-badge half';h\.textContent='半日';badges\.push\(h\);\}/, '半日の開催に「半日」の印');
  assert.match(html, /\.main-card \.ao-badge\.half\{background:#0e7490!important\}/, '印の色はイベントカレンダーの半日と同じ');
});
test('過去のボーダー表のカレンダーにも半日の印（区切りはイベントカレンダーと同じ）', () => {
  const r = calendarEventDays({events: []}, '2026-01-01', '2026-01-31', [
    {name: '昼の半日', date: '2026-01-05', startTime: '12:00', endTime: '23:59', url: 'https://yotei.ember-w.com/events/2026-01/'},
    {name: '夜の半日', date: '2026-01-05', startTime: '18:00', endTime: '23:59', url: 'https://yotei.ember-w.com/events/2026-01/'},
    {name: '1日', date: '2026-01-06', startTime: '00:00', endTime: '23:59', url: 'https://yotei.ember-w.com/events/2026-01/'},
    {name: '2日間', date: '2026-01-07', end: '2026-01-08', startTime: '12:00', endTime: '23:59', url: 'https://yotei.ember-w.com/events/2026-01/'},
  ]);
  const half = historyHalfDayDates(r);
  assert.deepEqual([...half], [['2026-01-05', 1]], '12:00〜23:59 は半日、6時間未満・1日・複数日は入れない');
  assert.equal(r.list.filter(x => eventHours(x) === '半日').length, 1, 'eventHours と同じ判定');
  for (const bad of [null, {}, {schema: 'x', list: [], days: {}}, {schema: 'poco-meter-event-days-v1', list: 'x', days: {}}]) assert.equal(historyHalfDayDates(bad).size, 0);
  const page = fs.readFileSync(new URL('../calculator/border-history.html', import.meta.url), 'utf8');
  assert.ok(page.includes("fetch('./data/event-days.json'") && page.includes("'cal-half'") && page.includes('.cal-half{'), '生成したページにも入っている');
});
