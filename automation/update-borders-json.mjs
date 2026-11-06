// Fetches the latest daily borders from the public source and merges them into
// data/borders.json (same shape as the former Sites GET /api/borders).
// Usage: node automation/update-borders-json.mjs [--file=data/borders.json]
// Exit 0: checked (ok/partial). Exit 2: stopped (403, network, invalid source); the
// sync status is still written so the page can show that the check failed.
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {discoverArticles, parseArticle, SOURCE_INDEX, RANKS, validDate, validTriple, sourceUrl, jstDate} from '../lib/border-source.mjs';
import {decodePNG, readTables, rowsFromResults} from './table-reader.mjs';

const SOURCE_HOST = 'one-carat.com';
const TIMEOUT_MS = 15000;
const MAX_BYTES = 3600000;
const MAX_IMAGE_BYTES = 8000000;
const TABLE_LOOKBACK_DAYS = 40;
const IMAGE_PREFIX = 'https://one-carat.com/campus/wp-content/uploads/';
export const MESSAGES = {
  ok: '掲載済みの日別ボーダーを確認しました。',
  partial: '一部の取得先を確認できませんでした。取得済みの値を保持しています。',
  unavailable: '更新元を取得できませんでした。前回の値を保持しています。',
};

export class StopError extends Error {
  constructor(code, detail = {}) { super(code); this.code = code; this.detail = detail; }
}

async function readLimited(response) {
  const declared = response.headers.get('content-length');
  if (declared && Number(declared) > MAX_BYTES) throw new StopError('response-too-large');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw new StopError('response-too-large');
  return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
}

// GET only. Retries once on network errors or 5xx; never on 403 or other 4xx.
async function getSource(url, fetch, log) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.host !== SOURCE_HOST) throw new StopError('host-not-allowed', {url: u.origin + u.pathname});
  for (let attempt = 1; attempt <= 2; attempt++) {
    const entry = {url: u.origin + u.pathname, attempt};
    let response;
    try {
      response = await fetch(url, {headers: {Accept: 'text/html'}, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS)});
    } catch {
      entry.status = 0;
      log.push(entry);
      if (attempt < 2) continue;
      throw new StopError('network', {url: entry.url});
    }
    entry.status = response.status;
    entry.contentType = response.headers.get('content-type') || '';
    log.push(entry);
    if (response.status === 403) throw new StopError('forbidden', {url: entry.url});
    if (response.status >= 500 && attempt < 2) continue;
    if (response.status !== 200) throw new StopError('http-' + response.status, {url: entry.url});
    if (!entry.contentType.includes('text/html')) throw new StopError('unexpected-content-type', {url: entry.url});
    return readLimited(response);
  }
  throw new StopError('unreachable');
}

// Binary GET for table images: same host rule, 403 never retried, PNG only, size-limited.
async function getImage(url, fetch, log) {
  if (!url.startsWith(IMAGE_PREFIX) || !/\.png$/i.test(new URL(url).pathname)) throw new StopError('image-url-not-allowed', {url});
  for (let attempt = 1; attempt <= 2; attempt++) {
    const entry = {url, attempt};
    let response;
    try { response = await fetch(url, {headers: {Accept: 'image/png'}, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS)}); }
    catch { entry.status = 0; log.push(entry); if (attempt < 2) continue; throw new StopError('network', {url}); }
    entry.status = response.status; entry.contentType = response.headers.get('content-type') || ''; log.push(entry);
    if (response.status === 403) throw new StopError('forbidden', {url});
    if (response.status >= 500 && attempt < 2) continue;
    if (response.status !== 200) throw new StopError('http-' + response.status, {url});
    if (!entry.contentType.includes('image/png')) throw new StopError('unexpected-content-type', {url});
    const declared = response.headers.get('content-length');
    if (declared && Number(declared) > MAX_IMAGE_BYTES) throw new StopError('response-too-large', {url});
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new StopError('response-too-large', {url});
    return bytes;
  }
  throw new StopError('unreachable');
}

// Every monthly article listed on the index page: {url, month: 'YYYY-MM', close}.
export function listMonthlyArticles(indexHTML) {
  const found = new Map();
  for (const m of indexHTML.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const title = m[2].replace(/<[^>]*>/g, '');
    const period = title.match(/(20\d{2})年(\d{1,2})月/), close = title.match(/(13|22|24)時締め/);
    if (!period || !close || !/Pococha.*ボーダー/.test(title)) continue;
    let url; try { url = new URL(m[1], SOURCE_INDEX).href.replace(/\/$/, ''); } catch { continue; }
    if (!sourceUrl(url)) continue;
    const month = `${period[1]}-${String(+period[2]).padStart(2, '0')}`;
    if (!found.has(month + '|' + close[1])) found.set(month + '|' + close[1], {url, month, close: close[1]});
  }
  return [...found.values()];
}

// The three table images of a monthly article, identified by their alt text.
export function tableImages(html, close) {
  const out = {};
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const alt = m[0].match(/\balt=["']([^"']*)["']/)?.[1], src = m[0].match(/\bsrc=["'](https:\/\/one-carat\.com\/campus\/wp-content\/uploads\/[^"']+\.png)["']/i)?.[1];
    const g = alt?.match(new RegExp('^' + close + '時締め_(D1-C3|B1-A3|S1-S6)$'));
    if (g && src && !out[g[1]]) out[g[1]] = src;
  }
  return Object.keys(out).length === 3 ? out : null;
}

const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// Second channel: fills only days that are still missing, from the monthly table images.
// The text channel normally covers the last two days (13時 data is published about two days later),
// so only older gaps are looked up. Days already confirmed blank in a finished month are skipped.
export async function collectFromTables({fetch, now = new Date(), data, indexHTML, htmlCache = new Map(), lookbackDays = TABLE_LOOKBACK_DAYS, skip = new Set()}) {
  const log = [], today = jstDate(now), have = new Set(data.records.map(r => r.date + '|' + r.close));
  const missing = new Set();
  for (let d = addDays(today, -lookbackDays); d <= addDays(today, -3); d = addDays(d, 1)) for (const c of ['13', '22', '24']) { const k = d + '|' + c; if (!have.has(k) && !skip.has(k)) missing.add(k); }
  if (missing.size === 0) return {status: 'not-needed', rows: [], images: [], log, blanks: []};
  const months = new Set([...missing].map(k => k.slice(0, 7)));
  const articles = listMonthlyArticles(indexHTML).filter(a => months.has(a.month));
  const tables = [], skipped = [];
  for (const a of articles) {
    const html = htmlCache.get(a.url) ?? await getSource(a.url, fetch, log);
    htmlCache.set(a.url, html);
    const imgs = tableImages(html, a.close);
    if (!imgs) { skipped.push({article: a.url, reason: 'table images not found'}); continue; }
    for (const [group, url] of Object.entries(imgs)) {
      const bytes = await getImage(url, fetch, log);
      let img; try { img = decodePNG(bytes); } catch (e) { skipped.push({image: url, reason: String(e.message)}); continue; }
      tables.push({key: url, url, sha256: createHash('sha256').update(bytes).digest('hex'), month: a.month, close: a.close, group, article: a.url, img});
    }
  }
  if (!tables.length) return {status: 'no-tables', rows: [], images: [], skipped, log, missing: missing.size};
  const known = (date, close) => data.records.find(r => r.date === date && r.close === close)?.ranks;
  const {results, images} = readTables(tables, known, {wanted: (date, close) => missing.has(date + '|' + close) && date < today});
  const articleFor = new Map(tables.map(t => [t.month + '|' + t.close, t.article]));
  const {rows, rejected} = rowsFromResults(results, (date, close) => articleFor.get(date.slice(0, 7) + '|' + close));
  const shaFor = new Map(tables.map(t => [t.url, t.sha256]));
  // A missing day of a finished month whose three trusted table images have no values for it is
  // recorded as blank in the source, so later runs do not download the images again for it.
  const trusted = new Set(images.filter(i => i.trusted).map(i => i.key)), blanks = [];
  for (const k of missing) {
    const [date, close] = k.split('|');
    if (date.slice(0, 7) >= today.slice(0, 7)) continue;
    const own = tables.filter(t => t.month === date.slice(0, 7) && t.close === close);
    const lastRow = (Number(date.slice(8)) - 1) * 3 + 2; // the day's "+2" row must exist in every image
    if (own.length === 3 && own.every(t => trusted.has(t.key) && t.parsed.slots > lastRow) && !results.some(r => r.date === date && r.close === close)) blanks.push({date, close});
  }
  return {status: 'checked', rows: rows.map(r => ({...r, images: r.images.map(u => ({url: u, sha256: shaFor.get(u)}))})), images, rejected, skipped, log, missing: missing.size, blanks};
}

// Adds table rows only for days that are still absent; never replaces a saved day.
export function addMissingRows(data, rows, now = new Date()) {
  const stamp = now.toISOString(), have = new Set(data.records.map(r => r.date + '|' + r.close));
  const added = [];
  const records = data.records.slice();
  for (const r of rows) {
    const key = r.date + '|' + r.close;
    if (have.has(key) || !sourceUrl(r.sourceURL)) continue;
    records.push({date: r.date, close: r.close, ranks: Object.fromEntries(RANKS.filter(k => r.ranks[k]).map(k => [k, r.ranks[k]])), sourceURL: r.sourceURL, checkedAt: stamp});
    have.add(key); added.push(r);
  }
  records.sort((a, b) => a.date.localeCompare(b.date) || a.close.localeCompare(b.close));
  return {data: validateData({...data, records}), added};
}

export async function collectFromSource({fetch, now = new Date(), htmlCache = new Map()}) {
  const log = [], articles = [];
  const indexHTML = await getSource(SOURCE_INDEX, fetch, log);
  const urls = discoverArticles(indexHTML).slice(0, 3);
  if (urls.length === 0) throw new StopError('no-articles-discovered');
  const rows = [];
  for (const url of urls) {
    const html = await getSource(url, fetch, log);
    htmlCache.set(url, html);
    try {
      const row = parseArticle(html, url, now);
      if (rows.some(r => r.close === row.close)) { articles.push({url, result: 'duplicate-cutoff'}); continue; }
      rows.push(row);
      articles.push({url, result: 'valid', date: row.date, close: row.close});
    } catch (error) {
      articles.push({url, result: 'rejected', reason: String(error?.message ?? 'invalid').slice(0, 120)});
    }
  }
  const closes = new Set(rows.map(r => r.close));
  return {rows, partial: ['13', '22', '24'].some(c => !closes.has(c)), log, articles, indexHTML};
}

export function validateData(data) {
  if (!data || !Array.isArray(data.records) || typeof data.sync !== 'object' || data.sync === null) throw new Error('Invalid borders data');
  const seen = new Set();
  for (const r of data.records) {
    const key = r?.date + '|' + r?.close;
    if (!validDate(r?.date) || !['13', '22', '24'].includes(r?.close) || !sourceUrl(r?.sourceURL) || seen.has(key)) throw new Error('Invalid border record ' + key);
    const ranks = Object.entries(r.ranks ?? {});
    if (ranks.length < 1 || ranks.length > 18 || ranks.some(([rank, v]) => !RANKS.includes(rank) || !validTriple(v))) throw new Error('Invalid border ranks ' + key);
    if (r.checkedAt !== undefined && !Number.isFinite(Date.parse(r.checkedAt))) throw new Error('Invalid checkedAt ' + key);
    seen.add(key);
  }
  for (const field of ['last_attempt', 'last_success']) {
    const v = data.sync[field];
    if (v !== '' && v !== undefined && !Number.isFinite(Date.parse(v))) throw new Error('Invalid sync ' + field);
  }
  return data;
}

// Collected rows are the latest verified observation for their (date, close):
// they are added, or replace a differing saved day (as the former server did).
// Days that were not collected are never touched; missing days stay missing.
export function mergeBorders(data, collected, now = new Date()) {
  const stamp = now.toISOString();
  const records = data.records.map(r => ({...r}));
  const index = new Map(records.map((r, i) => [r.date + '|' + r.close, i]));
  let added = 0, changed = 0, confirmed = 0;
  for (const row of collected.rows) {
    const key = row.date + '|' + row.close;
    const next = {date: row.date, close: row.close, ranks: row.ranks, sourceURL: row.sourceURL, checkedAt: stamp};
    if (!index.has(key)) { index.set(key, records.push(next) - 1); added++; continue; }
    const old = records[index.get(key)];
    const same = JSON.stringify(old.ranks) === JSON.stringify(row.ranks) && old.sourceURL === row.sourceURL;
    records[index.get(key)] = next;
    if (same) confirmed++; else changed++;
  }
  records.sort((a, b) => a.date.localeCompare(b.date) || a.close.localeCompare(b.close));
  const ok = collected.rows.length > 0;
  const status = ok ? (collected.partial ? 'partial' : 'ok') : 'unavailable';
  const sync = {
    last_attempt: stamp,
    last_success: ok ? stamp : (data.sync.last_success ?? ''),
    status,
    message: MESSAGES[status],
  };
  return {data: validateData({records, sync, serverDate: jstDate(now)}), added, changed, confirmed};
}

export function markUnavailable(data, now = new Date()) {
  return validateData({records: data.records, sync: {last_attempt: now.toISOString(), last_success: data.sync.last_success ?? '', status: 'unavailable', message: MESSAGES.unavailable}, serverDate: jstDate(now)});
}

async function readProvenance(file) {
  try { const list = JSON.parse(await readFile(file, 'utf8')); return Array.isArray(list) ? list : []; } catch { return []; }
}
async function appendProvenance(file, entries) {
  if (!entries.length) return;
  await writeFile(file, JSON.stringify((await readProvenance(file)).concat(entries), null, 1) + '\n');
}

export async function updateBordersFile({file, fetch, now = new Date(), tables = true, provenanceFile = join(dirname(file), 'border-provenance.json')}) {
  const data = validateData(JSON.parse(await readFile(file, 'utf8')));
  const report = {startedAt: now.toISOString(), file};
  try {
    const htmlCache = new Map();
    const collected = await collectFromSource({fetch, now, htmlCache});
    const merged = mergeBorders(data, collected, now);
    let result = merged.data;
    Object.assign(report, {outcome: 'ok', status: result.sync.status, added: merged.added, changed: merged.changed, confirmed: merged.confirmed, articles: collected.articles, log: collected.log});
    // Second channel (table images). Its failure never undoes the text result.
    if (tables) {
      try {
        const skip = new Set((await readProvenance(provenanceFile)).filter(e => e.status === 'not-in-source').map(e => e.date + '|' + e.close));
        const t = await collectFromTables({fetch, now, data: result, indexHTML: collected.indexHTML, htmlCache, skip});
        const filled = addMissingRows(result, t.rows, now);
        result = filled.data;
        report.table = {status: t.status, missingBefore: t.missing ?? 0, added: filled.added.map(r => r.date + '|' + r.close + ' (' + Object.keys(r.ranks).length + ' ranks)'), blankInSource: (t.blanks ?? []).map(b => b.date + '|' + b.close), images: t.images, rejected: t.rejected, skipped: t.skipped, log: t.log};
        await appendProvenance(provenanceFile, [
          ...filled.added.map(r => ({date: r.date, close: r.close, channel: 'onecarat-table-image', status: 'added', ranks: Object.keys(r.ranks).length, sourceURL: r.sourceURL, images: r.images, addedAt: now.toISOString()})),
          ...(t.blanks ?? []).map(b => ({date: b.date, close: b.close, channel: 'onecarat-table-image', status: 'not-in-source', checkedAt: now.toISOString()})),
        ]);
      } catch (error) {
        report.table = {status: 'stopped', stop: error instanceof StopError ? {code: error.code, ...error.detail} : {code: 'unexpected', message: String(error?.message ?? '').slice(0, 160)}};
      }
    }
    await writeFile(file, JSON.stringify(result) + '\n');
  } catch (error) {
    await writeFile(file, JSON.stringify(markUnavailable(data, now)) + '\n');
    Object.assign(report, {outcome: 'stopped', stop: error instanceof StopError ? {code: error.code, ...error.detail} : {code: 'unexpected', message: String(error?.message ?? '').slice(0, 160)}});
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv.slice(2).find(a => a.startsWith('--file='));
  const report = await updateBordersFile({file: arg ? arg.slice(7) : 'data/borders.json', fetch: globalThis.fetch});
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.outcome === 'ok' ? 0 : 2);
}
