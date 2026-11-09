/* Only the calculator shell and its public help/assets are cached. APIs and sign-in pages
   always use the network. Input/record storage remains device-local. */
const CACHE_PREFIX = 'pococha-meter-shell-';
const CACHE_NAME = CACHE_PREFIX + 'v63';
const APP_MARKER = '<meta name="pococha-app" content="meter-offline-v1">';
const HOME = new URL('/', self.location.origin).href;
// The Pages build enables unique startup URLs to bypass the hosting cache.
const FRESH_LAUNCH = false;
function freshShellRequest(input) {
  if (!FRESH_LAUNCH) return input;
  const url = new URL(typeof input === 'string' ? input : input.url);
  url.searchParams.set('_meter_launch', Date.now() + '-' + Math.random().toString(36).slice(2));
  return url.href;
}
let shellGeneration = 0, cachedGeneration = 0;
let shellWrites = Promise.resolve(), preparation = null;
const METHOD_PATH = '/calculation-methods';
const HISTORY_PATH = '/border-history';
const HISTORY_MARKER = '<meta name="pococha-history" content="border-history-v1">';
const METHOD_MARKER = '<meta name="pococha-help" content="calculation-methods-v1">';
const ASSETS = ['/meter.webmanifest', '/meter-icon-192.png', '/meter-icon-512.png', '/meter-icon-180.png', METHOD_PATH, HISTORY_PATH];
function expectedAssetType(response, expected) {
  return (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() === expected;
}
async function validAsset(response, path) {
  const expected = (path === METHOD_PATH || path === HISTORY_PATH) ? 'text/html' : path.endsWith('.png') ? 'image/png' : 'application/manifest+json';
  if (!response || response.status !== 200 || response.redirected || !expectedAssetType(response, expected)) return false;
  if (path === HISTORY_PATH) {if(response.url && response.url !== new URL(HISTORY_PATH, HOME).href)return false;return (await response.clone().text()).includes(HISTORY_MARKER);}
  if (path !== METHOD_PATH) return true;
  if (response.url && response.url !== new URL(METHOD_PATH, HOME).href) return false;
  return (await response.clone().text()).includes(METHOD_MARKER);
}

function shellRequest(request) {
  const url = new URL(request.url);
  return request.method === 'GET' && url.origin === self.location.origin &&
    url.pathname === '/' && !url.search && request.mode === 'navigate';
}
async function validShell(response) {
  if (!response) return false;
  const finalURL = response.url ? new URL(response.url) : null;
  if (finalURL && FRESH_LAUNCH) finalURL.searchParams.delete('_meter_launch');
  const canonicalURL = finalURL?.href || '';
  if (response.status !== 200 || response.redirected ||
      !['basic', 'default'].includes(response.type) ||
      !/^text\/html(?:;|$)/i.test(response.headers.get('content-type') || '')) return false;
  if (canonicalURL && canonicalURL !== HOME) return false;
  return (await response.clone().text()).includes(APP_MARKER);
}
function shellHeaders(response) {
  const headers = new Headers(response.headers);
  // The response body contains decoded bytes.
  headers.delete('content-encoding');
  headers.delete('content-length');
  if (FRESH_LAUNCH) headers.set('Cache-Control', 'no-store');
  return headers;
}
function liveShell(response) {
  // Prevent WebKit from reusing this navigation in its own HTTP cache.
  return FRESH_LAUNCH && response.status === 200 && !response.redirected
    ? new Response(response.body, { status: 200, headers: shellHeaders(response) })
    : response;
}
async function cacheShell(response, generation = ++shellGeneration) {
  if (!await validShell(response)) return false;
  // Serialize writes so an old slow response cannot finish after a newer one.
  const write = shellWrites.catch(() => {}).then(async () => {
    if (generation < cachedGeneration) return true;
    const cache = await caches.open(CACHE_NAME);
    const headers = shellHeaders(response);
    headers.set('X-Pococha-Saved-At', new Date().toISOString());
    await cache.put(HOME, new Response(response.body, { status: 200, headers }));
    cachedGeneration = generation;
    return true;
  });
  shellWrites = write;
  return write;
}
async function savedShell() {
  try {
    const cache = await caches.open(CACHE_NAME), response = await cache.match(HOME);
    if (await validShell(response)) return response;
    if (response) await cache.delete(HOME);
  } catch (_) {}
  return null;
}
async function performPreparation() {
  const generation = ++shellGeneration;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(freshShellRequest(HOME), { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
    if (!await cacheShell(response, generation)) throw new Error('App shell unavailable');
    // Icons are optional for calculation; their failure must not undo a good shell.
    await Promise.allSettled(ASSETS.map(async path => {
      const asset = await fetch(path, { cache: 'no-cache', credentials: 'same-origin', signal: controller.signal });
      if (await validAsset(asset, path)) {
        const cache = await caches.open(CACHE_NAME); await cache.put(new URL(path, HOME).href, asset);
      }
    }));
  } finally { clearTimeout(timer); }
}
function prepareShell() {
  if (preparation) return preparation;
  preparation = performPreparation().finally(() => { preparation = null; });
  return preparation;
}
self.addEventListener('install', event => {
  event.waitUntil(prepareShell().then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Preserve old shells if this version has not actually been prepared.
    if (await savedShell()) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
    }
    await self.clients.claim();
  })());
});
async function navigate(request, event) {
  let timeout;
  const generation = ++shellGeneration;
  // Return an arrived network response immediately. Storage maintenance is
  // independent, so slow phone storage does not delay a fresh page.
  const network = fetch(freshShellRequest(request), { cache: 'no-store' });
  event.waitUntil(network.then(response => cacheShell(response.clone(), generation)).catch(() => {}));
  try {
    const response = await Promise.race([network, new Promise(resolve => {
      timeout = setTimeout(() => resolve(null), 3000);
    })]);
    if (response && response.status < 500) return liveShell(response);
    const cached = await savedShell();
    if (cached) return cached;
    if (response) return response;
    // No saved shell: keep waiting for the real page rather than a blank screen.
    return liveShell(await network);
  } catch (_) {
    const cached = await savedShell();
    if (cached) return cached;
    return new Response('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>接続が必要です</title><body><p>この端末ではオフライン準備が完了していません。通信できる状態でメーターを一度開いてください。</p><a href="/">もう一度開く</a></body></html>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  } finally { clearTimeout(timeout); }
}
async function assetRequest(request, url) {
  let timer;
  const network = fetch(request, { cache: 'no-store' });
  try {
    const response = await Promise.race([network, new Promise(resolve => {
      timer = setTimeout(() => resolve(null), 3000);
    })]);
    if (response && response.status < 500) return response;
    try {
      const cache = await caches.open(CACHE_NAME), cached = await cache.match(url);
      if (await validAsset(cached, new URL(url).pathname)) return cached;
    } catch (_) {}
    return response || await network;
  } catch (_) {
    try {
      const cache = await caches.open(CACHE_NAME), cached = await cache.match(url);
      if (await validAsset(cached, new URL(url).pathname)) return cached;
    } catch (_) {}
    return Response.error();
  } finally { clearTimeout(timer); }
}
self.addEventListener('fetch', event => {
  if (shellRequest(event.request)) { event.respondWith(navigate(event.request, event)); return; }
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.search || !ASSETS.includes(url.pathname)) return;
  event.respondWith(assetRequest(event.request, url.href));

});
let clockMeasurement = null;
async function sampleClock() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let lo = -Infinity, hi = Infinity;
  try {
    for (let i = 0; i < 4 && !controller.signal.aborted; i++) {
      const started = Date.now(), url = new URL('meter.webmanifest', HOME);
      url.searchParams.set('clock', started);
      const response = await fetch(url.href, { method: 'HEAD', cache: 'no-store', mode: 'same-origin',
        credentials: 'omit', redirect: 'error', signal: controller.signal });
      const received = Date.now(), server = Date.parse(response.headers.get('date') || '');
      if (response.ok && Number.isFinite(server) && received >= started && received - started <= 3000) {
        // HTTP Date has one-second resolution. Intersect the bounds from each sample.
        lo = Math.max(lo, started - server - 1000);
        hi = Math.min(hi, received - server);
      }
      if (i < 3) await new Promise(resolve => setTimeout(resolve, 260));
    }
    return !controller.signal.aborted && Number.isFinite(lo) && lo <= hi ? { lo, hi, at: Date.now() } : null;
  } catch (_) { return null; }
  finally { clearTimeout(timeout); }
}

self.addEventListener('message', event => {
  const data = event.data;
  if (!event.source || !data) return;
  // Messages from another origin are ignored, even if a client id is supplied.
  try { if (!event.source.url || new URL(event.source.url).origin !== self.location.origin) return; }
  catch (_) { return; }
  if (data.type === 'POCOCHA_CLOCK_MEASURE') {
    const port = event.ports?.[0];
    if (!port) return;
    // Reloads and tabs can share the same ongoing sample batch.
    if (!clockMeasurement) clockMeasurement = sampleClock().finally(() => { clockMeasurement = null; });
    event.waitUntil(clockMeasurement.then(result => port.postMessage(result)).finally(() => port.close()));
    return;
  }
  if (!['POCOCHA_OFFLINE_STATUS', 'POCOCHA_OFFLINE_PREPARE'].includes(data.type) || !Number.isSafeInteger(data.id)) return;
  event.waitUntil((async () => {
    let failed = false;
    if (data.type === 'POCOCHA_OFFLINE_PREPARE') {
      try { await prepareShell(); } catch (_) { failed = true; }
    }
    const response = await savedShell();
    event.source.postMessage({ type: 'POCOCHA_OFFLINE_STATUS', id: data.id,
      ready: !!response, failed, version: CACHE_NAME, preparedAt: response && response.headers.get('X-Pococha-Saved-At') || '' });
  })());
});
