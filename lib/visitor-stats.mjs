import { validClientHint, visitorMetadata } from './visitor-metadata.mjs';
import { buildVisitorReport } from './visitor-report.mjs';
import { enforceRequestQuota, readLimitedBytes, RequestLimitError, quotaHeaders } from './security-limits.mjs';

const COOKIE = '__Host-pococha-visitor';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY = 86400000;
export const jstDay = (now = new Date()) => new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
export const shiftDay = (day, offset) => new Date(Date.parse(day + 'T00:00:00Z') + offset * DAY).toISOString().slice(0, 10);
export function isAnalyticsAdmin(user, env) {
  const email = String(env.ANALYTICS_ADMIN_EMAIL || '').trim().toLowerCase();
  const expectedID=String(env.ANALYTICS_ADMIN_USER_ID||'').trim();
  return Boolean(email && user?.userId && (!expectedID||user.userId===expectedID) && user?.email?.trim().toLowerCase() === email);
}
function dbFor(env) {
  if (!env.DB) throw new Error('Visitor database unavailable');
  return env.DB;
}
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
});
export async function recordVisit(request, env, now = new Date()) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
  // A JSON POST from the calculator only; no third-party CORS or form writes.
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'Origin rejected' }, 403);
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) return json({ error: 'JSON required' }, 415);
  if (/bot|crawler|spider|headless/i.test(request.headers.get('user-agent') || '')) return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  try {
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(await readLimitedBytes(request, 2048));
    let event;
    try { event = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON' }, 400); }
    if (!event || Array.isArray(event) || typeof event.eventId !== 'string' || !UUID.test(event.eventId) || Object.keys(event).some(key => !['eventId', 'clientHint'].includes(key)) || (Object.hasOwn(event, 'clientHint') && !validClientHint(event.clientHint))) return json({ error: 'Invalid event' }, 400);
    await enforceRequestQuota(request, env, 'visit', now.getTime());
    const cookie = (request.headers.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
    const visitor = cookie && UUID.test(cookie) ? cookie : crypto.randomUUID();
    const day = jstDay(now);
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(day + '\n' + visitor));
    const visitorHash = Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('');
    const metadata = visitorMetadata(request, event.clientHint);
    await dbFor(env).prepare('INSERT INTO site_visit_events (event_id,day,visitor_hash,occurred_at,ip_address,country,region,city,device_type,device_model,os_family,os_version,browser_family,browser_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(event_id) DO NOTHING')
      .bind(event.eventId.toLowerCase(), day, visitorHash, now.toISOString(), metadata.ipAddress, metadata.country, metadata.region, metadata.city, metadata.deviceType, metadata.deviceModel, metadata.osFamily, metadata.osVersion, metadata.browserFamily, metadata.browserVersion).run();
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store', 'Set-Cookie': `${COOKIE}=${visitor}; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax` } });
  } catch (error) {
    if (error instanceof RequestLimitError) return json({ error: error.status === 429 ? 'Rate limit exceeded' : 'Request rejected' }, error.status, quotaHeaders());
    console.error('Visitor recording unavailable', error instanceof Error ? error.message : 'unknown');
    return json({ error: '記録を利用できません' }, 503);
  }
}
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export function statsRange(start, end, now = new Date()) {
  const today = jstDay(now);
  start ||= shiftDay(today, -29); end ||= today;
  if (!validDay(start) || !validDay(end) || start > end || end > today || (Date.parse(end) - Date.parse(start)) / DAY > 365) throw new RangeError('期間は今日までの366日以内で、開始日から終了日の順に指定してください。');
  return { start, end, today };
}
export function visitorDetailFilters(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new RangeError('詳細の検索条件を正しく指定してください。');
  const filters = {};
  for (const key of ['ip', 'country', 'device', 'os', 'browser', 'q', 'hour']) {
    const value = raw[key] === undefined ? '' : raw[key];
    if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) throw new RangeError('詳細の検索条件は文字で指定してください。');
    filters[key] = value.trim();
  }
  if (filters.ip) {
    // Reuse the same canonical IP validation as recording. This does not trust
    // any query parameter as the request's network address.
    if (filters.ip.length > 45) throw new RangeError('IPアドレスを正しく指定してください。');
    const request = new Request('https://analytics.invalid/', { headers: { 'cf-connecting-ip': filters.ip } });
    const normalized = visitorMetadata(request).ipAddress;
    if (!normalized) throw new RangeError('IPアドレスを正しく指定してください。');
    filters.ip = normalized;
  }
  if (filters.country) {
    if (filters.country.toLowerCase() === 'unknown') filters.country = 'unknown';
    else if (/^[a-z]{2}$/i.test(filters.country)) filters.country = filters.country.toUpperCase();
    else throw new RangeError('国は2文字の国コードまたは unknown で指定してください。');
  }
  if (filters.device && !['smartphone', 'tablet', 'desktop', 'unknown'].includes(filters.device)) throw new RangeError('端末種別を正しく指定してください。');
  if (filters.os.length > 40 || filters.browser.length > 40) throw new RangeError('OS・ブラウザの検索条件は40文字以内で指定してください。');
  if (filters.q.length > 80) throw new RangeError('地域・機種の検索は80文字以内で指定してください。');
  if (filters.hour) {
    if (!/^\d{1,2}$/.test(filters.hour) || Number(filters.hour) > 23) throw new RangeError('時刻は0〜23時で指定してください。');
    filters.hour = String(Number(filters.hour));
  }
  return filters;
}
export async function readVisitorStats(env, range, options = {}) {
  const db = dbFor(env), { start, end, today } = range, yesterday = shiftDay(today, -1);
  const requestedDays = (Date.parse(end) - Date.parse(start)) / DAY + 1, precedingStart = shiftDay(start, -requestedDays);
  const filters = visitorDetailFilters(options.filters);
  const query = 'SELECT day, COUNT(DISTINCT visitor_hash) AS visitors, COUNT(*) AS views FROM site_visit_events WHERE day>=? AND day<=? GROUP BY day ORDER BY day DESC';
  const [days, recent, first] = await Promise.all([
    db.prepare(query).bind(precedingStart, end).all(),
    db.prepare(query).bind(yesterday, today).all(),
    db.prepare('SELECT MIN(day) AS first_day FROM site_visit_events').first(),
  ]);
  const firstDay = first?.first_day || null;
  const byDay = new Map(days.results.map(row => [row.day, row]));
  const lookupDay = day => byDay.get(day) || { day, visitors: firstDay && day >= firstDay ? 0 : null, views: firstDay && day >= firstDay ? 0 : null };
  const summary = day => recent.results.find(row => row.day === day) || { day, visitors: firstDay && day >= firstDay ? 0 : null, views: firstDay && day >= firstDay ? 0 : null };
  const rows = [];
  for (let day = end; day >= start; day = shiftDay(day, -1)) rows.push(lookupDay(day));
  const details = await readVisitorDetails(db, start, end, options.page, filters);
  const report = buildVisitorReport(range, rows, lookupDay, firstDay);
  return { ...range, firstDay, rows, todayStats: summary(today), yesterdayStats: summary(yesterday), totals: rows.reduce((sum, row) => ({ visitors: sum.visitors + (row.visitors || 0), views: sum.views + (row.views || 0) }), { visitors: 0, views: 0 }), report, details };
}


async function readVisitorDetails(db, start, end, requestedPage, filters) {
  let where = 'FROM site_visit_events WHERE day>=? AND day<=? AND occurred_at IS NOT NULL';
  const values = [start, end];
  for (const [filter, column] of [['ip', 'ip_address'], ['country', 'country'], ['device', 'device_type'], ['os', 'os_family'], ['browser', 'browser_family']]) {
    if (!filters[filter]) continue;
    if (filters[filter] === 'unknown') where += ` AND (${column} IS NULL OR ${column}=''${filter === 'device' ? ` OR ${column}='unknown'` : ''})`;
    else { where += ` AND ${column}=?`; values.push(filters[filter]); }
  }
  if (filters.q) {
    where += ` AND (${['region', 'city', 'device_model', 'os_family', 'browser_family'].map(column => `${column} LIKE ? ESCAPE '\\'`).join(' OR ')})`;
    const literal = '%' + filters.q.replace(/[\\%_]/g, character => '\\' + character) + '%';
    values.push(...Array(5).fill(literal));
  }
  if (filters.hour) { where += ` AND CAST(strftime('%H',occurred_at,'+9 hours') AS INTEGER)=?`; values.push(Number(filters.hour)); }
  const counts = 'COUNT(DISTINCT visitor_hash) AS visitors, COUNT(*) AS views';
  const groups = {
    countries: [['country', 'country']],
    regions: [['country', 'country'], ['region', 'region'], ['city', 'city']],
    devices: [['device_type', 'deviceType'], ['device_model', 'deviceModel']],
    systems: [['os_family', 'osFamily'], ['os_version', 'osVersion']],
    browsers: [['browser_family', 'browserFamily'], ['browser_version', 'browserVersion']],
    ips: [['ip_address', 'ipAddress']],
    deviceBrowsers: [['device_type', 'deviceType'], ['browser_family', 'browserFamily']],
  };
  const qualityExpressions = {
    ip: "ip_address IS NOT NULL AND ip_address<>''", country: "country IS NOT NULL AND country<>''",
    region: "(region IS NOT NULL AND region<>'') OR (city IS NOT NULL AND city<>'')",
    device: "device_type IS NOT NULL AND device_type<>'' AND device_type<>'unknown'", model: "device_model IS NOT NULL AND device_model<>''",
    os: "os_family IS NOT NULL AND os_family<>''", browser: "browser_family IS NOT NULL AND browser_family<>''",
  };
  const [summary, first, hourly, week, dayResults, ...groupResults] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS measuredViews, COUNT(DISTINCT ip_address) AS uniqueIPs, ${Object.entries(qualityExpressions).map(([key, expression]) => `SUM(CASE WHEN ${expression} THEN 1 ELSE 0 END) AS known_${key}`).join(',')} ${where}`).bind(...values).first(),
    db.prepare('SELECT MIN(day) AS firstDay FROM site_visit_events WHERE occurred_at IS NOT NULL').first(),
    db.prepare(`SELECT CAST(strftime('%H',occurred_at,'+9 hours') AS INTEGER) AS hour, ${counts} ${where} GROUP BY hour ORDER BY hour`).bind(...values).all(),
    db.prepare(`SELECT CAST(strftime('%w',occurred_at,'+9 hours') AS INTEGER) AS weekday, ${counts} ${where} GROUP BY weekday ORDER BY weekday`).bind(...values).all(),
    db.prepare(`SELECT day, ${counts} ${where} GROUP BY day ORDER BY day DESC`).bind(...values).all(),
    ...Object.entries(groups).map(([key, fields]) => db.prepare(`SELECT ${fields.map(([column, alias]) => `${column} AS ${alias}`).join(',')}, ${counts}${key === 'ips' ? ', MIN(occurred_at) AS firstSeen, MAX(occurred_at) AS lastSeen' : ''} ${where} GROUP BY ${fields.map(([column]) => column).join(',')} ORDER BY views DESC, ${fields.map(([column]) => column).join(',')} LIMIT 26`).bind(...values).all()),
  ]);
  const total = summary?.measuredViews || 0, pageSize = 50, pages = Math.ceil(total / pageSize);
  const candidate = Number(requestedPage);
  const page = Math.min(Math.max(1, Number.isSafeInteger(candidate) ? candidate : 1), Math.max(1, pages));
  const events = await db.prepare(`SELECT occurred_at AS occurredAt, ip_address AS ipAddress, country, region, city, device_type AS deviceType, device_model AS deviceModel, os_family AS osFamily, os_version AS osVersion, browser_family AS browserFamily, browser_version AS browserVersion ${where} ORDER BY occurred_at DESC,event_id DESC LIMIT ? OFFSET ?`).bind(...values, pageSize, (page - 1) * pageSize).all();
  const hours = Array.from({ length: 24 }, (_, hour) => hourly.results.find(row => row.hour === hour) || { hour, visitors: 0, views: 0 });
  const weekdays = Array.from({ length: 7 }, (_, weekday) => week.results.find(row => row.weekday === weekday) || { weekday, visitors: 0, views: 0 });
  const firstDay = first?.firstDay || null, daily = [];
  for (let day = end; firstDay && day >= start && day >= firstDay; day = shiftDay(day, -1)) daily.push(dayResults.results.find(row => row.day === day) || { day, visitors: 0, views: 0 });
  const quality = Object.keys(qualityExpressions).map(key => ({ key, known: summary?.['known_' + key] || 0, unknown: total - (summary?.['known_' + key] || 0) }));
  const data = Object.fromEntries(Object.keys(groups).map((key, i) => [key, groupResults[i].results.slice(0, 25)]));
  const truncated = Object.fromEntries(Object.keys(groups).map((key, i) => [key, groupResults[i].results.length > 25]));
  return { firstDay, measuredViews: total, uniqueIPs: summary?.uniqueIPs || 0, filters, ...data, daily, weekdays, quality, hours, events: events.results, pagination: { page, total, pageSize, pages }, truncated };
}
