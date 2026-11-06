// Fetches the latest daily borders from the public source and merges them into
// data/borders.json (same shape as the former Sites GET /api/borders).
// Usage: node automation/update-borders-json.mjs [--file=data/borders.json]
// Exit 0: checked (ok/partial). Exit 2: stopped (403, network, invalid source); the
// sync status is still written so the page can show that the check failed.
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {discoverArticles, parseArticle, SOURCE_INDEX, RANKS, validDate, validTriple, sourceUrl, jstDate} from '../lib/border-source.mjs';

const SOURCE_HOST = 'one-carat.com';
const TIMEOUT_MS = 15000;
const MAX_BYTES = 3600000;
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

export async function collectFromSource({fetch, now = new Date()}) {
  const log = [], articles = [];
  const indexHTML = await getSource(SOURCE_INDEX, fetch, log);
  const urls = discoverArticles(indexHTML).slice(0, 3);
  if (urls.length === 0) throw new StopError('no-articles-discovered');
  const rows = [];
  for (const url of urls) {
    const html = await getSource(url, fetch, log);
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
  return {rows, partial: ['13', '22', '24'].some(c => !closes.has(c)), log, articles};
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

export async function updateBordersFile({file, fetch, now = new Date()}) {
  const data = validateData(JSON.parse(await readFile(file, 'utf8')));
  const report = {startedAt: now.toISOString(), file};
  try {
    const collected = await collectFromSource({fetch, now});
    const merged = mergeBorders(data, collected, now);
    await writeFile(file, JSON.stringify(merged.data) + '\n');
    Object.assign(report, {outcome: 'ok', status: merged.data.sync.status, added: merged.added, changed: merged.changed, confirmed: merged.confirmed, articles: collected.articles, log: collected.log});
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
