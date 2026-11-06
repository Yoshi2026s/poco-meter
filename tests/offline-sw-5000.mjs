import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';

// Each named case is a different deterministic browser-IO condition. This
// executes the shipped service worker, never a second implementation of it.
const workerSource = await readFile(new URL('../calculator/sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://meter.example', HOME = `${ORIGIN}/`;
const CACHE = 'pococha-meter-shell-' + workerSource.match(/const CACHE_NAME = CACHE_PREFIX \+ '([^']+)'/)[1];
const OLD = `${CACHE}-previous-release`;
const MARKER = workerSource.match(/const APP_MARKER = '([^']+)'/)[1];
const METHOD_PATH = workerSource.match(/const METHOD_PATH = '([^']+)'/)[1];
const METHOD_MARKER = workerSource.match(/const METHOD_MARKER = '([^']+)'/)[1];
const ASSETS = ['/meter.webmanifest', '/meter-icon-192.png', '/meter-icon-512.png', '/meter-icon-180.png'];
const STAMP = '2026-10-01T00:00:00.000Z', EPOCH = Date.parse('2026-10-03T12:00:00.000Z');

class FakeResponse {
  constructor(body = '', options = {}) {
    this.body = String(body); this.status = options.status ?? 200;
    this.type = options.type ?? 'default'; this.url = options.url ?? '';
    this.redirected = options.redirected ?? false; this.headers = new Headers(options.headers);
    this.bodyUsed = false;
  }
  clone() {
    if (this.bodyUsed) throw new TypeError('Body already read');
    return new FakeResponse(this.body, { status: this.status, type: this.type, url: this.url,
      redirected: this.redirected, headers: this.headers });
  }
  async text() { if (this.bodyUsed) throw new TypeError('Body already read'); this.bodyUsed = true; return this.body; }
  static error() { return new FakeResponse('', { status: 0, type: 'error' }); }
}
function shell(label, options = {}) {
  return new FakeResponse(`<!doctype html>${MARKER}<main>${label}</main>`, {
    url: HOME, type: 'basic', headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Pococha-Saved-At': STAMP }, ...options });
}
function asset(path, label, options = {}) {
  return new FakeResponse(path===METHOD_PATH?METHOD_MARKER+label:label, { url: new URL(path, HOME).href, type: 'basic',
    headers: { 'Content-Type': path===METHOD_PATH?'text/html':path.endsWith('.png') ? 'image/png' : 'application/manifest+json' }, ...options });
}
function request(path = '/', options = {}) { return { url: new URL(path, HOME).href, method: 'GET', mode: 'navigate', ...options }; }
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function flush() { for (let i = 0; i < 32; i++) await Promise.resolve(); }
async function lifetime(event) { await Promise.all(event.waited); }
function harness(options = {}) {
  const entries = new Map(), operations = [], calls = [], handlers = new Map(), timers = new Map();
  let now = 0, timerId = 0, skipped = 0, claimed = 0;
  let fetcher = options.fetch ?? (async input => { const url = typeof input === 'string' ? input : input.url; return url === HOME ? shell('network') : asset(new URL(url, HOME).pathname, 'network asset'); });
  function bucket(name) { if (!entries.has(name)) entries.set(name, new Map()); return entries.get(name); }
  for (const [name, values] of Object.entries(options.seed ?? {})) for (const [url, value] of Object.entries(values)) bucket(name).set(url, value.clone());
  async function io(op, name, url, value) { operations.push([op, name, url]); await options.io?.(op, name, url, value); }
  const caches = {
    async open(name) { await io('open', name); const map = bucket(name); return {
      async put(url, value) { await io('put', name, url, value); map.set(url, value.clone()); },
      async match(url) { await io('match', name, url); return map.get(url)?.clone(); },
      async delete(url) { await io('remove', name, url); return map.delete(url); },
    }; },
    async keys() { await io('keys'); return [...entries.keys()]; },
    async delete(name) { await io('delete', name); return entries.delete(name); },
  };
  const self = { location: { origin: ORIGIN }, addEventListener(type, callback) { handlers.set(type, callback); },
    async skipWaiting() { skipped++; }, clients: { async claim() { claimed++; } } };
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [EPOCH + now])); } static now() { return EPOCH + now; } }
  const context = vm.createContext({ self, caches, URL, Headers, Date: ClockDate, Response: FakeResponse, AbortController,
    fetch(input, init) { calls.push({ input, init }); return Promise.resolve().then(() => fetcher(input, init)); },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(workerSource, context, { filename: 'calculator/sw.js' });
  return {
    entries, operations, calls, timers, get skipped() { return skipped; }, get claimed() { return claimed; },
    get(name) { return vm.runInContext(name, context); },
    setFetch(next) { fetcher = next; },
    cached(url = HOME, name = CACHE) { return entries.get(name)?.get(url); },
    dispatch(type, fields = {}) { const event = { ...fields, waited: [], response: undefined,
      waitUntil(promise) { this.waited.push(Promise.resolve(promise)); Promise.resolve(promise).catch(() => {}); },
      respondWith(promise) { this.response = Promise.resolve(promise); this.response.catch(() => {}); },
    }; handlers.get(type)(event); return event; },
    async advance(ms) { now += ms; for (;;) { const due = [...timers].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; timers.delete(due[0]); due[1].callback(); await flush(); } await flush(); },
  };
}
function failingIo(which) { return op => { if (op === which) throw new Error(`blocked ${which}`); }; }
function seedShell(kind) {
  if (kind === 'none') return {};
  if (kind === 'old') return { [OLD]: { [HOME]: shell('old release') } };
  const response = kind === 'valid' ? shell('saved') : kind === 'marker' ? new FakeResponse('sign-in', { url: HOME, headers: { 'Content-Type': 'text/html' } })
    : kind === 'status' ? shell('saved bad status', { status: 503 }) : kind === 'mime' ? shell('saved bad mime', { headers: { 'Content-Type': 'application/json' } })
    : shell('saved redirect', { redirected: true });
  return { [CACHE]: { [HOME]: response } };
}

const cases = [];
function add(family, condition, run) { cases.push({ family, condition, run }); }

// 4 statuses × 4 response types × 2 redirect flags × 4 MIME values × 4
// response URLs × 2 marker conditions = 1,024 distinct validation inputs.
for (const status of [200, 204, 401, 503]) for (const type of ['default', 'basic', 'cors', 'opaque'])
for (const redirected of [false, true]) for (const mime of ['text/html', 'text/html; charset=utf-8', 'text/plain', 'application/json'])
for (const url of [HOME, '', `${HOME}?auth=1`, 'https://foreign.example/']) for (const marker of [true, false]) {
  const condition = { status, type, redirected, mime, url, marker };
  const valid = status === 200 && ['default', 'basic'].includes(type) && !redirected && mime.startsWith('text/html') && ['', HOME].includes(url) && marker;
  add('shell', condition, async () => {
    const h = harness({ seed: seedShell('valid') });
    const response = new FakeResponse(`${marker ? MARKER : '<title>Sign in</title>'}<main>candidate</main>`, { status, type, redirected, url, headers: { 'Content-Type': mime, 'Content-Encoding': 'gzip', 'Content-Length': '17', 'X-App-Header': 'retain' } });
    assert.equal(await h.get('cacheShell')(response), valid);
    assert.equal(h.operations.filter(op => op[0] === 'put').length, Number(valid));
    assert.match(h.cached().body, valid ? /candidate/ : /saved/);
    assert.equal(response.bodyUsed, false);
    if (valid) {
      assert.equal(h.cached().headers.get('content-encoding'), null);
      assert.equal(h.cached().headers.get('content-length'), null);
      assert.equal(h.cached().headers.get('x-app-header'), 'retain');
      assert.equal(h.cached().headers.get('x-pococha-saved-at'), new Date(EPOCH).toISOString());
    }
  });
}

// 4 message types × 8 id boundary values × 8 source URL states × 4 seed
// states = 1,024 combinations of origin/id validation and preparation state.
const sources = [HOME, `${HOME}meter`, `${HOME}?x=1`, 'http://meter.example/', 'https://foreign.example/', 'not-a-url', undefined, null];
for (const type of ['POCOCHA_OFFLINE_STATUS', 'POCOCHA_OFFLINE_PREPARE', 'UNKNOWN', null])
for (const id of [0, 1, -1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, 1.5, '1', null])
for (const sourceUrl of sources) for (const seed of ['valid', 'none', 'marker', 'old']) {
  const condition = { type, id, sourceUrl: sourceUrl ?? String(sourceUrl), seed };
  const accepted = ['POCOCHA_OFFLINE_STATUS', 'POCOCHA_OFFLINE_PREPARE'].includes(type) && Number.isSafeInteger(id) && sources.slice(0, 3).includes(sourceUrl);
  add('message', condition, async () => {
    const h = harness({ seed: seedShell(seed) });
    const source = sourceUrl === null ? null : { url: sourceUrl, replies: [], postMessage(reply) { this.replies.push(reply); } };
    const event = h.dispatch('message', { source, data: { type, id } }); await lifetime(event);
    assert.equal(event.waited.length, Number(accepted));
    assert.equal(source?.replies.length ?? 0, Number(accepted));
    if (!accepted) { assert.equal(h.calls.length, 0); assert.equal(h.operations.length, 0); return; }
    const reply = source.replies[0], prepared = type === 'POCOCHA_OFFLINE_PREPARE';
    assert.equal(reply.id, id); assert.equal(reply.type, 'POCOCHA_OFFLINE_STATUS'); assert.equal(reply.version, CACHE);
    assert.equal(reply.ready, prepared || seed === 'valid'); assert.equal(reply.failed, false);
    assert.equal(reply.preparedAt, prepared ? new Date(EPOCH).toISOString() : seed === 'valid' ? STAMP : '');
    assert.equal(h.calls.length, prepared ? 1+ASSETS.length+1 : 0);
    if(prepared)assert.ok(h.cached(new URL(METHOD_PATH,HOME).href)?.body.includes(METHOD_MARKER),'Preparation also saves the public calculation help');
    assert.equal(h.operations.filter(op => op[0] === 'put').length, prepared ? 1+ASSETS.length+1 : 0);
    if (seed === 'old') assert.match(h.cached(HOME, OLD).body, /old release/);
  });
}

const navigationResponses = [
  ['valid', () => shell('network'), true],
  ['marker', () => new FakeResponse('network sign-in', { url: HOME, headers: { 'Content-Type': 'text/html' } }), false],
  ['redirect', () => shell('network redirect', { redirected: true }), false],
  ['foreign', () => shell('network foreign', { url: 'https://foreign.example/' }), false],
  ...[204, 301, 400, 401, 403, 404, 429, 499, 500, 502, 503].map(status => [`status${status}`, () => shell(`network status${status}`, { status }), false]),
  ['reject', null, false],
];
// 16 network responses × 6 cache conditions × 4 IO conditions × 4 arrival
// times = 1,536. Late completion is also checked for independent cache writes.
for (const [networkName, makeResponse, validNetwork] of navigationResponses)
for (const seed of ['valid', 'none', 'marker', 'status', 'mime', 'redirect'])
for (const io of ['none', 'open', 'match', 'put']) for (const arrival of [0, 1, 2999, 3001]) {
  const condition = { networkName, seed, io, arrival };
  add('navigation', condition, async () => {
    const gate = deferred(), response = makeResponse?.();
    const h = harness({ seed: seedShell(seed), io: failingIo(io), fetch: () => gate.promise });
    const event = h.dispatch('fetch', { request: request() });
    assert.ok(event.response); await flush();
    if (arrival) await h.advance(Math.min(arrival, 3000));
    if (arrival === 3001) await h.advance(1);
    if (response) gate.resolve(response); else gate.reject(new Error('network unavailable'));
    const actual = await event.response; await lifetime(event);
    const usableCache = seed === 'valid' && !['open', 'match'].includes(io);
    const prefersCache = usableCache && (arrival > 3000 || !response || response.status >= 500);
    if (prefersCache) { assert.match(actual.body, /saved/); assert.equal(actual.status, 200); }
    else if (response) assert.equal(actual, response);
    else { assert.equal(actual.status, 503); assert.match(actual.body, /オフライン準備/); assert.equal(actual.headers.get('cache-control'), 'no-store'); }
    const shouldWrite = validNetwork && !['open', 'put'].includes(io);
    assert.equal(h.operations.filter(op => op[0] === 'put').length, validNetwork && io !== 'open' ? 1 : 0);
    if (shouldWrite) assert.match(h.cached().body, /network/);
    else if (seed === 'valid') assert.match(h.cached().body, /saved/);
    assert.equal(h.timers.size, 0);
  });
}

const assetNetworks = [
  ['valid', path => asset(path, 'network asset')],
  ['mime', path => asset(path, 'network wrong mime', { headers: { 'Content-Type': 'text/html' } })],
  ...[204, 401, 404, 500, 503].map(status => [`status${status}`, path => asset(path, `network status${status}`, { status })]),
  ['reject', null],
];
const assetSeeds = ['valid', 'none', 'mime', 'status404', 'status503', 'prefix', 'normalized', 'empty'];
function cachedAsset(path, variant) {
  if (variant === 'none') return null;
  const expected = path.endsWith('.png') ? 'image/png' : 'application/manifest+json';
  const mime = variant === 'mime' ? 'text/plain' : variant === 'prefix' ? `${expected}-invalid` : variant === 'normalized' ? `${expected.toUpperCase()}; charset=utf-8` : variant === 'empty' ? '' : expected;
  return asset(path, `saved asset ${variant}`, { status: variant === 'status404' ? 404 : variant === 'status503' ? 503 : 200, headers: { 'Content-Type': mime } });
}
// 4 resource paths × 8 network outcomes × 8 cached MIME/status outcomes ×
// 2 cache-open outcomes × 2 arrival times = 1,024 asset response conditions.
for (const path of ASSETS) for (const [networkName, makeResponse] of assetNetworks)
for (const seed of assetSeeds) for (const io of ['none', 'open']) for (const arrival of [0, 3001]) {
  const condition = { path, networkName, seed, io, arrival };
  add('asset', condition, async () => {
    const gate = deferred(), response = makeResponse?.(path), cached = cachedAsset(path, seed), url = new URL(path, HOME).href;
    const h = harness({ seed: cached ? { [CACHE]: { [url]: cached } } : {}, io: failingIo(io), fetch: () => gate.promise });
    const event = h.dispatch('fetch', { request: request(path, { mode: 'no-cors' }) });
    await flush(); if (arrival) await h.advance(arrival);
    if (response) gate.resolve(response); else gate.reject(new Error('asset network unavailable'));
    const actual = await event.response; await lifetime(event);
    const usable = ['valid', 'normalized'].includes(seed) && io === 'none';
    if (usable && (arrival > 3000 || !response || response.status >= 500)) {
      assert.match(actual.body, /saved asset/); assert.equal(actual.status, 200);
    } else if (response) assert.equal(actual, response);
    else { assert.equal(actual.type, 'error'); assert.equal(actual.status, 0); }
    assert.equal(h.operations.filter(op => op[0] === 'put').length, 0);
    assert.equal(h.timers.size, 0);
    if (cached) assert.equal(h.cached(url).body, cached.body);
  });
}

const orders = [[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]];
const validPatterns = [[true, true, true], [true, true, false], [true, false, true], [false, true, true], [true, false, false]];
// All 6 completion orders of 3 initiated navigations × 5 acceptance patterns
// × 4 write-failure identities × 3 previous-release states = 360 race cases.
for (const order of orders) for (const validity of validPatterns) for (const failedGeneration of [0, 1, 2, 3]) for (const seed of ['none', 'valid', 'old']) {
  const condition = { order, validity, failedGeneration, seed };
  add('concurrency', condition, async () => {
    const gates = [deferred(), deferred(), deferred()]; let next = 0;
    const h = harness({ seed: seedShell(seed), fetch: () => gates[next++].promise,
      io(op, name, url, value) { if (op === 'put' && value.body.includes(`generation-${failedGeneration}<`)) throw new Error('quota at selected generation'); } });
    const events = gates.map(() => h.dispatch('fetch', { request: request() })); await flush();
    for (const generation of order) {
      const response = validity[generation - 1] ? shell(`generation-${generation}`) : new FakeResponse(`no marker generation-${generation}`, { url: HOME, headers: { 'Content-Type': 'text/html' } });
      gates[generation - 1].resolve(response); assert.equal(await events[generation - 1].response, response); await lifetime(events[generation - 1]);
    }
    const winners = [1, 2, 3].filter(generation => validity[generation - 1] && generation !== failedGeneration);
    if (winners.length) assert.match(h.cached().body, new RegExp(`generation-${Math.max(...winners)}<`));
    else if (seed === 'valid') assert.match(h.cached().body, /saved/);
    else assert.equal(h.cached(), undefined);
    if (seed === 'old') assert.match(h.cached(HOME, OLD).body, /old release/);
    assert.equal(h.timers.size, 0);
  });
}

// 2 methods × 2 origins × 2 query states × 2 modes × 2 paths = 32 exact
// interception boundaries. Bypassed API/auth/foreign requests do no worker IO.
for (const method of ['GET', 'POST']) for (const origin of [ORIGIN, 'https://foreign.example'])
for (const query of ['', '?token=1']) for (const mode of ['navigate', 'cors']) for (const path of ['/', '/api/borders']) {
  const condition = { method, origin, query, mode, path };
  add('routing', condition, async () => {
    const h = harness(), accepted = method === 'GET' && origin === ORIGIN && !query && mode === 'navigate' && path === '/';
    const event = h.dispatch('fetch', { request: { method, mode, url: `${origin}${path}${query}` } });
    assert.equal(Boolean(event.response), accepted);
    if (accepted) { assert.equal((await event.response).status, 200); await lifetime(event); assert.equal(h.calls.length, 1); assert.equal(h.operations.filter(op => op[0] === 'put').length, 1); }
    else { assert.equal(h.calls.length, 0); assert.equal(h.operations.length, 0); assert.equal(event.waited.length, 0); }
  });
}

assert.equal(cases.length, 5000, 'SW matrix must contain exactly 5,000 named cases');
const names = cases.map(({ family, condition }) => `${family} ${JSON.stringify(condition)}`);
assert.equal(new Set(names).size, cases.length, 'every condition name must be distinct');
let passedConditions=0,failedConditions=0;
for (const { family, condition, run } of cases) test(`SW5K ${family} ${JSON.stringify(condition)}`,async()=>{try{await run();passedConditions++;}catch(error){failedConditions++;throw error;}});

test.after(()=>{console.log('OFFLINE_SW_MATRIX_RESULT '+JSON.stringify({matrix:'offline-sw-5000',distinctMatrixConditions:cases.length,groups:cases.reduce((counts,item)=>(counts[item.family]=(counts[item.family]||0)+1,counts),{}),deterministicCasesSha256:createHash('sha256').update(JSON.stringify(names)).digest('hex'),passedConditions,failedConditions,status:passedConditions===5000&&failedConditions===0?'passed':'failed',limitations:['Service-worker VM and controlled browser IO; no physical-device or browser-rendering runs']}));});
