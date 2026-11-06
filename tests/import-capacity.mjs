import test from 'node:test';
import assert from 'node:assert/strict';
import {engine, permitRefresh, plain} from './calculator-harness.mjs';

const date = index => new Date(Date.UTC(2000, 0, 1) + index * 864e5).toISOString().slice(0, 10);
const log = count => Object.fromEntries(Array.from({length: count}, (_, i) => [date(i), {S2: [10, 20, 30]}]));
const row = (index, close = '22', rank = 'S2', vals = [100, 200, 300]) => ({date: date(index), close, rank, vals});
const csv = rows => rows.map(x => [x.date, x.rank, ...x.vals, x.close].join(',')).join('\n');
function importRows(e, rows) {
  e.element('paste').value = csv(rows);
  e.element('logDate').value = date(0);
  e.element('importBtn').onclick();
}
function observedEngine() {
  const e = engine(); permitRefresh(e);
  e.state.log13 = {}; e.state.log24 = {};
  const calls = {save: 0, update: 0, discard: 0};
  e.save = () => { calls.save++; return true; };
  e.update = () => { calls.update++; };
  e.discardEditorDrafts = () => { calls.discard++; };
  return {e, calls};
}

test('F09 repeated small CSV imports cannot grow a cutoff beyond 5000 days', () => {
  const {e, calls} = observedEngine(); e.state.log = log(4999);
  importRows(e, [row(4999)]);
  assert.equal(e.element('importMsg').className, 'toast');
  assert.equal(Object.keys(e.state.log).length, 5000);
  const before = JSON.stringify(e.state), revision = e.dataRevision, previousCalls = {...calls};
  importRows(e, [row(0), row(5000)]);
  assert.equal(e.element('importMsg').className, 'toast err');
  assert.match(e.element('importMsg').textContent, /22時締め.*5000日/);
  assert.equal(JSON.stringify(e.state), before, 'A later overflow must not overwrite an earlier row');
  assert.equal(e.dataRevision, revision);
  assert.deepEqual(calls, previousCalls, 'Reject before storage, rendering or draft removal');
  assert.equal(e.element('paste').value, csv([row(0), row(5000)]));
});

test('F09 one overflow in a mixed-cutoff import rejects the whole batch atomically', () => {
  const {e, calls} = observedEngine(); e.state.log24 = log(5000);
  e.editorDrafts = {['13|S2|' + date(0)]: ['1', '2', '3']};
  const before = JSON.stringify(e.state), drafts = JSON.stringify(e.editorDrafts);
  importRows(e, [row(0, '13'), row(0, '22'), row(5000, '24')]);
  assert.match(e.element('importMsg').textContent, /24時締め.*5000日/);
  assert.equal(JSON.stringify(e.state), before);
  assert.equal(JSON.stringify(e.editorDrafts), drafts);
  assert.deepEqual(calls, {save: 0, update: 0, discard: 0});
});

test('F09 capacity counts unique dates separately for each cutoff, including multiple ranks', () => {
  const {e} = observedEngine(); e.state.log = log(4999); e.state.log13 = log(4999); e.state.log24 = log(4999);
  const rows = ['13', '22', '24'].flatMap(close => [row(4999, close), row(4999, close, 'S1'), row(4999, close)]);
  importRows(e, rows);
  assert.equal(e.element('importMsg').className, 'toast');
  for (const key of ['log', 'log13', 'log24']) {
    assert.equal(Object.keys(e.state[key]).length, 5000);
    assert.deepEqual(plain(e.state[key][date(4999)]), {S2: [100, 200, 300], S1: [100, 200, 300]});
  }
});

test('F09 CSV and ordinary pasted borders enforce the same cumulative limit', () => {
  const {e, calls} = observedEngine(); e.state.log = log(5000);
  const before = JSON.stringify(e.state);
  e.element('paste').value = 'S2 100 200 300'; e.element('logDate').value = date(5000);
  e.element('importBtn').onclick();
  assert.match(e.element('importMsg').textContent, /5000日/);
  assert.equal(JSON.stringify(e.state), before);
  assert.deepEqual(calls, {save: 0, update: 0, discard: 0});
});

test('F09 preview rejects overflow and commit rechecks capacity after a successful preview', () => {
  const {e, calls} = observedEngine(); e.state.log = log(4999);
  const rows = e.parseImports(csv([row(5000)]), date(0));
  assert.match(e.previewRows(rows), /1件/);
  e.state.log[date(4999)] = {S2: [10, 20, 30]};
  const before = JSON.stringify(e.state);
  assert.throws(() => e.previewRows(rows), /5000日/);
  assert.throws(() => e.commitRows(rows), /5000日/);
  assert.equal(JSON.stringify(e.state), before);
  assert.deepEqual(calls, {save: 0, update: 0, discard: 0});
});

test('F09 legacy oversized logs are retained and may update existing dates without further growth', () => {
  const {e, calls} = observedEngine(); e.state.log = log(5001);
  importRows(e, [row(5000), row(5000, '22', 'S1')]);
  assert.equal(e.element('importMsg').className, 'toast');
  assert.equal(Object.keys(e.state.log).length, 5001);
  assert.deepEqual(plain(e.state.log[date(0)].S2), [10, 20, 30]);
  assert.deepEqual(plain(e.state.log[date(5000)]), {S2: [100, 200, 300], S1: [100, 200, 300]});
  const before = JSON.stringify(e.state), previousCalls = {...calls};
  importRows(e, [row(5001)]);
  assert.match(e.element('importMsg').textContent, /保存済みの記録は保持/);
  assert.equal(JSON.stringify(e.state), before);
  assert.deepEqual(calls, previousCalls);
});

test('F09 an oversized legacy cutoff does not prevent another cutoff from using its own capacity', () => {
  const {e} = observedEngine(); e.state.log = log(5001);
  const original = JSON.stringify(e.state.log);
  importRows(e, [row(0, '13')]);
  assert.equal(e.element('importMsg').className, 'toast');
  assert.equal(JSON.stringify(e.state.log), original);
  assert.deepEqual(plain(e.state.log13[date(0)].S2), [100, 200, 300]);
});

test('F09 existing JSON backup merge limits still reject growth without installing settings or records', () => {
  const {e, calls} = observedEngine(); e.state.log = log(5000);
  const before = JSON.stringify(e.state);
  e.element('paste').value = JSON.stringify({pmcBackup: 1, log: {[date(5000)]: {S2: [100, 200, 300]}}, settings: {...plain(e.state), current: '999'}});
  e.element('importBtn').onclick();
  assert.equal(e.element('importMsg').className, 'toast err');
  assert.equal(JSON.stringify(e.state), before);
  assert.deepEqual(calls, {save: 0, update: 0, discard: 0});
});
