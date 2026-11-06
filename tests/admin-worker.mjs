// Integration against the built Worker in an isolated, disposable D1 database.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { Miniflare, createFetchMock } = createRequire(require.resolve('wrangler/package.json'))('miniflare');
const root = path.resolve(import.meta.dirname, '..');
const built = path.join(root, 'dist/server');
const modulePaths = ['index.js', ...readdirSync(built, { recursive: true }).filter(file => /\.(?:mjs|js)$/.test(file) && file !== 'index.js')];
const fetchMock=createFetchMock();fetchMock.disableNetConnect();fetchMock.get('https://pococha-comment-access.freefreelife2000.chatgpt.site').intercept({path:'/api/catalog/access/meter'}).reply(200,JSON.stringify({id:'meter',enabled:true})).persist();
const mf = new Miniflare({ fetchMock, modules: modulePaths.map(file => ({ type: 'ESModule', path: path.join(built, file) })), modulesRoot: built, compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], bindings: { ANALYTICS_ADMIN_EMAIL: 'owner@example.test' }, cf: false });
try {
  const db = await mf.getD1Database('DB');
  for (const file of readdirSync(path.join(root, 'drizzle')).filter(file => /^\d+_.*\.sql$/.test(file)).sort()) {
    for (const statement of readFileSync(path.join(root, 'drizzle', file), 'utf8').split('--> statement-breakpoint')) if (statement.trim()) await db.prepare(statement.trim()).run();
  }
  const worker = await mf.getWorker();
  const get = (url, headers = {}) => worker.fetch('https://meter.example' + url, { headers, redirect: 'manual' });
  let response = await get('/');
  assert.equal(response.status, 200);
  const home = await response.text();
  assert.ok(!home.includes('id="contactForm"'), 'Retired public form stays absent');
  assert.ok(!home.includes('日別来訪者統計'));
  response = await get('/admin');
  assert.equal(response.status, 200, 'Anonymous visitors can open the management landing page');
  assert.equal(response.headers.get('location'), null, 'No forced sign-in redirect');
  assert.match(response.headers.get('cache-control'), /no-store/);
  const anonymous = await response.text();
  assert.ok(anonymous.includes('href="/signin-with-chatgpt?return_to=%2Fadmin"'));
  assert.ok(anonymous.includes('ChatGPTでログイン'));
  assert.ok(anonymous.includes('href="https://poco-meter.freefreelife2000.chatgpt.site/admin" target="_blank" rel="noopener noreferrer"'), 'The embedded login landing also offers a published-site link');
  assert.ok(!anonymous.includes('今日の来訪者'));
  assert.ok(!anonymous.includes('http-equiv="refresh"'));
  // Production requests can contain an incomplete identity. Do not loop or
  // treat an email alone as proof of an authenticated owner.
  for (const partial of [{ 'oai-authenticated-user-email': 'owner@example.test' }, { 'oai-authenticated-user-id': 'test-owner' }]) {
    response = await get('/admin', partial);
    assert.equal(response.status, 200); assert.equal(response.headers.get('location'), null);
    const partialPage = await response.text();
    assert.ok(partialPage.includes('ChatGPTでログイン')); assert.ok(!partialPage.includes('今日の来訪者'));
  }
  const visitorHeaders = { 'oai-authenticated-user-id': 'test-visitor', 'oai-authenticated-user-email': 'visitor@example.test' };
  response = await get('/admin', visitorHeaders);
  const denied = await response.text();
  assert.ok(denied.includes('管理者専用ページです')); assert.ok(!denied.includes('日別来訪者統計'));
  const ownerHeaders = { 'oai-authenticated-user-id': 'test-owner', 'oai-authenticated-user-email': 'owner@example.test' };
  response = await get('/admin', ownerHeaders);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const empty = await response.text();
  assert.ok(empty.includes('日別来訪者統計')); assert.ok(empty.includes('まだ来訪記録がありません'));
  const eventId = crypto.randomUUID();
  response = await mf.dispatchFetch('https://meter.example/api/visits', { method: 'POST', headers: { Origin: 'https://meter.example', 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.42', 'CF-IPCountry': 'JP', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' }, body: JSON.stringify({ eventId }) });
  assert.equal(response.status, 204, await response.clone().text());
  response = await get('/admin', ownerHeaders);
  const populated = await response.text();
  assert.ok(populated.includes('日別来訪者統計')); assert.ok(!populated.includes('まだ来訪記録がありません'));
  assert.ok(populated.includes('203.0.113.42'), 'Only the owner can read a collected IP');
  assert.ok(populated.includes('iPhone'), 'Browser-reported device family is displayed');
  for (const label of ['地域', '端末', 'ブラウザ', '時間帯']) assert.ok(populated.includes(label));
  const untrustedModel = '<img src=x onerror=alert(1)>';
  response = await mf.dispatchFetch('https://meter.example/api/visits', { method: 'POST', headers: { Origin: 'https://meter.example', 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) Chrome/145.0.0.0 Mobile' }, body: JSON.stringify({ eventId: crypto.randomUUID(), clientHint: { platform: 'Android', model: untrustedModel, mobile: true } }) });
  assert.equal(response.status, 204);
  response = await get('/admin', ownerHeaders);
  const safeMetadata = await response.text();
  assert.ok(safeMetadata.includes('&lt;img src=x onerror=alert(1)&gt;'), 'Browser labels render as escaped text');
  assert.ok(!safeMetadata.includes(untrustedModel), 'Browser metadata must never become markup');
  for (const field of ['ip', 'country', 'device', 'os', 'browser', 'q', 'hour']) assert.ok(safeMetadata.includes(`name="${field}"`), `Owner can filter ${field}`);
  response = await get('/admin?ip=203.0.113.42&device=smartphone', ownerHeaders);
  const filteredMetadata = await response.text();
  assert.ok(filteredMetadata.includes('iPhone'), 'Combined detail filters include matching observations');
  assert.ok(!filteredMetadata.includes('&lt;img src=x onerror=alert(1)&gt;'), 'Other devices do not appear in filtered groups or detail pages');
  response = await get('/admin?q=' + encodeURIComponent(untrustedModel), ownerHeaders);
  const searchedMetadata = await response.text();
  assert.ok(searchedMetadata.includes('&lt;img src=x onerror=alert(1)&gt;'), 'Literal device text is searchable without rendering markup');
  assert.ok(!searchedMetadata.includes(untrustedModel));
  const template = await db.prepare('SELECT * FROM site_visit_events WHERE event_id=?').bind(eventId).first();
  const pageFixtures = Array.from({ length: 51 }, (_, i) => db.prepare('INSERT INTO site_visit_events (event_id,day,visitor_hash,occurred_at,ip_address,country,device_type,device_model,os_family,os_version,browser_family,browser_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), template.day, 'page-fixture-' + i, template.occurred_at, template.ip_address, template.country, template.device_type, 'Paging_%& Test', template.os_family, template.os_version, template.browser_family, template.browser_version));
  await db.batch(pageFixtures);
  const pagingFilters = { ip: '203.0.113.42', country: template.country || 'unknown', device: 'smartphone', os: 'iOS', browser: 'Safari', q: 'Paging_%& Test', hour: String(new Date(Date.parse(template.occurred_at) + 9 * 3600000).getUTCHours()) };
  response = await get('/admin?' + new URLSearchParams(pagingFilters), ownerHeaders);
  const pagingMetadata = await response.text();
  const pageLink = [...pagingMetadata.matchAll(/href="([^"]+)"/g)].map(match => match[1].replaceAll('&amp;', '&')).find(href => new URL(href, 'https://meter.example').searchParams.get('page') === '2');
  assert.ok(pageLink, 'A matching detail cohort has a next page');
  const pageParameters = new URL(pageLink, 'https://meter.example').searchParams;
  for (const [key, value] of Object.entries(pagingFilters)) assert.equal(pageParameters.get(key), value, `Pagination preserves ${key}`);
  response = await get('/admin?start=2026-10-01&end=2026-10-01', ownerHeaders);
  const historical = await response.text();
  const historicalResult = historical.match(/<p class="admin-filter-result">([\s\S]*?)<\/p>/)?.[1].replace(/<[^>]*>/g, '');
  assert.ok(historicalResult?.includes('未計測'), 'Periods before detailed collection are not shown as zero');
  for (const query of ['hour=24', 'device=phone', 'ip=not-an-ip', 'country=JPN', 'q=one&q=two']) {
    response = await get('/admin?' + query, ownerHeaders);
    assert.ok((await response.text()).includes('role="alert"'), `Invalid filter is reported: ${query}`);
  }
  response = await get('/admin?page=1.5', ownerHeaders);
  assert.ok((await response.text()).includes('ページ'), 'Invalid page filters are reported');
  response = await get('/admin?start=2026-02-30&end=2026-03-01', ownerHeaders);
  assert.ok((await response.text()).includes('期間は今日までの366日以内'));
  response = await get('/admin', visitorHeaders);
  const deniedAfterCollection = await response.text();
  assert.ok(!deniedAfterCollection.includes('日別来訪者統計'));
  assert.ok(!deniedAfterCollection.includes('203.0.113.42'));
  response = await get('/admin');
  assert.ok(!(await response.text()).includes('203.0.113.42'));
  console.log('Built Worker passed: management login, owner-only statistics, private cache, D1 metadata, combined filters and literal search, escaped labels, invalid query handling, and denied cross-user reads.');
} finally { await mf.dispose(); }
