import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, pageEngine, plain } from './calculator-harness.mjs';
const KEY = 'pococha-meter-calc-v1';
function page(phone = true) {
  const media = new Map();
  const matchMedia = query => {
    if (!media.has(query)) {
      const listeners = [];
      media.set(query, { matches: query === '(max-width:700px)' && phone, addEventListener: (_, fn) => listeners.push(fn), change(value) { this.matches = value; listeners.forEach(fn => fn({ matches: value })); } });
    }
    return media.get(query);
  };
  const state = { ...plain(engine().state), pick: '', target: '2000', current: '500', rank: 'S2', coreCount: '0', seedVer: 3, seedVer13: 1, snapshotVersion: '2026-10-02-v3', goalDefaultsVersion: 1, provenance: {},
    log: { '2025-01-01': { S2: [1,2,3] }, '2026-09-01': { S2: [100,200,300] }, '2026-09-02': { S2: [101,201,301] }, '2026-10-01': { S2: [10,20,30] }, '2026-10-02': { S2: [11,22,33], S6: [111,222,333] } }, log13: {}, log24: {} };
  const p = pageEngine(state, { navigator: { onLine: false }, matchMedia });
  return { p, media, groups: () => p.element('logList').children, rows: group => group.querySelector('.saved-record-month-rows').children };
}
function change(p, id, value, type = 'change') { p.element(id).value = value; p.element(id).dispatchEvent(new Event(type)); }
function toggle(group, open) { group.open = open; group.dispatchEvent(new Event('toggle')); }
test('phone starts with month headings only, newest first, without rendering every daily row', () => {
  const { p, groups, rows } = page();
  assert.equal(p.element('recordMobileFilters').hidden, false);
  assert.deepEqual(groups().map(g => g.dataset.month), ['2026-10','2026-09','2025-01']);
  groups().forEach(group => { assert.ok(!group.open); assert.equal(rows(group).length, 0); });
});
test('opening a month loads only its days and closes the other month', () => {
  const { groups, rows } = page(); const [oct, sep] = groups();
  toggle(oct, true); assert.equal(rows(oct).length, 2); assert.equal(rows(sep).length, 0);
  const first = rows(oct)[0]; toggle(oct, true); assert.equal(rows(oct)[0], first);
  toggle(sep, true); assert.equal(oct.open, false); assert.equal(rows(sep).length, 2);
  sep.querySelector('.saved-record-month-close').click(); assert.equal(sep.open, false);
});
test('month and exact-day searches open their matching month without changing stored data', () => {
  const { p, groups, rows } = page(); const before = p.stored.get(KEY);
  change(p, 'recordMonthFilter', '2026-09'); assert.equal(groups().length, 1); assert.equal(groups()[0].open, true); assert.equal(rows(groups()[0]).length, 2);
  change(p, 'recordDayFilter', '2026-10-02'); assert.equal(p.element('recordMonthFilter').value, '2026-10'); assert.equal(rows(groups()[0]).length, 1);
  assert.equal(rows(groups()[0])[0].children[0].textContent, '2026/10/02');
  change(p, 'recordDayFilter', '2026-10-03'); assert.equal(groups()[0].className, 'empty'); assert.match(groups()[0].textContent, /一致する記録がありません/);
  assert.equal(p.stored.get(KEY), before);
});
test('clear collapses all months; clock updates never reopen them or rebuild unchanged rows', () => {
  const { p, groups } = page(); change(p, 'recordMonthFilter', '2026-10');
  p.element('recordClearFilters').click(); assert.equal(groups().length, 3); groups().forEach(group => assert.ok(!group.open));
  const first = groups()[0]; p.tick(1000); p.tick(1000); assert.equal(groups()[0], first); assert.ok(!first.open);
});
test('rank searches across months stay compact and retain existing day/rank matching', () => {
  const { p, groups, rows } = page(); change(p, 'recordSearch', 'S2', 'input');
  assert.equal(groups().length, 3); groups().forEach(group => assert.ok(!group.open));
  change(p, 'recordSearch', 'S6', 'input'); assert.equal(groups().length, 1); assert.ok(groups()[0].open); assert.equal(rows(groups()[0]).length, 1);
});
test('desktop keeps the original flat list and viewport changes rebuild the appropriate view', () => {
  const { p, groups, media } = page(false); assert.equal(p.element('recordMobileFilters').hidden, true); assert.equal(groups().length, 5); groups().forEach(row => assert.equal(row.className, 'row'));
  media.get('(max-width:700px)').change(true); assert.equal(groups().length, 3); assert.equal(p.element('recordMobileFilters').hidden, false);
  change(p, 'recordMonthFilter', '2026-10'); assert.equal(groups().length, 1);
  media.get('(max-width:700px)').change(false); assert.equal(groups().length, 5);
});
test('view/edit buttons still select the exact saved day inside a month', () => {
  const { p, groups, rows } = page(); change(p, 'recordDayFilter', '2026-10-02');
  const row = rows(groups()[0])[0]; row.children.find(node => node.textContent === '一覧').click(); assert.equal(p.element('dailyDate').value, '2026-10-02');
  row.children.find(node => node.textContent === '編集').click(); assert.equal(p.element('editDate').value, '2026-10-02'); assert.equal(p.element('editZero').value, '11');
});
