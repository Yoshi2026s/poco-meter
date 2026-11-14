// ポコチャのイベント情報を情報源から集め、data/events.json に「事実だけ」を蓄積する。
// - 本文は保存しない（イベント名・期間・対象ランク・URL・公開日のみ）。
// - robots.txt で許可された経路（RSS・サイトマップ・記事ページ）だけを使う。
// - 403/429 は再試行せず、その情報源の収集を打ち切る（取得元のアクセス制限を回避しない）。
// 使い方：node automation/collect-events.mjs [--file=data/events.json] [--since=2024-12-01] [--backfill] [--delay=1500] [--only=pococha-official-sns,pococha-official-event-page]
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';

export const UA = 'poco-meter-event-collector/1.0 (+https://github.com/Yoshi2026s/poco-meter)';
import {articleText, toEvent, eventFrom, newsItems, snsLineEvent, SNS_SOURCE} from '../calculator/event-parse.mjs';
export * from '../calculator/event-parse.mjs';
// 情報源の一覧。追加するときは利用規約・robots.txt・転載可否を確認し、checked に記録する。
export const SOURCES = [
  {
    id: 'pococha-official-note', name: 'Pococha(ポコチャ)公式（note）', kind: 'official',
    home: 'https://report.pococha.com', rss: 'https://report.pococha.com/rss', sitemap: 'https://report.pococha.com/sitemap.xml.gz',
    checked: {date: '2026-11-12', robots: '/n/*・/sitemap.xml.gz を許可（/n/*/comments 等は不許可）', terms: 'note利用規約：クリエイターの承諾なく本文を複製・公衆送信しない → 本文は保存せず、期間・ランク等の事実とURLのみ記録'},
  },
  {
    // 公式サイトの「お知らせ」。一覧ページ（/ja/news・/ja/news/pages/N）の埋め込みデータ（__NEXT_DATA__）に本文があるので、一覧だけを読む。
    id: 'pococha-official-site', name: 'Pococha公式サイト（お知らせ）', kind: 'official', news: 'https://www.pococha.com/ja/news',
    home: 'https://www.pococha.com/ja/news',
    checked: {date: '2026-11-13', robots: 'www.pococha.com の robots.txt は無し（404）。event.pococha.com は画像の一部だけ不許可', terms: 'Pococha会員規約 第10条はアプリ・サーバーの解析やボットでの「本サービス」利用を禁止 → アプリ内・非公開の通信は使わず、公開のお知らせページだけを1回2ページまで読む。本文は保存せず、期間・ランク等の事実とURLのみ記録'},
  },
  {
    // 公式X（@pococha_jp）・公式Instagram の告知。X・Instagram は規約で許可のない自動収集を禁止しているため取りに行かず、
    // 人が投稿を見て貼り付け、画面の「公式X・インスタの告知を読み取る」で作った共有用の1行（事実だけ）を data/sns-events.txt から読む。
    ...SNS_SOURCE, name: 'Pococha公式X・Instagram（手動の貼り付け）', pasted: 'data/sns-events.txt', home: 'https://x.com/pococha_jp',
    checked: {date: '2026-11-13', robots: 'x.com・instagram.com へはアクセスしない（自動取得しない）', terms: 'X・Instagramの規約は許可のない自動収集（スクレイピング）を禁止。公式APIは有料・登録が必要なため不使用 → 人が貼った投稿文から、名前・期間・時間帯・対象ランク・投稿URLの事実だけを1行にして記録。本文は保存しない'},
  },
  {
    // 公式イベントページ（event.pococha.com）。開催期間は画面の表示時に読み込まれ、ページの文字だけでは取れないため自動では取りに行かず、
    // 人（またはブラウザーでページを開いた作業者）が「イベントスケジュール」を見て確認した事実の1行を data/event-page-events.txt から読む。
    id: 'pococha-official-event-page', kind: 'official', name: 'Pococha公式イベントページ（手動の確認）', pasted: 'data/event-page-events.txt', home: 'https://event.pococha.com',
    checked: {date: '2026-11-14', robots: 'event.pococha.com の robots.txt は画像の一部だけ不許可。自動取得はしない（人がページを開いて確認する）', terms: 'Pococha会員規約 第10条はアプリ・サーバーの解析やボットでの「本サービス」利用を禁止 → ログインが必要な範囲・非公開の通信は使わず、公開ページに表示された名前・期間・対象ランク・URLだけを記録'},
  },
  {
    // 公式note の記事のうち、自動の読み取りが拾えない書き方の期間や、画像の中にだけある日程。記事を開いて確認した事実の1行を data/official-note-events.txt から読む。
    id: 'pococha-official-note-manual', kind: 'official', name: 'Pococha(ポコチャ)公式（note・手動の確認）', pasted: 'data/official-note-events.txt', home: 'https://report.pococha.com',
    checked: {date: '2026-11-14', robots: '/n/* を許可（自動収集と同じ記事。画像は記事に表示されるものを開いて見るだけで保存しない）', terms: 'note利用規約：クリエイターの承諾なく本文・画像を複製・公衆送信しない → 本文・画像は保存せず、名前・期間・対象ランクの事実とURLのみ記録'},
  },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const arg = (name, def) => { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : def; };

class Blocked extends Error {}

async function get(url, {binary = false} = {}) {
  const jar = get.jar || (get.jar = new Map());
  let target = url;
  for (let hop = 0; hop < 5; hop++) {
    const host = new URL(target).host;
    const cookies = jar.get(host) || new Map(); // 名前ごとに上書き（積み上げるとヘッダーが肥大して 431 になる）
    const res = await fetch(target, {redirect: 'manual', headers: {'user-agent': UA, 'accept-language': 'ja', ...(cookies.size ? {cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ')} : {})}});
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (i > 0) cookies.set(kv.slice(0, i).trim(), kv.slice(i + 1)); }
    jar.set(host, cookies);
    if (res.status === 403 || res.status === 429) throw new Blocked(`${res.status} ${target}`);
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { target = new URL(res.headers.get('location'), target).href; continue; }
    if (!res.ok) throw new Error(`${res.status} ${target}`);
    return binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
  }
  throw new Error(`リダイレクトが多すぎます ${url}`);
}

async function collectNews(source, {byId, since, backfill, delay, report, log}) {
  let pages = 1;
  const limit = backfill ? 60 : 2; // 普段は新しい2ページ（約20件）だけ。--backfill で全ページ
  for (let page = 1; page <= Math.min(pages, limit); page++) {
    await sleep(delay);
    let html;
    try { html = await get(page === 1 ? source.news : `${source.news}/pages/${page}`); } catch (e) { if (e instanceof Blocked) { report.blocked = e.message; log(`停止: ${e.message}`); return; } report.errors.push(String(e.message)); return; }
    const {items, pages: total} = newsItems(html);
    pages = total || 1;
    if (items.length && items.every(n => n.published && n.published.slice(0, 10) < since)) break; // 古い記事だけのページから先は読まない
    for (const n of items) {
      if (n.published && n.published.slice(0, 10) < since) continue;
      const url = `https://www.pococha.com/ja/news/${n.id}`, prev = byId.get(url);
      if (prev && prev.modified === n.modified && !process.argv.includes('--refresh')) continue; // 未更新は作り直さない
      const ev = eventFrom(source, url, n, articleText(n.body));
      report.fetched++; report[prev ? 'updated' : 'added']++;
      byId.set(url, ev);
    }
  }
}
// 貼り付けの1行（data/sns-events.txt・data/event-page-events.txt・data/official-note-events.txt）から作るイベント。毎回作り直す（ファイルから消した行はイベントからも消える）。
export function readPasted(source, byId, text, report = {}) {
  for (const [k, e] of byId) if (e.sourceId === source.id) byId.delete(k);
  let n = 0;
  for (const line of String(text).split(/\r?\n/)) {
    // 公式イベントページの行は「確認日」で始まる。確認日は開催より後のことがあるため、読み取りは開催開始日を基準にし、確認日は confirmedAt に残す。
    const checked = line.match(/^\s*確認日\s*(\d{4}-\d{2}-\d{2})/);
    const day = checked && line.match(/開催期間[:：]\s*(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (checked && !day) continue;
    const ev = snsLineEvent(checked ? line.replace(/^\s*確認日\s*\d{4}-\d{2}-\d{2}/, `投稿日 ${day[1]}-${String(day[2]).padStart(2, '0')}-${String(day[3]).padStart(2, '0')}`) : line);
    if (!ev) continue;
    const {line: _l, ...fact} = ev;
    byId.set(fact.url, {...fact, sourceId: source.id, sourceKind: source.kind, ...(checked ? {published: null, modified: null, confirmedAt: checked[1]} : {}), fetchedAt: null});
    n++;
  }
  report.pasted = (report.pasted || 0) + n;
  return n;
}
async function listArticles(source, {since, backfill}) {
  const urls = new Map();
  const rss = await get(source.rss);
  for (const m of rss.matchAll(/<item>[\s\S]*?<link>([^<]+)<\/link>[\s\S]*?<pubDate>([^<]+)<\/pubDate>[\s\S]*?<\/item>/g)) urls.set(m[1].trim(), new Date(m[2]).toISOString());
  const lastmod = new Map();
  if (source.sitemap) {
    const xml = gunzipSync(await get(source.sitemap, {binary: true})).toString('utf8');
    for (const m of xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*(?:<lastmod>([^<]+)<\/lastmod>)?/g)) {
      if (!/\/n\/[a-z0-9]+$/.test(m[1])) continue;
      if (m[2]) lastmod.set(m[1], m[2]);
      if (backfill && (!m[2] || m[2].slice(0, 10) >= since) && !urls.has(m[1])) urls.set(m[1], m[2] || null);
    }
  }
  return {list: [...urls.keys()], lastmod};
}

export async function collect({file, since, backfill, delay, only = null, log = console.error}) {
  let store = {schema: 'poco-events-v1', note: '', sources: [], events: [], skipped: []};
  try { store = JSON.parse(await readFile(file, 'utf8')); } catch {}
  const byId = new Map(store.events.map(e => [e.url, e]));
  const report = {fetched: 0, added: 0, updated: 0, blocked: null, errors: []};
  for (const source of SOURCES) {
    if (only && !String(only).split(',').includes(source.id)) continue;
    if (source.news) { await collectNews(source, {byId, since, backfill, delay, report, log}); continue; }
    if (source.pasted) { readPasted(source, byId, await readFile(resolve(fileURLToPath(new URL('..', import.meta.url)), source.pasted), 'utf8').catch(() => ''), report); continue; }
    let list;
    let lastmod;
    try { ({list, lastmod} = await listArticles(source, {since, backfill})); } catch (e) { if (e instanceof Blocked) { report.blocked = e.message; continue; } throw e; }
    // 取得後に更新された記事（日程の変更など）は取り直す。公開から120日以内・1回20件まで。
    const recent = Date.now() - 120 * 864e5;
    const stale = [...byId.values()].filter(e => lastmod.get(e.url) && e.published && Date.parse(e.published) >= recent && (!e.fetchedAt || Date.parse(lastmod.get(e.url)) > Date.parse(e.fetchedAt)))
      .sort((a, b) => Date.parse(lastmod.get(b.url)) - Date.parse(lastmod.get(a.url))).slice(0, 20).map(e => e.url);
    report.refetched = stale.length;
    for (const url of [...list, ...stale.filter(u => !list.includes(u))]) {
      if (byId.has(url) && !stale.includes(url) && !process.argv.includes('--refresh')) continue; // 取得済み・未更新は取り直さない
      await sleep(delay);
      let html;
      try { html = await get(url); } catch (e) { if (e instanceof Blocked) { report.blocked = e.message; log(`停止: ${e.message}`); break; } report.errors.push(String(e.message)); continue; }
      report.fetched++;
      const ev = toEvent(source, url, html);
      if (ev.published && ev.published.slice(0, 10) < since) continue;
      report[byId.has(url) ? 'updated' : 'added']++;
      byId.set(url, ev);
      if (report.fetched % 25 === 0) log(`${report.fetched} 件取得`);
    }
  }
  const events = [...byId.values()].sort((a, b) => (b.start || b.published || '').localeCompare(a.start || a.published || ''));
  const out = {
    schema: 'poco-events-v1',
    note: 'イベント名・期間・対象ランク・対象（audience）・URLなどの事実だけを記録。本文は保存しない。confidence: high=「開催期間」等の見出し付きの期間を検出 / low=見出しなしの期間 / none=期間を検出できず。使用期限・配信時間・応募や選考などの期間は除外（excluded に件数）。',
    updatedAt: new Date().toISOString(),
    sources: SOURCES.map(({id, name, kind, home, checked}) => ({id, name, kind, home, checked})),
    pending: [
      {kind: 'personal-note', status: '未収集', reason: 'note の /search は robots.txt で不許可。記事の発見手段（作者のRSS等）を決め、作者ごとに転載可否を確認してから追加する'},
      {kind: 'personal-blog', status: '未収集', reason: 'ブログごとに利用規約・robots.txt・転載可否の確認が必要。HAISHIN LAB は無断転載禁止のため使わない'},
    ],
    events,
  };
  // 新しい記事が無ければ書き換えない（更新日時だけの差分コミットを作らない）。
  const same = JSON.stringify({...store, updatedAt: null}) === JSON.stringify({...out, updatedAt: null});
  if (!same) await writeFile(file, JSON.stringify(out, null, 1) + '\n');
  return {...report, total: events.length, written: !same};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await collect({file: arg('file', 'data/events.json'), since: arg('since', '2024-12-01'), backfill: process.argv.includes('--backfill'), delay: +arg('delay', '1500'), only: arg('only', null)});
  console.log(JSON.stringify(r));
}
