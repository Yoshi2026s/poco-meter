import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeHistoryQuery,filterHistory,createHistoryIndex} from '../calculator/history-core.mjs';
const rows=['2026-01-03','2026-02-03','2026-10-03','2026-11-03','2026-12-03'].map(date=>({date,rank:'S2',close:'22',values:[10,20,30],origin:'manual'})),index=createHistoryIndex(rows);
for(const query of ['2026/1','2026-1','2026年1月','２０２６／１','2026/01'])test('Month query selects January only: '+query,()=>{
 assert.equal(normalizeHistoryQuery(query),'2026-01');assert.deepEqual(filterHistory(index,{query}).rows.map(r=>r.date),['2026-01-03']);
});
for(const query of ['2026/10 S2 22時','2026年10月 S2 22時','2026-10 S2 22時'])test('Month query combines with rank and cutoff: '+query,()=>{assert.deepEqual(filterHistory(index,{query}).rows.map(r=>r.date),['2026-10-03']);});
for(const query of ['2026-1-3','2026/1/3','2026年1月3日'])test('Full date remains a single date query: '+query,()=>{assert.equal(normalizeHistoryQuery(query),'2026-01-03');assert.deepEqual(filterHistory(index,{query}).rows.map(r=>r.date),['2026-01-03']);});
test('Invalid months and dates produce no invented matches and leave records unchanged',()=>{const before=JSON.stringify(rows);for(const query of ['2026/0','2026/13','2026/2/30'])assert.deepEqual(filterHistory(index,{query}).rows,[]);assert.equal(JSON.stringify(rows),before);});
