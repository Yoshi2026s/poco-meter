import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, pageEngine, plain, html, pointsFromK } from './calculator-harness.mjs';

const baseline = plain(engine().state);
const clockPath = '/api/pococha-time';
const officialURL = 'https://www.pococha.com/';
const sample = (time = '2026-10-12T21:59:58+09:00', overrides = {}) => ({
  schema: 'pococha-site-time-v1', source: 'pococha-official-website-http-date',
  sourceURL: officialURL, serverTimeMs: Date.parse(time), sampleAgeMs: 0,
  uncertaintyMs: 500, upstreamRoundTripMs: 20, processingMs: 0, ...overrides,
});
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };

async function clockPage(settings = {}, capabilities = {}) {
  let monotonicMs = 1000;
  const calls = [];
  const storageValues = new Map();
  const writes = [];
  const localStorage = {
    getItem: key => storageValues.get(key) ?? null,
    setItem(key, value) { writes.push({ key, value }); storageValues.set(key, value); },
  };
  storageValues.set('pococha-meter-calc-v1', JSON.stringify({ ...baseline, target: '100000', current: '0', ...settings }));
  const fetch = (url, options) => {
    if (url !== clockPath) return new Promise(() => {});
    return new Promise((resolve, reject) => {
      const call = { url, options, resolve, reject };
      calls.push(call);
      options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  };
  const page = pageEngine(undefined, { fetch, localStorage, performance: { now: () => monotonicMs },
    navigator: { onLine: true }, ...capabilities });
  await settle();
  return { page, calls, writes, storageValues,
    advance: ms => { monotonicMs += ms; },
    async reply(data = sample(), { rtt = 0, ok = true, jsonError = false, index = calls.length - 1 } = {}) {
      assert.ok(calls[index], 'A clock request must precede its response');
      monotonicMs += rtt;
      calls[index].resolve({ ok, json: async () => { if (jsonError) throw new Error('invalid JSON'); return data; } });
      await settle();
    },
    async reject(index = calls.length - 1) { calls[index].reject(new Error('network unavailable')); await settle(); },
  };
}

function assertTimes(page, time, countdown) {
  assert.equal(page.element('todayTime').textContent, time);
  assert.equal(page.element('miniNowTime').textContent, time);
  assert.equal(page.element('todayTimeLabel').textContent, page.element('miniTimeLabel').textContent,
    'Main and HUD clocks must use the same time-source label');
  if (countdown !== undefined) {
    if (!countdown.includes('.')) countdown += '.0';
    assert.equal(page.element('left').textContent, countdown);
    assert.equal(page.element('miniT').textContent, countdown);
  }
}
const sourceLabel = page => page.element('clockTimeSource').textContent;
const syncLabel = page => page.element('clockSyncStatus').textContent;
const refreshClock = page => page.element('clockSyncNow').dispatchEvent(new Event('click'));
function assertTimeLabels(page, expected) {
  assert.equal(page.element('todayTimeLabel').textContent, expected);
  assert.equal(page.element('miniTimeLabel').textContent, expected);
}

test('The public page uses the fixed time endpoint and never contacts an arbitrary clock host', async () => {
  const c = await clockPage();
  assert.equal(c.calls.length, 1);
  assert.equal(c.calls[0].url, clockPath);
  assert.equal(c.calls[0].options.cache, 'no-store');
  assert.equal(c.calls[0].options.credentials, 'same-origin');
  assert.ok(c.calls[0].options.signal instanceof AbortSignal);
  assert.ok(!/fetch\(['"]https:\/\/www\.pococha\.com/.test(html), 'The browser uses the server endpoint');
  await c.reply();
  assert.equal(sourceLabel(c.page), 'Pocochaサーバー時刻');
  assertTimeLabels(c.page, 'Pocochaサーバー時刻');
  assert.match(syncLabel(c.page), /同期済み/);
  assertTimes(c.page, '21:59:58', '00:00:02');
  assert.match(c.page.element('left').getAttribute('aria-label'), /公式サイト/);
  assert.equal(c.page.element('left').getAttribute('aria-label'), c.page.element('miniT').getAttribute('aria-label'));
});

test('The synchronized clock adds half the measured response trip and ignores later device-clock changes', async () => {
  const c = await clockPage();
  await c.reply(sample('2026-10-12T21:59:58.700+09:00'), { rtt: 400 });
  assertTimes(c.page, '21:59:58', '00:00:01.1');
  c.page.setNow('2035-04-01T04:05:06+09:00');
  c.advance(1100); c.page.tick(1000);
  assertTimes(c.page, '22:00:00', '24:00:00');
  assert.equal(c.page.element('today').getAttribute('datetime'), '2026-10-12T22:00:00+09:00');
  assert.equal(c.page.element('miniNow').getAttribute('datetime'), '2026-10-12T22:00:00+09:00');
});

test('Fractional response trip and monotonic elapsed time keep updating the required pace', async () => {
  const c=await clockPage();
  await c.reply(sample('2026-10-12T21:59:58+09:00'),{rtt:100.5});
  assertTimes(c.page,'21:59:58','00:00:02.0');
  const required=100000n*3600000n*4n,denominator=7799n;
  assert.equal(pointsFromK(c.page.element('perHour').textContent),(required+denominator-1n)/denominator);
  c.advance(50.125);assert.doesNotThrow(()=>c.page.tick(1000));
  const nextRequired=100000n*3600000n*8n,nextDenominator=15197n;
  assert.equal(pointsFromK(c.page.element('perHour').textContent),(nextRequired+nextDenominator-1n)/nextDenominator);
  assert.equal(c.page.element('miniT').textContent,c.page.element('left').textContent);
  assert.equal(sourceLabel(c.page),'Pocochaサーバー時刻');
});

test('The clock adds only network transit after the server sample and excludes server processing duration', async () => {
  const c = await clockPage();
  await c.reply(sample('2026-10-12T21:59:58.900+09:00', { processingMs: 1400 }), { rtt: 1600 });
  assertTimes(c.page, '21:59:59', '00:00:01');
  assert.match(syncLabel(c.page), /同期済み/);
});

test('The synchronized Japanese date and midnight cutoff roll together on the main page and HUD', async () => {
  const c = await clockPage({ deadline: '00:00' });
  await c.reply(sample('2026-10-12T23:59:59+09:00'));
  assertTimes(c.page, '23:59:59', '00:00:01');
  assert.equal(c.page.element('miniNowDate').textContent, '2026/10/12（月）');
  c.advance(1000); c.page.tick(1000);
  assertTimes(c.page, '00:00:00', '24:00:00');
  assert.equal(c.page.element('todayDate').textContent, '10/13（火）');
  assert.equal(c.page.element('miniNowDate').textContent, '2026/10/13（火）');
});

test('Configured 13:00 and 22:00 cutoffs use the synchronized sample at the exact boundary', async () => {
  for (const deadline of ['13:00', '22:00']) {
    const c = await clockPage({ deadline });
    await c.reply(sample(`2026-10-12T${deadline}:00+09:00`));
    assertTimes(c.page, deadline + ':00', '24:00:00');
    global.gc?.();
  }
});

test('Malformed identity, schema and numeric time samples never claim synchronization', async () => {
  const invalid = [
    null, {}, sample(undefined, { schema: 'unknown' }), sample(undefined, { source: 'device-clock' }),
    sample(undefined, { sourceURL: 'https://example.com/' }), sample(undefined, { sourceURL: 'https://www.pococha.com/ja' }),
    sample(undefined, { serverTimeMs: '1791809998000' }), sample(undefined, { serverTimeMs: NaN }),
    sample(undefined, { serverTimeMs: Date.parse('1999-12-31T23:59:59Z') }),
    sample(undefined, { serverTimeMs: Date.parse('2101-01-01T00:00:00Z') }),
    sample(undefined, { sampleAgeMs: -1 }), sample(undefined, { sampleAgeMs: 60001 }),
    sample(undefined, { uncertaintyMs: 499 }), sample(undefined, { uncertaintyMs: 3501 }),
    sample(undefined, { upstreamRoundTripMs: -1 }), sample(undefined, { upstreamRoundTripMs: 5001 }),
    sample(undefined, { processingMs: -1 }), sample(undefined, { processingMs: 6001 }),
    sample(undefined, { processingMs: NaN }), sample(undefined, { processingMs: '0' }),
    sample(undefined, { processingMs: 101 }),
  ];
  for (const data of invalid) {
    const c = await clockPage();
    await c.reply(data);
    assert.match(sourceLabel(c.page), /端末時計/);
    assertTimeLabels(c.page, '端末時刻');
    assert.match(syncLabel(c.page), /未同期/);
    assertTimes(c.page, '21:00:00', '01:00:00');
    global.gc?.();
  }
});

test('HTTP, parsing, network and timeout failures visibly fall back to the device clock', async () => {
  for (const failure of ['http', 'json', 'network', 'timeout']) {
    const c = await clockPage();
    if (failure === 'network') await c.reject();
    else if (failure === 'timeout') { c.page.flushTimers(10000); await settle(); assert.equal(c.calls[0].options.signal.aborted, true); }
    else await c.reply(sample(), { ok: failure !== 'http', jsonError: failure === 'json' });
    assert.match(sourceLabel(c.page), /端末時計/);
    assertTimeLabels(c.page, '端末時刻');
    assert.match(syncLabel(c.page), /未同期/);
    assertTimes(c.page, '21:00:00', '01:00:00');
    global.gc?.();
  }
});

test('Client response trip and total uncertainty limits reject excessively delayed samples', async () => {
  for (const [rtt, uncertaintyMs] of [[10001, 500], [6000, 3500]]) {
    const c = await clockPage();
    await c.reply(sample(undefined, { uncertaintyMs }), { rtt });
    assert.match(sourceLabel(c.page), /端末時計/);
    assertTimeLabels(c.page, '端末時刻');
    assert.match(syncLabel(c.page), /未同期/);
    global.gc?.();
  }
});

test('Restore, network and refresh events deduplicate in-flight requests and respect the ten-second throttle', async () => {
  const c = await clockPage();
  c.page.dispatchWindow('pageshow', {}); c.page.dispatchWindow('focus', {}); c.page.dispatchWindow('online', {});
  refreshClock(c.page); c.page.tick(60000); await settle();
  assert.equal(c.calls.length, 1);
  await c.reply();
  c.page.dispatchWindow('focus', {}); refreshClock(c.page); await settle();
  assert.equal(c.calls.length, 1);
  c.advance(9999); refreshClock(c.page); await settle();
  assert.equal(c.calls.length, 1);
  c.advance(1); refreshClock(c.page); await settle();
  assert.equal(c.calls.length, 2);
  c.page.dispatchWindow('online', {}); c.page.tick(60000); await settle();
  assert.equal(c.calls.length, 2);
  await c.reply(sample('2026-10-12T22:00:08+09:00'));
});

test('The minute refresh pauses while hidden and resynchronizes when visible or restored', async () => {
  const c = await clockPage();
  await c.reply(sample(), { rtt: 1000 });
  // The interval starts at page initialization, before the first sample arrives.
  // Its first minute must still refresh a sample that is only 59 seconds old.
  c.advance(59000); c.page.tick(60000); await settle();
  assert.equal(c.calls.length, 2);
  c.page.tick(60000); await settle();
  assert.equal(c.calls.length, 2, 'A repeated interval cannot duplicate the pending request');
  await c.reply(sample('2026-10-12T22:00:58+09:00'));
  c.advance(60000); c.page.document.hidden = true; c.page.tick(60000);
  assert.equal(c.calls.length, 2);
  c.page.dispatchDocument('visibilitychange');
  assert.equal(c.calls.length, 2);
  c.page.document.hidden = false; c.page.dispatchDocument('visibilitychange'); await settle();
  assert.equal(c.calls.length, 3);
  await c.reply(sample('2026-10-12T22:01:58+09:00'));
  c.advance(60000); c.page.dispatchWindow('pageshow', { persisted: true }); await settle();
  assert.equal(c.calls.length, 4);
  await c.reply(sample('2026-10-12T22:02:58+09:00'));
  assertTimes(c.page, '22:02:58', '23:57:02');
});

test('Online and focus events refresh an old sample without bypassing the request throttle', async () => {
  const c = await clockPage(); await c.reply();
  c.advance(60000); c.page.dispatchWindow('online', {}); await settle();
  assert.equal(c.calls.length, 2); await c.reply(sample('2026-10-12T22:00:58+09:00'));
  c.advance(60000); c.page.dispatchWindow('focus', {}); await settle();
  assert.equal(c.calls.length, 3); await c.reply(sample('2026-10-12T22:01:58+09:00'));
});

test('A failed resynchronization retains a recent monotonic sample with an explicit failure label', async () => {
  const c = await clockPage(); await c.reply();
  c.advance(60000); refreshClock(c.page); await settle(); await c.reject();
  assert.equal(sourceLabel(c.page), 'Pocochaサーバー時刻');
  assertTimeLabels(c.page, 'Pocochaサーバー時刻');
  assert.match(syncLabel(c.page), /再同期失敗/);
  assertTimes(c.page, '22:00:58', '23:59:02');
  c.page.setNow('2030-01-01T10:00:00+09:00'); c.advance(1000); c.page.tick(1000);
  assertTimes(c.page, '22:00:59', '23:59:01');
});

test('Samples older than five minutes or a regressed monotonic clock fall back with a clear label', async () => {
  for (const advance of [300001, -1]) {
    const c = await clockPage(); await c.reply();
    c.page.setNow('2026-10-12T10:05:00+09:00'); c.advance(advance); c.page.tick(1000);
    assertTimes(c.page, '10:05:00', '11:55:00');
    assert.match(sourceLabel(c.page), /端末時計/);
    assertTimeLabels(c.page, '端末時刻');
    assert.match(syncLabel(c.page), /同期切れ|未同期/);
    global.gc?.();
  }
});

test('Clock samples stay in memory and do not create or alter clock-specific storage records', async () => {
  const c = await clockPage(); await c.reply();
  c.advance(60000); c.page.tick(60000); await settle(); await c.reply(sample('2026-10-12T22:00:58+09:00'));
  assert.equal(c.writes.some(({ key }) => /clock|time-sync|server-time/i.test(key)), false);
  for (const { value } of c.writes) assert.ok(!/pococha-site-time-v1|pococha-official-website-http-date|serverTimeMs|clockSample/.test(value));
  const restarted = pageEngine(undefined, { localStorage: { getItem: key => c.storageValues.get(key) ?? null, setItem() {} } });
  assertTimes(restarted, '21:00:00', '01:00:00');
  assert.match(sourceLabel(restarted), /端末時計/);
  assertTimeLabels(restarted, '端末時刻');
  assert.match(syncLabel(restarted), /未同期/);
});

test('Unavailable monotonic clocks leave a usable and honestly labeled device-clock calculator', async () => {
  let requests = 0;
  const page = pageEngine({ ...baseline, target: '100000' }, { fetch: () => { requests++; return new Promise(() => {}); } });
  await settle();
  assert.match(sourceLabel(page), /端末時計/);
  assertTimeLabels(page, '端末時刻');
  assert.match(syncLabel(page), /未同期/);
  assertTimes(page, '21:00:00', '01:00:00');
  assert.equal(requests, 1, 'Only the existing border request is sent without a monotonic clock');
  page.element('currentTop').value = '1000'; page.element('currentTop').dispatchEvent(new Event('input'));
  assert.equal(page.element('remain').textContent, '99K');
});
