// イベント収集（automation/collect-events.mjs）が許可リスト外のホストを取得しないこと。外部へは接続せず fetch を差し替えて確かめる。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {FETCH_HOSTS, fetchableUrl, noteSessionHop, get, collect, SOURCES} from '../automation/collect-events.mjs';

function mockFetch(routes) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push(String(url));
    assert.equal(opts?.redirect, 'manual', 'リダイレクトは自動で追わない');
    const r = routes[String(url)];
    if (!r) return new Response('not found', {status: 404});
    return typeof r === 'function' ? r() : r;
  };
  return {calls, restore: () => { globalThis.fetch = orig; }};
}

test('許可リストは自動取得している取得元のホストだけ', () => {
  assert.deepEqual([...FETCH_HOSTS].sort(), ['report.pococha.com', 'www.pococha.com']);
  for (const s of SOURCES.filter(s => !s.pasted)) for (const u of [s.rss, s.sitemap, s.news].filter(Boolean)) assert.ok(fetchableUrl(u), u);
});

test('fetchableUrl：https・許可ホスト以外は取得しない', () => {
  assert.ok(fetchableUrl('https://report.pococha.com/n/abc123'));
  assert.ok(fetchableUrl('https://www.pococha.com/ja/news/pages/2'));
  for (const u of [
    'http://report.pococha.com/n/abc123',
    'https://evil.example.com/n/abc123',
    'https://report.pococha.com.evil.example/n/abc',
    'https://event.pococha.com/',
    'https://x.com/pococha_jp',
    'https://user:pw@report.pococha.com/n/abc',
    'https://report.pococha.com:8443/n/abc',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'not a url',
    '',
  ]) assert.equal(fetchableUrl(u), null, u);
});

test('現在の data/events.json の自動収集の記事URLは許可リストで弾かれない', () => {
  const store = JSON.parse(readFileSync(new URL('../data/events.json', import.meta.url), 'utf8'));
  const auto = store.events.filter(e => !SOURCES.find(s => s.id === e.sourceId)?.pasted);
  assert.ok(auto.length > 0);
  for (const e of auto) assert.ok(fetchableUrl(e.url), e.url);
});

test('get：許可外ホストは fetch を呼ばずに失敗する', async () => {
  const m = mockFetch({});
  try {
    await assert.rejects(get('https://evil.example.com/x'), /許可外/);
    await assert.rejects(get('http://report.pococha.com/rss'), /許可外/);
    assert.deepEqual(m.calls, []);
  } finally { m.restore(); }
});

test('get：許可外へのリダイレクトは追わない・許可内のリダイレクトは追う', async () => {
  const m = mockFetch({
    'https://report.pococha.com/n/a': () => new Response('', {status: 302, headers: {location: 'https://evil.example.com/steal'}}),
    'https://report.pococha.com/n/b': () => new Response('', {status: 301, headers: {location: '/n/c'}}),
    'https://report.pococha.com/n/c': () => new Response('ok'),
    'https://report.pococha.com/n/d': () => new Response('', {status: 302, headers: {location: 'http://report.pococha.com/n/c'}}),
  });
  try {
    await assert.rejects(get('https://report.pococha.com/n/a'), /許可外.*evil\.example\.com/);
    assert.equal(await get('https://report.pococha.com/n/b'), 'ok');
    await assert.rejects(get('https://report.pococha.com/n/d'), /許可外/);
    assert.ok(!m.calls.some(u => !u.startsWith('https://report.pococha.com/')), m.calls.join('\n'));
  } finally { m.restore(); }
});

test('collect：RSS・サイトマップの許可外リンクは取得しない', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'collect-hosts-'));
  const rss = ['https://report.pococha.com/n/ok1', 'https://evil.example.com/n/bad1', 'http://report.pococha.com/n/bad2']
    .map(u => `<item><title>t</title><link>${u}</link><pubDate>Mon, 01 Jun 2026 00:00:00 GMT</pubDate></item>`).join('');
  const sitemap = gzipSync(Buffer.from(`<urlset><url><loc>https://evil.example.com/n/bad3</loc><lastmod>2026-06-01</lastmod></url><url><loc>https://report.pococha.com/n/ok2</loc><lastmod>2026-06-01</lastmod></url></urlset>`));
  const page = '<html><head><title>記事</title></head><body></body></html>';
  const m = mockFetch({
    'https://report.pococha.com/rss': () => new Response(`<rss>${rss}</rss>`),
    'https://report.pococha.com/sitemap.xml.gz': () => new Response(sitemap),
    'https://report.pococha.com/n/ok1': () => new Response(page),
    'https://report.pococha.com/n/ok2': () => new Response(page),
  });
  try {
    const file = join(dir, 'events.json');
    await collect({file, since: '2024-12-01', backfill: true, delay: 0, only: 'pococha-official-note', log: () => {}});
    assert.ok(m.calls.every(u => u.startsWith('https://report.pococha.com/')), m.calls.join('\n'));
    assert.ok(m.calls.includes('https://report.pococha.com/n/ok1'));
    assert.ok(m.calls.includes('https://report.pococha.com/n/ok2'));
    const urls = JSON.parse(await readFile(file, 'utf8')).events.map(e => e.url);
    assert.ok(!urls.some(u => /evil|^http:/.test(u)), urls.join('\n'));
  } finally { m.restore(); await rm(dir, {recursive: true, force: true}); }
});

test('get：note.com/cd/sessions はリダイレクトの経由先としてだけ通し、戻り先が許可ホストでなければ止める', async () => {
  const back = 'https://report.pococha.com/n/nb1';
  const hop = 'https://note.com/cd/sessions?redirect_to=' + encodeURIComponent(back);
  assert.ok(noteSessionHop(hop));
  assert.equal(noteSessionHop('https://note.com/cd/sessions?redirect_to=' + encodeURIComponent('https://evil.example/x')), null);
  assert.equal(noteSessionHop('https://note.com/other?redirect_to=' + encodeURIComponent(back)), null);
  assert.equal(noteSessionHop('http://note.com/cd/sessions?redirect_to=' + encodeURIComponent(back)), null);
  let first = true;
  const m = mockFetch({
    [back]: () => first ? (first = false, new Response('', {status: 302, headers: {location: hop}})) : new Response('<p>ok</p>', {status: 200}),
    [hop]: () => new Response('', {status: 302, headers: {location: back}}),
    'https://report.pococha.com/n/body': () => new Response('', {status: 302, headers: {location: 'https://note.com/cd/sessions?redirect_to=' + encodeURIComponent('https://report.pococha.com/n/x')}}),
    ['https://note.com/cd/sessions?redirect_to=' + encodeURIComponent('https://report.pococha.com/n/x')]: () => new Response('note page', {status: 200}),
  });
  try {
    assert.equal(await get(back), '<p>ok</p>');
    await assert.rejects(get('https://report.pococha.com/n/body'), /経由先から本文が返った/);
    await assert.rejects(get(hop), /許可外の取得先/); // 最初の取得先としては使わない
  } finally { m.restore(); }
});
