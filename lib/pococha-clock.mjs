// This samples the public website's HTTP response time. Pococha does not expose
// its internal live-app clock here, so the API deliberately names that source.
export const POCOCHA_TIME_URL = 'https://www.pococha.com/';
export const POCOCHA_TIME_SCHEMA = 'pococha-site-time-v1';
export const POCOCHA_TIME_SOURCE = 'pococha-official-website-http-date';
const PUBLIC_ORIGIN = 'https://pococha2026.github.io';
const SAMPLE_LIFETIME_MS = 60_000;
const FAILURE_BACKOFF_MS = 10_000;
const REQUEST_TIMEOUT_MS = 6_000;
const MAX_ROUND_TRIP_MS = 5_000;
const MAX_SOURCE_OFFSET_MS = 300_000;
const SITE_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function verifiedStatus(response) {
  if (response.ok) return true;
  if (!SITE_REDIRECT_STATUSES.has(response.status)) return false;
  const location = response.headers.get('location');
  if (!location) return false;
  try {
    const destination = new URL(location, POCOCHA_TIME_URL);
    return destination.origin === new URL(POCOCHA_TIME_URL).origin &&
      destination.protocol === 'https:' && !destination.username && !destination.password;
  } catch { return false; }
}

function httpDate(value) {
  // Date.parse also accepts local and ambiguous date formats. HTTP dates must
  // be unambiguous GMT, have a real calendar date, and have the right weekday.
  if (typeof value !== 'string' || !/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toUTCString() === value ? parsed : NaN;
}

export function createPocochaTimeApi({ fetcher = fetch, now = Date.now,
  setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let sample = null, inFlight = null, nonce = 0;
  let failedAt = null;
  function metadata() {
    return { schema: POCOCHA_TIME_SCHEMA, source: POCOCHA_TIME_SOURCE, sourceURL: POCOCHA_TIME_URL };
  }
  function headers(request) {
    const result = new Headers({ 'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' });
    if (request.headers.get('origin') === PUBLIC_ORIGIN) {
      result.set('Access-Control-Allow-Origin', PUBLIC_ORIGIN);
      result.set('Access-Control-Allow-Methods', 'GET, HEAD');
    }
    return result;
  }
  async function readSample() {
    const startedAt = now();
    if (!Number.isFinite(startedAt)) throw new Error('Clock unavailable');
    const url = new URL(POCOCHA_TIME_URL);
    url.searchParams.set('_pococha1012_clock', String(Math.floor(startedAt)) + '-' + (++nonce));
    const controller = new AbortController();
    let timer;
    try {
      const response = await Promise.race([
        Promise.resolve().then(() => fetcher(url.href, { method: 'HEAD', redirect: 'manual',
          cache: 'no-store', credentials: 'omit', signal: controller.signal,
          headers: { 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache' } })),
        new Promise((_, reject) => { timer = setTimer(() => {
          controller.abort(); reject(new Error('Upstream timeout'));
        }, REQUEST_TIMEOUT_MS); }),
      ]);
      const receivedAt = now(), roundTripMs = receivedAt - startedAt;
      if (!Number.isFinite(roundTripMs) || roundTripMs < 0 || roundTripMs > MAX_ROUND_TRIP_MS) throw new Error('Unreliable round trip');
      // The official root currently redirects to its language page. Read the
      // fresh first response's Date only after validating the same-site target;
      // following that redirect could return a cached page's older Date.
      if (!response || !verifiedStatus(response) || response.redirected || response.url && response.url !== url.href) throw new Error('Unverified upstream response');
      const age = response.headers.get('age');
      if (age !== null && (!/^\d+$/.test(age) || Number(age) !== 0)) throw new Error('Cached upstream response');
      const dateMs = httpDate(response.headers.get('date'));
      if (!Number.isFinite(dateMs) || Math.abs(dateMs + 500 - (startedAt + receivedAt) / 2) > MAX_SOURCE_OFFSET_MS) throw new Error('Unreliable upstream Date');
      // HTTP Date has one-second precision. Midpoint (+500ms) and half of the
      // measured round trip estimate the website time when its reply arrived.
      sample = { receivedAt, serverTimeMs: dateMs + 500 + roundTripMs / 2,
        uncertaintyMs: Math.ceil(500 + roundTripMs / 2), upstreamRoundTripMs: roundTripMs };
      failedAt = null;
      return sample;
    } finally { if (timer !== undefined) clearTimer(timer); }
  }
  async function currentSample() {
    const at = now();
    if (!Number.isFinite(at)) throw new Error('Clock unavailable');
    if (sample && at < sample.receivedAt) sample = null;
    if (failedAt !== null && at < failedAt) failedAt = null;
    if (sample && at - sample.receivedAt < SAMPLE_LIFETIME_MS) return sample;
    if (inFlight) return inFlight;
    if (failedAt !== null && at - failedAt < FAILURE_BACKOFF_MS) throw new Error('Retry later');
    inFlight = readSample().catch(error => { failedAt = now(); throw error; })
      .finally(() => { inFlight = null; });
    return inFlight;
  }
  return async function pocochaTimeApi(request) {
    const responseHeaders = headers(request);
    if (request.method === 'OPTIONS') {
      if (request.headers.get('origin') !== PUBLIC_ORIGIN) {
        return new Response(null, { status: 403, headers: responseHeaders });
      }
      return new Response(null, { status: 204, headers: responseHeaders });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      responseHeaders.set('Allow', 'GET, HEAD, OPTIONS');
      return new Response(JSON.stringify({ ...metadata(), error: 'Method not allowed' }),
        { status: 405, headers: responseHeaders });
    }
    const requestStartedAt = now();
    try {
      const current = await currentSample(), responseAt = now();
      const elapsed = responseAt - current.receivedAt, processingMs = responseAt - requestStartedAt;
      // A clock rollback during the awaited request must never advance a
      // previously verified sample using a negative duration.
      if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= SAMPLE_LIFETIME_MS ||
          !Number.isFinite(processingMs) || processingMs < 0 || processingMs > REQUEST_TIMEOUT_MS) {
        sample = null; throw new Error('Sample expired');
      }
      const data = { ...metadata(), serverTimeMs: current.serverTimeMs + elapsed,
        sampleAgeMs: elapsed, uncertaintyMs: current.uncertaintyMs + Math.ceil(elapsed / 10_000),
        upstreamRoundTripMs: current.upstreamRoundTripMs, processingMs };
      return new Response(request.method === 'HEAD' ? null : JSON.stringify(data),
        { status: 200, headers: responseHeaders });
    } catch {
      responseHeaders.set('Retry-After', String(FAILURE_BACKOFF_MS / 1000));
      return new Response(request.method === 'HEAD' ? null : JSON.stringify({ ...metadata(),
        error: 'Pococha公式サイトの時刻を取得できません。' }), { status: 503, headers: responseHeaders });
    }
  };
}

export const pocochaTimeApi = createPocochaTimeApi();
