import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// These cases execute the worker itself; only browser IO and time are doubled.
const workerSource = await readFile(new URL('../calculator/sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://meter.example';
const HOME = `${ORIGIN}/`;
// Read release metadata so the same lifecycle checks exercise every new cache
// version and the public help page shipped with the calculator.
const workerConstants = vm.runInNewContext(workerSource.slice(0, workerSource.indexOf('function expectedAssetType'))
  + '\n({cache:CACHE_NAME,methodPath:METHOD_PATH,methodMarker:METHOD_MARKER,historyPath:HISTORY_PATH,historyMarker:HISTORY_MARKER})', { self: { location: { origin: ORIGIN } }, URL });
const CACHE = workerConstants.cache, METHOD_PATH = workerConstants.methodPath, METHOD_MARKER = workerConstants.methodMarker;
const HISTORY_PATH = workerConstants.historyPath, HISTORY_MARKER = workerConstants.historyMarker;
const OLD = 'pococha-meter-shell-v1';
const MARKER = '<meta name="pococha-app" content="meter-offline-v1">';
const ASSETS = ['/meter.webmanifest', '/meter-icon-192.png', '/meter-icon-512.png', '/meter-icon-180.png', METHOD_PATH, HISTORY_PATH];
const EPOCH = Date.parse('2026-10-03T12:00:00.000Z');
const STAMP = '2026-09-30T09:15:00.000Z';

class FakeResponse {
  constructor(body = '', options = {}) {
    this.body = String(body);
    this.status = options.status ?? 200;
    this.type = options.type ?? 'default';
    this.url = options.url ?? '';
    this.redirected = options.redirected ?? false;
    this.headers = new Headers(options.headers);
    this.bodyUsed = false;
    this.readHook = options.readHook;
  }
  clone() {
    if (this.bodyUsed) throw new TypeError('Body has already been read');
    return new FakeResponse(this.body, { status: this.status, type: this.type,
      url: this.url, redirected: this.redirected, headers: this.headers, readHook: this.readHook });
  }
  async text() {
    if (this.bodyUsed) throw new TypeError('Body has already been read');
    this.bodyUsed = true;
    if (this.readHook) await this.readHook();
    return this.body;
  }
  static error() { return new FakeResponse('', { status: 0, type: 'error' }); }
}
function shell(label = 'fresh', options = {}) {
  return new FakeResponse(`<!doctype html>${MARKER}<main>${label}</main>`, {
    url: HOME, type: 'basic', headers: { 'Content-Type': 'text/html; charset=utf-8' }, ...options });
}
function saved(label = 'saved', stamp = STAMP) {
  return shell(label, { headers: { 'Content-Type': 'text/html', 'X-Pococha-Saved-At': stamp } });
}
function asset(path, label = path, options = {}) {
  const html = path === METHOD_PATH ? METHOD_MARKER : path === HISTORY_PATH ? HISTORY_MARKER : '';
  return new FakeResponse(html ? `<!doctype html>${html}<main>${label}</main>` : label,
    { url: new URL(path, HOME).href, type: 'basic',
      headers: { 'Content-Type': html ? 'text/html; charset=utf-8' : path.endsWith('.png') ? 'image/png' : 'application/manifest+json' }, ...options });
}
function request(path = '/', options = {}) {
  return { url: new URL(path, HOME).href, method: 'GET', mode: 'navigate', ...options };
}
function assetRequest(path = ASSETS[1]) { return request(path, { mode: 'no-cors' }); }
function key(path) { return new URL(path, HOME).href; }
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 32; i += 1) await Promise.resolve(); }
function client() { return { url: HOME, replies: [], postMessage(message) { this.replies.push(message); } }; }
async function lifetime(event) { await Promise.all(event.waited); }
function status(h, source, id = 1, type = 'POCOCHA_OFFLINE_STATUS') {
  return h.dispatch('message', { source, data: { type, id } });
}
function networkError() { throw new Error('offline network'); }

function harness(options = {}) {
  const entries = new Map(), operations = [], calls = [], handlers = new Map(), timers = new Map();
  let now = 0, timerId = 0, skipped = 0, claimed = 0;
  let fetcher = options.fetch ?? (async input => {
    const url = typeof input === 'string' ? input : input.url;
    return url === HOME ? shell('network') : asset(new URL(url, HOME).pathname);
  });
  function bucket(name) {
    if (!entries.has(name)) entries.set(name, new Map());
    return entries.get(name);
  }
  for (const [name, values] of Object.entries(options.seed ?? {})) {
    const map = bucket(name);
    for (const [url, value] of Object.entries(values)) map.set(url, value.clone());
  }
  async function io(operation, name, url, value) {
    operations.push([operation, name, url]);
    await options.io?.(operation, name, url, value);
  }
  const caches = {
    async open(name) {
      await io('open', name);
      const map = bucket(name);
      return {
        async put(url, value) { await io('put', name, url, value); map.set(url, value.clone()); },
        async match(url) { await io('match', name, url); return map.get(url)?.clone(); },
        async delete(url) { await io('remove', name, url); return map.delete(url); },
      };
    },
    async keys() { await io('keys'); return [...entries.keys()]; },
    async delete(name) { await io('delete', name); return entries.delete(name); },
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener(type, listener) { handlers.set(type, listener); },
    async skipWaiting() { skipped += 1; },
    clients: { async claim() { claimed += 1; } },
  };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [EPOCH + now])); }
    static now() { return EPOCH + now; }
  }
  const context = vm.createContext({ self, caches, URL, Headers, Date: ClockDate,
    Response: FakeResponse, AbortController,
    fetch(input, init) { calls.push({ input, init }); return Promise.resolve().then(() => fetcher(input, init)); },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(workerSource, context, { filename: 'calculator/sw.js' });
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
    cached(url = HOME, name = CACHE) { return entries.get(name)?.get(url); },
  };
}
function seeded(extra = {}) { return harness({ seed: { [CACHE]: { [HOME]: saved() } }, ...extra }); }
function assertError(response) { assert.equal(response.type, 'error'); assert.equal(response.status, 0); }

test('v2 01 new shell writes remain isolated from the installed v1 release', async () => {
  const h = harness({ seed: { [OLD]: { [HOME]: saved('v1 retained') } } });
  await h.get('cacheShell')(shell('v2 new'));
  assert.match(h.cached().body, /v2 new/);
  assert.match(h.cached(HOME, OLD).body, /v1 retained/);
  assert.ok(h.operations.filter(op => op[0] === 'put').every(op => op[1] === CACHE));
});

test('v2 02 a v2 offline navigation cannot reuse a shell from v1', async () => {
  const h = harness({ seed: { [OLD]: { [HOME]: saved('v1') } }, fetch: networkError });
  const event = h.dispatch('fetch', { request: request() });
  assert.equal((await event.response).status, 503);
  await lifetime(event);
  assert.match(h.cached(HOME, OLD).body, /v1/);
});

test('v2 03 old release alone reports the new namespace as unprepared', async () => {
  const h = harness({ seed: { [OLD]: { [HOME]: saved('v1') } } }), source = client();
  await lifetime(status(h, source));
  assert.equal(source.replies[0].version, CACHE);
  assert.equal(source.replies[0].ready, false);
  assert.equal(source.replies[0].preparedAt, '');
});

test('v2 04 prepared v2 activation removes prior shells while preserving unrelated data', async () => {
  const h = harness({ seed: { [CACHE]: { [HOME]: saved() }, [OLD]: { [HOME]: saved('v1') },
    'pococha-meter-shell-v0': {}, 'pococha-meter-records-v1': {}, 'other-app-shell-v1': {} } });
  await lifetime(h.dispatch('activate'));
  assert.deepEqual([...h.entries.keys()].sort(), [CACHE, 'pococha-meter-records-v1', 'other-app-shell-v1'].sort());
  assert.equal(h.claimed, 1);
});

test('v2 05 a failed new install retains the previous release and does not activate', async () => {
  const h = harness({ seed: { [OLD]: { [HOME]: saved('working v1') } }, fetch: networkError });
  await assert.rejects(lifetime(h.dispatch('install')), /offline network/);
  assert.equal(h.skipped, 0);
  assert.match(h.cached(HOME, OLD).body, /working v1/);
  assert.equal(h.cached(), undefined);
});

test('v2 06 a quota failure preparing v2 cannot overwrite the v1 release', async () => {
  const h = harness({ seed: { [OLD]: { [HOME]: saved('working v1') } },
    io(op) { if (op === 'put') throw new Error('v2 quota'); } });
  await assert.rejects(h.get('prepareShell')(), /v2 quota/);
  assert.match(h.cached(HOME, OLD).body, /working v1/);
  assert.equal(h.cached(), undefined);
  assert.equal(h.timers.size, 0);
});

test('v2 07 a corrupt new release preserves v1 during activation', async () => {
  const h = harness({ seed: { [CACHE]: { [HOME]: shell('invalid v2', { status: 500 }) },
    [OLD]: { [HOME]: saved('usable v1') } } });
  await lifetime(h.dispatch('activate'));
  assert.equal(h.cached(), undefined);
  assert.match(h.cached(HOME, OLD).body, /usable v1/);
  assert.equal(h.claimed, 1);
});

test('v2 08 failed cache enumeration leaves both releases recoverable', async () => {
  const h = harness({ seed: { [CACHE]: { [HOME]: saved('v2') }, [OLD]: { [HOME]: saved('v1') } },
    io(op) { if (op === 'keys') throw new Error('enumeration unavailable'); } });
  await assert.rejects(lifetime(h.dispatch('activate')), /enumeration unavailable/);
  assert.match(h.cached().body, /v2/);
  assert.match(h.cached(HOME, OLD).body, /v1/);
  assert.equal(h.operations.filter(op => op[0] === 'delete').length, 0);
});

test('v2 09 failure deleting an old namespace leaves the new shell usable', async () => {
  const h = harness({ seed: { [CACHE]: { [HOME]: saved('v2 ready') }, [OLD]: { [HOME]: saved('v1') } },
    io(op, name) { if (op === 'delete' && name === OLD) throw new Error('cleanup failed'); } });
  await assert.rejects(lifetime(h.dispatch('activate')), /cleanup failed/);
  assert.match((await h.get('savedShell')()).body, /v2 ready/);
  assert.ok(h.entries.has(OLD));
});

test('v2 10 asset fallback does not mix icons from an older release', async () => {
  const h = harness({ seed: { [OLD]: { [key(ASSETS[1])]: asset(ASSETS[1], 'v1 icon') } }, fetch: networkError });
  const event = h.dispatch('fetch', { request: assetRequest() });
  assertError(await event.response);
  assert.equal(h.cached(key(ASSETS[1]), OLD).body, 'v1 icon');
});

test('v2 11 stalled cache opening does not delay an arrived root response', async () => {
  const gate = deferred(), h = harness({ io(op) { if (op === 'open') return gate.promise; } });
  const event = h.dispatch('fetch', { request: request() });
  let response;
  event.response.then(value => { response = value; });
  await flush();
  assert.match(response?.body ?? '', /network/);
  assert.equal(h.cached(), undefined);
  gate.resolve();
  await lifetime(event);
  assert.match(h.cached().body, /network/);
});

test('v2 12 stalled cache writing does not delay an arrived root response', async () => {
  const gate = deferred(), h = seeded({ io(op) { if (op === 'put') return gate.promise; } });
  const event = h.dispatch('fetch', { request: request() });
  let response;
  event.response.then(value => { response = value; });
  await flush();
  assert.match(response?.body ?? '', /network/);
  assert.match(h.cached().body, /saved/);
  gate.resolve();
  await lifetime(event);
  assert.match(h.cached().body, /network/);
});

test('v2 13 background shell validation does not delay a fresh navigation', async () => {
  const gate = deferred(), fresh = shell('slow body validation', { readHook: () => gate.promise });
  const h = harness({ fetch: async () => fresh });
  const event = h.dispatch('fetch', { request: request() });
  let response;
  event.response.then(value => { response = value; });
  await flush();
  assert.equal(response, fresh);
  assert.equal(h.cached(), undefined);
  assert.equal(fresh.bodyUsed, false);
  gate.resolve();
  await lifetime(event);
  assert.match(h.cached().body, /slow body validation/);
});

test('v2 14 a fresh root bypasses potentially stalled reads of existing storage', async () => {
  const gate = deferred(), h = seeded({ io(op) { if (op === 'match') return gate.promise; } });
  const event = h.dispatch('fetch', { request: request() });
  assert.match((await event.response).body, /network/);
  await lifetime(event);
  assert.equal(h.operations.filter(op => op[0] === 'match').length, 0);
  gate.resolve();
});

test('v2 15 navigation lifetime remains pending until its independent write completes', async () => {
  const gate = deferred(), h = harness({ io(op) { if (op === 'put') return gate.promise; } });
  const event = h.dispatch('fetch', { request: request() });
  await event.response;
  let completed = false;
  lifetime(event).then(() => { completed = true; });
  await flush();
  assert.equal(completed, false);
  assert.equal(event.waited.length, 1);
  gate.resolve();
  await lifetime(event);
  assert.equal(completed, true);
});

test('v2 16 a rejected background write permits a later navigation to refresh storage', async () => {
  let fail = true;
  const h = seeded({ io(op) { if (op === 'put' && fail) throw new Error('temporary quota'); } });
  const first = h.dispatch('fetch', { request: request() });
  assert.equal((await first.response).status, 200);
  await lifetime(first);
  assert.match(h.cached().body, /saved/);
  fail = false;
  h.setFetch(async () => shell('recovered'));
  const second = h.dispatch('fetch', { request: request() });
  await second.response;
  await lifetime(second);
  assert.match(h.cached().body, /recovered/);
});

test('v2 17 a second shell put cannot overtake a blocked first put', async () => {
  const gate = deferred();
  let puts = 0;
  const h = harness({ io(op) { if (op === 'put' && ++puts === 1) return gate.promise; } });
  const first = h.get('cacheShell')(shell('first'));
  await flush();
  const second = h.get('cacheShell')(shell('second'));
  await flush();
  assert.equal(puts, 1);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(puts, 2);
  assert.match(h.cached().body, /second/);
});

test('v2 18 an older navigation arriving last cannot replace a completed newer shell', async () => {
  const old = deferred(), recent = deferred();
  let count = 0;
  const h = harness({ fetch: () => ++count === 1 ? old.promise : recent.promise });
  const first = h.dispatch('fetch', { request: request() });
  const second = h.dispatch('fetch', { request: request() });
  await flush();
  recent.resolve(shell('new generation'));
  await second.response; await lifetime(second);
  old.resolve(shell('old generation'));
  assert.match((await first.response).body, /old generation/);
  await lifetime(first);
  assert.match(h.cached().body, /new generation/);
  assert.equal(h.operations.filter(op => op[0] === 'put').length, 1);
});

test('v2 19 out of order completion of three roots preserves the newest successful generation', async () => {
  const gates = [deferred(), deferred(), deferred()];
  let count = 0;
  const h = harness({ fetch: () => gates[count++].promise });
  const events = gates.map(() => h.dispatch('fetch', { request: request() }));
  await flush();
  gates[1].resolve(shell('middle')); await events[1].response; await lifetime(events[1]);
  gates[2].resolve(shell('latest')); await events[2].response; await lifetime(events[2]);
  gates[0].resolve(shell('oldest')); await events[0].response; await lifetime(events[0]);
  assert.match(h.cached().body, /latest/);
  assert.equal(h.operations.filter(op => op[0] === 'put').length, 2);
});

test('v2 20 a failed newer write does not prohibit an older successful response', async () => {
  const old = deferred(), newer = deferred();
  let count = 0;
  const h = seeded({ fetch: () => ++count === 1 ? old.promise : newer.promise,
    io(op, name, url, response) { if (op === 'put' && response.body.includes('newer rejected')) throw new Error('quota'); } });
  const first = h.dispatch('fetch', { request: request() });
  const second = h.dispatch('fetch', { request: request() });
  await flush();
  newer.resolve(shell('newer rejected')); await second.response; await lifetime(second);
  old.resolve(shell('older successful')); await first.response; await lifetime(first);
  assert.match(h.cached().body, /older successful/);
});

test('v2 21 slow validation of an earlier write cannot overwrite a later saved shell', async () => {
  const gate = deferred(), h = harness();
  const first = h.get('cacheShell')(shell('slow first', { readHook: () => gate.promise }));
  await flush();
  await h.get('cacheShell')(shell('quick second'));
  gate.resolve();
  await first;
  assert.match(h.cached().body, /quick second/);
  assert.equal(h.operations.filter(op => op[0] === 'put').length, 1);
});

test('v2 22 preparation reserves generation before fetching and cannot replace a newer root', async () => {
  const gate = deferred();
  const h = harness({ fetch: input => input === HOME ? gate.promise : typeof input === 'string' ? asset(input) : shell('new navigation') });
  const preparing = h.get('prepareShell')();
  await flush();
  const navigation = h.dispatch('fetch', { request: request() });
  await navigation.response; await lifetime(navigation);
  gate.resolve(shell('old preparation'));
  await preparing;
  assert.match(h.cached().body, /new navigation/);
  assert.equal(h.entries.get(CACHE).size, 1 + ASSETS.length);
});

test('v2 23 preparation started after a root keeps its newer shell when the root arrives late', async () => {
  const gate = deferred();
  const h = harness({ fetch: input => typeof input !== 'string' ? gate.promise : input === HOME ? shell('new preparation') : asset(input) });
  const navigation = h.dispatch('fetch', { request: request() });
  await flush();
  await h.get('prepareShell')();
  gate.resolve(shell('old navigation'));
  await navigation.response; await lifetime(navigation);
  assert.match(h.cached().body, /new preparation/);
});

test('v2 24 saved timestamp reflects the eventual serialized write rather than fetch start', async () => {
  const gate = deferred();
  let opened = 0;
  const h = harness({ io(op) { if (op === 'open' && ++opened === 1) return gate.promise; } });
  const first = h.get('cacheShell')(shell('first'));
  const second = h.get('cacheShell')(shell('second'));
  await flush();
  await h.advance(4200);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(h.cached().headers.get('x-pococha-saved-at'), new Date(EPOCH + 4200).toISOString());
});

test('v2 25 saved responses retain content headers while leaving source headers and body intact', async () => {
  const h = harness(), source = shell('preserved', { headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-App-Revision': '17' } });
  source.headers.set('content-encoding', 'gzip');
  source.headers.set('content-length', '123');
  await h.get('cacheShell')(source);
  assert.equal(source.headers.get('x-pococha-saved-at'), null);
  assert.equal(source.bodyUsed, false);
  assert.equal(h.cached().headers.get('x-app-revision'), '17');
  assert.equal(h.cached().headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(h.cached().headers.get('content-encoding'), null);
  assert.equal(h.cached().headers.get('content-length'), null);
  assert.equal(source.headers.get('content-encoding'), 'gzip');
  assert.equal(h.cached().headers.get('x-pococha-saved-at'), new Date(EPOCH).toISOString());
  assert.match(await h.cached().clone().text(), /preserved/);
});

test('v2 26 status reports the persisted timestamp rather than status request time', async () => {
  const h = seeded(), source = client();
  await h.advance(90000);
  await lifetime(status(h, source, 26));
  assert.equal(source.replies[0].preparedAt, STAMP);
  assert.equal(source.replies[0].id, 26);
  assert.equal(source.replies[0].version, CACHE);
  assert.equal(h.calls.length, 0);
});

test('v2 27 a readable legacy-format current shell has ready status and empty timestamp', async () => {
  const h = harness({ seed: { [CACHE]: { [HOME]: shell('no stamp') } } }), source = client();
  await lifetime(status(h, source));
  assert.equal(source.replies[0].ready, true);
  assert.equal(source.replies[0].preparedAt, '');
  assert.equal(source.replies[0].failed, false);
});

test('v2 28 failed preparation reports the existing timestamp without manufacturing a new one', async () => {
  const h = seeded({ fetch: networkError }), source = client();
  await h.advance(6000);
  await lifetime(status(h, source, 28, 'POCOCHA_OFFLINE_PREPARE'));
  assert.equal(source.replies[0].failed, true);
  assert.equal(source.replies[0].ready, true);
  assert.equal(source.replies[0].preparedAt, STAMP);
  assert.equal(h.cached().headers.get('x-pococha-saved-at'), STAMP);
});

test('v2 29 simultaneous preparation callers share one in flight promise', async () => {
  const gate = deferred(), h = harness({ fetch: input => input === HOME ? gate.promise : asset(input) });
  const first = h.get('prepareShell')(), second = h.get('prepareShell')();
  assert.equal(first, second);
  await flush();
  assert.equal(h.calls.length, 1);
  gate.resolve(shell('prepared once'));
  await Promise.all([first, second]);
  assert.equal(h.timers.size, 0);
});

test('v2 30 preparation coalescing lasts through the optional asset phase', async () => {
  const iconGate = deferred();
  const h = harness({ fetch: input => input === HOME ? shell() : input === ASSETS[1] ? iconGate.promise : asset(input) });
  const first = h.get('prepareShell')();
  await flush();
  assert.ok(h.cached());
  const second = h.get('prepareShell')();
  assert.equal(first, second);
  assert.equal(h.calls.length, 1 + ASSETS.length);
  iconGate.resolve(asset(ASSETS[1]));
  await second;
  assert.equal(h.calls.length, 1 + ASSETS.length);
});

test('v2 31 concurrent prepare messages share IO but reply with each original request id', async () => {
  const gate = deferred(), h = harness({ fetch: input => input === HOME ? gate.promise : asset(input) });
  const a = client(), b = client();
  const first = status(h, a, 101, 'POCOCHA_OFFLINE_PREPARE');
  const second = status(h, b, 202, 'POCOCHA_OFFLINE_PREPARE');
  await flush();
  assert.equal(h.calls.length, 1);
  assert.equal(a.replies.length + b.replies.length, 0);
  gate.resolve(shell('shared'));
  await Promise.all([lifetime(first), lifetime(second)]);
  assert.equal(h.calls.length, 1 + ASSETS.length);
  assert.equal(a.replies[0].id, 101); assert.equal(b.replies[0].id, 202);
  assert.equal(a.replies[0].ready, true); assert.equal(b.replies[0].ready, true);
  assert.equal(a.replies[0].preparedAt, b.replies[0].preparedAt);
});

test('v2 32 install and an overlapping prepare message share preparation before skipping waiting', async () => {
  const gate = deferred(), h = harness({ fetch: input => input === HOME ? gate.promise : asset(input) }), source = client();
  const install = h.dispatch('install');
  const message = status(h, source, 32, 'POCOCHA_OFFLINE_PREPARE');
  await flush();
  assert.equal(h.calls.length, 1); assert.equal(h.skipped, 0);
  gate.resolve(shell('shared install'));
  await Promise.all([lifetime(install), lifetime(message)]);
  assert.equal(h.calls.length, 1 + ASSETS.length); assert.equal(h.skipped, 1);
  assert.equal(source.replies[0].ready, true);
});

test('v2 33 rejected preparation clears the coalescing slot and permits a network retry', async () => {
  const h = harness({ fetch: networkError });
  const first = h.get('prepareShell')();
  await assert.rejects(first, /offline network/);
  h.setFetch(async input => input === HOME ? shell('retry') : asset(input));
  const second = h.get('prepareShell')();
  assert.notEqual(first, second);
  await second;
  assert.match(h.cached().body, /retry/);
  assert.equal(h.calls.filter(call => call.input === HOME).length, 2);
});

test('v2 34 completed preparation can refresh again with a new timestamp', async () => {
  const h = harness();
  const first = h.get('prepareShell')(); await first;
  const firstStamp = h.cached().headers.get('x-pococha-saved-at');
  await h.advance(2500);
  h.setFetch(async input => input === HOME ? shell('second refresh') : asset(input));
  const second = h.get('prepareShell')();
  assert.notEqual(first, second);
  await second;
  assert.match(h.cached().body, /second refresh/);
  assert.notEqual(h.cached().headers.get('x-pococha-saved-at'), firstStamp);
  assert.equal(h.calls.length, 2 * (1 + ASSETS.length));
});

test('v2 35 shared invalid shell rejection leaves preparation retryable for both clients', async () => {
  const gate = deferred(), h = harness({ fetch: () => gate.promise });
  const first = h.get('prepareShell')(), second = h.get('prepareShell')();
  const settled = Promise.allSettled([first, second]);
  gate.resolve(shell('not ready', { status: 401 }));
  const results = await settled;
  assert.equal(results[0].status, 'rejected'); assert.equal(results[1].status, 'rejected');
  assert.match(results[0].reason.message, /App shell unavailable/);
  assert.equal(h.calls.length, 1);
  h.setFetch(async input => input === HOME ? shell('retry valid') : asset(input));
  await h.get('prepareShell')();
  assert.match(h.cached().body, /retry valid/);
});

test('v2 36 optional asset storage failure keeps prepared status and timestamp accurate', async () => {
  const h = harness({ io(op, name, url) { if (op === 'put' && url !== HOME) throw new Error('icon quota'); } }), source = client();
  await lifetime(status(h, source, 36, 'POCOCHA_OFFLINE_PREPARE'));
  assert.equal(source.replies[0].ready, true);
  assert.equal(source.replies[0].failed, false);
  assert.equal(source.replies[0].preparedAt, new Date(EPOCH).toISOString());
  assert.equal(h.entries.get(CACHE).size, 1);
});

test('v2 37 hung optional assets share preparation until abort and then permit retry', async () => {
  const h = harness({ fetch: (input, init) => input === HOME ? shell('ready despite assets') : new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('asset abort')), { once: true });
  }) });
  const first = h.get('prepareShell')();
  await flush();
  assert.equal(h.get('prepareShell')(), first);
  await h.advance(11999);
  assert.equal(h.calls[1].init.signal.aborted, false);
  await h.advance(1);
  await first;
  assert.equal(h.calls[1].init.signal.aborted, true);
  assert.ok(h.cached()); assert.equal(h.timers.size, 0);
  h.setFetch(async input => input === HOME ? shell('retry complete') : asset(input));
  await h.get('prepareShell')();
  assert.equal(h.entries.get(CACHE).size, 1 + ASSETS.length);
});

test('v2 38 preparation recovers its write queue after a shared quota rejection', async () => {
  let fail = true;
  const h = seeded({ io(op, name, url) { if (op === 'put' && url === HOME && fail) throw new Error('quota'); } });
  const first = h.get('prepareShell')(), shared = h.get('prepareShell')();
  assert.equal(first, shared);
  const results = await Promise.allSettled([first, shared]);
  assert.ok(results.every(result => result.status === 'rejected'));
  assert.match(h.cached().body, /saved/);
  fail = false;
  await h.get('prepareShell')();
  assert.match(h.cached().body, /network/);
  assert.equal(h.entries.get(CACHE).size, 1 + ASSETS.length);
});

test('v2 39 a hung icon request uses its saved icon exactly at three seconds', async () => {
  const gate = deferred(), h = harness({ seed: { [CACHE]: { [key(ASSETS[1])]: asset(ASSETS[1], 'saved icon') } }, fetch: () => gate.promise });
  const event = h.dispatch('fetch', { request: assetRequest() });
  let settled = false; event.response.then(() => { settled = true; });
  await flush(); await h.advance(2999);
  assert.equal(settled, false);
  await h.advance(1);
  assert.equal((await event.response).body, 'saved icon');
  assert.equal(h.timers.size, 0);
  gate.resolve(asset(ASSETS[1], 'late icon'));
  await flush();
  assert.equal(h.cached(key(ASSETS[1])).body, 'saved icon');
});

test('v2 40 asset server errors use the current valid manifest instead of the error body', async () => {
  const h = harness({ seed: { [CACHE]: { [key(ASSETS[0])]: asset(ASSETS[0], '{"name":"saved manifest"}') } },
    fetch: async () => new FakeResponse('server unavailable', { status: 502 }) });
  const response = await h.dispatch('fetch', { request: assetRequest(ASSETS[0]) }).response;
  assert.equal(response.status, 200);
  assert.match(response.body, /saved manifest/);
  assert.equal(response.headers.get('content-type'), 'application/manifest+json');
});

test('v2 41 an asset server error without saved data remains the real server response', async () => {
  const original = new FakeResponse('maintenance', { status: 503 });
  const h = harness({ fetch: async () => original });
  const response = await h.dispatch('fetch', { request: assetRequest() }).response;
  assert.equal(response, original);
  assert.equal(h.timers.size, 0);
});

test('v2 42 offline icon fallback rejects a saved HTML response', async () => {
  const h = harness({ seed: { [CACHE]: { [key(ASSETS[1])]: new FakeResponse('login', { headers: { 'Content-Type': 'text/html' } }) } }, fetch: networkError });
  assertError(await h.dispatch('fetch', { request: assetRequest() }).response);
});

test('v2 43 offline manifest fallback rejects generic JSON rather than manifest MIME', async () => {
  const h = harness({ seed: { [CACHE]: { [key(ASSETS[0])]: new FakeResponse('{}', { headers: { 'Content-Type': 'application/json' } }) } }, fetch: networkError });
  assertError(await h.dispatch('fetch', { request: assetRequest(ASSETS[0]) }).response);
});

test('v2 44 fallback MIME validation rejects a prefix lookalike rather than serving an invalid icon', async () => {
  const h = harness({ seed: { [CACHE]: { [key(ASSETS[1])]: asset(ASSETS[1], 'invalid mime', { headers: { 'Content-Type': 'image/png-invalid' } }) } }, fetch: networkError });
  assertError(await h.dispatch('fetch', { request: assetRequest() }).response);
});

test('v2 45 disabled cache storage returns a network-error response for an offline asset', async () => {
  const h = harness({ fetch: networkError, io(op) { if (op === 'open') throw new Error('storage disabled'); } });
  assertError(await h.dispatch('fetch', { request: assetRequest() }).response);
  assert.equal(h.timers.size, 0);
});

test('v2 46 failed asset cache reads return a network error without rejecting respondWith', async () => {
  const h = harness({ seed: { [CACHE]: { [key(ASSETS[1])]: asset(ASSETS[1]) } }, fetch: networkError,
    io(op) { if (op === 'match') throw new Error('cache read failure'); } });
  const response = await h.dispatch('fetch', { request: assetRequest() }).response;
  assertError(response);
  assert.equal(h.timers.size, 0);
});

test('v2 47 a timed out asset with no cache keeps waiting for the actual network asset', async () => {
  const gate = deferred(), h = harness({ fetch: () => gate.promise });
  const event = h.dispatch('fetch', { request: assetRequest() });
  let settled = false; event.response.then(() => { settled = true; });
  await flush(); await h.advance(3000);
  assert.equal(settled, false);
  const real = asset(ASSETS[1], 'real late icon'); gate.resolve(real);
  assert.equal(await event.response, real);
  assert.equal(h.timers.size, 0);
});

test('v2 48 late network rejection after timed icon fallback does not invalidate that response', async () => {
  const gate = deferred(), h = harness({ seed: { [CACHE]: { [key(ASSETS[1])]: asset(ASSETS[1], 'retained icon') } }, fetch: () => gate.promise });
  const event = h.dispatch('fetch', { request: assetRequest() });
  await flush(); await h.advance(3000);
  const response = await event.response;
  gate.reject(new Error('late disconnect'));
  await flush();
  assert.equal(await response.text(), 'retained icon');
  assert.equal(h.timers.size, 0);
});

test('v2 49 a fresh asset bypasses blocked storage and clears its fallback timer', async () => {
  const gate = deferred(), h = harness({ io(op) { if (op === 'open') return gate.promise; } });
  const event = h.dispatch('fetch', { request: assetRequest() });
  assert.equal((await event.response).status, 200);
  assert.equal(h.operations.length, 0);
  assert.equal(h.timers.size, 0);
  await h.advance(3000);
  assert.equal(h.operations.length, 0);
  gate.resolve();
});

test('v2 50 simultaneous timed asset fallbacks keep separate timers and cache keys', async () => {
  const iconGate = deferred(), manifestGate = deferred();
  const h = harness({ seed: { [CACHE]: { [key(ASSETS[1])]: asset(ASSETS[1], 'saved icon'),
    [key(ASSETS[0])]: asset(ASSETS[0], 'saved manifest') } },
    fetch: input => new URL(input.url).pathname === ASSETS[1] ? iconGate.promise : manifestGate.promise });
  const iconEvent = h.dispatch('fetch', { request: assetRequest() });
  await flush(); await h.advance(1000);
  const manifestEvent = h.dispatch('fetch', { request: assetRequest(ASSETS[0]) });
  let manifestSettled = false; manifestEvent.response.then(() => { manifestSettled = true; });
  await flush(); await h.advance(2000);
  assert.equal((await iconEvent.response).body, 'saved icon');
  assert.equal(manifestSettled, false);
  assert.equal(h.timers.size, 1);
  await h.advance(1000);
  assert.equal((await manifestEvent.response).body, 'saved manifest');
  assert.equal(h.timers.size, 0);
  iconGate.resolve(asset(ASSETS[1])); manifestGate.resolve(asset(ASSETS[0]));
  await flush();
});
