import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { contactApi } from '../lib/contact-store.mjs';
const origin = 'https://meter.example';
const adminHeaders = { 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'owner@example.test' };
function setup() {
  const sql = new DatabaseSync(':memory:'); for (const name of ['0003_large_blackheart','0004_dizzy_the_leader','0005_blushing_madrox','0007_contact_sessions']) sql.exec(readFileSync(new URL('../drizzle/'+name+'.sql', import.meta.url), 'utf8')); sql.exec('PRAGMA foreign_keys=ON');
  const DB = { prepare(query) { let values = []; return { bind(...args) { values = args; return this; }, async run() { return sql.prepare(query).run(...values); }, async all() { return { results: sql.prepare(query).all(...values) }; }, async first() { return sql.prepare(query).get(...values); } }; }, async batch(statements) { sql.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results; } catch (error) { sql.exec('ROLLBACK'); throw error; } } };
  const env = { DB, ANALYTICS_ADMIN_EMAIL: 'owner@example.test' };
  const get = (cookie = '', query = '', admin = false, headers = {}) => contactApi(new Request(origin + (admin ? '/api/admin/contact' : '/api/contact') + query, { headers: { Cookie: cookie, ...(admin ? adminHeaders : {}), ...headers } }), env, admin);
  const post = (cookie, data, admin = false, headers = {}) => contactApi(new Request(origin + (admin ? '/api/admin/contact' : '/api/contact'), { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', ...(admin ? adminHeaders : {}), ...headers }, body: JSON.stringify(data) }), env, admin);
  return { env, sql, get, post, async cookie() { return (await get()).headers.get('Set-Cookie').split(';')[0]; } };
}
const message = (content = 'お問い合わせ\n二行目', requestId = crypto.randomUUID()) => ({ requestId, subject: '不具合の報告', content });
test('private browser capability; thread and message ownership; only hash stored', async () => {
  const s = setup(), bootstrap = await s.get(), cookie = bootstrap.headers.get('Set-Cookie').split(';')[0];
  assert.match(bootstrap.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Strict/); assert.match(bootstrap.headers.get('cache-control'), /private, no-store/);
  const input = message(), saved = await s.post(cookie, input); assert.equal(saved.status, 200);
  const own = await (await s.get(cookie)).json(); assert.equal(own.messages[0].content, input.content); assert.equal(own.thread.id, input.requestId);
  const other = await s.cookie(); assert.equal((await (await s.get(other)).json()).total, 0);
  assert.equal((await s.get(other, '?thread=' + input.requestId)).status, 404);
  assert.equal((await s.post(other, { ...message('不正な返信'), threadId: input.requestId })).status, 404);
  assert.equal((await s.get(other, '?before=' + input.requestId)).status, 200, 'No thread data is exposed by a guessed cursor');
  const stored = JSON.stringify(s.sql.prepare('SELECT * FROM contact_threads').all()); assert.ok(!stored.includes(cookie.split('=')[1]));
  assert.equal((await s.post('', message())).status, 401);
});
test('owner-only reads/replies; email-only, id-only, outsiders and service credentials denied', async () => {
  const s = setup(), cookie = await s.cookie(), input = message('<img src=x onerror=alert(1)>'); await s.post(cookie, input);
  for (const headers of [{ 'oai-authenticated-user-id': '', 'oai-authenticated-user-email': '' }, { 'oai-authenticated-user-id': '' }, { 'oai-authenticated-user-email': '' }, { 'oai-authenticated-user-email': 'other@example.test' }, { 'oai-authenticated-user-id': '', 'oai-authenticated-user-email': '', 'OAI-Sites-Authorization': 'Bearer local-test-credential' }]) {
    const denied = await s.get('', '', true, headers); assert.equal(denied.status, 403); assert.ok(!(await denied.text()).includes('onerror'));
    assert.equal((await s.post('', { requestId: crypto.randomUUID(), threadId: input.requestId, content: '返信' }, true, headers)).status, 403);
  }
  const body = { requestId: crypto.randomUUID(), threadId: input.requestId, content: '確認しました。\nありがとうございます。' };
  assert.equal((await s.post('', body, true)).status, 200);
  assert.equal((await s.post('', body, true)).status, 200);
  const own = await (await s.get(cookie)).json(); assert.equal(own.messages.length, 2); assert.equal(own.messages[1].author, 'owner'); assert.equal(own.messages[1].content, body.content);
  assert.equal((await (await s.get('', '', true)).json()).threads[0].lastAuthor, 'owner');
});
test('retry dedup requires same owner, content, category and conversation', async () => {
  const s = setup(), cookie = await s.cookie(), input = message();
  await s.post(cookie, input); await s.post(cookie, input);
  assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM contact_messages').get().n, 1);
  assert.equal((await s.post(cookie, { ...input, content: '変更' })).status, 409);
  assert.equal((await s.post(cookie, { ...input, subject: 'その他' })).status, 409);
  assert.equal((await s.post(await s.cookie(), input)).status, 409);
  const second = message('新規'); await s.post(cookie, second);
  assert.equal((await s.post(cookie, { ...input, threadId: second.requestId })).status, 409);
  assert.equal((await s.post(cookie, { ...message('追加'), threadId: input.requestId })).status, 200);
  assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM contact_threads').get().n, 2);
});
test('origin, JSON, size, IDs, empty and extra-field boundaries reject before writes', async () => {
  const s = setup(), cookie = await s.cookie();
  for (const [headers, status] of [[{ Origin: 'https://other.example' }, 403], [{ Origin: '' }, 403], [{ 'Sec-Fetch-Site': 'cross-site' }, 403], [{ 'Content-Type': 'text/plain' }, 415]]) assert.equal((await s.post(cookie, message(), false, headers)).status, status);
  for (const data of [message(''), message('   '), message('x'.repeat(1501)), { ...message(), requestId: 'invalid' }, { ...message(), subject: 'invalid' }, { ...message(), ip: 'forged' }, message('\u0000')]) assert.equal((await s.post(cookie, data)).status, 400);
  assert.equal((await s.post(cookie, message('x'.repeat(9000)))).status, 413);
  assert.equal((await s.get(cookie, '?page=0')).status, 400);
  assert.equal((await s.get(cookie, '?thread=invalid')).status, 400);
  assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM contact_messages').get().n, 0);
});
test('bounded history and thread pagination retain all saved conversations', async () => {
  const s = setup(), cookie = await s.cookie(), input = message(); await s.post(cookie, input);
  const template = s.sql.prepare('SELECT * FROM contact_threads').get();
  for (let i = 0; i < 65; i++) s.sql.prepare('INSERT INTO contact_messages (id,thread_id,author,content,created_at) VALUES (?,?,?,?,?)').run(crypto.randomUUID(), input.requestId, 'owner', '履歴' + i, i);
  const recent = await (await s.get(cookie)).json(); assert.equal(recent.messages.length, 50); assert.ok(recent.nextBefore);
  const old = await (await s.get(cookie, '?thread=' + input.requestId + '&before=' + recent.nextBefore)).json(); assert.equal(old.messages.length, 16); assert.equal(old.nextBefore, null);
  assert.equal(new Set([...recent.messages, ...old.messages].map(row => row.id)).size, 66);
  for (let i = 0; i < 31; i++) s.sql.prepare('INSERT INTO contact_threads VALUES (?,?,?,?,?)').run(crypto.randomUUID(), template.visitor_hash, 'その他', i, i);
  const first = await (await s.get(cookie)).json(), next = await (await s.get(cookie, '?page=2')).json(); assert.equal(first.total, 32); assert.equal(first.threads.length, 30); assert.equal(next.threads.length, 2);
  assert.equal(new Set([...first.threads, ...next.threads].map(row => row.id)).size, 32);
  const stranger = await s.cookie(), foreign = message(); await s.post(stranger, foreign);
  assert.equal((await s.get(cookie, '?thread=' + input.requestId + '&before=' + foreign.requestId)).status, 400);
});
test('rate limits do not create empty threads and saved retries still succeed', async () => {
  const s = setup(), cookie = await s.cookie(), first = message(); await s.post(cookie, first);
  for (let i = 1; i < 5; i++) assert.equal((await s.post(cookie, message())).status, 200);
  assert.equal((await s.post(cookie, message())).status, 429);
  for (let i = 5; i < 20; i++) assert.equal((await s.post(cookie, { ...message('追加' + i), threadId: first.requestId })).status, 200);
  assert.equal((await s.post(cookie, { ...message('上限後'), threadId: first.requestId })).status, 429);
  assert.equal((await s.post(cookie, first)).status, 200);
  assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM contact_threads t WHERE NOT EXISTS (SELECT 1 FROM contact_messages m WHERE m.thread_id=t.id)').get().n, 0);
});
test('storage failures return recoverable errors without exposing content', async () => {
  const s = setup(), cookie = await s.cookie(); s.env.DB = { prepare() { throw new Error('Private sensitive content'); } };
  const response = await s.post(cookie, message('Private sensitive content')); assert.equal(response.status, 503); assert.ok(!(await response.text()).includes('Private sensitive content'));
});
