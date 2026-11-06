import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { enforceRequestQuota, claimSignedWrite } from '../lib/security-limits.mjs';

const origin = 'https://meter.example';
const request = () => new Request(origin, { headers: { 'CF-Connecting-IP': '203.0.113.42' } });
function setup({ cleanupFailure = false, pauseCleanup } = {}) {
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE security_rate_windows (id TEXT PRIMARY KEY NOT NULL, expires_at INTEGER NOT NULL, hits INTEGER NOT NULL)');
  sql.exec("CREATE TABLE contact_messages (content TEXT); INSERT INTO contact_messages VALUES ('preserve')");
  const cleanups = [];
  const DB = { prepare(query) {
    let values = [];
    return {
      bind(...args) { values = args; return this; },
      async run() {
        if (query.startsWith('DELETE')) {
          cleanups.push({ query, values });
          if (pauseCleanup) await pauseCleanup();
          if (cleanupFailure) throw new Error('Injected maintenance failure');
        }
        return sql.prepare(query).run(...values);
      },
    };
  } };
  return { sql, env: { DB }, cleanups };
}

test('expired counters are removed without a minute-boundary request and live or grace-period records survive', async () => {
  const s = setup();
  try {
    const now = Date.parse('2026-10-17T03:01:17Z'), cutoff = Math.floor(now / 1000) - 3600;
    const insert = s.sql.prepare('INSERT INTO security_rate_windows VALUES (?,?,1)');
    insert.run('stale-counter', cutoff - 1);
    insert.run('signed:stale:signature', cutoff - 1);
    insert.run('grace-boundary', cutoff);
    insert.run('live-counter', Math.floor(now / 1000) + 60);
    insert.run('signed:current:signature', Math.floor(now / 1000) + 360);
    await enforceRequestQuota(request(), s.env, 'contactNew', now);
    const ids = new Set(s.sql.prepare('SELECT id FROM security_rate_windows').all().map(row => row.id));
    assert.ok(!ids.has('stale-counter')); assert.ok(!ids.has('signed:stale:signature'));
    for (const id of ['grace-boundary', 'live-counter', 'signed:current:signature']) assert.ok(ids.has(id));
    assert.equal(s.sql.prepare('SELECT content FROM contact_messages').get().content, 'preserve');
    assert.equal(s.cleanups.length, 1);
    await enforceRequestQuota(request(), s.env, 'contactNew', now + 59999);
    assert.equal(s.cleanups.length, 1);
    await enforceRequestQuota(request(), s.env, 'contactNew', now + 60000);
    assert.equal(s.cleanups.length, 2);
  } finally { s.sql.close(); }
});

test('concurrent callers share the cleanup throttle and another DB has its own schedule', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = setup({ pauseCleanup: () => gate }), second = setup();
  const now = Date.parse('2026-10-17T03:02:19Z');
  try {
    const pending = enforceRequestQuota(request(), first.env, 'borderRead', now);
    await new Promise(resolve => setImmediate(resolve));
    await Promise.all(Array.from({ length: 6 }, (_, i) => enforceRequestQuota(request(), first.env, 'borderRead', now + i * 60000)));
    assert.equal(first.cleanups.length, 1);
    await enforceRequestQuota(request(), second.env, 'borderRead', now);
    assert.equal(second.cleanups.length, 1);
    release(); await pending;
    await enforceRequestQuota(request(), first.env, 'borderRead', now + 360000);
    assert.equal(first.cleanups.length, 2);
  } finally { release(); first.sql.close(); second.sql.close(); }
});

test('cleanup failure is throttled while real quota limits are still enforced', async () => {
  const s = setup({ cleanupFailure: true }), now = Date.parse('2026-10-17T03:03:23Z');
  try {
    for (let i = 0; i < 10; i++) await enforceRequestQuota(request(), s.env, 'contactNew', now);
    await assert.rejects(enforceRequestQuota(request(), s.env, 'contactNew', now), error => error.status === 429);
    assert.equal(s.cleanups.length, 1);
    await assert.rejects(enforceRequestQuota(request(), s.env, 'contactNew', now + 60000), error => error.status === 429);
    assert.equal(s.cleanups.length, 2);
  } finally { s.sql.close(); }
});

test('signed writes alone also run maintenance, preserve replay records and tolerate cleanup failure', async () => {
  for (const cleanupFailure of [false, true]) {
    const s = setup({ cleanupFailure });
    try {
      s.sql.prepare('INSERT INTO security_rate_windows VALUES (?,?,1)').run('old-counter', 1);
      const stamp = String(Math.floor(Date.now() / 1000));
      const signed = new Request(origin + '/api/borders/refresh', { headers: { 'X-Border-Writer-Time': stamp, 'X-Border-Writer-Signature': 'ab'.repeat(32) } });
      await claimSignedWrite(signed, s.env);
      await assert.rejects(claimSignedWrite(signed, s.env), error => error.status === 409);
      assert.equal(s.cleanups.length, 1);
      assert.equal(Boolean(s.sql.prepare('SELECT id FROM security_rate_windows WHERE id=?').get('old-counter')), cleanupFailure);
      assert.ok(s.sql.prepare("SELECT id FROM security_rate_windows WHERE id LIKE 'signed:%'").get());
    } finally { s.sql.close(); }
  }
});
