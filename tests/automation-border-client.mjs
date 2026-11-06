// Network-free tests for the Code-side border writer client.
// The "site" is the real borderApi on an in-memory SQLite database; the source
// pages are saved fixtures. No request leaves the process.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, rm, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {borderApi} from '../lib/border-store.mjs';
import {SOURCE_INDEX} from '../lib/border-source.mjs';
import {runBorderWriter, verifyPublished, sanitize, SITE_ORIGIN, planSteps} from '../automation/border-writer-client.mjs';

const KEY = 'ab'.repeat(32);
const fixture = Object.fromEntries(await Promise.all(['13', '22', '24', 'category'].map(async name => [name, await readFile(new URL('./fixtures/' + name + '.html', import.meta.url), 'utf8')])));
const ARTICLES = {
  'https://one-carat.com/campus/archives/89497': fixture['13'],
  'https://one-carat.com/campus/archives/89496': fixture['22'],
  'https://one-carat.com/campus/archives/89495': fixture['24'],
};
const html = body => new Response(body, {headers: {'Content-Type': 'text/html; charset=UTF-8'}});

async function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0000_sweet_corsair.sql', '0006_security_rate_windows.sql']) {
    sqlite.exec((await readFile(new URL('../drizzle/' + file, import.meta.url), 'utf8')).replaceAll('--> statement-breakpoint', ''));
  }
  const DB = {prepare(sql) {
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async all() { return {results: sqlite.prepare(sql).all(...args)}; },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async run() { const meta = sqlite.prepare(sql).run(...args); return {meta, changes: meta.changes}; },
    };
  }};
  return {sqlite, DB};
}

// Fake network: records every call; routes the site origin to the real handler.
function network(serverEnv, overrides = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({url, method: init.method ?? 'GET', headers: {...init.headers}});
    const key = (init.method ?? 'GET') + ' ' + url;
    if (overrides[key]) return overrides[key](url, init, calls);
    if (url.startsWith(SITE_ORIGIN)) return borderApi(new Request(url, {method: init.method, headers: init.headers, body: init.body}), serverEnv);
    if (url === SOURCE_INDEX) return html(fixture.category);
    if (ARTICLES[url]) return html(ARTICLES[url]);
    throw new Error('Unexpected network call ' + url);
  };
  return {fetch, calls};
}
const refuseNetwork = () => { throw new Error('network must not be used'); };

test('plan mode makes no network request', async () => {
  const report = await runBorderWriter({fetch: refuseNetwork});
  assert.equal(report.mode, 'plan');
  assert.equal(report.outcome, 'planned');
  assert.equal(report.log.length, 0);
  assert.deepEqual(report.steps, planSteps('plan'));
});

test('diagnose uses only GET and leaves the database untouched', async () => {
  const {sqlite, DB} = await database();
  const net = network({DB, BORDER_WRITER_KEY: KEY});
  const report = await runBorderWriter({mode: 'diagnose', fetch: net.fetch});
  assert.equal(report.outcome, 'ok');
  assert.ok(net.calls.every(c => c.method === 'GET'));
  assert.ok(net.calls.every(c => !('X-Border-Writer-Signature' in c.headers)));
  assert.deepEqual(report.articles.map(a => a.result), ['valid', 'valid', 'valid']);
  assert.deepEqual(report.articles.map(a => a.close).sort(), ['13', '22', '24']);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM border_days').get().n, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM security_rate_windows').get().n, 0);
});

test('writer modes refuse before any request when the key is missing or malformed', async () => {
  for (const env of [{}, {BORDER_WRITER_KEY: 'short'}, {BORDER_WRITER_KEY: 'AB'.repeat(32)}]) {
    for (const mode of ['discover', 'refresh']) {
      const report = await runBorderWriter({mode, env, fetch: refuseNetwork, confirmProductionWrite: true});
      assert.equal(report.outcome, 'stopped');
      assert.equal(report.stop.code, 'writer-key-missing');
      assert.equal(report.log.length, 0);
    }
  }
});

test('refresh refuses before any request without explicit production confirmation', async () => {
  const report = await runBorderWriter({mode: 'refresh', env: {BORDER_WRITER_KEY: KEY}, fetch: refuseNetwork});
  assert.equal(report.stop.code, 'production-write-not-confirmed');
  assert.equal(report.log.length, 0);
});

test('discover signs one POST that the real server accepts, without saving borders', async () => {
  const {sqlite, DB} = await database();
  const net = network({DB, BORDER_WRITER_KEY: KEY});
  const report = await runBorderWriter({mode: 'discover', env: {BORDER_WRITER_KEY: KEY}, fetch: net.fetch});
  assert.equal(report.outcome, 'ok');
  assert.equal(report.serverDiscovered, 3);
  assert.equal(net.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM border_days').get().n, 0);
  // The server records replay protection only for /api/borders/refresh (lib/border-store.mjs).
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM security_rate_windows WHERE id LIKE 'signed:%'").get().n, 0);
});

test('refresh saves, reads back and verifies; a second run adds no duplicate', async () => {
  const {sqlite, DB} = await database();
  const net = network({DB, BORDER_WRITER_KEY: KEY});
  const first = await runBorderWriter({mode: 'refresh', env: {BORDER_WRITER_KEY: KEY}, fetch: net.fetch, confirmProductionWrite: true});
  assert.equal(first.outcome, 'ok', JSON.stringify(first.stop));
  assert.equal(first.verification.ok, true);
  assert.deepEqual(first.verification.missing, []);
  const ids = first.articles.map(a => a.date + '|' + a.close);
  for (const id of ids) assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM border_days WHERE id=?').get(id).n, 1);
  const rowsAfterFirst = sqlite.prepare('SELECT COUNT(*) n FROM border_days').get().n;
  // A later run (a new second, so a new signature) re-confirms the same data.
  await new Promise(resolve => setTimeout(resolve, 1100));
  const second = await runBorderWriter({mode: 'refresh', env: {BORDER_WRITER_KEY: KEY}, fetch: net.fetch, confirmProductionWrite: true});
  assert.equal(second.outcome, 'ok', JSON.stringify(second.stop));
  assert.equal(second.refreshResponse.changedDays, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM border_days').get().n, rowsAfterFirst);
});

test('a 403 stops at once, is never retried, and text/plain is classified outside the app', async () => {
  const {DB} = await database();
  const net = network({DB}, {['GET ' + SITE_ORIGIN + '/api/borders/source-urls']: () => new Response('Forbidden', {status: 403, headers: {'Content-Type': 'text/plain; charset=UTF-8'}})});
  const report = await runBorderWriter({mode: 'diagnose', fetch: net.fetch});
  assert.equal(report.outcome, 'stopped');
  assert.equal(report.stop.code, 'forbidden');
  assert.equal(report.stop.step, 'site-source-urls');
  assert.match(report.stop.layerHint, /^A/);
  assert.equal(net.calls.length, 1);
});

test('a 403 from the source is classified as G and not retried', async () => {
  const {DB} = await database();
  const net = network({DB}, {['GET ' + SOURCE_INDEX]: () => new Response('denied', {status: 403, headers: {'Content-Type': 'text/html'}})});
  const report = await runBorderWriter({mode: 'diagnose', fetch: net.fetch});
  assert.equal(report.stop.code, 'forbidden');
  assert.match(report.stop.layerHint, /^G/);
  assert.equal(net.calls.filter(c => c.url === SOURCE_INDEX).length, 1);
});

test('a wrong key is rejected by the server as E/F and nothing is saved', async () => {
  const {sqlite, DB} = await database();
  const net = network({DB, BORDER_WRITER_KEY: 'cd'.repeat(32)});
  const report = await runBorderWriter({mode: 'refresh', env: {BORDER_WRITER_KEY: KEY}, fetch: net.fetch, confirmProductionWrite: true});
  assert.equal(report.stop.code, 'forbidden');
  assert.equal(report.stop.step, 'signed-discover');
  assert.equal(report.stop.layerHint, 'E/F');
  assert.equal(net.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM border_days').get().n, 0);
});

test('the report never contains the key, a signature or any 64-hex value', async () => {
  const {DB} = await database();
  const net = network({DB, BORDER_WRITER_KEY: KEY});
  const report = await runBorderWriter({mode: 'refresh', env: {BORDER_WRITER_KEY: KEY}, fetch: net.fetch, confirmProductionWrite: true});
  const text = JSON.stringify(report);
  assert.ok(!text.includes(KEY));
  assert.ok(!/[a-f0-9]{64}/i.test(text));
  const signatures = net.calls.map(c => c.headers['X-Border-Writer-Signature']).filter(Boolean);
  assert.ok(signatures.length >= 2);
  for (const signature of signatures) assert.ok(!text.includes(signature));
  assert.ok(report.log.filter(e => e.method === 'POST').every(e => e.sentHeaders['X-Border-Writer-Signature'] === true && e.sentHeaders.Origin === false));
  assert.equal(sanitize('key ' + KEY + ' Bearer abc.def', [KEY]).includes(KEY), false);
});

test('URLs outside the allow-list are refused without a request', async () => {
  const {DB} = await database();
  const net = network({DB, BORDER_WRITER_KEY: KEY}, {['POST ' + SITE_ORIGIN + '/api/borders/source-urls']: () => Response.json({urls: ['https://evil.example/a'], discovered: 1})});
  const report = await runBorderWriter({mode: 'discover', env: {BORDER_WRITER_KEY: KEY}, fetch: net.fetch});
  assert.equal(report.stop.code, 'host-not-allowed');
  assert.ok(!net.calls.some(c => c.url.startsWith('https://evil.example')));
});

test('GET retries once on 5xx; POST is never retried', async () => {
  const {DB} = await database();
  let failures = 1;
  const net = network({DB, BORDER_WRITER_KEY: KEY}, {
    ['GET ' + SOURCE_INDEX]: () => failures-- > 0 ? new Response('busy', {status: 503}) : html(fixture.category),
    ['POST ' + SITE_ORIGIN + '/api/borders/source-urls']: () => new Response('{}', {status: 502, headers: {'Content-Type': 'application/json'}}),
  });
  const report = await runBorderWriter({mode: 'discover', env: {BORDER_WRITER_KEY: KEY}, fetch: net.fetch});
  assert.equal(net.calls.filter(c => c.url === SOURCE_INDEX).length, 2);
  assert.equal(report.stop.code, 'http-502');
  assert.equal(net.calls.filter(c => c.method === 'POST').length, 1);
});

test('a rejected article is reported, only valid ones are sent, and the run is marked partial', async () => {
  const {DB} = await database();
  const broken = 'https://one-carat.com/campus/archives/89496';
  const net = network({DB, BORDER_WRITER_KEY: KEY}, {['GET ' + broken]: () => html(fixture['22'].replace('［+2］16,659', '［+2］16,659.5'))});
  let sentArticles = null;
  const wrapped = async (url, init) => {
    if (url.endsWith('/api/borders/refresh')) sentArticles = JSON.parse(new TextDecoder().decode(init.body)).articles.map(a => a.url);
    return net.fetch(url, init);
  };
  const report = await runBorderWriter({mode: 'refresh', env: {BORDER_WRITER_KEY: KEY}, fetch: wrapped, confirmProductionWrite: true});
  assert.equal(report.outcome, 'ok', JSON.stringify(report.stop));
  assert.equal(report.partial, true);
  assert.equal(report.articles.find(a => a.url === broken).result, 'rejected');
  assert.deepEqual(sentArticles.sort(), Object.keys(ARTICLES).filter(u => u !== broken).sort());
});

test('a fresh lock prevents a second concurrent run; a stale lock is replaced', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'border-lock-'));
  const lockPath = join(dir, 'writer.lock');
  try {
    await writeFile(lockPath, JSON.stringify({at: Date.now()}));
    const blocked = await runBorderWriter({mode: 'diagnose', fetch: refuseNetwork, lockPath});
    assert.equal(blocked.stop.code, 'already-running');
    assert.equal(blocked.log.length, 0);
    await writeFile(lockPath, JSON.stringify({at: Date.now() - 11 * 60 * 1000}));
    const {DB} = await database();
    const net = network({DB});
    const resumed = await runBorderWriter({mode: 'diagnose', fetch: net.fetch, lockPath});
    assert.equal(resumed.outcome, 'ok');
    await assert.rejects(readFile(lockPath), /ENOENT/);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('an identical signed refresh within the same second is rejected as a replay and not retried', async () => {
  const {DB} = await database();
  const net = network({DB, BORDER_WRITER_KEY: KEY});
  const fixed = Date.now();
  const first = await runBorderWriter({mode: 'refresh', env: {BORDER_WRITER_KEY: KEY}, fetch: net.fetch, confirmProductionWrite: true, now: () => fixed});
  assert.equal(first.outcome, 'ok', JSON.stringify(first.stop));
  const replay = await runBorderWriter({mode: 'refresh', env: {BORDER_WRITER_KEY: KEY}, fetch: net.fetch, confirmProductionWrite: true, now: () => fixed});
  assert.equal(replay.stop.code, 'http-409');
  assert.equal(replay.stop.step, 'signed-refresh');
});

test('verification fails when the saved values differ or the sync was not attempted', () => {
  const row = {date: '2026-10-02', close: '22', ranks: Object.fromEntries(['D1', 'D2', 'D3', 'C1', 'C2', 'C3', 'B1', 'B2', 'B3', 'A1', 'A2', 'A3', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6'].map((r, i) => [r, [i + 1, i + 2, i + 3]]))};
  const published = {sync: {last_attempt: '2026-11-06T00:00:00.000Z', status: 'ok'}, records: [{...row}]};
  assert.equal(verifyPublished(published, [row], '2026-11-05T00:00:00.000Z').ok, true);
  assert.equal(verifyPublished(published, [row], '2026-11-07T00:00:00.000Z').ok, false);
  const changed = {...published, records: [{...row, ranks: {...row.ranks, S6: [1, 1, 1]}}]};
  assert.deepEqual(verifyPublished(changed, [row], '2026-11-05T00:00:00.000Z').missing, ['2026-10-02|22']);
  assert.equal(verifyPublished({...published, sync: {...published.sync, status: 'unavailable'}}, [row], '2026-11-05T00:00:00.000Z').ok, false);
});
