// Code-side client for the existing border writer API.
// Default mode makes no network request. Modes that touch production must be
// chosen explicitly; this module never schedules itself.
import {createHash, createHmac} from 'node:crypto';
import {open, readFile, rm} from 'node:fs/promises';
import {discoverArticles, parseArticle, SOURCE_INDEX, RANKS} from '../lib/border-source.mjs';

export const SITE_ORIGIN = 'https://poco-meter.freefreelife2000.chatgpt.site';
export const SOURCE_HOST = 'one-carat.com';
export const MODES = Object.freeze({
  plan: 'ネットワークなし。実行予定の手順だけを返す',
  diagnose: 'GETのみ（サイトの取得元URL・取得元一覧・記事）。本番への書き込みなし',
  discover: 'diagnose＋署名付きPOST /api/borders/source-urls（署名の確認と記事URLの判定だけ。DBへの書き込みなし）',
  refresh: 'discover＋署名付きPOST /api/borders/refresh（本番保存）＋GET /api/borders で照合',
});
const TIMEOUT_MS = 15000;
const MAX_BYTES = 3600000;
const LOCK_STALE_MS = 10 * 60 * 1000;
const KNOWN_APP_403 = {
  'このツールは現在非公開です。': 'B',
  'Production writer origin required': 'C',
  'Origin rejected': 'D',
  'Border writer authorization required': 'E/F',
};

export class StopError extends Error {
  constructor(code, step, detail = {}) {
    super(code);
    this.code = code;
    this.step = step;
    this.detail = detail;
  }
}

// Removes values that could be secrets before anything is logged.
export function sanitize(text, secrets = []) {
  let out = String(text ?? '');
  for (const secret of secrets) if (secret) out = out.split(secret).join('[secret]');
  out = out.replace(/\b[a-f0-9]{64}\b/gi, '[hex64]').replace(/Bearer\s+\S+/gi, 'Bearer [secret]').replace(/[\u0000-\u001f\u007f]/g, ' ');
  return out.length > 200 ? out.slice(0, 200) + '…' : out;
}

function logUrl(url) {
  const u = new URL(url);
  return u.origin + u.pathname;
}

function assertAllowed(url, siteOrigin) {
  const u = new URL(url);
  const allowed = u.protocol === 'https:' && (u.origin === siteOrigin || u.host === SOURCE_HOST);
  if (!allowed) throw new StopError('host-not-allowed', 'request', {url: logUrl(url)});
}

export function signBody(keyHex, path, bodyBytes, nowMs) {
  const stamp = String(Math.floor(nowMs / 1000));
  const digest = createHash('sha256').update(bodyBytes).digest('hex');
  const signature = createHmac('sha256', Buffer.from(keyHex, 'hex')).update(`POST\n${path}\n${stamp}\n${digest}`).digest('hex');
  return {'X-Border-Writer-Time': stamp, 'X-Border-Writer-Signature': signature};
}

async function readLimited(response) {
  const declared = response.headers.get('content-length');
  if (declared && Number(declared) > MAX_BYTES) throw new StopError('response-too-large', 'read');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new StopError('response-too-large', 'read');
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks.map(c => Buffer.from(c))));
}

function jsonError(contentType, text, secrets) {
  if (!contentType.includes('application/json')) return '';
  try {
    const value = JSON.parse(text);
    return typeof value?.error === 'string' ? sanitize(value.error, secrets) : '';
  } catch {
    return '';
  }
}

function layerHint(status, contentType, error, host, siteHost) {
  if (status !== 403) return '';
  if (host !== siteHost) return 'G（取得元が拒否）';
  if (KNOWN_APP_403[error]) return KNOWN_APP_403[error];
  return 'A（アプリより手前の層。JSONのアプリ応答ではない）';
}

// One HTTP exchange. GET may retry once on network errors or 5xx; POST never retries; 403 never retries.
async function exchange(ctx, step, {url, method = 'GET', body = null, signed = false, accept = 'application/json'}) {
  assertAllowed(url, ctx.siteOrigin);
  const bytes = body === null ? null : new TextEncoder().encode(body);
  const attempts = method === 'GET' ? 2 : 1;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const headers = {Accept: accept};
    if (bytes) headers['Content-Type'] = 'application/json; charset=utf-8';
    if (signed) Object.assign(headers, signBody(ctx.key, new URL(url).pathname, bytes, ctx.now()));
    const entry = {
      at: new Date(ctx.now()).toISOString(), step, attempt, url: logUrl(url), method,
      sentHeaders: {
        'X-Border-Writer-Time': 'X-Border-Writer-Time' in headers,
        'X-Border-Writer-Signature': 'X-Border-Writer-Signature' in headers,
        Origin: 'Origin' in headers,
      },
    };
    let response;
    try {
      response = await ctx.fetch(url, {method, headers, body: bytes, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS)});
    } catch (error) {
      entry.status = 0;
      entry.error = sanitize(error?.name === 'TimeoutError' ? 'timeout' : 'network error', ctx.secrets);
      ctx.log.push(entry);
      if (attempt < attempts) continue;
      throw new StopError('network', step, {url: entry.url});
    }
    entry.status = response.status;
    entry.contentType = response.headers.get('content-type') || '';
    const text = await readLimited(response);
    const error = jsonError(entry.contentType, text, ctx.secrets);
    if (error) entry.error = error;
    const hint = layerHint(response.status, entry.contentType, error, new URL(url).host, new URL(ctx.siteOrigin).host);
    if (hint) entry.layerHint = hint;
    ctx.log.push(entry);
    if (response.status === 403) throw new StopError('forbidden', step, {url: entry.url, layerHint: hint});
    if (response.status >= 500 && attempt < attempts) continue;
    if (response.status !== 200) throw new StopError('http-' + response.status, step, {url: entry.url});
    return {contentType: entry.contentType, text};
  }
  throw new StopError('unreachable', step);
}

function parseJson(text, step) {
  try {
    return JSON.parse(text);
  } catch {
    throw new StopError('invalid-json', step);
  }
}

async function acquireLock(path, now) {
  if (!path) return async () => {};
  for (let tries = 0; tries < 2; tries++) {
    try {
      const handle = await open(path, 'wx');
      await handle.writeFile(JSON.stringify({pid: process.pid, at: now()}));
      await handle.close();
      return async () => rm(path, {force: true});
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let at = 0;
      try { at = JSON.parse(await readFile(path, 'utf8')).at; } catch { /* unreadable lock counts as fresh */ at = now(); }
      if (now() - at < LOCK_STALE_MS) throw new StopError('already-running', 'lock');
      await rm(path, {force: true});
    }
  }
  throw new StopError('already-running', 'lock');
}

export function planSteps(mode) {
  const steps = [
    'GET /api/borders/source-urls（サイト）',
    'GET 取得元一覧（one-carat.com）',
    'ローカルで記事URLを判定',
    'GET 各締め時間の最新記事（最大3件）',
    'ローカルで日付・締め時間・18ランクを検証',
  ];
  if (mode === 'discover' || mode === 'refresh') steps.splice(3, 0, '署名付きPOST /api/borders/source-urls（署名の確認と記事URLの判定。DBへの書き込みなし）');
  if (mode === 'refresh') steps.push('署名付きPOST /api/borders/refresh（本番保存）', 'GET /api/borders で保存内容と同期状態を照合');
  return steps;
}

export async function runBorderWriter(options = {}) {
  const mode = options.mode ?? 'plan';
  if (!(mode in MODES)) throw new StopError('unknown-mode', 'config');
  const now = options.now ?? (() => Date.now());
  const report = {mode, startedAt: new Date(now()).toISOString(), steps: planSteps(mode), outcome: 'planned', articles: [], log: []};
  if (mode === 'plan') return report;

  const key = options.env?.BORDER_WRITER_KEY;
  const needsKey = mode === 'discover' || mode === 'refresh';
  if (needsKey && (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key))) return stopped(report, new StopError('writer-key-missing', 'config'), now);
  if (mode === 'refresh' && options.confirmProductionWrite !== true) return stopped(report, new StopError('production-write-not-confirmed', 'config'), now);
  if (typeof options.fetch !== 'function') return stopped(report, new StopError('fetch-missing', 'config'), now);

  const ctx = {fetch: options.fetch, now, key, secrets: [key], siteOrigin: options.siteOrigin ?? SITE_ORIGIN, log: report.log};
  let release = async () => {};
  try {
    release = await acquireLock(options.lockPath, now);
    const source = parseJson((await exchange(ctx, 'site-source-urls', {url: ctx.siteOrigin + '/api/borders/source-urls'})).text, 'site-source-urls');
    if (source?.indexURL !== SOURCE_INDEX) throw new StopError('unexpected-index-url', 'site-source-urls');
    const indexHTML = (await exchange(ctx, 'source-index', {url: SOURCE_INDEX, accept: 'text/html'})).text;
    let urls = discoverArticles(indexHTML);
    report.localDiscovered = urls.length;
    if (needsKey) {
      const lookup = parseJson((await exchange(ctx, 'signed-discover', {url: ctx.siteOrigin + '/api/borders/source-urls', method: 'POST', body: JSON.stringify({indexHTML}), signed: true})).text, 'signed-discover');
      if (!Array.isArray(lookup?.urls) || lookup.urls.length < 1 || lookup.urls.length > 3) throw new StopError('invalid-discover-response', 'signed-discover');
      report.serverDiscovered = lookup.discovered;
      urls = lookup.urls;
    }
    if (urls.length === 0) throw new StopError('no-articles-discovered', 'source-index');
    const accepted = [];
    for (const url of urls.slice(0, 3)) {
      const html = (await exchange(ctx, 'source-article', {url, accept: 'text/html'})).text;
      try {
        const row = parseArticle(html, url, new Date(now()));
        if (accepted.some(a => a.row.close === row.close)) {
          report.articles.push({url, result: 'duplicate-cutoff'});
          continue;
        }
        accepted.push({url, html, row});
        report.articles.push({url, result: 'valid', date: row.date, close: row.close});
      } catch (error) {
        report.articles.push({url, result: 'rejected', reason: sanitize(error?.message, ctx.secrets)});
      }
    }
    report.partial = accepted.length < 3;
    if (mode !== 'refresh') {
      report.outcome = 'ok';
      return finish(report, now);
    }
    if (accepted.length === 0) throw new StopError('no-valid-articles', 'validate');
    const startedAt = report.startedAt;
    const saved = parseJson((await exchange(ctx, 'signed-refresh', {url: ctx.siteOrigin + '/api/borders/refresh', method: 'POST', body: JSON.stringify({articles: accepted.map(a => ({url: a.url, html: a.html}))}), signed: true})).text, 'signed-refresh');
    report.refreshResponse = {busy: saved?.busy === true, changedDays: saved?.changedDays, fetchedDays: saved?.fetchedDays};
    if (saved?.busy === true) throw new StopError('server-busy', 'signed-refresh');
    // POST 200 alone is not success: read back the shared data and compare.
    const published = parseJson((await exchange(ctx, 'verify', {url: ctx.siteOrigin + '/api/borders'})).text, 'verify');
    report.verification = verifyPublished(published, accepted.map(a => a.row), startedAt);
    report.outcome = report.verification.ok ? 'ok' : 'unverified';
    return finish(report, now);
  } catch (error) {
    return stopped(report, error, now);
  } finally {
    await release();
  }
}

export function verifyPublished(published, rows, startedAt) {
  const sync = published?.sync ?? {};
  const records = Array.isArray(published?.records) ? published.records : [];
  const attempted = typeof sync.last_attempt === 'string' && sync.last_attempt >= startedAt;
  const missing = [];
  for (const row of rows) {
    const record = records.find(r => r.date === row.date && r.close === row.close);
    const same = record && RANKS.every(rank => JSON.stringify(record.ranks?.[rank]) === JSON.stringify(row.ranks[rank]));
    if (!same) missing.push(row.date + '|' + row.close);
  }
  return {ok: attempted && ['ok', 'partial'].includes(sync.status) && missing.length === 0, attempted, status: sync.status ?? '', missing};
}

function finish(report, now) {
  report.finishedAt = new Date(now()).toISOString();
  return report;
}

function stopped(report, error, now) {
  if (!(error instanceof StopError)) error = new StopError('unexpected', 'internal', {message: sanitize(error?.message)});
  report.outcome = 'stopped';
  report.stop = {code: error.code, step: error.step, ...error.detail};
  return finish(report, now);
}
