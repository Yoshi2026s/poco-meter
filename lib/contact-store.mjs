import { isAnalyticsAdmin } from './visitor-stats.mjs';
import { enforceRequestQuota, readLimitedBytes, RequestLimitError } from './security-limits.mjs';
import {validateAndStripPNG} from './png-security.mjs';
import {stripJPEGMetadata, stripWebPMetadata} from './image-metadata-security.mjs';
import { CONTACT_SESSION_SECONDS, ContactSessionError, createContactSession, requireContactSession, assertContactSession, revokeContactSession } from './contact-sessions.mjs';

const COOKIE = '__Host-pococha-contact';
const CLEAR_COOKIE = `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUBJECTS = ['不具合の報告', '使い方の質問', '改善のご要望', 'その他'];
const MAX_BODY = 8192;
const MAX_IMAGE = 2 * 1024 * 1024;
const MAX_IMAGES = 5;
const MAX_UPLOAD = MAX_IMAGES * MAX_IMAGE + MAX_BODY + 32768;
class ContactError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function reply(data, status = 200, cookie) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'Vary': 'Cookie, oai-authenticated-user-id, oai-authenticated-user-email', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' });
  if (cookie) headers.set('Set-Cookie', cookie);
  if (status === 429) headers.set('Retry-After', '60');
  return new Response(JSON.stringify(data), { status, headers });
}
function sessionToken(request) {
  const values = (request.headers.get('Cookie') || '').split(';').map(value => value.trim()).filter(value => value.startsWith(COOKIE + '='));
  if (values.length !== 1) return null;
  const token = values[0].slice(COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}
function newToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join(''); }
async function tokenHash(token) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), value => value.toString(16).padStart(2, '0')).join(''); }
async function visitorSession(request, env, issue = false) {
  const token = sessionToken(request), issuanceQuota = () => enforceRequestQuota(request, env, 'contactSession');
  if (!token) {
    if (!issue) throw new ContactError(401, 'このブラウザでCookieを有効にして、もう一度お問い合わせを開いてください。');
    await issuanceQuota();
    const selected = newToken(), hash = await tokenHash(selected);
    await createContactSession(env.DB, hash);
    return { hash, cookie: `${COOKIE}=${selected}; Path=/; Max-Age=${CONTACT_SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict` };
  }
  const hash = await tokenHash(token);
  await requireContactSession(env.DB, hash, issuanceQuota);
  return { hash };
}
function owner(request, env) {
  return isAnalyticsAdmin({ userId: request.headers.get('oai-authenticated-user-id'), email: request.headers.get('oai-authenticated-user-email') }, env);
}
function requireSameOrigin(request, admin) {
  if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new ContactError(403, 'このツールを開いて送信してください。');
  if (!(admin ? /^application\/json(?:\s*;|$)/i : /^(?:application\/json(?:\s*;|$)|multipart\/form-data(?:\s*;|$))/i).test(request.headers.get('Content-Type') || '')) throw new ContactError(415, '送信形式を確認してください。');
}
async function readBytes(request, limit) {
  try { const bytes = await readLimitedBytes(request, limit, 30000); if (!bytes.length) throw new ContactError(400, '内容または画像を入力してください。'); return bytes; }
  catch (error) { if (error instanceof RequestLimitError) throw new ContactError(error.status, error.status === 408 ? '送信が時間切れになりました。入力内容を残して再度お試しください。' : '画像は5枚まで・1枚2MB以内、内容は1,500文字以内にしてください。'); throw error; }
}
function parseData(bytes) {
  if (bytes.byteLength > MAX_BODY) throw new ContactError(413, '内容は1,500文字以内にしてください。');
  const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid JSON');
  return data;
}
async function digest(bytes) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join(''); }
function checkImageDimensions(width, height) {
  if (!width || !height || width > 16000 || height > 16000 || width * height > 40000000) throw new ContactError(400, '画像のサイズが大きすぎます。小さい画像を選択してください。');
}
function imageType(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start, end) => String.fromCharCode(...bytes.slice(start,end));
  if (bytes.length >= 33 && [137,80,78,71,13,10,26,10].every((value,index) => bytes[index] === value) && view.getUint32(8) === 13 && text(12,16) === 'IHDR') {
    checkImageDimensions(view.getUint32(16), view.getUint32(20));
    let hasData = false;
    for (let position = 8; position + 12 <= bytes.length;) {
      const length = view.getUint32(position), kind = text(position+4,position+8);
      if (length > bytes.length - position - 12 || position !== 8 && kind === 'IHDR') break;
      if (kind === 'IDAT' && length > 0) hasData = true;
      if (kind === 'IEND') {
        if (length === 0 && hasData && position + 12 === bytes.length) return 'image/png';
        break;
      }
      position += length + 12;
    }
    throw new ContactError(415, '画像が途中で切れています。別の画像を選択してください。');
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217) {
    let hasFrame = false;
    for (let position = 2; position + 4 <= bytes.length;) {
      if (bytes[position++] !== 255) break;
      while (bytes[position] === 255) position++;
      const marker = bytes[position++];
      if (marker === 0xD9) break;
      if (marker === 0x01 || marker >= 0xD0 && marker <= 0xD8) continue;
      if (position + 2 > bytes.length) break;
      const length = view.getUint16(position);
      if (length < 2 || position + length > bytes.length) break;
      if (marker >= 0xC0 && marker <= 0xCF && ![0xC4,0xC8,0xCC].includes(marker) && length >= 8) {
        checkImageDimensions(view.getUint16(position+5), view.getUint16(position+3));
        const components = bytes[position+7];
        if (!components || length < 8 + 3 * components) break;
        hasFrame = true;
      }
      if (marker === 0xDA) {
        const components = bytes[position+2];
        if (hasFrame && components > 0 && length >= 6 + 2 * components && position + length < bytes.length - 2) return 'image/jpeg';
        break;
      }
      position += length;
    }
  }
  if (bytes.length >= 20 && text(0,4) === 'RIFF' && text(8,12) === 'WEBP' && view.getUint32(4,true) === bytes.length - 8) {
    let actualFrame = false;
    for (let position = 12; position + 8 <= bytes.length;) {
      const kind = text(position,position+4), length = view.getUint32(position+4,true), start = position+8;
      if (start+length > bytes.length) break;
      if (kind === 'VP8X' && length === 10) {
        if (bytes[start] & 2) throw new ContactError(415, '静止画のJPEG・PNG・WebPを選択してください。');
        const dimension = offset => 1 + bytes[offset] + (bytes[offset+1]<<8) + (bytes[offset+2]<<16);
        checkImageDimensions(dimension(start+4),dimension(start+7));
      } else if (kind === 'VP8 ' && length >= 10 && !(bytes[start]&1) && text(start+3,start+6) === '\x9d\x01\x2a') {
        checkImageDimensions(view.getUint16(start+6,true)&0x3fff,view.getUint16(start+8,true)&0x3fff);actualFrame=true;
      } else if (kind === 'VP8L' && length >= 5 && bytes[start] === 0x2f) {
        const dimensions = view.getUint32(start+1,true);
        checkImageDimensions((dimensions&0x3fff)+1,((dimensions>>>14)&0x3fff)+1);actualFrame=true;
      }
      position = start+length+(length%2);
    }
    if (actualFrame) return 'image/webp';
  }
  throw new ContactError(415, 'JPEG・PNG・WebP画像を選択してください。');
}
async function readBody(request) {
  try {
    const multipart = /^multipart\/form-data(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '');
    const bytes = await readBytes(request, multipart ? MAX_UPLOAD : MAX_BODY);
    if (!multipart) return { data: parseData(bytes), attachments: [] };
    const form = await new Response(bytes, { headers: { 'Content-Type': request.headers.get('Content-Type') } }).formData();
    const entries = [...form.entries()];
    const files = form.getAll('image');
    if (form.getAll('data').length !== 1 || !files.length || files.length > MAX_IMAGES || entries.some(([key]) => !['data','image'].includes(key))) throw new ContactError(400, '画像は1メッセージにつき5枚まで添付してください。');
    const field = form.get('data');
    if (typeof field !== 'string' || files.some(file => !file || typeof file === 'string')) throw new ContactError(400, '送信内容を確認してください。');
    const data = parseData(new TextEncoder().encode(field));
    const attachments = [];
    // Validate the whole selection before any file reaches object storage.
    for (const file of files) {
      if (!file.size || file.size > MAX_IMAGE) throw new ContactError(413, '画像は1枚2MB以内にしてください。');
      let image = new Uint8Array(await file.arrayBuffer());const original = image, type = imageType(image);
      try { image = type === 'image/png' ? await validateAndStripPNG(image) : type === 'image/jpeg' ? stripJPEGMetadata(image) : stripWebPMetadata(image); }
      catch { throw new ContactError(415, '画像を検証できません。別の画像を選択してください。'); }
      attachments.push({ bytes: image, type, size: image.length, hash: await digest(image), ...(original !== image ? { originalSize: original.length, originalHash: await digest(original) } : {}) });
    }
    return { data, attachments };
  } catch (error) { if (error instanceof ContactError) throw error; throw new ContactError(400, '送信内容を確認してください。'); }
}
function validID(value) { if (typeof value !== 'string' || !UUID.test(value)) throw new ContactError(400, '問い合わせ番号を確認してください。'); return value.toLowerCase(); }
function contentText(value, allowEmpty = false) {
  if (typeof value !== 'string') throw new ContactError(400, '内容を入力してください。');
  const clean = value.replace(/\r\n?/g, '\n').trim();
  if ((!clean && !allowEmpty) || [...clean].length > 1500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(clean)) throw new ContactError(400, '内容は1,500文字以内で入力し、内容または画像を添付してください。');
  return clean;
}
function publicThread(row) { return { id: row.id, subject: row.subject, createdAt: row.created_at, updatedAt: row.updated_at, lastAuthor: row.last_author }; }
function storedAttachments(row) {
  if (row.attachments_json) return JSON.parse(row.attachments_json);
  return row.attachment_key ? [{ key: row.attachment_key, type: row.attachment_type, size: row.attachment_size, hash: row.attachment_hash }] : [];
}
function publicMessage(row, admin) {
  const attachments = storedAttachments(row).map((image, index) => ({ url: `/api/${admin ? 'admin/' : ''}contact/attachments/${row.id}${index ? '?image=' + (index + 1) : ''}`, type: image.type, size: image.size }));
  return { id: row.id, author: row.author, content: row.content, createdAt: row.created_at, attachment: attachments[0] || null, attachments };
}
const threadSelect = `SELECT t.*, (SELECT author FROM contact_messages m WHERE m.thread_id=t.id ORDER BY m.rowid DESC LIMIT 1) AS last_author FROM contact_threads t`;

export async function readContactInbox(db, { visitorHash = null, threadId = null, before = null, page = 1 } = {}) {
  // A null visitorHash is allowed only after the owner authorization at the API/page boundary.
  const predicate = visitorHash ? ' WHERE t.visitor_hash=?' : '';
  const args = visitorHash ? [visitorHash] : [];
  const list = await db.prepare(threadSelect + predicate + ' ORDER BY t.updated_at DESC,t.id DESC LIMIT 31 OFFSET ?').bind(...args, (page - 1) * 30).all();
  const rows = list.results.slice(0, 30);
  const count = await db.prepare('SELECT COUNT(*) AS total FROM contact_threads' + (visitorHash ? ' WHERE visitor_hash=?' : '')).bind(...args).first();
  const selected = threadId || rows[0]?.id;
  let thread = null, messages = [], nextBefore = null;
  if (selected) {
    validID(selected);
    const found = await db.prepare(threadSelect + ' WHERE t.id=?' + (visitorHash ? ' AND t.visitor_hash=?' : '')).bind(selected, ...args).first();
    if (!found) throw new ContactError(404, 'この問い合わせは確認できません。');
    thread = publicThread(found);
    let cursor = null;
    if (before) { cursor = await db.prepare('SELECT rowid AS position FROM contact_messages WHERE id=? AND thread_id=?').bind(validID(before), selected).first(); if (!cursor) throw new ContactError(400, '前のメッセージを確認できません。'); }
    const history = await db.prepare('SELECT * FROM contact_messages WHERE thread_id=?' + (cursor ? ' AND rowid<?' : '') + ' ORDER BY rowid DESC LIMIT 51').bind(selected, ...(cursor ? [cursor.position] : [])).all();
    const items = history.results.slice(0, 50);
    nextBefore = history.results.length > 50 ? items.at(-1).id : null;
    messages = items.reverse().map(row => publicMessage(row, !visitorHash));
  }
  return { threads: rows.map(publicThread), thread, messages, nextBefore, page, total: count.total, hasNext: list.results.length > 30 };
}

async function saveMessage(env, data, visitorHash, admin, attachments, request) {
  const db = env.DB;
  if (Object.keys(data).some(key => !(admin ? ['requestId', 'threadId', 'content'] : ['requestId', 'threadId', 'subject', 'content']).includes(key))) throw new ContactError(400, '送信内容を確認してください。');
  const id = validID(data.requestId), content = contentText(data.content, !!attachments.length);
  const threadId = data.threadId ? validID(data.threadId) : id;
  if (admin && !data.threadId) throw new ContactError(400, '返信先を選択してください。');
  if (!admin && !SUBJECTS.includes(data.subject)) throw new ContactError(400, 'お問い合わせの種類を選択してください。');
  if (!admin) await assertContactSession(db, visitorHash);
  const author = admin ? 'owner' : 'visitor';
  const existing = await db.prepare('SELECT m.*,t.visitor_hash,t.subject FROM contact_messages m JOIN contact_threads t ON t.id=m.thread_id WHERE m.id=?').bind(id).first();
  if (existing) {
    if ((admin || existing.visitor_hash === visitorHash) && existing.author === author && existing.thread_id === threadId && existing.content === content && sameAttachments(existing, attachments) && (admin || existing.subject === data.subject)) {
      if (!admin) await assertContactSession(db, visitorHash);
      return { ok: true, threadId, id };
    }
    throw new ContactError(409, '送信番号が重複しています。内容を確認して再送してください。');
  }
  if (data.threadId || admin) {
    const thread = await db.prepare('SELECT subject FROM contact_threads WHERE id=?' + (admin ? '' : ' AND visitor_hash=?')).bind(threadId, ...(admin ? [] : [visitorHash])).first();
    if (!thread) throw new ContactError(404, 'この問い合わせには送信できません。');
    if (!admin && thread.subject !== data.subject) throw new ContactError(400, 'お問い合わせの種類を確認してください。');
  }
  const now = Date.now(), cutoff = now - 3600000;
  if (!admin && !data.threadId) await enforceRequestQuota(request, env, 'contactNew');
  const uploaded = [];
  if (attachments.length) {
    if (!env.BUCKET) throw new ContactError(503, '画像を保存できません。選択内容を残して再度お試しください。');
    if (!admin) {
      const limits = await db.prepare(`SELECT
        (SELECT COUNT(*) FROM contact_threads WHERE visitor_hash=? AND created_at>?) AS threads,
        (SELECT COUNT(*) FROM contact_messages m JOIN contact_threads t ON t.id=m.thread_id WHERE t.visitor_hash=? AND m.author='visitor' AND m.created_at>?) AS messages`).bind(visitorHash, cutoff, visitorHash, cutoff).first();
      if ((!data.threadId && limits.threads >= 5) || limits.messages >= 20) throw new ContactError(429, '短時間の送信上限に達しました。時間をおいて送信してください。');
    }
    try {
      for (const attachment of attachments) {
        if (!admin) await assertContactSession(db, visitorHash);
        const key = `contact-images/${crypto.randomUUID()}`;
        uploaded.push({ key, type: attachment.type, size: attachment.size, hash: attachment.hash });
        await env.BUCKET.put(key, attachment.bytes, { httpMetadata: { contentType: attachment.type, cacheControl: 'private, no-store' }, sha256: attachment.hash });
      }
      if (!admin) await assertContactSession(db, visitorHash);
    } catch (error) {
      // No database operation has started; only this attempt's objects can exist.
      for (const image of uploaded) { try { await env.BUCKET.delete(image.key); } catch { console.error('Unreferenced contact image cleanup unavailable'); } }
      throw error;
    }
  }
  const first = uploaded[0], manifest = uploaded.length ? JSON.stringify(uploaded) : null;
  const commitNow = Date.now();
  // Use database execution time too: a queued batch may run after the request's
  // earlier JS timestamp has expired. strftime works in both D1 and local SQLite.
  const sessionGuard = " AND EXISTS (SELECT 1 FROM contact_sessions s WHERE s.visitor_hash=? AND s.revoked_at IS NULL AND s.expires_at>MAX(?,CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER)))";
  const statements = [];
  if (!data.threadId && !admin) statements.push(db.prepare(`INSERT OR IGNORE INTO contact_threads (id,visitor_hash,subject,created_at,updated_at)
    SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM contact_threads WHERE visitor_hash=? AND created_at>?)<5
    AND NOT EXISTS (SELECT 1 FROM contact_messages WHERE id=?)
    AND (SELECT COUNT(*) FROM contact_messages m JOIN contact_threads t ON t.id=m.thread_id WHERE t.visitor_hash=? AND m.author='visitor' AND m.created_at>?)<20` + sessionGuard).bind(threadId, visitorHash, data.subject, now, now, visitorHash, cutoff, id, visitorHash, cutoff, visitorHash, commitNow));
  statements.push(db.prepare(`INSERT OR IGNORE INTO contact_messages (id,thread_id,author,content,created_at,attachment_key,attachment_type,attachment_size,attachment_hash,attachments_json)
    SELECT ?,?,?,?,?,?,?,?,?,? FROM contact_threads t WHERE t.id=?${admin ? '' : ` AND t.visitor_hash=? AND t.subject=?
    AND (SELECT COUNT(*) FROM contact_messages m JOIN contact_threads own ON own.id=m.thread_id WHERE own.visitor_hash=? AND m.author='visitor' AND m.created_at>?)<20` + sessionGuard}`).bind(id, threadId, author, content, now, first?.key || null, first?.type || null, first?.size || null, first?.hash || null, manifest, threadId, ...(admin ? [] : [visitorHash, data.subject, visitorHash, cutoff, visitorHash, commitNow])));
  // Only the message inserted by this operation can advance the conversation.
  statements.push(db.prepare('UPDATE contact_threads SET updated_at=MAX(updated_at,?) WHERE id=?' + (admin ? '' : ' AND visitor_hash=? AND subject=?' + sessionGuard) + ' AND EXISTS (SELECT 1 FROM contact_messages WHERE id=? AND thread_id=? AND author=? AND content=? AND attachment_hash IS ? AND attachments_json IS ?)').bind(now, threadId, ...(admin ? [] : [visitorHash, data.subject, visitorHash, commitNow]), id, threadId, author, content, first?.hash || null, manifest));
  // An uncertain database outcome must not delete an image that may have committed.
  let batchError = null;
  try { await db.batch(statements); } catch (error) { batchError = error; }
  const saved = await db.prepare('SELECT m.*,t.visitor_hash,t.subject FROM contact_messages m JOIN contact_threads t ON t.id=m.thread_id WHERE m.id=?').bind(id).first();
  if (uploaded.length && (!batchError || saved)) {
    const retained = new Set(saved ? storedAttachments(saved).map(image => image.key) : []);
    for (const image of uploaded) if (!retained.has(image.key)) {
      try { await env.BUCKET.delete(image.key); } catch { console.error('Unreferenced contact image cleanup unavailable'); }
    }
  }
  if (!admin) await assertContactSession(db, visitorHash);
  if (saved && (admin || saved.visitor_hash === visitorHash) && saved.thread_id === threadId && saved.author === author && saved.content === content && sameAttachments(saved, attachments) && (admin || saved.subject === data.subject)) return { ok: true, threadId, id };
  if (batchError) throw batchError;
  if (saved) throw new ContactError(409, '送信番号が重複しています。内容を確認して再送してください。');
  throw new ContactError(429, '短時間の送信上限に達しました。時間をおいて送信してください。');
}

function sameAttachments(row, attachments) {
  const saved = storedAttachments(row);
  return saved.length === attachments.length && saved.every((image, index) => {
    const selected = attachments[index];
    // A retry of an image saved before metadata scrubbing must remain idempotent.
    return image.type === selected.type && (image.hash === selected.hash && image.size === selected.size || image.hash === selected.originalHash && image.size === selected.originalSize);
  });
}

export async function contactAttachmentApi(request, env, admin = false) {
  try {
    if (!['GET','HEAD'].includes(request.method)) return reply({ error: 'この操作は利用できません。' }, 405);
    if (admin && !owner(request, env)) throw new ContactError(403, '管理者のログインが必要です。');
    if (request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new ContactError(403, 'このツールから開いてください。');
    if (!env.DB || !env.BUCKET) throw new ContactError(503, '画像を読み込めません。時間をおいて再度お試しください。');
    const url = new URL(request.url), id = validID(url.pathname.split('/').at(-1));
    const indices = url.searchParams.getAll('image');
    if (indices.length > 1 || indices.length && !/^[1-5]$/.test(indices[0]) || [...url.searchParams.keys()].some(key => key !== 'image')) throw new ContactError(400, '画像番号を確認してください。');
    const index = indices.length ? Number(indices[0]) - 1 : 0;
    const token = admin ? null : sessionToken(request);
    if (!admin && !token) throw new ContactError(401, 'お問い合わせを送信したブラウザで開いてください。');
    let hash;
    if (!admin) { await enforceRequestQuota(request, env, 'contactRead'); ({hash} = await visitorSession(request, env)); }
    const row = await env.DB.prepare('SELECT m.* FROM contact_messages m JOIN contact_threads t ON t.id=m.thread_id WHERE m.id=?' + (admin ? '' : ' AND t.visitor_hash=?')).bind(id, ...(admin ? [] : [hash])).first();
    const attachment = row && storedAttachments(row)[index];
    if (!attachment?.key) throw new ContactError(404, 'この画像は確認できません。');
    if (!admin) await assertContactSession(env.DB, hash);
    const object = await env.BUCKET.get(attachment.key);
    if (!object) throw new ContactError(503, '画像を読み込めません。時間をおいて再度お試しください。');
    const extension = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp' }[attachment.type];
    if (!extension || object.size !== attachment.size) throw new ContactError(503, '画像を確認できません。');
    if (!admin) await assertContactSession(env.DB, hash);
    return new Response(request.method === 'HEAD' ? null : object.body, { headers: {
      'Content-Type': attachment.type, 'Content-Length': String(attachment.size),
      'Content-Disposition': `inline; filename="contact-image.${extension}"`,
      'Cache-Control':'private, no-store', 'Vary':'Cookie, oai-authenticated-user-id, oai-authenticated-user-email',
      'X-Content-Type-Options':'nosniff', 'X-Robots-Tag':'noindex, nofollow',
      'Referrer-Policy':'no-referrer', 'Cross-Origin-Resource-Policy':'same-origin',
      'Content-Security-Policy': "default-src 'none'; sandbox; frame-ancestors 'none'"
    }});
  } catch (error) {
    if (error instanceof ContactSessionError) return reply({error:error.message}, error.status, CLEAR_COOKIE);
    if (error instanceof ContactError) return reply({error:error.message}, error.status);
    if (error instanceof RequestLimitError) return reply({error:error.status === 429 ? '短時間の利用上限に達しました。時間をおいて再度お試しください。' : '安全確認を利用できません。時間をおいて再度お試しください。'}, error.status);
    console.error('Contact image unavailable');
    return reply({error:'画像を読み込めません。時間をおいて再度お試しください。'},503);
  }
}

export async function contactApi(request, env, admin = false) {
  try {
    if (!['GET', 'POST'].includes(request.method)) return reply({ error: 'この操作は利用できません。' }, 405);
    if (admin && !owner(request, env)) return reply({ error: '管理者のログインが必要です。' }, 403);
    if (request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new ContactError(403, 'このツールから開いてください。');
    if (!env.DB) throw new ContactError(503, 'メッセージ窓口を利用できません。時間をおいて再度お試しください。');
    let hash = null, cookie;
    if (request.method === 'GET') {
      const url = new URL(request.url), pageValue = url.searchParams.get('page') || '1';
      if (!/^[1-9]\d{0,5}$/.test(pageValue)) throw new ContactError(400, 'ページ番号を確認してください。');
      const threadId = url.searchParams.get('thread'), before = url.searchParams.get('before');
      if (threadId) validID(threadId);
      if (!admin) { await enforceRequestQuota(request, env, 'contactRead'); ({hash,cookie} = await visitorSession(request, env, true)); }
      const inbox = await readContactInbox(env.DB, { visitorHash: hash, threadId, before, page: Number(pageValue) });
      if (!admin) await assertContactSession(env.DB, hash);
      return reply(inbox, 200, cookie);
    }
    requireSameOrigin(request, admin);
    if (!admin) {
      if (!sessionToken(request)) throw new ContactError(401, 'このブラウザでCookieを有効にして、もう一度お問い合わせを開いてください。');
      await enforceRequestQuota(request, env, 'contactWrite');
      if (/^multipart\/form-data(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) await enforceRequestQuota(request, env, 'contactUpload');
      ({hash} = await visitorSession(request, env));
    }
    const { data, attachments } = await readBody(request);
    return reply(await saveMessage(env, data, hash, admin, attachments, request));
  } catch (error) {
    if (error instanceof ContactSessionError) return reply({ error: error.message }, error.status, CLEAR_COOKIE);
    if (error instanceof ContactError) return reply({ error: error.message }, error.status);
    if (error instanceof RequestLimitError) return reply({ error: error.status === 429 ? '短時間の利用上限に達しました。時間をおいて再度お試しください。' : '安全確認を利用できません。時間をおいて再度お試しください。' }, error.status);
    console.error('Contact storage unavailable');
    return reply({ error: '保存または読み込みを確認できませんでした。入力内容を残して再度お試しください。' }, 503);
  }
}

export async function contactSessionApi(request, env) {
  try {
    if (request.method !== 'POST') return reply({error:'この操作は利用できません。'},405);
    if (!owner(request, env)) throw new ContactError(403,'管理者のログインが必要です。');
    requireSameOrigin(request, true);
    if (!env.DB) throw new ContactError(503,'アクセス停止を確認できません。時間をおいて再度お試しください。');
    let data;
    try { data = parseData(await readLimitedBytes(request, MAX_BODY, 30000)); }
    catch (error) { if (error instanceof RequestLimitError) throw error; throw new ContactError(400,'停止する問い合わせを選択してください。'); }
    if (Object.keys(data).length !== 1 || !Object.hasOwn(data,'threadId')) throw new ContactError(400,'停止する問い合わせを選択してください。');
    const threadId = validID(data.threadId);
    if (!await revokeContactSession(env.DB, threadId)) throw new ContactError(404,'この問い合わせは確認できません。');
    return reply({ok:true,threadId,revoked:true});
  } catch (error) {
    if (error instanceof ContactError) return reply({error:error.message},error.status);
    if (error instanceof RequestLimitError) return reply({error:error.status===408?'送信が時間切れになりました。再度お試しください。':'送信内容が大きすぎます。'},error.status);
    console.error('Contact session revocation unavailable');
    return reply({error:'アクセス停止を確認できません。時間をおいて再度お試しください。'},503);
  }
}
