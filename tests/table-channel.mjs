// Network-free tests for the second source channel (ONECARAT monthly table images).
// Fixtures are synthetic tables drawn in the same layout with our own random values
// (tests/fixtures/table-2026-09-22-*.png): day 8 is blank, and one digit (9/10 S3 +1) is smudged.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {decodePNG, readTables, rowsFromResults, GROUPS} from '../automation/table-reader.mjs';
import {collectFromTables, addMissingRows, updateBordersFile, listMonthlyArticles, tableImages} from '../automation/update-borders-json.mjs';
import {SOURCE_INDEX} from '../lib/border-source.mjs';

const fx = name => new URL('./fixtures/' + name, import.meta.url);
const truth = JSON.parse(await readFile(fx('table-2026-09-22-values.json'), 'utf8'));
const png = Object.fromEntries(await Promise.all(Object.keys(GROUPS).map(async g => [g, await readFile(fx(`table-2026-09-22-${g}.png`))])));
const dateOf = d => `2026-09-${String(d).padStart(2, '0')}`;
const knownUpTo = last => (date, close) => close === '22' && date <= dateOf(last) ? truth.values[date] : undefined;
const tables = () => Object.keys(GROUPS).map(g => ({key: g, url: g, sha256: g, month: '2026-09', close: '22', group: g, img: decodePNG(png[g])}));

test('PNG decoder reads the fixture dimensions and pixels', () => {
  const img = decodePNG(png['S1-S6']);
  assert.equal(img.width, 1024);
  assert.equal(img.height, 26 + 27 * 30);
  assert.ok(img.px(10, 40) > 200);           // white background
  assert.ok(img.px(310, 12) < 220);          // orange header
});

test('unknown days are read exactly; the blank day and the smudged value are left out', () => {
  const {results, images} = readTables(tables(), knownUpTo(7), {wanted: d => d > dateOf(7)});
  assert.ok(images.every(i => i.trusted), JSON.stringify(images));
  const {rows, rejected} = rowsFromResults(results, () => 'https://one-carat.com/campus/archives/1');
  assert.deepEqual(rows.map(r => r.date).sort(), [dateOf(9), dateOf(10)]);
  for (const row of rows) for (const [rank, v] of Object.entries(row.ranks)) assert.deepEqual(v, truth.values[row.date][rank], row.date + ' ' + rank);
  assert.equal(Object.keys(rows.find(r => r.date === dateOf(9)).ranks).length, 18);
  assert.equal(rows.find(r => r.date === dateOf(10)).ranks.S3, undefined, 'smudged rank must not be guessed');
  assert.deepEqual(rejected.map(r => r.date + ' ' + r.rank), [dateOf(10) + ' S3']);
});

test('an image that disagrees with already-known values is not trusted and adds nothing', () => {
  const wrong = (date, close) => { const k = knownUpTo(7)(date, close); if (!k) return k; const c = structuredClone(k); c.S1 = c.S1.map(v => v + 1); return c; };
  const {results, images} = readTables(tables(), wrong, {wanted: d => d > dateOf(7)});
  assert.equal(images.find(i => i.key === 'S1-S6').trusted, false);
  assert.ok(!results.some(r => r.image === 'S1-S6'));
});

test('too few known cells means no trust', () => {
  const {images} = readTables(tables(), knownUpTo(0), {wanted: () => true});
  assert.ok(images.every(i => !i.trusted));
});

test('table rows only fill absent days and never replace saved ones', () => {
  const saved = {date: dateOf(9), close: '22', ranks: {S1: [1, 2, 3]}, sourceURL: 'https://one-carat.com/campus/archives/5', checkedAt: '2026-09-10T00:00:00.000Z'};
  const data = {records: [saved], sync: {last_attempt: '', last_success: '', status: 'ok', message: ''}, serverDate: '2026-10-01'};
  const rows = [{date: dateOf(9), close: '22', ranks: {S1: [9, 9, 9]}, sourceURL: 'https://one-carat.com/campus/archives/6'}, {date: dateOf(10), close: '22', ranks: {S1: [4, 5, 6]}, sourceURL: 'https://one-carat.com/campus/archives/6'}];
  const {data: out, added} = addMissingRows(data, rows);
  assert.deepEqual(out.records.find(r => r.date === dateOf(9)).ranks, {S1: [1, 2, 3]});
  assert.deepEqual(added.map(r => r.date), [dateOf(10)]);
});

// Fake ONECARAT: index + one monthly article with the three fixture images.
const ARTICLE = 'https://one-carat.com/campus/archives/900';
const IMG = g => `https://one-carat.com/campus/wp-content/uploads/fixture-${g}.png`;
const indexHTML = `<a href="${ARTICLE}">【2026年9月】Pococha全ランクボーダー早見表《22時締め》</a>`;
const articleHTML = Object.keys(GROUPS).map(g => `<img decoding="async" alt="22時締め_${g}" src="${IMG(g)}">`).join('');
function site(overrides = {}) {
  const calls = [];
  const fetch = async url => {
    calls.push(url);
    if (overrides[url]) return overrides[url]();
    if (url === ARTICLE) return new Response(articleHTML, {headers: {'Content-Type': 'text/html'}});
    for (const g of Object.keys(GROUPS)) if (url === IMG(g)) return new Response(png[g], {headers: {'Content-Type': 'image/png'}});
    throw new Error('unexpected ' + url);
  };
  return {fetch, calls};
}
const NOW = new Date('2026-10-02T21:00:00Z'); // 2026-10-03 JST: September has ended
const baseData = () => ({records: [1, 2, 3, 4, 5, 6, 7].map(d => ({date: dateOf(d), close: '22', ranks: truth.values[dateOf(d)], sourceURL: ARTICLE, checkedAt: '2026-09-30T00:00:00.000Z'})), sync: {last_attempt: '', last_success: '', status: 'ok', message: ''}, serverDate: '2026-10-03'});

test('index and article parsing find the monthly article and its three images', () => {
  assert.deepEqual(listMonthlyArticles(indexHTML), [{url: ARTICLE, month: '2026-09', close: '22'}]);
  assert.deepEqual(tableImages(articleHTML, '22'), Object.fromEntries(Object.keys(GROUPS).map(g => [g, IMG(g)])));
  assert.equal(tableImages(articleHTML, '13'), null);
});

test('collectFromTables fills missing days, records a blank day of a finished month, and only touches ONECARAT', async () => {
  const net = site();
  const t = await collectFromTables({fetch: net.fetch, now: NOW, data: baseData(), indexHTML, lookbackDays: 40});
  assert.equal(t.status, 'checked');
  assert.deepEqual(t.rows.map(r => r.date).sort(), [dateOf(9), dateOf(10)]);
  assert.ok(t.rows.every(r => r.sourceURL === ARTICLE && r.images.every(i => /^[a-f0-9]{64}$/.test(i.sha256))));
  assert.deepEqual(t.blanks, [{date: dateOf(8), close: '22'}]);
  assert.ok(net.calls.every(u => u.startsWith('https://one-carat.com/')));
});

test('nothing is downloaded when no older day is missing', async () => {
  const net = site();
  const data = baseData(); data.records = []; // window below covers no dates of this data set
  const t = await collectFromTables({fetch: net.fetch, now: new Date('2026-09-03T00:00:00Z'), data: {...data, records: [{date: '2026-08-31', close: '13', ranks: {S1: [1, 2, 3]}, sourceURL: ARTICLE}, {date: '2026-08-31', close: '22', ranks: {S1: [1, 2, 3]}, sourceURL: ARTICLE}, {date: '2026-08-31', close: '24', ranks: {S1: [1, 2, 3]}, sourceURL: ARTICLE}]}, indexHTML, lookbackDays: 3});
  assert.equal(t.status, 'not-needed');
  assert.equal(net.calls.length, 0);
});

test('days already recorded as blank in the source are not looked up again', async () => {
  const net = site();
  const skip = new Set();
  for (let d = 8; d <= 10; d++) skip.add(dateOf(d) + '|22');
  const data = baseData();
  const t = await collectFromTables({fetch: net.fetch, now: NOW, data: {...data, records: data.records.filter(r => r.close !== '22' || r.date <= dateOf(7))}, indexHTML: '', lookbackDays: 40, skip});
  assert.notEqual(t.status, 'checked');
  assert.ok(!net.calls.some(u => u.includes('fixture-')));
});

test('a 403 on a table image stops only the table channel; the text result is kept', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'table-'));
  try {
    const file = join(dir, 'borders.json');
    await writeFile(file, JSON.stringify(baseData()));
    const fixtureIndex = await readFile(new URL('./fixtures/category.html', import.meta.url), 'utf8');
    const articles = {'https://one-carat.com/campus/archives/89497': '13', 'https://one-carat.com/campus/archives/89496': '22', 'https://one-carat.com/campus/archives/89495': '24'};
    const pages = Object.fromEntries(await Promise.all(Object.entries(articles).map(async ([u, c]) => [u, await readFile(new URL(`./fixtures/${c}.html`, import.meta.url), 'utf8')])));
    const calls = [];
    const fetch = async url => {
      calls.push(url);
      if (url === SOURCE_INDEX) return new Response(indexHTML + fixtureIndex, {headers: {'Content-Type': 'text/html'}});
      if (pages[url]) return new Response(pages[url], {headers: {'Content-Type': 'text/html'}});
      if (url === ARTICLE) return new Response(articleHTML, {headers: {'Content-Type': 'text/html'}});
      if (url.includes('fixture-')) return new Response('denied', {status: 403});
      if (/^https:\/\/one-carat\.com\/campus\/archives\/\d+$/.test(url)) return new Response('<html></html>', {headers: {'Content-Type': 'text/html'}});
      throw new Error('unexpected ' + url);
    };
    const report = await updateBordersFile({file, fetch, now: new Date('2026-10-03T07:00:00Z')});
    assert.equal(report.outcome, 'ok');
    assert.equal(report.table.status, 'stopped');
    assert.equal(report.table.stop.code, 'forbidden');
    assert.equal(calls.filter(u => u.includes('fixture-')).length, 1, '403 is never retried');
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.ok(saved.records.length > 7, 'text channel rows were saved');
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});
