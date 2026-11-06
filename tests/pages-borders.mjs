// Network-free tests for the GitHub Pages publication:
// data/borders.json updater and the Pages build.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SOURCE_INDEX} from '../lib/border-source.mjs';
import {scriptSources} from '../lib/browser-security.mjs';
import {collectFromSource, mergeBorders, validateData, updateBordersFile, MESSAGES} from '../automation/update-borders-json.mjs';
import {buildPages, PAGES_VERSION} from '../scripts/build-pages.mjs';

const fixture = Object.fromEntries(await Promise.all(['13', '22', '24', 'category'].map(async n => [n, await readFile(new URL('./fixtures/' + n + '.html', import.meta.url), 'utf8')])));
const ARTICLES = {
  'https://one-carat.com/campus/archives/89497': fixture['13'],
  'https://one-carat.com/campus/archives/89496': fixture['22'],
  'https://one-carat.com/campus/archives/89495': fixture['24'],
};
const NOW = new Date('2026-10-03T07:00:00Z');
const html = body => new Response(body, {headers: {'Content-Type': 'text/html; charset=UTF-8'}});
function source(overrides = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push(url);
    if (overrides[url]) return overrides[url]();
    if (url === SOURCE_INDEX) return html(fixture.category);
    if (ARTICLES[url]) return html(ARTICLES[url]);
    throw new Error('unexpected ' + url);
  };
  return {fetch, calls};
}
const empty = () => ({records: [], sync: {last_attempt: '', last_success: '', status: 'pending', message: ''}, serverDate: '2026-10-01'});

test('collects the three cut-offs from the source fixtures', async () => {
  const net = source();
  const got = await collectFromSource({fetch: net.fetch, now: NOW});
  assert.equal(got.rows.length, 3);
  assert.deepEqual(got.rows.map(r => r.close).sort(), ['13', '22', '24']);
  assert.equal(got.partial, false);
  assert.ok(net.calls.every(u => u.startsWith('https://one-carat.com/')));
});

test('merge adds new days, re-running confirms without duplicates, and untouched days stay as they were', async () => {
  const {rows} = await collectFromSource({fetch: source().fetch, now: NOW});
  const old = {date: '2025-01-01', close: '13', ranks: {S1: [1, 2, 3]}, sourceURL: 'https://one-carat.com/campus/archives/1', checkedAt: '2025-01-02T00:00:00.000Z'};
  const base = {...empty(), records: [old]};
  const first = mergeBorders(base, {rows, partial: false}, NOW);
  assert.equal(first.added, 3);
  assert.equal(first.data.records.length, 4);
  assert.deepEqual(first.data.records[0], old);
  assert.equal(first.data.sync.status, 'ok');
  assert.equal(first.data.sync.message, MESSAGES.ok);
  assert.equal(first.data.sync.last_success, NOW.toISOString());
  const later = new Date(NOW.getTime() + 3600e3);
  const second = mergeBorders(first.data, {rows, partial: false}, later);
  assert.equal(second.added, 0);
  assert.equal(second.changed, 0);
  assert.equal(second.confirmed, 3);
  assert.equal(second.data.records.length, 4);
});

test('a differing observation for the same day replaces it and is counted as changed', async () => {
  const {rows} = await collectFromSource({fetch: source().fetch, now: NOW});
  const first = mergeBorders(empty(), {rows, partial: false}, NOW).data;
  const edited = structuredClone(rows);
  edited[0].ranks.S6 = [edited[0].ranks.S6[0], edited[0].ranks.S6[1], edited[0].ranks.S6[2] + 1];
  const result = mergeBorders(first, {rows: edited, partial: false}, NOW);
  assert.equal(result.changed, 1);
  assert.equal(result.data.records.length, 3);
});

test('partial collection is marked partial; no rows keeps every record and the last success', async () => {
  const {rows} = await collectFromSource({fetch: source().fetch, now: NOW});
  const partial = mergeBorders(empty(), {rows: rows.slice(0, 2), partial: true}, NOW);
  assert.equal(partial.data.sync.status, 'partial');
  const none = mergeBorders(partial.data, {rows: [], partial: true}, new Date(NOW.getTime() + 1000));
  assert.equal(none.data.sync.status, 'unavailable');
  assert.equal(none.data.sync.last_success, NOW.toISOString());
  assert.equal(none.data.records.length, 2);
});

test('a 403 stops without retry, keeps every record, and records the failed check', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'borders-'));
  try {
    const file = join(dir, 'borders.json');
    const {rows} = await collectFromSource({fetch: source().fetch, now: NOW});
    const saved = mergeBorders(empty(), {rows, partial: false}, NOW).data;
    await writeFile(file, JSON.stringify(saved));
    const net = source({[SOURCE_INDEX]: () => new Response('denied', {status: 403, headers: {'Content-Type': 'text/html'}})});
    const report = await updateBordersFile({file, fetch: net.fetch, now: new Date(NOW.getTime() + 1000)});
    assert.equal(report.outcome, 'stopped');
    assert.equal(report.stop.code, 'forbidden');
    assert.equal(net.calls.length, 1);
    const after = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(after.records, saved.records);
    assert.equal(after.sync.status, 'unavailable');
    assert.equal(after.sync.last_success, NOW.toISOString());
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('5xx is retried once; a rejected article is reported and only valid days are saved', async () => {
  let failures = 1;
  const broken = 'https://one-carat.com/campus/archives/89496';
  const net = source({
    [SOURCE_INDEX]: () => failures-- > 0 ? new Response('busy', {status: 503}) : html(fixture.category),
    [broken]: () => html(fixture['22'].replace('［+2］16,659', '［+2］16,659.5')),
  });
  const got = await collectFromSource({fetch: net.fetch, now: NOW});
  assert.equal(net.calls.filter(u => u === SOURCE_INDEX).length, 2);
  assert.equal(got.rows.length, 2);
  assert.equal(got.partial, true);
  assert.equal(got.articles.find(a => a.url === broken).result, 'rejected');
});

test('hosts other than the source are refused', async () => {
  const net = source({[SOURCE_INDEX]: () => html('<a href="https://evil.example/1">【2026年10月】Pococha全ランクボーダー早見表《22時締め》</a>')});
  await assert.rejects(collectFromSource({fetch: net.fetch, now: NOW}), /no-articles-discovered/);
  assert.ok(!net.calls.some(u => u.includes('evil.example')));
});

test('the committed data file is valid', async () => {
  const data = validateData(JSON.parse(await readFile(new URL('../data/borders.json', import.meta.url), 'utf8')));
  assert.ok(data.records.length >= 1951);
});

test('the Pages build contains no Sites API, tracker or admin link, and its CSP covers every script', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pages-'));
  try {
    const result = await buildPages({out: dir});
    for (const name of ['index.html', 'border-history.html', 'e-border.html', 'calculation-methods.html', 'meter-sw.js', 'meter.webmanifest', 'data/borders.json', '.nojekyll']) assert.ok(result.files.includes(name), name);
    for (const name of ['index.html', 'border-history.html', 'e-border.html']) {
      const page = await readFile(join(dir, name), 'utf8');
      for (const banned of ['freefreelife2000', 'pococha-comment', "fetch('/api/", 'pococha-public-access-tracker', 'v2026.10.23.3']) assert.ok(!page.includes(banned), name + ' contains ' + banned);
      assert.ok(page.includes(PAGES_VERSION.version), name + ' version');
      const declared = page.match(/script-src\s+([^;"]+);/)[1];
      for (const hash of scriptSources(page).split(' ').filter(Boolean)) assert.ok(declared.includes(hash), name + ' CSP');
    }
    const index = await readFile(join(dir, 'index.html'), 'utf8');
    assert.ok(index.includes("fetch('./data/borders.json'"));
    assert.ok(index.includes('href="./e-border.html"'));
    assert.ok(!index.includes('/api/pococha-time'));
    const history = await readFile(join(dir, 'border-history.html'), 'utf8');
    assert.ok(history.includes("fetch('./data/borders.json'"));
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'data/borders.json'), 'utf8')).records.length >= 1951, true);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('the history page no longer writes to status elements that its template lacks', async () => {
  const ui = await readFile(new URL('../calculator/history-ui.mjs', import.meta.url), 'utf8');
  const template = await readFile(new URL('../calculator/history-page-template.html', import.meta.url), 'utf8');
  const direct = [...ui.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]);
  const missing = [...new Set(direct)].filter(id => !template.includes(`id="${id}"`) && !ui.includes(`id="${id}"`) && !ui.includes(`.id='${id}'`));
  assert.deepEqual(missing, []);
});
