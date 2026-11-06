import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { recordVisit, readVisitorStats, statsRange, isAnalyticsAdmin, jstDay, shiftDay, visitorDetailFilters } from '../lib/visitor-stats.mjs';
import { visitorMetadata } from '../lib/visitor-metadata.mjs';
import { buildVisitorReport } from '../lib/visitor-report.mjs';
const detailMigration = readFileSync(new URL('../drizzle/0002_magenta_solo.sql', import.meta.url), 'utf8');
function setup() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../drizzle/0001_fine_monster_badoon.sql', import.meta.url), 'utf8'));
  sql.exec(detailMigration);
  const DB = { prepare(query) { let values = []; return {
    bind(...args) { values = args; return this; },
    async run() { return sql.prepare(query).run(...values); },
    async all() { return { results: sql.prepare(query).all(...values) }; },
    async first() { return sql.prepare(query).get(...values); },
  }; } };
  return { DB, sql };
}
function request(eventId = crypto.randomUUID(), cookie = '', extra = {}, payload = {}) {
  return new Request('https://meter.example/api/visits', { method: 'POST', headers: { Origin: 'https://meter.example', 'Content-Type': 'application/json', Cookie: cookie, ...extra }, body: JSON.stringify({ eventId, ...payload }) });
}
const now = new Date('2026-10-08T16:00:00Z');
test('one daily visitor across reloads; retries do not inflate views; fresh browser is separate', async () => {
  const env = setup();
  const id = crypto.randomUUID();
  const first = await recordVisit(request(id), env, now);
  assert.equal(first.status, 204);
  const cookie = first.headers.get('set-cookie').split(';')[0];
  assert.match(first.headers.get('set-cookie'), /Secure; HttpOnly; SameSite=Lax/);
  await recordVisit(request(id, cookie), env, now);
  await recordVisit(request(crypto.randomUUID(), cookie), env, now);
  await recordVisit(request(), env, now);
  const stats = await readVisitorStats(env, statsRange('2026-10-08', '2026-10-09', now));
  assert.equal(stats.todayStats.visitors, 2); assert.equal(stats.todayStats.views, 3);
  assert.equal(stats.yesterdayStats.visitors, null);
  assert.equal(stats.firstDay, '2026-10-09');
  assert.ok(env.sql.prepare('SELECT visitor_hash FROM site_visit_events LIMIT 1').get().visitor_hash.length === 64);
  assert.ok(!JSON.stringify(env.sql.prepare('SELECT * FROM site_visit_events').all()).includes(cookie.split('=')[1]));
});
test('JST midnight creates a new daily visitor; unmeasured dates are distinct from zero', async () => {
  const env = setup(), before = new Date('2026-10-08T14:59:59Z');
  const first = await recordVisit(request(), env, before);
  const cookie = first.headers.get('set-cookie').split(';')[0];
  await recordVisit(request(crypto.randomUUID(), cookie), env, now);
  const later = new Date('2026-10-10T16:00:00Z');
  const stats = await readVisitorStats(env, statsRange('2026-10-07', '2026-10-11', later));
  assert.deepEqual(stats.rows.map(x => x.visitors), [0, 0, 1, 1, null]);
  assert.equal(stats.totals.visitors, 2);
  assert.equal(jstDay(before), '2026-10-08');
});
test('strict method, origin, content type, body and bot boundaries', async () => {
  const env = setup();
  assert.equal((await recordVisit(new Request('https://meter.example/api/visits'), env)).status, 405);
  assert.equal((await recordVisit(request(undefined, '', { Origin: 'https://other.example' }), env)).status, 403);
  assert.equal((await recordVisit(request(undefined, '', { 'Content-Type': 'text/plain' }), env)).status, 415);
  assert.equal((await recordVisit(request('invalid'), env)).status, 400);
  assert.equal((await recordVisit(request('x'.repeat(3000)), env)).status, 413);
  assert.equal((await recordVisit(request(undefined, '', { 'User-Agent': 'ExampleBot/1' }), env)).status, 204);
  assert.equal(env.sql.prepare('SELECT COUNT(*) AS n FROM site_visit_events').get().n, 0);
});
test('empty state and bounded valid date filters', async () => {
  const stats = await readVisitorStats(setup(), statsRange(undefined, undefined, now));
  assert.equal(stats.rows.length, 30); assert.equal(stats.firstDay, null);
  assert.equal(stats.todayStats.visitors, null);
  for (const [start, end] of [['2026-02-30','2026-03-01'],['2026-10-09','2026-10-08'],['2026-10-09','2026-10-10'],['2025-01-01','2026-10-09'],['oops','2026-10-09']]) assert.throws(() => statsRange(start, end, now), RangeError);
});
test('statistics authorization is fail-closed for anonymous and other signed-in accounts', () => {
  const env = { ANALYTICS_ADMIN_EMAIL: 'owner@example.test' };
  assert.equal(isAnalyticsAdmin(null, env), false);
  assert.equal(isAnalyticsAdmin({ userId: 'visitor', email: 'visitor@example.test' }, env), false);
  assert.equal(isAnalyticsAdmin({ email: 'owner@example.test' }, env), false);
  assert.equal(isAnalyticsAdmin({ userId: 'owner', email: 'owner@example.test' }, {}), false);
  assert.equal(isAnalyticsAdmin({ userId: 'owner', email: 'OWNER@example.test' }, env), true);
});

test('additive migration preserves existing records without fabricating details', async () => {
  const env = setup();
  // Verify the migration against the previously deployed schema, with an old row.
  const legacy = new DatabaseSync(':memory:');
  legacy.exec(readFileSync(new URL('../drizzle/0001_fine_monster_badoon.sql', import.meta.url), 'utf8'));
  legacy.prepare('INSERT INTO site_visit_events VALUES (?,?,?)').run('old-event', '2026-10-08', 'legacy-hash');
  legacy.exec(detailMigration);
  const row = legacy.prepare('SELECT * FROM site_visit_events').get();
  assert.equal(row.event_id, 'old-event'); assert.equal(row.visitor_hash, 'legacy-hash');
  for (const key of Object.keys(row).filter(key => !['event_id', 'day', 'visitor_hash'].includes(key))) assert.equal(row[key], null);
  env.sql.prepare('INSERT INTO site_visit_events (event_id,day,visitor_hash) VALUES (?,?,?)').run('old-event', '2026-10-08', 'legacy-hash');
  let stats = await readVisitorStats(env, statsRange('2026-10-08', '2026-10-09', now));
  assert.equal(stats.totals.views, 1); assert.equal(stats.details.measuredViews, 0); assert.equal(stats.details.firstDay, null);
  assert.deepEqual(stats.details.events, []);
  await recordVisit(request(), env, now);
  stats = await readVisitorStats(env, statsRange('2026-10-08', '2026-10-09', now));
  assert.equal(stats.firstDay, '2026-10-08'); assert.equal(stats.details.firstDay, '2026-10-09');
  assert.equal(stats.totals.views, 2); assert.equal(stats.details.measuredViews, 1);
});

test('network observation uses Cloudflare IP and geo only; absent values remain unknown', async () => {
  const env = setup();
  const req = request(undefined, '', { 'cf-connecting-ip': '203.0.113.10', 'cf-ipcountry': 'US', 'X-Forwarded-For': '198.51.100.1' });
  Object.defineProperty(req, 'cf', { value: { country: 'JP', region: 'Tokyo', city: 'Shinjuku' } });
  await recordVisit(req, env, now);
  const event = (await readVisitorStats(env, statsRange('2026-10-09', '2026-10-09', now))).details.events[0];
  assert.equal(event.ipAddress, '203.0.113.10'); assert.equal(event.country, 'JP'); assert.equal(event.region, 'Tokyo'); assert.equal(event.city, 'Shinjuku');
  assert.equal(event.occurredAt, now.toISOString()); assert.equal(event.deviceType, 'unknown');
  assert.equal(event.deviceModel, null); assert.equal(event.osFamily, null); assert.equal(event.browserFamily, null);
  for (const invalid of ['999.0.1.2', '1.2.3.04', '1.2.3.4,5.6.7.8', '2a06:98c0:3600::103', '2A06:98C0:3600:0:0:0:0:103', '::invalid']) {
    assert.equal(visitorMetadata(request(undefined, '', { 'cf-connecting-ip': invalid })).ipAddress, null);
  }
  assert.equal(visitorMetadata(request(undefined, '', { 'cf-connecting-ip': '2001:db8:0:0::1' })).ipAddress, '2001:db8::1');
  assert.equal(visitorMetadata(request(undefined, '', { 'X-Forwarded-For': '203.0.113.2' })).ipAddress, null);
  assert.equal(visitorMetadata(request(undefined, '', { 'cf-ipcountry': 'XX' })).country, null);
  assert.equal(visitorMetadata(request(undefined, '', { 'cf-ipcountry': 'T1' })).country, null);
  assert.equal(visitorMetadata(request(undefined, '', { 'cf-ipcountry': 'JP' })).country, 'JP');
});

test('device metadata uses bounded optional hints and does not infer an iPhone generation or reduced Android model', async () => {
  const env = setup();
  const androidUA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36';
  const reduced = visitorMetadata(request(undefined, '', { 'User-Agent': androidUA }));
  assert.equal(reduced.deviceType, 'smartphone'); assert.equal(reduced.deviceModel, null); assert.equal(reduced.osFamily, 'Android'); assert.equal(reduced.osVersion, null);
  assert.equal(reduced.browserFamily, 'Chrome'); assert.equal(reduced.browserVersion, '154');
  const req = request(undefined, '', { 'User-Agent': androidUA }, { clientHint: { model: 'Pixel 9', platform: 'Android', platformVersion: '15.0.0', mobile: true } });
  assert.equal((await recordVisit(req, env, now)).status, 204);
  let metadata = env.sql.prepare('SELECT * FROM site_visit_events').get();
  assert.equal(metadata.device_model, 'Pixel 9'); assert.equal(metadata.os_version, '15.0.0');
  const iphone = visitorMetadata(request(undefined, '', { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1' }));
  assert.equal(iphone.deviceType, 'smartphone'); assert.equal(iphone.deviceModel, 'iPhone'); assert.equal(iphone.osVersion, '18.6'); assert.equal(iphone.browserFamily, 'Safari');
  const windows = visitorMetadata(request(undefined, '', { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36' }));
  assert.equal(windows.deviceType, 'desktop'); assert.equal(windows.osFamily, 'Windows'); assert.equal(windows.osVersion, 'NT 10.0');
  const unknown = visitorMetadata(request(undefined, '', { 'User-Agent': 'custom client' }));
  assert.equal(unknown.deviceType, 'unknown'); assert.equal(unknown.deviceModel, null);
  const headerModel = visitorMetadata(request(undefined, '', { 'User-Agent': androidUA, 'sec-ch-ua-model': '"SM-S918B"', 'sec-ch-ua-platform': '"Android"', 'sec-ch-ua-platform-version': '"14.0.0"' }));
  assert.equal(headerModel.deviceModel, 'SM-S918B'); assert.equal(headerModel.osVersion, '14.0.0');
});

test('optional metadata payload remains strict and original eventId-only clients still work', async () => {
  const env = setup();
  for (const payload of [
    { ipAddress: '203.0.113.5' }, { country: 'JP' }, { clientHint: null }, { clientHint: [] },
    { clientHint: { model: 'x'.repeat(101) } }, { clientHint: { model: 'bad\u0000label' } },
    { clientHint: { mobile: 'true' } }, { clientHint: { ip: '203.0.113.5' } },
  ]) assert.equal((await recordVisit(request(undefined, '', {}, payload), env, now)).status, 400);
  assert.equal((await recordVisit(request(undefined, '', {}, { clientHint: {} }), env, now)).status, 204);
  assert.equal((await recordVisit(request(), env, now)).status, 204);
  assert.equal(env.sql.prepare('SELECT COUNT(*) AS n FROM site_visit_events').get().n, 2);
});

test('details aggregate by selected range and JST hour; duplicate retries retain the original observation', async () => {
  const env = setup(), id = crypto.randomUUID();
  const first = await recordVisit(request(id, '', { 'cf-connecting-ip': '203.0.113.1', 'cf-ipcountry': 'JP' }), env, now);
  const cookie = first.headers.get('set-cookie').split(';')[0];
  await recordVisit(request(id, cookie, { 'cf-connecting-ip': '203.0.113.2', 'cf-ipcountry': 'US' }), env, new Date(now.getTime() + 1000));
  await recordVisit(request(undefined, cookie, { 'cf-connecting-ip': '203.0.113.1', 'cf-ipcountry': 'JP' }), env, new Date(now.getTime() + 1000));
  await recordVisit(request(undefined, '', { 'cf-connecting-ip': '203.0.113.2', 'cf-ipcountry': 'US' }), env, new Date('2026-10-09T05:00:00Z'));
  await recordVisit(request(), env, new Date('2026-10-08T14:59:59Z'));
  const stats = await readVisitorStats(env, statsRange('2026-10-09', '2026-10-09', now));
  assert.equal(stats.details.measuredViews, 3); assert.equal(stats.details.uniqueIPs, 2);
  assert.equal(stats.details.countries.find(row => row.country === 'JP').visitors, 1);
  assert.equal(stats.details.countries.find(row => row.country === 'JP').views, 2);
  assert.equal(stats.details.hours.length, 24);
  assert.deepEqual({ ...stats.details.hours[1] }, { hour: 1, visitors: 1, views: 2 });
  assert.deepEqual({ ...stats.details.hours[14] }, { hour: 14, visitors: 1, views: 1 });
  assert.equal(stats.details.hours.reduce((sum, row) => sum + row.views, 0), 3);
  const saved = env.sql.prepare('SELECT * FROM site_visit_events WHERE event_id=?').get(id);
  assert.equal(saved.ip_address, '203.0.113.1'); assert.equal(saved.country, 'JP'); assert.equal(saved.occurred_at, now.toISOString());
});

test('event listing uses bounded pages and group truncation rather than dumping every saved event', async () => {
  const env = setup();
  for (let i = 0; i < 57; i++) {
    const req = request(undefined, '', { 'cf-connecting-ip': '203.0.113.1' });
    Object.defineProperty(req, 'cf', { value: { country: 'JP', region: 'Region ' + i, city: 'City ' + i } });
    await recordVisit(req, env, new Date(now.getTime() + i * 1000));
  }
  const range = statsRange('2026-10-09', '2026-10-09', now);
  const first = (await readVisitorStats(env, range)).details;
  assert.deepEqual(first.pagination, { page: 1, total: 57, pageSize: 50, pages: 2 });
  assert.equal(first.events.length, 50); assert.equal(first.events[0].occurredAt, new Date(now.getTime() + 56000).toISOString());
  assert.equal(first.regions.length, 25); assert.equal(first.truncated.regions, true); assert.equal(first.truncated.countries, false);
  assert.equal(first.uniqueIPs, 1);
  const second = (await readVisitorStats(env, range, { page: 2 })).details;
  assert.equal(second.events.length, 7); assert.equal(second.events[6].occurredAt, now.toISOString());
  assert.equal((await readVisitorStats(env, range, { page: 100000 })).details.pagination.page, 2);
  assert.equal((await readVisitorStats(env, range, { page: -100 })).details.pagination.page, 1);
  assert.equal((await readVisitorStats(env, range, { page: 'unsafe' })).details.pagination.page, 1);
});

function insertObserved(env, entry) {
  const values = { occurredAt: entry.day + 'T01:00:00.000Z', ipAddress: null, country: null, region: null, city: null, deviceType: 'unknown', deviceModel: null, osFamily: null, osVersion: null, browserFamily: null, browserVersion: null, ...entry };
  env.sql.prepare('INSERT INTO site_visit_events (event_id,day,visitor_hash,occurred_at,ip_address,country,region,city,device_type,device_model,os_family,os_version,browser_family,browser_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(crypto.randomUUID(), values.day, values.day + ':' + values.visitor, values.occurredAt, values.ipAddress, values.country, values.region, values.city, values.deviceType, values.deviceModel, values.osFamily, values.osVersion, values.browserFamily, values.browserVersion);
}
function insertDay(env, day, visitors, views) {
  for (let i = 0; i < views; i++) insertObserved(env, { day, visitor: i % visitors });
}

test('period report calculates calendar-day changes, same-length comparison, averages, and completed weekday averages', async () => {
  const env = setup();
  insertDay(env, '2026-10-01', 1, 1);
  insertDay(env, '2026-10-02', 2, 3); insertDay(env, '2026-10-03', 1, 2);
  insertDay(env, '2026-10-05', 3, 6); insertDay(env, '2026-10-07', 1, 1);
  const stats = await readVisitorStats(env, statsRange('2026-10-05', '2026-10-07', now));
  assert.deepEqual(stats.totals, { visitors: 4, views: 7 });
  const report = stats.report;
  assert.equal(report.requestedDays, 3); assert.equal(report.measuredDays, 3); assert.equal(report.partialToday, false);
  assert.equal(report.averageVisitors, 4 / 3); assert.equal(report.averageViews, 7 / 3); assert.equal(report.viewsPerVisitor, 7 / 4); assert.equal(report.repeatViews, 3);
  assert.deepEqual(report.peakDay, { day: '2026-10-05', visitors: 3, views: 6 });
  assert.deepEqual(report.comparison, { start: '2026-10-02', end: '2026-10-04', measuredDays: 3, complete: true, visitors: 3, views: 5, visitorsDelta: 1, viewsDelta: 2, visitorsPercent: 1 / 3 * 100, viewsPercent: 40 });
  const byDay = new Map(report.daily.map(row => [row.day, row]));
  assert.equal(byDay.get('2026-10-05').deltaVisitors, 3); assert.equal(byDay.get('2026-10-05').visitorsPercent, null);
  assert.equal(byDay.get('2026-10-06').deltaVisitors, -3); assert.equal(byDay.get('2026-10-06').visitorsPercent, -100);
  assert.equal(byDay.get('2026-10-07').deltaViews, 1); assert.equal(byDay.get('2026-10-07').viewsPercent, null);
  assert.deepEqual(report.weekdays[1], { weekday: 1, days: 1, visitors: 3, views: 6, averageVisitors: 3, averageViews: 6 });
  assert.deepEqual(report.weekdays[2], { weekday: 2, days: 1, visitors: 0, views: 0, averageVisitors: 0, averageViews: 0 });
  assert.equal(report.weekdays[0].averageViews, null);
});

test('unfinished today and unmeasured comparison dates suppress misleading growth; no-data stays distinct from zero', async () => {
  const empty = await readVisitorStats(setup(), statsRange('2026-10-07', '2026-10-09', now));
  assert.equal(empty.report.measuredDays, 0); assert.equal(empty.report.averageVisitors, null); assert.equal(empty.report.averageViews, null);
  assert.equal(empty.report.viewsPerVisitor, null); assert.equal(empty.report.repeatViews, null); assert.equal(empty.report.peakDay, null);
  assert.equal(empty.report.comparison.complete, false); assert.equal(empty.report.comparison.visitorsDelta, null);
  const env = setup();
  insertDay(env, '2026-10-07', 1, 2); insertDay(env, '2026-10-09', 2, 3);
  const stats = await readVisitorStats(env, statsRange('2026-10-07', '2026-10-09', now));
  assert.equal(stats.report.measuredDays, 3); assert.equal(stats.report.partialToday, true); assert.equal(stats.report.averageViews, 5 / 3);
  assert.equal(stats.report.comparison.measuredDays, 0); assert.equal(stats.report.comparison.complete, false);
  for (const key of ['visitorsDelta', 'viewsDelta', 'visitorsPercent', 'viewsPercent']) assert.equal(stats.report.comparison[key], null);
  const today = stats.report.daily[0];
  for (const key of ['deltaVisitors', 'deltaViews', 'visitorsPercent', 'viewsPercent']) assert.equal(today[key], null);
  assert.equal(stats.report.daily.find(row => row.day === '2026-10-07').deltaVisitors, null);
  assert.equal(stats.report.weekdays[5].days, 0); assert.equal(stats.report.weekdays[5].averageVisitors, null);
  assert.equal(stats.report.weekdays.reduce((sum, row) => sum + row.days, 0), 1);
  const completed = await readVisitorStats(env, statsRange('2026-10-08', '2026-10-08', now));
  assert.equal(completed.report.averageViews, 0); assert.equal(completed.report.peakDay.views, 0);
  assert.equal(completed.report.viewsPerVisitor, null);
});

test('strict detail filters canonicalize addresses and reject arrays, invalid hours, oversized or control text', () => {
  assert.deepEqual(visitorDetailFilters(), { ip: '', country: '', device: '', os: '', browser: '', q: '', hour: '' });
  assert.deepEqual(visitorDetailFilters({ ip: '2001:0db8:0:0::1', country: ' jp ', device: 'smartphone', os: 'iOS', browser: 'Safari', q: ' 100%_Tokyo ', hour: '00', start: 'ignored' }), { ip: '2001:db8::1', country: 'JP', device: 'smartphone', os: 'iOS', browser: 'Safari', q: '100%_Tokyo', hour: '0' });
  assert.equal(visitorDetailFilters({ country: 'UNKNOWN' }).country, 'unknown');
  for (const raw of [null, [], { ip: 'bad' }, { ip: '999.1.1.1' }, { ip: ['1.2.3.4'] }, { country: 'Japan' }, { device: 'phone' }, { os: 'x'.repeat(41) }, { browser: false }, { q: 'x'.repeat(81) }, { q: 'line\nfeed' }, { hour: '24' }, { hour: '-1' }, { hour: '1.5' }, { hour: 2 }, { hour: '000' }]) assert.throws(() => visitorDetailFilters(raw), RangeError);
});

test('initial collection day remains in actual totals but cannot be treated as a complete comparison day', async () => {
  const env = setup(), later = new Date('2026-10-10T00:00:00Z');
  insertDay(env, '2026-10-07', 2, 5); insertDay(env, '2026-10-08', 3, 4);
  const oneDay = await readVisitorStats(env, statsRange('2026-10-08', '2026-10-08', later));
  assert.equal(oneDay.report.measuredDays, 1); assert.equal(oneDay.report.partialFirstDay, false);
  assert.equal(oneDay.report.comparison.measuredDays, 1); assert.equal(oneDay.report.comparison.complete, false);
  assert.equal(oneDay.report.comparison.visitorsDelta, null); assert.equal(oneDay.report.daily[0].deltaVisitors, null);
  const both = await readVisitorStats(env, statsRange('2026-10-07', '2026-10-08', later));
  assert.equal(both.report.partialFirstDay, true); assert.equal(both.report.averageVisitors, 2.5); assert.equal(both.report.averageViews, 4.5);
  assert.equal(both.report.weekdays.reduce((sum, row) => sum + row.days, 0), 1);
  assert.equal(both.report.weekdays[3].averageViews, null); assert.equal(both.report.weekdays[4].averageViews, 4);
  assert.equal(both.report.daily.find(row => row.day === '2026-10-07').deltaVisitors, null);
});

test('detail filters share scope across summaries, quality, groups, days, weekdays, and event pages while whole-site totals stay whole', async () => {
  const env = setup();
  const complete = { day: '2026-10-09', ipAddress: '203.0.113.7', country: 'JP', deviceType: 'smartphone', deviceModel: 'iPhone', osFamily: 'iOS', osVersion: '18.6', browserFamily: 'Safari', browserVersion: '18.6' };
  insertObserved(env, { ...complete, visitor: 'a', city: '100%_Tokyo' });
  insertObserved(env, { ...complete, visitor: 'a', city: '100XYZTokyo' });
  insertObserved(env, { day: '2026-10-09', visitor: 'b', occurredAt: '2026-10-08T15:00:00.000Z' });
  insertObserved(env, { day: '2026-10-09', visitor: 'c', country: 'US', deviceType: 'desktop', osFamily: 'Windows', browserFamily: 'Chrome' });
  const filters = { ip: '203.0.113.7', country: 'JP', device: 'smartphone', os: 'iOS', browser: 'Safari', q: '100%_', hour: '10' };
  const stats = await readVisitorStats(env, statsRange('2026-10-08', '2026-10-09', now), { filters });
  assert.deepEqual(stats.totals, { visitors: 3, views: 4 }); assert.equal(stats.report.repeatViews, 1);
  const details = stats.details;
  assert.equal(details.measuredViews, 1); assert.equal(details.uniqueIPs, 1); assert.equal(details.pagination.total, 1);
  assert.equal(details.events[0].city, '100%_Tokyo'); assert.equal(details.daily.length, 1); assert.equal(details.daily[0].views, 1);
  assert.equal(details.hours[10].views, 1); assert.equal(details.weekdays[5].views, 1);
  for (const key of ['countries', 'regions', 'devices', 'systems', 'browsers', 'ips', 'deviceBrowsers']) assert.equal(details[key].reduce((sum, row) => sum + row.views, 0), 1);
  for (const row of details.quality) { assert.equal(row.known, 1); assert.equal(row.unknown, 0); }
  assert.equal(details.ips[0].firstSeen, details.events[0].occurredAt); assert.equal(details.ips[0].lastSeen, details.events[0].occurredAt);
  const unknown = (await readVisitorStats(env, statsRange('2026-10-09', '2026-10-09', now), { filters: { country: 'unknown', device: 'unknown', os: 'unknown', browser: 'unknown', hour: '0' } })).details;
  assert.equal(unknown.measuredViews, 1); assert.equal(unknown.uniqueIPs, 0); assert.equal(unknown.ips[0].ipAddress, null);
  for (const row of unknown.quality) { assert.equal(row.known, 0); assert.equal(row.unknown, 1); }
  const none = (await readVisitorStats(env, statsRange('2026-10-09', '2026-10-09', now), { filters: { q: "' OR 1=1 --" } })).details;
  assert.equal(none.measuredViews, 0); assert.equal(none.events.length, 0); assert.equal(none.daily[0].views, 0);
});

test('filtered pagination and IP first/last observations retain the same filtered scope with literal backslash search', async () => {
  const env = setup(), day = '2026-10-09';
  for (let i = 0; i < 57; i++) insertObserved(env, { day, visitor: i % 3, occurredAt: new Date(now.getTime() + i * 1000).toISOString(), ipAddress: '203.0.113.7', country: 'JP', region: 'A\\B', deviceType: 'smartphone', browserFamily: 'Safari' });
  for (let i = 0; i < 5; i++) insertObserved(env, { day, visitor: 'other' + i, ipAddress: '203.0.113.8', country: 'US', region: 'AXB', deviceType: 'desktop', browserFamily: 'Chrome' });
  const stats = await readVisitorStats(env, statsRange(day, day, now), { page: 2, filters: { country: 'JP', q: 'A\\B' } });
  assert.equal(stats.totals.views, 62); assert.equal(stats.details.measuredViews, 57);
  assert.equal(stats.details.pagination.page, 2); assert.equal(stats.details.pagination.total, 57); assert.equal(stats.details.events.length, 7);
  assert.equal(stats.details.ips[0].views, 57); assert.equal(stats.details.ips[0].visitors, 3);
  assert.equal(stats.details.ips[0].firstSeen, now.toISOString()); assert.equal(stats.details.ips[0].lastSeen, new Date(now.getTime() + 56000).toISOString());
  assert.equal(stats.details.deviceBrowsers[0].deviceType, 'smartphone'); assert.equal(stats.details.deviceBrowsers[0].browserFamily, 'Safari');
  assert.equal(stats.details.quality.find(row => row.key === 'model').unknown, 57);
});

test('1000 deterministic report scenarios preserve arithmetic, date coverage, and unfinished-day invariants', () => {
  let state = 0x1012;
  const random = maximum => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % maximum; };
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
  for (let scenario = 0; scenario < 1000; scenario++) {
    const count = random(31) + 1, end = '2026-10-09', start = shiftDay(end, 1 - count), today = shiftDay(end, random(3));
    const earliest = shiftDay(start, -count), knownFrom = shiftDay(earliest, random(count * 2 + 4) - 2), firstDay = knownFrom <= end ? knownFrom : null;
    const values = new Map();
    for (let day = earliest; day <= end; day = shiftDay(day, 1)) {
      const visitors = day >= knownFrom ? (day === knownFrom ? random(19) + 1 : random(20)) : null, views = visitors === null ? null : visitors ? visitors + random(30) : 0;
      values.set(day, { day, visitors, views });
    }
    const lookup = day => values.get(day) || { day, visitors: null, views: null }, rows = [];
    for (let day = end; day >= start; day = shiftDay(day, -1)) rows.push(lookup(day));
    const report = buildVisitorReport({ start, end, today }, rows, lookup, firstDay), observed = rows.filter(row => row.visitors !== null);
    const totalVisitors = observed.reduce((sum, row) => sum + row.visitors, 0), totalViews = observed.reduce((sum, row) => sum + row.views, 0);
    assert.equal(report.requestedDays, count); assert.equal(report.measuredDays, observed.length);
    if (observed.length) {
      near(report.averageVisitors * observed.length, totalVisitors); near(report.averageViews * observed.length, totalViews);
      assert.equal(report.repeatViews + totalVisitors, totalViews);
      assert.equal(report.peakDay.visitors, Math.max(...observed.map(row => row.visitors)));
    } else { assert.equal(report.averageVisitors, null); assert.equal(report.repeatViews, null); assert.equal(report.peakDay, null); }
    if (totalVisitors) near(report.viewsPerVisitor * totalVisitors, totalViews); else assert.equal(report.viewsPerVisitor, null);
    assert.equal(report.partialFirstDay, Boolean(firstDay && start <= firstDay && firstDay <= end));
    assert.equal(report.weekdays.reduce((sum, row) => sum + row.days, 0), observed.filter(row => row.day !== today && row.day !== firstDay).length);
    near(report.weekdays.reduce((sum, row) => sum + (row.averageViews || 0) * row.days, 0), observed.filter(row => row.day !== today && row.day !== firstDay).reduce((sum, row) => sum + row.views, 0));
    for (const row of report.daily) {
      const previous = lookup(shiftDay(row.day, -1));
      if (row.day === today || row.day === firstDay || previous.day === firstDay || row.visitors === null || previous.visitors === null) { assert.equal(row.deltaVisitors, null); assert.equal(row.visitorsPercent, null); }
      else {
        assert.equal(previous.visitors + row.deltaVisitors, row.visitors);
        if (previous.visitors > 0) near(row.visitorsPercent / 100 * previous.visitors, row.deltaVisitors); else assert.equal(row.visitorsPercent, null);
      }
    }
    const comparison = report.comparison;
    assert.equal(comparison.complete, Boolean(firstDay && start > firstDay && comparison.start > firstDay && report.measuredDays === count && comparison.measuredDays === count && end < today));
    if (comparison.complete) { assert.equal(comparison.visitors + comparison.visitorsDelta, totalVisitors); assert.equal(comparison.views + comparison.viewsDelta, totalViews); }
    else for (const key of ['visitorsDelta', 'viewsDelta', 'visitorsPercent', 'viewsPercent']) assert.equal(comparison[key], null);
  }
});
