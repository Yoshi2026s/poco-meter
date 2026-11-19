// メーター画面のイベントカード（aoEventItems）のリンク先検証。予想データ（meter-forecast.json とその端末保存の写し）の url を
// そのまま href にせず、イベントカレンダーの eventCalendarURL と同じ条件（https・pococha.com／yotei.ember-w.com／このリポジトリ）を通す。
import assert from 'node:assert/strict';
import {engine, pageEngine} from './calculator-harness.mjs';
import {eventCalendarURL} from '../calculator/event-calendar.mjs';

const e = engine('2026-10-03T21:00:00+09:00');
e.URL = URL;

// 判定はイベントカレンダーの eventCalendarURL と一致する（sns でない予想データの項目）
const urls = [
  'https://www.pococha.com/ja/news/1', 'https://pococha.com/x', 'https://info.pococha.com/a?b=1#c',
  'https://yotei.ember-w.com/pococha/2026-11', 'https://github.com/Yoshi2026s/poco-meter/blob/HEAD/docs/x.md#t',
  'javascript:alert(1)', 'JAVASCRIPT:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>alert(1)</script>',
  'http://www.pococha.com/ja/news/1', 'https://pococha.com.evil.example/', 'https://evilpococha.com/', 'https://example.com/x',
  'https://user:pass@www.pococha.com/', 'https://github.com/someone/else/', 'https://yotei.ember-w.com.evil.example/',
  '//www.pococha.com/', '/relative', '', 'not a url', 'https://x.com/pococha_jp/status/1',
];
for (const url of urls) assert.equal(e.aoEventURL({url}), eventCalendarURL(url), url);
for (const url of [undefined, null, 1, {}, ['https://www.pococha.com/']]) assert.equal(e.aoEventURL({url}), '', String(url));
assert.equal(e.aoEventURL(null), '');
// 貼り付けた公式X・インスタの告知（sns）だけは https の x.com・twitter.com・instagram.com も通す
assert.equal(e.aoEventURL({sns: true, url: 'https://x.com/pococha_jp/status/1'}), 'https://x.com/pococha_jp/status/1');
assert.equal(e.aoEventURL({sns: true, url: 'https://www.instagram.com/p/abc/'}), 'https://www.instagram.com/p/abc/');
assert.equal(e.aoEventURL({sns: true, url: 'https://x.com/pococha_jp#2026-01-06-%E5%A4%9C'}), 'https://x.com/pococha_jp#2026-01-06-%E5%A4%9C');
assert.equal(e.aoEventURL({sns: true, url: 'http://x.com/pococha_jp/status/1'}), '');
assert.equal(e.aoEventURL({sns: true, url: 'javascript:alert(1)'}), '');
assert.equal(e.aoEventURL({sns: true, url: 'https://x.com.evil.example/'}), '');
assert.equal(e.aoEventURL({url: 'https://www.instagram.com/p/abc/'}), '', 'sns でなければ X・インスタは通さない');

// 画面：端末保存の予想データの写しに危ない url があっても、リンク（a）にせず名前だけの文字で出す
{
  const day = '2026-10-03';
  const ev = (title, url, extra = {}) => ({title, label: title, type: 'event', ranks: ['S2'], start: '2026-10-01', end: '2026-10-05', phase: 'middle', url, ...extra});
  const forecast = {schema: 'poco-meter-forecast-v1', generatedAt: '2026-10-03T11:00:00Z', model: {}, days: {[day]: {
    events: [ev('公式イベント', 'https://www.pococha.com/ja/news/1'), ev('危ないイベント', 'javascript:alert(document.cookie)'), ev('許可外イベント', 'https://evil.example/phish'), ev('平文イベント', 'http://www.pococha.com/ja/news/2')],
    lasts: [ev('最終日イベント', 'data:text/html,<b>x</b>', {phase: 'last', end: day}), ev('最終日公式', 'https://yotei.ember-w.com/x', {phase: 'last', end: day})],
  }}};
  // 予想データは fetch（./data/meter-forecast.json）で渡す。取得後に端末保存の写しにも入る。
  // ※ テスト用の DOM には createTextNode が無いため、ページの初期化（同期）の後、fetch の応答より前に足す。
  const store = new Map();
  const fetch = url => /meter-forecast\.json$/.test(url) ? Promise.resolve({ok: true, json: async () => JSON.parse(JSON.stringify(forecast))}) : new Promise(() => {});
  const page = pageEngine(undefined, {URL, fetch, localStorage: {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k)}});
  page.document.createTextNode = text => { const n = page.document.createElement('span'); n.textContent = text; return n; };
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(store.has('pococha-meter-forecast-v1'), '予想データを端末に保存した');
  const items = id => {
    const out = [], walk = n => { for (const c of n.childNodes || []) { if (c.tagName === 'LI') out.push(c); else walk(c); } };
    walk(page.element(id)); return out;
  };
  const head = li => li.childNodes[0];
  const shown = items('aoEvents');
  assert.deepEqual(shown.map(li => head(li).textContent), ['公式イベント', '危ないイベント', '許可外イベント', '平文イベント'], 'イベントは名前ごと表示される');
  const byName = Object.fromEntries([...shown, ...items('aoLast')].map(li => [head(li).textContent, head(li)]));
  assert.equal(byName['公式イベント'].tagName, 'A');
  assert.equal(byName['公式イベント'].href, 'https://www.pococha.com/ja/news/1');
  assert.equal(byName['公式イベント'].target, '_blank');
  assert.equal(byName['公式イベント'].rel, 'noopener noreferrer');
  for (const name of ['危ないイベント', '許可外イベント', '平文イベント', '最終日イベント']) {
    assert.equal(byName[name].tagName, 'SPAN', name + ' はリンクにしない');
    assert.ok(!byName[name].href, name + ' に href を付けない');
  }
  assert.equal(byName['最終日公式'].tagName, 'A');
  assert.equal(byName['最終日公式'].href, 'https://yotei.ember-w.com/x');
}
console.log('event-link-url: ok');
