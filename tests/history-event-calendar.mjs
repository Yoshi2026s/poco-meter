// 過去のボーダー表の「Pocochaイベントカレンダー」：data/event-days.json から月ごとの表を作る部分と、公開物・画面の組み込み。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {eventCalendarMonth, eventCalendarName, eventCalendarURL, validEventDays} from '../calculator/history-core.mjs';
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

test('過去のボーダー表に折りたたみで組み込まれ、公開時は60日先まで作る', () => {
  const html = fs.readFileSync(new URL('../calculator/border-history.html', import.meta.url), 'utf8');
  assert.match(html, /<details class="panel" id="eventCalendarPanel">/);
  assert.ok(html.indexOf('id="eventCalendarPanel"') > html.indexOf('id="calendarResults"'), 'ボーダーのカレンダーより下');
  assert.ok(html.indexOf('id="eventCalendarPanel"') < html.indexOf('<footer'));
  assert.match(html, /fetch\('\.\/data\/event-days\.json'/);
  const build = fs.readFileSync(new URL('../scripts/build-pages.mjs', import.meta.url), 'utf8');
  assert.match(build, /EVENT_DAYS_AHEAD = 60/);
});
