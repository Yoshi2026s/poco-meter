// ポコチャのイベント情報を情報源から集め、data/events.json に「事実だけ」を蓄積する。
// - 本文は保存しない（イベント名・期間・対象ランク・URL・公開日のみ）。
// - robots.txt で許可された経路（RSS・サイトマップ・記事ページ）だけを使う。
// - 403/429 は再試行せず、その情報源の収集を打ち切る（取得元のアクセス制限を回避しない）。
// 使い方：node automation/collect-events.mjs [--file=data/events.json] [--since=2024-12-01] [--backfill] [--delay=1500]
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';

export const UA = 'poco-meter-event-collector/1.0 (+https://github.com/Yoshi2026s/poco-meter)';
export const RANKS = ['D1','D2','D3','C1','C2','C3','B1','B2','B3','A1','A2','A3','S1','S2','S3','S4','S5','S6'];

// 情報源の一覧。追加するときは利用規約・robots.txt・転載可否を確認し、checked に記録する。
export const SOURCES = [
  {
    id: 'pococha-official-note', name: 'Pococha(ポコチャ)公式（note）', kind: 'official',
    home: 'https://report.pococha.com', rss: 'https://report.pococha.com/rss', sitemap: 'https://report.pococha.com/sitemap.xml.gz',
    checked: {date: '2026-11-12', robots: '/n/*・/sitemap.xml.gz を許可（/n/*/comments 等は不許可）', terms: 'note利用規約：クリエイターの承諾なく本文を複製・公衆送信しない → 本文は保存せず、期間・ランク等の事実とURLのみ記録'},
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

const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, ' ');

export function articleText(html) {
  return decode(html
    .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(br|\/p|\/h[1-6]|\/li|\/div|\/tr|\/td|\/th|\/figcaption)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t　]+/g, ' ').replace(/\n\s*\n+/g, '\n');
}

export function articleMeta(html) {
  const title = decode(html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/)?.[1] || html.match(/<title>([^<]*)<\/title>/)?.[1] || '')
    .replace(/｜Pococha\(ポコチャ\)公式\s*$/, '').trim();
  const published = html.match(/"datePublished":"([^"]+)"/)?.[1] || null;
  const modified = html.match(/"dateModified":"([^"]+)"/)?.[1] || published;
  return {title, published, modified};
}

const z = n => String(n).padStart(2, '0');
const toFull = (s) => s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/：/g, ':').replace(/／/g, '/');

// 「2026年10月9日(金) 12:00 〜 2026年10月13日(火) 23:59」「10/9(金)12:00〜10/13(火)23:59」などを拾う。
export function findPeriods(text, publishedISO) {
  const t = toFull(text);
  const pubYear = publishedISO ? +publishedISO.slice(0, 4) : new Date().getFullYear();
  const pubMonth = publishedISO ? +publishedISO.slice(5, 7) : 1;
  const D = String.raw`(?:(\d{4})年)?(\d{1,2})(?:月|/)(\d{1,2})日?\s*(?:[\(（][^)）]{1,3}[\)）])?\s*(\d{1,2}:\d{2})?`;
  // 範囲：日付〜日付／日付 時刻〜時刻（同日）／日付より開催（開始のみ）
  const re = new RegExp(D + String.raw`\s*(?:[〜~～\-–]\s*(?:` + D + String.raw`|(\d{1,2}:\d{2}))|より(?:開催|スタート|開始))`, 'g');
  const yearOf = (y, mo) => { if (y) return +y; let v = pubYear; if (+mo < pubMonth - 6) v++; return v; };
  const out = [];
  const lines = t.split('\n');
  lines.forEach((line, li) => {
    for (const m of line.matchAll(re)) {
      const [, y1, mo1, d1, h1, y2, mo2, d2, h2, hOnly] = m;
      if (+mo1 > 12 || +d1 > 31 || +mo1 < 1 || +d1 < 1) continue;
      const ys = yearOf(y1, mo1);
      const start = `${ys}-${z(mo1)}-${z(d1)}`;
      let end = null, endTime = null;
      if (mo2) {
        if (+mo2 > 12 || +d2 > 31) continue;
        let ye = y2 ? +y2 : ys; if (!y2 && +mo2 < +mo1) ye = ys + 1;
        end = `${ye}-${z(mo2)}-${z(d2)}`; endTime = h2 || null;
      } else if (hOnly) { end = start; endTime = hOnly; }
      if (!h1 && !mo2 && hOnly) continue; // 「10:00〜12:00」だけの行は日付範囲ではない
      if (end && (end < start || (Date.parse(end) - Date.parse(start)) / 864e5 > 120)) continue;
      const prefix = line.slice(0, m.index);
      const head = [lines[li - 1], lines[li - 2]].filter(Boolean).join(' ');
      const labeled = /開催期間|イベント期間|開催日程|開催日時|期間[:：]|予選|本戦|決勝|ステージ|リーグ|より(開催|スタート|開始)/.test(prefix + m[0]);
      const isEntry = /エントリー?期間|応募期間|申込|受付/.test(prefix);
      const clean = s => s.replace(/\p{Extended_Pictographic}|️/gu, '').replace(/[:：\s・■]+$/, '').replace(/^[\s・■]+/, '').replace(/^イベント名\s*[:：]\s*/, '').trim();
      let label = clean(prefix).slice(-30) || null;
      if (!label || /^(開催期間|イベント期間|開催日程|開催日時|第\d+日程)$/.test(label)) {
        // 見出しだけの行は、直前の見出し（日付を含まない短い行）をイベント名として補う。
        for (let k = li - 1; k >= Math.max(0, li - 6); k--) {
          const h = clean(lines[k] || '');
          if (h && h.length <= 40 && !/\d{1,2}[\/月]\d{1,2}|期間|エントリ|対象|条件|※/.test(h)) { label = label ? `${h.slice(0, 30)} ${label}` : h.slice(0, 30); break; }
        }
      }
      const ranks = findRanks(prefix);
      out.push({start, end, startTime: h1 || null, endTime, label, labeled, isEntry, ranks: ranks.length ? ranks : findRanks(head)});
    }
  });
  const seen = new Set();
  return out.filter(p => { const k = `${p.start}|${p.end}|${p.label}|${p.isEntry}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// 「S1〜S6」「B1-A3」「Aランク」「全ランク」などから対象ランクを集める。
export function findRanks(text) {
  const t = toFull(text).replace(/ランク/g, 'ランク ');
  const set = new Set();
  if (/全ランク|すべてのランク|全てのランク/.test(t)) RANKS.forEach(r => set.add(r));
  const ORDER = ['E1', 'E2', 'E3', ...RANKS]; // E帯は範囲の端としてだけ使い、結果には含めない
  for (const m of t.matchAll(/([SABCDE])([1-6])\s*[〜~～\-–ー]\s*([SABCDE])([1-6])/g)) {
    const a = ORDER.indexOf(m[1] + m[2]), b = ORDER.indexOf(m[3] + m[4]);
    if (a >= 0 && b >= 0) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) set.add(ORDER[i]);
  }
  for (const m of t.matchAll(/(?:^|[^A-Za-z])([SABCD])ランク/g)) RANKS.filter(r => r[0] === m[1]).forEach(r => set.add(r));
  return RANKS.filter(r => set.has(r));
}

// 大型イベント：全体のボーダーを動かしうる、ランク横断の年間・季節の大会だけ（タイトルで判定）。
const BIG = /POCO\s?LAND|POCO\s?AWARD|ギルドカップ|Pococha\s?甲子園|世代ウォーズ|周年祭|総合ランキング/i;
export function classify(title, text) {
  const s = `${title}\n${text.slice(0, 1500)}`;
  if (BIG.test(title)) return 'big';
  if (/新規ライバー|デビュー|ルーキー/.test(title)) return 'newcomer';
  if (/ミッション/.test(title)) return 'mission';
  if (/アイテム|イベントカレンダー/.test(title)) return 'item';
  if (/×|コラボ|出演権|モデル|オーディション|決定戦|選抜/.test(s.slice(0, 200))) return 'collab';
  if (/イベント|ランキング|開催/.test(title)) return 'event';
  return 'notice';
}

export function toEvent(source, url, html) {
  const {title, published, modified} = articleMeta(html);
  const text = articleText(html);
  const periods = findPeriods(text, modified || published);
  // 公開日〜最終更新日の前後だけを対象にする（過去の実績紹介や翌年の予告を拾いすぎないため）。
  const lo = published ? Date.parse(published.slice(0, 10)) - 30 * 864e5 : -Infinity;
  const hi = modified ? Date.parse(modified.slice(0, 10)) + 90 * 864e5 : Infinity;
  const main = periods.filter(p => !p.isEntry && Date.parse(p.start) >= lo && Date.parse(p.start) <= hi);
  const type = classify(title, text);
  const ranks = findRanks(text);
  // 期間が1つだけのときは記事全体の期間とみなす。複数あるとき（予定表・まとめ記事）は periods を個別に使う。
  const single = main.length === 1 ? main[0] : null;
  const confidence = !main.length ? 'none' : main.some(p => p.labeled) ? 'high' : 'low';
  return {id: url.split('/').pop(), title, url, sourceId: source.id, sourceKind: source.kind, published, modified, type,
    start: single?.start || null, end: single?.end || null, periods: main.map(({isEntry, ...p}) => p), ranks, confidence};
}

async function listArticles(source, {since, backfill}) {
  const urls = new Map();
  const rss = await get(source.rss);
  for (const m of rss.matchAll(/<item>[\s\S]*?<link>([^<]+)<\/link>[\s\S]*?<pubDate>([^<]+)<\/pubDate>[\s\S]*?<\/item>/g)) urls.set(m[1].trim(), new Date(m[2]).toISOString());
  if (backfill && source.sitemap) {
    const xml = gunzipSync(await get(source.sitemap, {binary: true})).toString('utf8');
    for (const m of xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*(?:<lastmod>([^<]+)<\/lastmod>)?/g)) {
      if (!/\/n\/[a-z0-9]+$/.test(m[1])) continue;
      if (!m[2] || m[2].slice(0, 10) >= since) if (!urls.has(m[1])) urls.set(m[1], m[2] || null);
    }
  }
  return [...urls.keys()];
}

export async function collect({file, since, backfill, delay, log = console.error}) {
  let store = {schema: 'poco-events-v1', note: '', sources: [], events: [], skipped: []};
  try { store = JSON.parse(await readFile(file, 'utf8')); } catch {}
  const byId = new Map(store.events.map(e => [e.url, e]));
  const report = {fetched: 0, added: 0, updated: 0, blocked: null, errors: []};
  for (const source of SOURCES) {
    let list;
    try { list = await listArticles(source, {since, backfill}); } catch (e) { if (e instanceof Blocked) { report.blocked = e.message; continue; } throw e; }
    for (const url of list) {
      if (byId.has(url) && byId.get(url).confidence !== 'none' && !process.argv.includes('--refresh')) continue;
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
    note: 'イベント名・期間・対象ランク・URLなどの事実だけを記録。本文は保存しない。confidence: high=「開催期間」等の見出し付きの期間を検出 / low=見出しなしの期間 / none=期間を検出できず。',
    updatedAt: new Date().toISOString(),
    sources: SOURCES.map(({id, name, kind, home, checked}) => ({id, name, kind, home, checked})),
    pending: [
      {kind: 'personal-note', status: '未収集', reason: 'note の /search は robots.txt で不許可。記事の発見手段（作者のRSS等）を決め、作者ごとに転載可否を確認してから追加する'},
      {kind: 'personal-blog', status: '未収集', reason: 'ブログごとに利用規約・robots.txt・転載可否の確認が必要。HAISHIN LAB は無断転載禁止のため使わない'},
    ],
    events,
  };
  await writeFile(file, JSON.stringify(out, null, 1) + '\n');
  return {...report, total: events.length};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await collect({file: arg('file', 'data/events.json'), since: arg('since', '2024-12-01'), backfill: process.argv.includes('--backfill'), delay: +arg('delay', '1500')});
  console.log(JSON.stringify(r));
}
