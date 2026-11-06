import { visitorMetadata } from './visitor-metadata.mjs';

export class RequestLimitError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export async function readLimitedBytes(input, limit, timeoutMs = 15000) {
  const declared = input.headers.get('Content-Length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new RequestLimitError(413, 'Payload too large');
  const reader = input.body?.getReader();
  if (!reader) return new Uint8Array();
  let timer, size = 0; const chunks = [];
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => {
    reject(new RequestLimitError(408, 'Request read timeout'));
    Promise.resolve(reader.cancel()).catch(() => {});
  }, timeoutMs); });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) { Promise.resolve(reader.cancel()).catch(() => {}); throw new RequestLimitError(413, 'Payload too large'); }
      chunks.push(value);
    }
    const result = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result;
  } finally { clearTimeout(timer); }
}

const initialized = new WeakMap();
const blocked = new WeakMap();
const maintenance = new WeakMap();
async function ready(db) {
  if (!initialized.has(db)) initialized.set(db, Promise.resolve().then(() => db.prepare('CREATE TABLE IF NOT EXISTS security_rate_windows (id TEXT PRIMARY KEY NOT NULL, expires_at INTEGER NOT NULL, hits INTEGER NOT NULL)').run()).catch(error => { initialized.delete(db); throw error; }));
  await initialized.get(db);
}
async function cleanExpiredCounters(db, now) {
  const previous = maintenance.get(db);
  // The first caller owns cleanup until it finishes. Throttle attempts, including
  // failures, independently for each DB; no exact wall-clock second is required.
  if (previous && (previous.pending || now < previous.nextAt)) return;
  const entry = { pending: true, nextAt: now + 60000 };
  maintenance.set(db, entry);
  try {
    // Retain a grace hour after expiry, including accepted-signature records.
    // Contact records, attachments and visitor history are never removed here.
    await db.prepare('DELETE FROM security_rate_windows WHERE expires_at<?').bind(Math.floor(now / 1000) - 3600).run();
  } catch {
    // Maintenance must neither bypass quota claims nor reject a valid write.
    console.error('Expired security counter cleanup unavailable');
  } finally {
    entry.pending = false;
  }
}
const policies = {
  contactSession: [[3600, 30, 1000], [86400, 100, 5000]],
  contactWrite: [[60, 30, 300], [3600, 120, 1500]],
  contactNew: [[3600, 10, 100]],
  contactUpload: [[3600, 20, 200]],
  contactRead: [[60, 120, 2000]],
  visit: [[60, 120, 2000], [3600, 600, 10000], [86400, 5000, 100000]],
  borderRead: [[60, 120, 2000]],
};
// Cloudflare's connection header is used, never caller-supplied X-Forwarded-For.
// Missing connection metadata shares a conservative bucket instead of bypassing limits.
export async function enforceRequestQuota(request, env, policy, now = Date.now()) {
  if (!env.DB || !policies[policy]) throw new RequestLimitError(503, 'Security checks unavailable');
  const db = env.DB; await ready(db); await cleanExpiredCounters(db, now);
  const ip = visitorMetadata(request).ipAddress || 'unavailable';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  const identity = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  let denied=blocked.get(db);if(!denied){denied=new Map();blocked.set(db,denied);}
  if((denied.get(policy+':'+identity)||0)>now||(denied.get(policy+':all')||0)>now)throw new RequestLimitError(429,'Rate limit exceeded');
  const seconds = Math.floor(now / 1000);
  const statements = policies[policy].flatMap(([duration, perIP, global]) => {
    const window = Math.floor(seconds / duration), end = (window + 1) * duration;
    return [['ip:' + identity, perIP], ['all', global]].map(([scope, limit]) => db.prepare('INSERT INTO security_rate_windows (id,expires_at,hits) VALUES (?,?,1) ON CONFLICT(id) DO UPDATE SET hits=hits+1 WHERE hits<?')
      .bind(policy + ':' + scope + ':' + duration + ':' + window, end, limit));
  });
  const results = await Promise.all(statements.map(statement => statement.run()));
  if (results.some(result => Number(result.meta?.changes ?? result.changes) !== 1)) {
    if(denied.size>5000)denied.clear();
    const globallyBlocked=results.some((result,index)=>index%2===1&&Number(result.meta?.changes??result.changes)!==1);
    denied.set(policy+':'+(globallyBlocked?'all':identity),now+60000);
    throw new RequestLimitError(429, 'Rate limit exceeded');
  }
}
export function quotaHeaders() { return { 'Retry-After': '60', 'Cache-Control': 'private, no-store' }; }
export async function claimSignedWrite(request,env) {
  if(!env.DB)throw new RequestLimitError(503,'Security checks unavailable');
  await ready(env.DB);
  await cleanExpiredCounters(env.DB,Date.now());
  const stamp=request.headers.get('X-Border-Writer-Time'),signature=request.headers.get('X-Border-Writer-Signature');
  const result=await env.DB.prepare('INSERT INTO security_rate_windows (id,expires_at,hits) VALUES (?,?,1) ON CONFLICT(id) DO NOTHING').bind('signed:'+stamp+':'+signature,Number(stamp)+360).run();
  if(Number(result.meta?.changes??result.changes)!==1)throw new RequestLimitError(409,'Signed request already accepted');
}
