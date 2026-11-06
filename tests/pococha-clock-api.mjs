import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPocochaTimeApi, POCOCHA_TIME_URL, POCOCHA_TIME_SCHEMA,
  POCOCHA_TIME_SOURCE } from '../lib/pococha-clock.mjs';

const BASE = Date.parse('2026-10-11T19:16:00Z');
const ORIGIN = 'https://pococha2026.github.io';
const request = (method = 'GET', origin, url = 'https://example.chatgpt.site/api/pococha-time') =>
  new Request(url, { method, headers: origin ? { Origin: origin } : {} });
function upstream(headers = {}, status = 200) {
  return new Response(null, { status, headers: { Date: new Date(BASE).toUTCString(), ...headers } });
}
function fixture(fetcher) {
  let clock = BASE, timerId = 0;
  const calls = [], timers = new Map();
  const api = createPocochaTimeApi({ now: () => clock,
    fetcher: async (...args) => { calls.push(args); return fetcher ? fetcher(...args) : upstream(); },
    setTimer: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimer: id => timers.delete(id) });
  return { api, calls, timers, setNow: value => { clock = value; },
    fireTimeout: () => { for (const [id, timer] of [...timers]) {
      if (timer.delay === 6000 && timers.delete(id)) timer.callback();
    } } };
}
async function json(api, req = request()) { const response = await api(req); return { response, data: await response.json() }; }
async function flush() { for (let i = 0; i < 5; i++) await Promise.resolve(); }

test('HTTP Date sampling returns the named public website source and quantified precision', async () => {
  let f;
  f = fixture(async () => { f.setNow(BASE + 200); return upstream(); });
  const { response, data } = await json(f.api);
  assert.equal(response.status, 200);
  assert.equal(data.schema, POCOCHA_TIME_SCHEMA);
  assert.equal(data.source, POCOCHA_TIME_SOURCE);
  assert.equal(data.sourceURL, POCOCHA_TIME_URL);
  assert.equal(data.serverTimeMs, BASE + 600);
  assert.equal(data.uncertaintyMs, 600);
  assert.equal(data.upstreamRoundTripMs, 200);
  assert.equal(data.sampleAgeMs, 0);
  assert.equal(data.processingMs, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('vary'), 'Origin');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(f.timers.size, 0);
});

test('upstream URL and headers are fixed, fresh, and never copy visitor cookies or query parameters', async () => {
  const f = fixture();
  const visitor = new Request('https://example.chatgpt.site/api/pococha-time?url=https://attacker.example/&secret=visitor',
    { headers: { Cookie: 'session=private', Authorization: 'Bearer private' } });
  await f.api(visitor);
  const [address, options] = f.calls[0], url = new URL(address);
  assert.equal(url.origin + url.pathname, POCOCHA_TIME_URL);
  assert.deepEqual([...url.searchParams.keys()], ['_pococha1012_clock']);
  assert.equal(options.method, 'HEAD');
  assert.equal(options.redirect, 'manual');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.credentials, 'omit');
  const headers = new Headers(options.headers);
  assert.equal(headers.get('cookie'), null);
  assert.equal(headers.get('authorization'), null);
  assert.match(headers.get('cache-control'), /no-cache/);
  assert.match(headers.get('cache-control'), /no-store/);
  f.setNow(BASE + 60000);
  await f.api(request());
  assert.notEqual(f.calls[0][0], f.calls[1][0], 'A new upstream sample has a fresh URL');
});

test('within 60 seconds the cached sample advances rather than freezing; expiration fetches again', async () => {
  const f = fixture();
  const first = (await json(f.api)).data;
  f.setNow(BASE + 1500);
  const next = (await json(f.api)).data;
  assert.equal(f.calls.length, 1);
  assert.equal(next.serverTimeMs - first.serverTimeMs, 1500);
  assert.equal(next.sampleAgeMs, 1500);
  assert.equal(next.processingMs, 0);
  assert.ok(next.uncertaintyMs >= first.uncertaintyMs);
  f.setNow(BASE + 59999);
  await f.api(request());
  assert.equal(f.calls.length, 1);
  f.setNow(BASE + 60000);
  assert.equal((await f.api(request())).status, 200);
  assert.equal(f.calls.length, 2);
});

test('concurrent requests share one upstream sample while keeping individual response headers', async () => {
  let complete;
  const f = fixture(() => new Promise(resolve => { complete = resolve; }));
  const first = f.api(request('GET', ORIGIN));
  const second = f.api(request('GET', 'https://attacker.example'));
  await flush();
  assert.equal(f.calls.length, 1);
  f.setNow(BASE + 120);
  complete(upstream());
  const a = await first, b = await second;
  assert.deepEqual(await a.json(), await b.json());
  assert.equal(a.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(b.headers.get('access-control-allow-origin'), null);
});

test('response processing time distinguishes the initial upstream wait from cache and each coalesced caller', async () => {
  let complete;
  const f = fixture(() => new Promise(resolve => { complete = resolve; }));
  const first = f.api(request());
  await flush();
  f.setNow(BASE + 200);
  const second = f.api(request());
  await flush();
  f.setNow(BASE + 1000);
  complete(upstream());
  const a = await (await first).json(), b = await (await second).json();
  assert.equal(a.processingMs, 1000);
  assert.equal(b.processingMs, 800);
  assert.equal(a.serverTimeMs, b.serverTimeMs);
  assert.equal(a.upstreamRoundTripMs, 1000);
  assert.equal(f.calls.length, 1);
  f.setNow(BASE + 1300);
  const cached = (await json(f.api)).data;
  assert.equal(cached.processingMs, 0);
  assert.equal(cached.sampleAgeMs, 300);
  assert.equal(cached.serverTimeMs, a.serverTimeMs + 300);
});

test('invalid per-request processing duration fails instead of returning misleading timing metadata', async () => {
  for (const values of [[BASE, BASE, BASE, BASE, BASE + 6001],
    [BASE + 1, BASE, BASE, BASE, BASE], [NaN, BASE, BASE, BASE, BASE]]) {
    let index = 0;
    const api = createPocochaTimeApi({ now: () => values[index++] ?? BASE, fetcher: async () => upstream() });
    const { response, data } = await json(api);
    assert.equal(response.status, 503);
    assert.equal(data.serverTimeMs, undefined);
    assert.equal(data.processingMs, undefined);
  }
});

test('clock rollback invalidates the cached sample and obtains a new verified one', async () => {
  const f = fixture();
  await f.api(request());
  f.setNow(BASE - 1000);
  const { response, data } = await json(f.api);
  assert.equal(response.status, 200);
  assert.equal(data.sampleAgeMs, 0);
  assert.equal(f.calls.length, 2, 'Rollback must not advance old cached time');
});

test('clock rollback during the upstream request is rejected', async () => {
  let f;
  f = fixture(async () => { f.setNow(BASE - 1); return upstream(); });
  const { response, data } = await json(f.api);
  assert.equal(response.status, 503);
  assert.equal(data.serverTimeMs, undefined);
});

test('absent, malformed, impossible and incorrect-weekday HTTP Date values never synchronize', async () => {
  const values = [null, '', '2026-10-11T19:16:00Z', 'Sun, 32 Oct 2026 19:16:00 GMT',
    'Mon, 11 Oct 2026 19:16:00 GMT', 'Sun, 11 Oct 2026 25:16:00 GMT',
    'Sun, 11 Oct 2026 19:16:00 +0000'];
  for (const date of values) {
    const f = fixture(() => {
      const response = upstream();
      if (date === null) response.headers.delete('date'); else response.headers.set('date', date);
      return response;
    });
    const { response, data } = await json(f.api);
    assert.equal(response.status, 503, String(date));
    assert.equal(data.serverTimeMs, undefined);
  }
});

test('positive or malformed Age and implausibly old or future Date values are rejected', async () => {
  for (const age of ['1', '3600', '-1', 'garbage', '0.5']) {
    const f = fixture(() => upstream({ Age: age }));
    assert.equal((await f.api(request())).status, 503, age);
  }
  assert.equal((await fixture(() => upstream({ Age: '0' })).api(request())).status, 200);
  for (const offset of [-301000, 301000]) {
    const f = fixture(() => upstream({ Date: new Date(BASE + offset).toUTCString() }));
    assert.equal((await f.api(request())).status, 503, String(offset));
  }
});

test('non-success status, redirect history and unexpected upstream URL fail closed', async () => {
  for (const status of [301, 302, 304, 403, 429, 500, 503]) {
    const f = fixture(() => upstream({}, status));
    assert.equal((await f.api(request())).status, 503, String(status));
  }
  for (const [key, value] of [['redirected', true], ['url', 'https://attacker.example/']]) {
    const f = fixture(() => { const response = upstream(); Object.defineProperty(response, key, { value }); return response; });
    assert.equal((await f.api(request())).status, 503, key);
  }
});

test('fresh official-root redirect Date is sampled without following its same-site language target', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    for (const location of ['/en-us/?_pococha1012_clock=sample', 'https://www.pococha.com/ja']) {
      const f = fixture(() => upstream({ Location: location }, status));
      const { response, data } = await json(f.api);
      assert.equal(response.status, 200, status + ' ' + location);
      assert.equal(data.serverTimeMs, BASE + 500);
      assert.equal(f.calls.length, 1, 'No redirect destination is fetched');
      assert.equal(f.calls[0][1].redirect, 'manual');
    }
  }
});

test('redirect time is rejected for external, HTTP, credentialed, absent and invalid destinations', async () => {
  for (const location of ['https://attacker.example/', '//attacker.example/', 'http://www.pococha.com/ja',
    'https://www.pococha.com.attacker.example/', 'https://user@www.pococha.com/', 'http://[', '']) {
    const f = fixture(() => upstream({ Location: location }, 307));
    assert.equal((await f.api(request())).status, 503, location);
    assert.equal(f.calls.length, 1);
  }
  const f = fixture(() => upstream({ Location: '/ja' }, 304));
  assert.equal((await f.api(request())).status, 503);
});

test('over 5 seconds of round-trip delay is rejected even when the request completed', async () => {
  let f;
  f = fixture(async () => { f.setNow(BASE + 5001); return upstream(); });
  assert.equal((await f.api(request())).status, 503);
  assert.equal(f.timers.size, 0);
});

test('six-second timeout aborts and completes even if an upstream fetch ignores AbortSignal', async () => {
  const f = fixture(() => new Promise(() => {}));
  const pending = f.api(request());
  await flush();
  const signal = f.calls[0][1].signal;
  assert.equal(signal.aborted, false);
  f.fireTimeout();
  const response = await pending;
  assert.equal(response.status, 503);
  assert.equal(signal.aborted, true);
  assert.equal(f.timers.size, 0);
});

test('failure backoff suppresses request floods, expires, and recovers after clock rollback', async () => {
  let failing = true;
  const f = fixture(() => { if (failing) throw new Error('network'); return upstream(); });
  assert.equal((await f.api(request())).status, 503);
  f.setNow(BASE + 9999);
  assert.equal((await f.api(request())).status, 503);
  assert.equal(f.calls.length, 1);
  failing = false;
  f.setNow(BASE + 10000);
  assert.equal((await f.api(request())).status, 200);
  assert.equal(f.calls.length, 2);
  const rollback = fixture(() => { if (failing) throw new Error('network'); return upstream(); });
  failing = true;
  await rollback.api(request());
  failing = false; rollback.setNow(BASE - 1);
  assert.equal((await rollback.api(request())).status, 200);
  assert.equal(rollback.calls.length, 2);
});

test('GET and HEAD CORS is restricted to the publication origin without credentials', async () => {
  const f = fixture();
  for (const origin of [ORIGIN, 'https://attacker.example', ORIGIN + '.attacker.example', undefined]) {
    for (const method of ['GET', 'HEAD']) {
      const response = await f.api(request(method, origin));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('access-control-allow-origin'), origin === ORIGIN ? ORIGIN : null);
      assert.equal(response.headers.get('access-control-allow-credentials'), null);
      assert.equal(response.headers.get('vary'), 'Origin');
      if (method === 'HEAD') assert.equal(await response.text(), '');
    }
  }
});

test('preflight and rejected methods never contact the upstream or accept writes', async () => {
  const f = fixture();
  const options = await f.api(request('OPTIONS', ORIGIN));
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('access-control-allow-methods'), 'GET, HEAD');
  assert.equal((await f.api(request('OPTIONS', 'https://attacker.example'))).status, 403);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await f.api(request(method, ORIGIN));
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD, OPTIONS');
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
  assert.equal(f.calls.length, 0);
});

test('Worker routes the dedicated public clock API before its existing framework handler', async () => {
  const worker = await readFile(new URL('../build/sites-worker.ts', import.meta.url), 'utf8');
  assert.match(worker, /import \{ pocochaTimeApi \} from "\.\.\/lib\/pococha-clock\.mjs"/);
  const route = worker.indexOf('if (path === "/api/pococha-time") return pocochaTimeApi(request);');
  assert.ok(route >= 0 && route < worker.indexOf('handler.fetch(request, env, ctx)'));
});
