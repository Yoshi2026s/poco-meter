// ボーダー取得の全リクエストに、ツール名とリポジトリURLだけを含む User-Agent が付くことを確かめる。
// 外部には接続しない（fetch を差し替える）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {BORDER_UA, SOURCE_INDEX, fetchHtml} from '../lib/border-source.mjs';
import {collectFromSource, collectFromTables, StopError} from '../automation/update-borders-json.mjs';

test('BORDER_UA はツール名とリポジトリURLだけを含み、メールアドレスを含まない', () => {
  assert.match(BORDER_UA, /^poco-meter-border-updater\/[\d.]+ \(\+https:\/\/github\.com\/Yoshi2026s\/poco-meter\)$/);
  assert.doesNotMatch(BORDER_UA, /@/);
});

test('lib/border-source.mjs の fetchHtml は UA を付け、リダイレクトを拒否する', async () => {
  const seen = [];
  const fetcher = async (url, init) => { seen.push(init); return new Response('<html></html>', {headers: {'Content-Type': 'text/html'}}); };
  await fetchHtml('https://one-carat.com/campus/archives/89495', fetcher);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].headers['User-Agent'], BORDER_UA);
  assert.equal(seen[0].headers.Accept, 'text/html');
  assert.equal(seen[0].redirect, 'error');
});

test('自動更新の HTML 取得は UA を付け、403 では再試行せず中止する', async () => {
  const seen = [];
  const fetch = async (url, init) => { seen.push({url, init}); return new Response('', {status: 403, headers: {'Content-Type': 'text/html'}}); };
  await assert.rejects(collectFromSource({fetch}), e => e instanceof StopError && e.code === 'forbidden');
  assert.equal(seen.length, 1, '403 は再試行しない');
  assert.equal(seen[0].url, SOURCE_INDEX);
  assert.equal(seen[0].init.headers['User-Agent'], BORDER_UA);
  assert.equal(seen[0].init.redirect, 'error');
});

test('自動更新の表画像取得も UA を付ける', async () => {
  const ARTICLE = 'https://one-carat.com/campus/archives/900';
  const IMG = g => `https://one-carat.com/campus/wp-content/uploads/ua-${g}.png`;
  const groups = ['D1-C3', 'B1-A3', 'S1-S6'];
  const indexHTML = `<a href="${ARTICLE}">【2026年9月】Pococha全ランクボーダー早見表《22時締め》</a>`;
  const articleHTML = groups.map(g => `<img alt="22時締め_${g}" src="${IMG(g)}">`).join('');
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({url, init});
    if (url === ARTICLE) return new Response(articleHTML, {headers: {'Content-Type': 'text/html'}});
    if (groups.some(g => url === IMG(g))) return new Response('not a png', {headers: {'Content-Type': 'image/png'}});
    throw new Error('unexpected ' + url);
  };
  const data = {records: [], sync: {last_attempt: '', last_success: '', status: 'ok', message: ''}, serverDate: '2026-10-03'};
  const t = await collectFromTables({fetch, now: new Date('2026-10-02T21:00:00Z'), data, indexHTML, lookbackDays: 40});
  assert.equal(t.status, 'no-tables');
  const images = seen.filter(s => s.url.endsWith('.png'));
  assert.equal(images.length, 3);
  for (const s of seen) {
    assert.equal(s.init.headers['User-Agent'], BORDER_UA, s.url);
    assert.equal(s.init.redirect, 'error', s.url);
  }
  assert.ok(images.every(s => s.init.headers.Accept === 'image/png'));
});
