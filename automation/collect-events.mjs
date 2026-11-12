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

// note の記事本文（note-common-styles__textnote-body の div）だけを取り出す。見つからなければページ全体。
export function articleBody(html) {
  const i = html.indexOf('note-common-styles__textnote-body');
  if (i < 0) return html;
  const s = html.lastIndexOf('<div', i);
  const re = /<\/?div\b/g; re.lastIndex = s;
  let depth = 0, m;
  while ((m = re.exec(html))) { depth += m[0] === '<div' ? 1 : -1; if (depth === 0) return html.slice(s, m.index); }
  return html.slice(s);
}

export function articleText(html) {
  return decode(articleBody(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<h[2-4][^>]*>/gi, '\n## ')
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
      const prefix = line.slice(0, m.index).replace(/^## /, '');
      const head = [lines[li - 1], lines[li - 2]].filter(Boolean).join(' ');
      // 直前の見出し（## 行）。日付の行から12行以内のもの。
      let heading = null;
      for (let k = li - 1; k >= Math.max(0, li - 12); k--) if (/^## /.test(lines[k] || '')) { heading = cleanLabel(lines[k].slice(3)); break; }
      const ctx = `${heading || ''} ${prefix}`;
      const labeled = /開催期間|イベント期間|開催日程|開催日時|キャンペーン期間|期間[:：]|予選|本戦|準決勝|決勝|ステージ|リーグ|より(開催|スタート|開始)/.test(prefix + m[0]);
      const isEntry = /エントリー?期間|応募期間|申込|受付/.test(prefix);
      // イベントそのものの期間ではないもの（使用期限・配信時間・募集や選考・結果発表など）
      const nonEvent = NON_EVENT.test(prefix) || (!labeled && NON_EVENT.test(heading || ''));
      const mins = x => x ? +x.split(':')[0] * 60 + +x.split(':')[1] : null;
      const slot = end === start && h1 && endTime && mins(endTime) > mins(h1) && mins(endTime) - mins(h1) <= 180 && !labeled;
      out.push({start, end, startTime: h1 || null, endTime, label: pickLabel(prefix, heading), labeled, isEntry: isEntry || nonEvent || slot,
        kind: isEntry ? 'entry' : nonEvent ? 'other' : slot ? 'slot' : 'event', ranks: findRanks(ctx).length ? findRanks(ctx) : findRanks(head)});
    }
  });
  // 同じ期間の重複はまとめる（名前は見出し付き・具体的なものを残す）。
  const best = new Map();
  for (const p of out) {
    const k = `${p.start}|${p.end}|${p.isEntry}`, cur = best.get(k);
    const score = q => (q.labeled ? 2 : 0) + (q.label ? 1 : 0) + (q.ranks.length ? 1 : 0);
    if (!cur || score(p) > score(cur)) best.set(k, p);
  }
  return [...best.values()];
}

export const NON_EVENT = /使用期限|有効期限|利用期限|交換期限|獲得対象期限|次回配信|配信日時|配信スケジュール|配信予定|放送|募集期間|応募|選考|審査|結果発表|発表日|受け?取り期限|付与|適用期間|お届け予定|販売期間|購入期間/;
export const GENERIC = /^(開催期間|イベント期間|開催日程|開催日時|キャンペーン期間|集計期間|期間|日程|スケジュール|第\d+日程|イベント名)$/;
export function cleanLabel(s) {
  return String(s || '').replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, '').replace(/[:：\s・■▼▶︎●◆◇★☆【】]+$/, '').replace(/^[\s・■▼▶︎●◆◇★☆]+/, '')
    .replace(/^イベント名\s*[:：]\s*/, '').replace(/\s+/g, ' ').trim();
}
// 見出しの決まり文句（概要・詳細・ルール・「〜について」・末尾の「開催期間」等）を名前から外す。
// 決まり文句しか残らないときは記事タイトルの名前を使う。予選・本戦・投票などの段階名は残す。
const BOILER = /^(?:(?:イベント|キャンペーン|企画|大会)?(?:概要|詳細|内容|ルール|の流れ)(?:[/・／](?:概要|詳細|ルール|内容))*|この記事でご紹介する内容|この記事の内容|豪華賞品はこちら[！!]?|対象ランク|対象者?|スケジュール|エントリー?)$/;
// 記事タイトルから名前を作る：『』「」の名前を優先し、日付やお知らせの【】と「のご紹介」を外し、切れた括弧を残さない。
// 括弧の外に残る語が短い（「〜」開催決定！）か決まり文句（の概要）なら、括弧内だけを名前にする
const QUOTE_TAIL = /^(?:の?(?:概要|詳細|内容|ご紹介|お知らせ|ルール説明)|(?:開催|決定|に関する|をPocochaで).*|.{0,10})$/;
// 閉じていない括弧は記号だけ外し（中身は残す）、末尾の区切り記号を落とす
function cutDangling(t) {
  for (const [o, c] of [['【', '】'], ['「', '」'], ['『', '』'], ['（', '）'], ['(', ')']]) {
    if (t.lastIndexOf(o) > t.lastIndexOf(c)) t = t.slice(0, t.lastIndexOf(o)) + ' ' + t.slice(t.lastIndexOf(o) + 1);
  }
  return t.replace(/\s+/g, ' ').replace(/[\s：:・、〜~×-]+$/, '').trim();
}
// 長い名前は区切り（空白・！・」など）で切る。区切りが前すぎるときは文字数で切る
function cutAt(t, max) {
  if (t.length <= max) return t;
  const head = t.slice(0, max), i = Math.max(...[' ', '！', '!', '」', '』', '】', '×'].map(ch => head.lastIndexOf(ch)));
  return i >= 20 ? head.slice(0, i + (/[！!」』】]/.test(head[i]) ? 1 : 0)) : head;
}
export function titleNameOf(title) {
  const raw = cleanLabel(String(title || '').replace(/[＼／]/g, ' '));
  // 日付・お知らせだけの【】（【9/16〜9/29】【期間限定】【新イベ開催予告】など）は外す
  const stripped = raw.replace(/【[^】]*(?:\d+\s*[/月]|限定|登場|開催予告|お知らせ|更新|追記|速報|NEW|予告|結果発表)[^】]*】/g, ' ').replace(/\s+/g, ' ').trim();
  let t = stripped.length >= 6 ? stripped : raw;
  t = t.replace(/(?:のご紹介|開催決定|を開催|開催)[！!]*$/, '').trim();
  const q = t.match(/^[^『「]{0,20}[『「]([^』」]{4,40})[』」](.*)$/);
  if (q && QUOTE_TAIL.test(q[2].trim())) return q[1];
  return cutDangling(cutAt(t, 48)) || cutDangling(raw.slice(0, 48));
}
export function tidyLabel(label, titleName) {
  let l = cleanLabel(label);
  for (let i = 0; i < 3; i++) {
    const before = l;
    l = l.replace(/\s*(?:の)?(?:開催期間|イベント期間|キャンペーン期間|開催日程|開催日時)$/, '').replace(/\s*について$/, '').trim();
    const parts = l.split(' ');
    if (parts.length > 1 && BOILER.test(parts[0])) l = parts.slice(1).join(' ');
    if (parts.length > 1 && BOILER.test(parts[parts.length - 1])) l = parts.slice(0, -1).join(' ');
    l = l.replace(/^(?:\d+月実施予定[！!]?\s*)?Pococha内イベント/, '').trim();
    const q = l.match(/^[^「『]{0,30}[「『]([^」』]{2,40})[」』](.+)$/);
    if (q && QUOTE_TAIL.test(q[2].trim())) l = q[1];
    l = cutDangling(l);
    if (l === before) break;
  }
  if (!l || l.length < 2 || GENERIC.test(l) || BOILER.test(l) || /^(?:イベント|キャンペーン)$/.test(l)) return titleName || null;
  // 以前の収集で記事タイトルを途中で切った名前は、整えた記事タイトルの名前に置き換える
  if (titleName && titleName.length > l.length && titleName.startsWith(l)) return titleName;
  return l;
}
// 名前の決め方：①行内の『』「」で囲まれた名前 ②行の前置きが短い名前ならそれ ③直前の見出し（＋前置きが「開催期間」等なら付ける）
export function pickLabel(prefix, heading) {
  const p = cleanLabel(prefix);
  const quoted = p.match(/[『「]([^』」]{2,40})[』」]/);
  if (quoted) return quoted[1];
  const short = p && p.length >= 2 && p.length <= 24 && !/[。、！？!?]|です|ます|こちら|以下|本記事|こんにちは/.test(p) && !/^[\d※＊*（(]|\/$|^【?$/.test(p);
  if (short && !GENERIC.test(p)) return p;
  if (heading && heading.length <= 40) return short && GENERIC.test(p) ? `${heading} ${p}` : heading;
  return short ? p : null;
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
  const titleName = titleNameOf(title);
  const main = periods.filter(p => !p.isEntry && Date.parse(p.start) >= lo && Date.parse(p.start) <= hi).map(p => ({...p, label: p.label && !GENERIC.test(p.label) ? tidyLabel(p.label, titleName) : titleName}));
  const type = classify(title, text);
  const ranks = findRanks(text);
  // 期間が1つだけのときは記事全体の期間とみなす。複数あるとき（予定表・まとめ記事）は periods を個別に使う。
  const single = main.length === 1 ? main[0] : null;
  const confidence = !main.length ? 'none' : main.some(p => p.labeled) ? 'high' : 'low';
  return {id: url.split('/').pop(), title, url, sourceId: source.id, sourceKind: source.kind, published, modified, type,
    start: single?.start || null, end: single?.end || null, periods: main.map(({isEntry, kind, ...p}) => p), ranks, confidence, audience: audienceOf(title, text),
    excluded: periods.filter(p => p.isEntry).length, fetchedAt: new Date().toISOString()};
}

// イベントの対象（内容の手がかり）。タイトルと本文の冒頭から判定する。
export function audienceOf(title, text) {
  const s = `${title}\n${String(text).slice(0, 2000)}`, out = [];
  if (/ボイス(ライバー|配信)/.test(s)) out.push('ボイス');
  if (/新規ライバー|デビュー|ルーキー/.test(title)) out.push('新規ライバー');
  if (/リスナー(限定|向け|のみ)|リスナーランキング/.test(s)) out.push('リスナー');
  if (/事務所|ギルド/.test(title)) out.push('事務所');
  if (/ファミリー/.test(title)) out.push('ファミリー');
  return out;
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

export async function collect({file, since, backfill, delay, log = console.error}) {
  let store = {schema: 'poco-events-v1', note: '', sources: [], events: [], skipped: []};
  try { store = JSON.parse(await readFile(file, 'utf8')); } catch {}
  const byId = new Map(store.events.map(e => [e.url, e]));
  const report = {fetched: 0, added: 0, updated: 0, blocked: null, errors: []};
  for (const source of SOURCES) {
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
  const r = await collect({file: arg('file', 'data/events.json'), since: arg('since', '2024-12-01'), backfill: process.argv.includes('--backfill'), delay: +arg('delay', '1500')});
  console.log(JSON.stringify(r));
}
