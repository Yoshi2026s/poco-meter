import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPages } from '../scripts/build-pages.mjs';
import vm from 'node:vm';

// Execute the shipped worker in a fresh realm for each test. No worker logic is
// copied into this harness; requests, storage, clients and time are controlled.
const workerSource = await readFile(new URL('../calculator/sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://meter.example';
const HOME = `${ORIGIN}/`;
// Public constants follow the current release; lifecycle assertions below keep
// checking the shipped worker rather than an obsolete cache namespace.
const workerConstants = vm.runInNewContext(workerSource.slice(0, workerSource.indexOf('function expectedAssetType'))
  + '\n({cache:CACHE_NAME,methodPath:METHOD_PATH,methodMarker:METHOD_MARKER})', { self: { location: { origin: ORIGIN } }, URL });
const CACHE = workerConstants.cache, METHOD_PATH = workerConstants.methodPath, METHOD_MARKER = workerConstants.methodMarker;
const MARKER = '<meta name="pococha-app" content="meter-offline-v1">';
const ASSETS = ['/meter.webmanifest', '/meter-icon-192.png', '/meter-icon-512.png', '/meter-icon-180.png', METHOD_PATH, '/border-history'];

class FakeResponse {
  constructor(body = '', options = {}) {
    this.body = String(body);
    this.status = options.status ?? 200;
    this.type = options.type ?? 'default';
    this.url = options.url ?? '';
    this.redirected = options.redirected ?? false;
    this.headers = new Headers(options.headers);
    this.bodyUsed = false;
    this.readError = options.readError;
  }
  clone() {
    if (this.bodyUsed) throw new TypeError('Body has already been read');
    return new FakeResponse(this.body, {
      status: this.status, type: this.type, url: this.url,
      redirected: this.redirected, headers: this.headers, readError: this.readError,
    });
  }
  async text() {
    if (this.bodyUsed) throw new TypeError('Body has already been read');
    this.bodyUsed = true;
    if (this.readError) throw this.readError;
    return this.body;
  }
  static error() { return new FakeResponse('', { status: 0, type: 'error' }); }
}

function shell(label = 'calculator', options = {}) {
  return new FakeResponse(`<!doctype html>${MARKER}<main>${label}</main>`, {
    url: HOME, type: 'basic', headers: { 'Content-Type': 'text/html; charset=utf-8' }, ...options,
  });
}
function request(path = '/', options = {}) {
  return { url: new URL(path, HOME).href, method: 'GET', mode: 'navigate', ...options };
}
function assetResponse(path) {
  return new FakeResponse(path === '/border-history' ? '<!doctype html><meta name="pococha-history" content="border-history-v1">' : path === METHOD_PATH ? `<!doctype html>${METHOD_MARKER}<main>${path}</main>` : path,
    { url: new URL(path, HOME).href, type: 'basic',
      headers: { 'Content-Type': (path === METHOD_PATH || path === '/border-history') ? 'text/html; charset=utf-8' : path.endsWith('.png') ? 'image/png' : 'application/manifest+json' } });
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 16; i += 1) await Promise.resolve(); }

function harness(options = {}) {
  const entries = new Map();
  const operations = [];
  const calls = [];
  const handlers = new Map();
  const timers = new Map();
  let now = 0, timerId = 0, skipped = 0, claimed = 0;
  let fetcher = options.fetch ?? (async input => {
    const url = typeof input === 'string' ? input : input.url;
    return url === HOME ? shell('network') : assetResponse(new URL(url, HOME).pathname);
  });
  function bucket(name) {
    if (!entries.has(name)) entries.set(name, new Map());
    return entries.get(name);
  }
  for (const [name, values] of Object.entries(options.seed ?? {})) {
    const map = bucket(name);
    for (const [url, value] of Object.entries(values)) map.set(url, value.clone());
  }
  const caches = {
    async open(name) {
      operations.push(['open', name]);
      if (options.openError) throw options.openError;
      const map = bucket(name);
      return {
        async put(key, value) {
          operations.push(['put', name, key]);
          if (options.putError) throw options.putError;
          map.set(key, value.clone());
        },
        async match(key) {
          operations.push(['match', name, key]);
          if (options.matchError) throw options.matchError;
          return map.get(key)?.clone();
        },
        async delete(key) {
          operations.push(['remove', name, key]);
          return map.delete(key);
        },
      };
    },
    async keys() { return [...entries.keys()]; },
    async delete(name) { operations.push(['delete', name]); return entries.delete(name); },
  };
  const self = {
    location: { origin: ORIGIN },
    registration: { scope: options.scope ?? HOME },
    addEventListener(type, listener) { handlers.set(type, listener); },
    async skipWaiting() { skipped += 1; },
    clients: { async claim() { claimed += 1; } },
  };
  const context = vm.createContext({
    self, caches, URL, Headers, Response: FakeResponse, AbortController,
    fetch(input, init) { calls.push({ input, init }); return Promise.resolve().then(() => fetcher(input, init)); },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(options.source ?? workerSource, context, { filename: 'calculator/sw.js' });
  return {
    entries, operations, calls, timers,
    get skipped() { return skipped; }, get claimed() { return claimed; },
    get(name) { return vm.runInContext(name, context); },
    setFetch(next) { fetcher = next; },
    dispatch(type, fields = {}) {
      const event = { ...fields, waited: [], response: undefined,
        waitUntil(promise) { this.waited.push(Promise.resolve(promise)); Promise.resolve(promise).catch(() => {}); },
        respondWith(promise) { this.response = Promise.resolve(promise); this.response.catch(() => {}); },
      };
      handlers.get(type)(event);
      return event;
    },
    async advance(ms) {
      now += ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); due[1].callback(); await flush();
      }
      await flush();
    },
    cached(key = HOME, name = CACHE) { return entries.get(name)?.get(key); },
  };
}
function seeded(extra = {}) { return harness({ seed: { [CACHE]: { [HOME]: shell('saved') } }, ...extra }); }
function client(url = HOME) { return { url, replies: [], postMessage(message) { this.replies.push(message); } }; }
async function lifetime(event) { await Promise.all(event.waited); }

test('01 root navigation is eligible for the app shell', () => {
  assert.equal(harness().get('shellRequest')(request()), true);
});

test('02 root with query parameters is excluded', () => {
  assert.equal(harness().get('shellRequest')(request('/?next=/login')), false);
});

test('03 API and nested routes are excluded', () => {
  const eligible = harness().get('shellRequest');
  assert.equal(eligible(request('/api/records')), false);
  assert.equal(eligible(request('/login')), false);
});

test('04 another origin cannot use the shell', () => {
  assert.equal(harness().get('shellRequest')(request('https://other.example/')), false);
});

test('05 non-GET root requests are excluded', () => {
  assert.equal(harness().get('shellRequest')(request('/', { method: 'POST' })), false);
});

test('06 root subresource requests are excluded', () => {
  assert.equal(harness().get('shellRequest')(request('/', { mode: 'cors' })), false);
});

test('07 marked HTML shell is validated without consuming its body', async () => {
  const response = shell();
  assert.equal(await harness().get('validShell')(response), true);
  assert.equal(response.bodyUsed, false);
  assert.match(await response.text(), /calculator/);
});

test('08 all non-200 shell statuses are rejected', async () => {
  const validate = harness().get('validShell');
  for (const status of [0, 204, 302, 401, 403, 404, 500]) {
    assert.equal(await validate(shell('', { status })), false, `status ${status}`);
  }
});

test('09 redirected HTML cannot be cached as the shell', async () => {
  assert.equal(await harness().get('validShell')(shell('', { redirected: true })), false);
});

test('10 opaque and cross-origin response types are rejected', async () => {
  const validate = harness().get('validShell');
  for (const type of ['opaque', 'opaqueredirect', 'cors', 'error']) {
    assert.equal(await validate(shell('', { type })), false, type);
  }
});

test('11 MIME guards reject JSON and HTML lookalikes', async () => {
  const validate = harness().get('validShell');
  for (const mime of ['application/json', 'text/plain', 'text/html-not-really', '']) {
    assert.equal(await validate(shell('', { headers: { 'Content-Type': mime } })), false, mime);
  }
});

test('12 a login URL or another origin is not a root shell', async () => {
  const validate = harness().get('validShell');
  assert.equal(await validate(shell('', { url: `${ORIGIN}/login` })), false);
  assert.equal(await validate(shell('', { url: 'https://other.example/' })), false);
});

test('13 generic HTML without the app marker is rejected', async () => {
  const response = new FakeResponse('<html>Sign in</html>', { url: HOME, headers: { 'Content-Type': 'text/html' } });
  assert.equal(await harness().get('validShell')(response), false);
});

test('14 default responses and case-insensitive HTML MIME remain valid', async () => {
  assert.equal(await harness().get('validShell')(shell('', { type: 'default', url: '',
    headers: { 'Content-Type': 'TEXT/HTML; charset=UTF-8' } })), true);
});

test('15 cacheShell saves a readable clone under the absolute root key', async () => {
  const h = harness(), response = shell('fresh');
  assert.equal(await h.get('cacheShell')(response), true);
  assert.equal(response.bodyUsed, false);
  assert.match(await h.cached().text(), /fresh/);
  assert.deepEqual(h.operations.filter(op => op[0] === 'put'), [['put', CACHE, HOME]]);
});

test('16 invalid shell does not open or alter a cache', async () => {
  const h = seeded();
  assert.equal(await h.get('cacheShell')(shell('forbidden', { status: 403 })), false);
  assert.deepEqual(h.operations, []);
  assert.match(h.cached().body, /saved/);
});

test('17 cacheShell exposes quota failure without replacing a saved shell', async () => {
  const h = seeded({ putError: new Error('QuotaExceededError') });
  await assert.rejects(h.get('cacheShell')(shell('fresh')), /QuotaExceededError/);
  assert.match(h.cached().body, /saved/);
});

test('18 savedShell returns a valid cached response', async () => {
  const h = seeded();
  const response = await h.get('savedShell')();
  assert.equal(response.status, 200);
  assert.match(await response.text(), /saved/);
});

test('19 corrupt cached HTML is deleted before offline reuse', async () => {
  const h = harness({ seed: { [CACHE]: { [HOME]: new FakeResponse('login', { headers: { 'Content-Type': 'text/html' } }) } } });
  assert.equal(await h.get('savedShell')(), null);
  assert.equal(h.cached(), undefined);
  assert.ok(h.operations.some(op => op[0] === 'remove' && op[2] === HOME));
});

test('20 savedShell tolerates cache open and match failures', async () => {
  assert.equal(await seeded({ openError: new Error('storage disabled') }).get('savedShell')(), null);
  assert.equal(await seeded({ matchError: new Error('read failed') }).get('savedShell')(), null);
});

test('21 unreadable cached response is treated as unavailable', async () => {
  const h = harness({ seed: { [CACHE]: { [HOME]: shell('', { readError: new Error('corrupt body') }) } } });
  assert.equal(await h.get('savedShell')(), null);
});

test('22 prepareShell uses explicit same-origin fetch and cache policies', async () => {
  const h = harness();
  await h.get('prepareShell')();
  assert.equal(h.calls[0].input, HOME);
  assert.equal(h.calls[0].init.cache, 'no-store');
  assert.equal(h.calls[0].init.credentials, 'same-origin');
  assert.equal(h.calls[0].init.signal.aborted, false);
  assert.deepEqual(h.calls.slice(1).map(call => call.input), ASSETS);
  for (const call of h.calls.slice(1)) {
    assert.equal(call.init.cache, 'no-cache');
    assert.equal(call.init.credentials, 'same-origin');
    assert.equal(call.init.signal, h.calls[0].init.signal);
  }
  assert.equal(h.timers.size, 0);
});

test('23 preparation saves the validated manifest and all three icons', async () => {
  const h = harness();
  await h.get('prepareShell')();
  assert.ok(h.cached());
  for (const path of ASSETS) assert.equal(h.cached(new URL(path, HOME).href).body, assetResponse(path).body);
  assert.equal(h.entries.get(CACHE).size, 1 + ASSETS.length);
});

test('24 optional icon failures leave a usable prepared shell', async () => {
  const h = harness({ fetch: async input => { if (input === HOME) return shell('ready'); throw new Error('icon offline'); } });
  await h.get('prepareShell')();
  assert.match(h.cached().body, /ready/);
  assert.equal(h.entries.get(CACHE).size, 1);
  assert.equal(h.timers.size, 0);
});

test('25 asset status, redirect and MIME guards prevent invalid cache entries', async () => {
  const h = harness({ fetch: async input => {
    if (input === HOME) return shell();
    if (input === ASSETS[0]) return new FakeResponse('{}', { headers: { 'Content-Type': 'text/html' } });
    if (input === ASSETS[1]) return new FakeResponse('bad', { status: 404, headers: { 'Content-Type': 'image/png' } });
    if (input === ASSETS[2]) return new FakeResponse('login', { redirected: true, headers: { 'Content-Type': 'image/png' } });
    return assetResponse(input);
  } });
  await h.get('prepareShell')();
  assert.equal(h.entries.get(CACHE).size, 1 + ASSETS.length - 3);
  assert.ok(h.cached(new URL(ASSETS[3], HOME).href));
  assert.match(h.cached(new URL(METHOD_PATH, HOME).href).body, /pococha-help/);
});

test('26 rejected shell stops preparation before asset requests', async () => {
  const h = harness({ fetch: async () => shell('', { status: 401 }) });
  await assert.rejects(h.get('prepareShell')(), /App shell unavailable/);
  assert.equal(h.calls.length, 1);
  assert.equal(h.cached(), undefined);
  assert.equal(h.timers.size, 0);
});

test('27 preparation aborts a hung network at twelve seconds', async () => {
  const h = harness({ fetch: (input, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('AbortError')), { once: true });
  }) });
  const preparing = h.get('prepareShell')();
  preparing.catch(() => {});
  await flush();
  await h.advance(11999);
  assert.equal(h.calls[0].init.signal.aborted, false);
  await h.advance(1);
  await assert.rejects(preparing, /AbortError/);
  assert.equal(h.calls[0].init.signal.aborted, true);
  assert.equal(h.timers.size, 0);
});

test('28 install skips waiting only after the shell has been saved', async () => {
  const gate = deferred(), h = harness({ fetch: async input => input === HOME ? gate.promise : assetResponse(input) });
  const event = h.dispatch('install');
  await flush();
  assert.equal(h.skipped, 0);
  gate.resolve(shell());
  await lifetime(event);
  assert.equal(h.skipped, 1);
  assert.ok(h.cached());
});

test('29 a failed install rejects its lifetime and does not skip waiting', async () => {
  const h = harness({ fetch: async () => { throw new Error('offline install'); } });
  const event = h.dispatch('install');
  await assert.rejects(lifetime(event), /offline install/);
  assert.equal(h.skipped, 0);
  assert.equal(h.cached(), undefined);
});

test('30 activation cleans only obsolete calculator cache namespaces', async () => {
  const h = harness({ seed: {
    [CACHE]: { [HOME]: shell() }, 'pococha-meter-shell-v0': { [HOME]: shell('old') },
    'other-app-v1': {}, 'pococha-meter-records-v1': {},
  } });
  await lifetime(h.dispatch('activate'));
  assert.deepEqual([...h.entries.keys()].sort(), [CACHE, 'other-app-v1', 'pococha-meter-records-v1'].sort());
  assert.equal(h.claimed, 1);
});

test('31 unprepared activation preserves old shells and claims clients', async () => {
  const h = harness({ seed: { 'pococha-meter-shell-v0': { [HOME]: shell('old') } } });
  await lifetime(h.dispatch('activate'));
  assert.ok(h.entries.has('pococha-meter-shell-v0'));
  assert.equal(h.claimed, 1);
});

test('32 corrupt current cache cannot trigger deletion of an old shell', async () => {
  const h = harness({ seed: { [CACHE]: { [HOME]: shell('', { redirected: true }) },
    'pococha-meter-shell-v0': { [HOME]: shell('old') } } });
  await lifetime(h.dispatch('activate'));
  assert.equal(h.cached(), undefined);
  assert.ok(h.entries.has('pococha-meter-shell-v0'));
  assert.equal(h.claimed, 1);
});

test('33 status messages return readiness, request id and cache version', async () => {
  const h = seeded(), source = client();
  await lifetime(h.dispatch('message', { source, data: { type: 'POCOCHA_OFFLINE_STATUS', id: 7 } }));
  assert.equal(source.replies.length, 1);
  assert.equal(source.replies[0].type, 'POCOCHA_OFFLINE_STATUS');
  assert.equal(source.replies[0].id, 7);
  assert.equal(source.replies[0].ready, true);
  assert.equal(source.replies[0].failed, false);
  assert.equal(source.replies[0].version, CACHE);
  assert.equal(h.calls.length, 0);
});

test('34 status reports a device with no prepared shell as not ready', async () => {
  const h = harness(), source = client();
  await lifetime(h.dispatch('message', { source, data: { type: 'POCOCHA_OFFLINE_STATUS', id: 0 } }));
  assert.equal(source.replies[0].ready, false);
  assert.equal(source.replies[0].failed, false);
});

test('35 prepare message saves the app and replies when ready', async () => {
  const h = harness(), source = client(`${ORIGIN}/any-client`);
  await lifetime(h.dispatch('message', { source, data: { type: 'POCOCHA_OFFLINE_PREPARE', id: 11 } }));
  assert.equal(h.calls.length, 1 + ASSETS.length);
  assert.equal(source.replies[0].ready, true);
  assert.equal(source.replies[0].failed, false);
  assert.equal(source.replies[0].id, 11);
});

test('36 failed preparation reports failure while retaining existing readiness', async () => {
  const h = seeded({ fetch: async () => { throw new Error('offline'); } }), source = client();
  await lifetime(h.dispatch('message', { source, data: { type: 'POCOCHA_OFFLINE_PREPARE', id: 12 } }));
  assert.equal(source.replies[0].ready, true);
  assert.equal(source.replies[0].failed, true);
  assert.match(h.cached().body, /saved/);
});

test('37 messages from another origin are ignored even with a valid id', async () => {
  const h = seeded(), source = client('https://other.example/');
  const event = h.dispatch('message', { source, data: { type: 'POCOCHA_OFFLINE_PREPARE', id: 1 } });
  await lifetime(event);
  assert.equal(event.waited.length, 0);
  assert.equal(h.calls.length, 0);
  assert.equal(source.replies.length, 0);
});

test('38 missing and malformed message source URLs are ignored safely', async () => {
  const h = harness(), data = { type: 'POCOCHA_OFFLINE_STATUS', id: 1 };
  assert.doesNotThrow(() => h.dispatch('message', { data }));
  assert.doesNotThrow(() => h.dispatch('message', { data, source: client('') }));
  const source = client('not a valid URL');
  let event;
  assert.doesNotThrow(() => { event = h.dispatch('message', { data, source }); });
  await lifetime(event);
  assert.equal(event.waited.length, 0);
  assert.equal(source.replies.length, 0);
});

test('39 unsupported types and invalid message ids cannot prepare the shell', async () => {
  const h = harness(), source = client();
  for (const data of [null, {}, { type: 'DELETE_CACHE', id: 1 },
    { type: 'POCOCHA_OFFLINE_PREPARE', id: '1' }, { type: 'POCOCHA_OFFLINE_PREPARE', id: 1.5 },
    { type: 'POCOCHA_OFFLINE_PREPARE', id: Number.MAX_SAFE_INTEGER + 1 }]) {
    const event = h.dispatch('message', { data, source });
    assert.equal(event.waited.length, 0);
  }
  assert.equal(h.calls.length, 0);
  assert.equal(source.replies.length, 0);
});

test('40 fresh root navigation returns the network shell and updates offline storage', async () => {
  const h = seeded({ fetch: async () => shell('fresh') }), req = request();
  const event = h.dispatch('fetch', { request: req });
  const response = await event.response;
  assert.match(await response.text(), /fresh/);
  await lifetime(event);
  assert.match(h.cached().body, /fresh/);
  assert.equal(h.calls[0].input, req);
  assert.equal(h.timers.size, 0);
});

test('41 authentication and permission responses are returned without cached substitution', async () => {
  for (const status of [401, 403]) {
    const h = seeded({ fetch: async () => new FakeResponse('sign in', { status }) });
    const event = h.dispatch('fetch', { request: request() });
    assert.equal((await event.response).status, status);
    await lifetime(event);
    assert.match(h.cached().body, /saved/);
  }
});

test('42 redirected login HTML is returned and cannot overwrite the offline shell', async () => {
  const h = seeded({ fetch: async () => shell('login', { url: `${ORIGIN}/login`, redirected: true }) });
  const event = h.dispatch('fetch', { request: request() });
  const response = await event.response;
  assert.equal(response.redirected, true);
  assert.match(await response.text(), /login/);
  await lifetime(event);
  assert.match(h.cached().body, /saved/);
});

test('43 server errors fall back to a validated saved shell', async () => {
  const h = seeded({ fetch: async () => new FakeResponse('server down', { status: 503 }) });
  const event = h.dispatch('fetch', { request: request() });
  const response = await event.response;
  assert.equal(response.status, 200);
  assert.match(await response.text(), /saved/);
  await lifetime(event);
});

test('44 a rejected navigation fetch uses the saved shell', async () => {
  const h = seeded({ fetch: async () => { throw new Error('network offline'); } });
  const event = h.dispatch('fetch', { request: request() });
  assert.match(await (await event.response).text(), /saved/);
  await lifetime(event);
  assert.equal(h.timers.size, 0);
});

test('45 offline without a usable shell returns a Japanese no-store 503 page', async () => {
  const h = harness({ fetch: async () => { throw new Error('offline'); } });
  const event = h.dispatch('fetch', { request: request() });
  const response = await event.response;
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-type'), /^text\/html/);
  const body = await response.text();
  assert.match(body, /接続が必要です/);
  assert.match(body, /オフライン準備が完了していません/);
  assert.match(body, /href="\/"/);
  await lifetime(event);
});

test('46 slow navigation serves saved shell at three seconds and later refreshes it', async () => {
  const gate = deferred(), h = seeded({ fetch: () => gate.promise });
  const event = h.dispatch('fetch', { request: request() });
  let settled = false;
  event.response.then(() => { settled = true; });
  await flush();
  await h.advance(2999);
  assert.equal(settled, false);
  await h.advance(1);
  assert.match(await (await event.response).text(), /saved/);
  assert.equal(event.waited.length, 1);
  gate.resolve(shell('late fresh'));
  await lifetime(event);
  assert.match(h.cached().body, /late fresh/);
  assert.equal(h.timers.size, 0);
});

test('47 slow navigation without saved data keeps waiting for the real page', async () => {
  const gate = deferred(), h = harness({ fetch: () => gate.promise });
  const event = h.dispatch('fetch', { request: request() });
  let settled = false;
  event.response.then(() => { settled = true; });
  await flush();
  await h.advance(3000);
  assert.equal(settled, false);
  gate.resolve(shell('late network'));
  assert.match(await (await event.response).text(), /late network/);
  await lifetime(event);
  assert.equal(h.timers.size, 0);
});

test('48 navigation remains usable when refreshing the cache hits a quota error', async () => {
  const h = seeded({ putError: new Error('quota'), fetch: async () => shell('network usable') });
  const event = h.dispatch('fetch', { request: request() });
  assert.match(await (await event.response).text(), /network usable/);
  await lifetime(event);
  assert.match(h.cached().body, /saved/);
});

test('49 asset requests use network then cached fallback or a network-error response', async () => {
  const key = new URL(ASSETS[1], HOME).href;
  const h = harness({ seed: { [CACHE]: { [key]: assetResponse(ASSETS[1]) } } });
  const online = h.dispatch('fetch', { request: request(ASSETS[1], { mode: 'no-cors' }) });
  assert.equal((await online.response).status, 200);
  assert.equal(h.calls.length, 1);
  assert.equal(h.operations.length, 0);
  h.setFetch(async () => { throw new Error('offline'); });
  const saved = h.dispatch('fetch', { request: request(ASSETS[1], { mode: 'no-cors' }) });
  assert.equal(await (await saved.response).text(), ASSETS[1]);
  const missing = h.dispatch('fetch', { request: request(ASSETS[2], { mode: 'no-cors' }) });
  const response = await missing.response;
  assert.equal(response.status, 0);
  assert.equal(response.type, 'error');
});

test('50 fetch handler bypasses query, API, external and non-GET asset requests', () => {
  const h = harness();
  for (const req of [request(`${ASSETS[0]}?token=private`), request('/api/records'), request('/?token=private'),
    request(`https://other.example${ASSETS[1]}`), request(ASSETS[2], { method: 'POST' }), request('/unlisted.png')]) {
    const event = h.dispatch('fetch', { request: req });
    assert.equal(event.response, undefined, req.url);
    assert.equal(event.waited.length, 0);
  }
  assert.equal(h.calls.length, 0);
});

test('Pages launches bypass the hosting and browser caches, retaining the latest offline copy', async () => {
  const out = await mkdtemp(join(tmpdir(), 'meter-launch-'));
  try {
    await buildPages({out});
    const source = await readFile(join(out, 'meter-sw.js'), 'utf8');
    const scope = new URL('/poco-meter/', HOME).href;
    let revision = 0;
    const h = harness({ source, scope, fetch: async url => {
      assert.ok(new URL(url).searchParams.get('_meter_launch'));
      return shell('revision ' + (++revision), { url, headers: {
        'Content-Type': 'text/html', 'Cache-Control': 'max-age=600',
      } });
    } });
    for (const [path, expected] of [['/poco-meter/', 1], ['/poco-meter/index.html', 2]]) {
      const launch = h.dispatch('fetch', { request: request(path) });
      const response = await launch.response;
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(await response.text(), shell('revision ' + expected).body);
      await lifetime(launch);
    }
    assert.notEqual(h.calls[0].input, h.calls[1].input);
    h.setFetch(async () => { throw new Error('offline'); });
    const response = await h.dispatch('fetch', { request: request('/poco-meter/') }).response;
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(await response.text(), /revision 2/);
  } finally {
    await rm(out, {recursive: true, force: true});
  }
});
