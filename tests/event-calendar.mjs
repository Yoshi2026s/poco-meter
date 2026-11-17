// メーター画面の「Pocochaイベントカレンダー」：data/event-days.json から月ごとの表を作る部分と、画面への組み込み。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {eventCalendarMonth, eventCalendarName, eventCalendarURL, eventSoonOrder, validEventDays} from '../calculator/event-calendar.mjs';
import {calendarEventDays} from '../automation/build-meter-factors.mjs';

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

test('並び順：開催期間が短いもの、次にイベラス（最終日）が近いものほど上', () => {
  const list = [
    {name: '長期・明後日まで', start: '2026-01-01', end: '2026-01-12'},
    {name: '1週間・明日まで', start: '2026-01-04', end: '2026-01-11'},
    {name: '1週間・5日後まで', start: '2026-01-08', end: '2026-01-15'},
    {name: '日付なし'},
    {name: '1日・半日', start: '2026-01-10', end: '2026-01-10', startTime: '12:00', endTime: '23:59'},
    {name: '1日', start: '2026-01-10'}];
  assert.deepEqual(list.slice().sort(eventSoonOrder('2026-01-10')).map(x => x.name), ['1日・半日', '1日', '1週間・明日まで', '1週間・5日後まで', '長期・明後日まで', '日付なし']);
  const longer = {events: [
    {title: '長期', url: 'https://report.pococha.com/n/l', type: 'big', confidence: 'high', ranks: [], periods: [{start: '2026-03-01', end: '2026-03-20', label: '長期', ranks: []}]},
    {title: '短期', url: 'https://report.pococha.com/n/s', type: 'mission', confidence: 'high', ranks: [], periods: [{start: '2026-03-05', end: '2026-03-07', label: '短期', ranks: []}]}]};
  const m = eventCalendarMonth(calendarEventDays(longer, '2026-03-01', '2026-03-31'), '2026-03', '');
  assert.deepEqual(m.cells.find(c => c && c.date === '2026-03-06').items.map(x => x.name), ['短期', '長期'], '種類（大型）より期間の短さを優先');
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

test('第三者候補は日別カレンダーだけに追加し、同日の公式情報と重複させない', () => {
  const url = 'https://yotei.ember-w.com/events/2026-11/';
  const candidate = {name: 'デビューぽこトレ', date: '2026-01-03', startTime: '12:00', endTime: '23:59', rankRange: 'E1〜D3', url};
  const repeatedOfficial = {...candidate, name: '新春ミッション'};
  const result = calendarEventDays(events, '2026-01-01', '2026-02-10', [candidate, candidate, repeatedOfficial]);
  assert.deepEqual(result.days['2026-01-03'].e, data.days['2026-01-03'].e);
  assert.deepEqual(result.days['2026-01-03'].l, data.days['2026-01-03'].l);
  const displayed = eventCalendarMonth(result, '2026-01').cells.find(c => c?.date === '2026-01-03').items;
  const item = displayed.at(-1);
  assert.deepEqual([item.name, item.candidate, item.last, item.startTime, item.endTime, item.rankRange, item.url],
    ['デビューぽこトレ', true, false, '12:00', '23:59', 'E1〜D3', url]);
  assert.equal(displayed.filter(x => x.candidate).length, 1);
  assert.equal(eventCalendarURL(url), '');
  assert.equal(eventCalendarURL('https://yotei.ember-w.com.evil.example/', true), '');
});
