import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
import {validDate,validTriple,RANKS,sourceUrl} from '../lib/border-source.mjs';
const rows=JSON.parse(await readFile(new URL('../db/history-2025-2026.json',import.meta.url),'utf8'));
const seen=new Set(),months=new Set();let triples=0;
for(const r of rows){assert.ok(validDate(r.date)&&r.date>='2025-01-01'&&r.date<'2026-10-06');assert.ok(['13','22','24'].includes(r.close));assert.ok(sourceUrl(r.sourceURL));assert.ok(!seen.has(r.date+'|'+r.close));seen.add(r.date+'|'+r.close);months.add(r.date.slice(0,7));assert.ok(Object.keys(r.ranks).length>0&&Object.keys(r.ranks).length<=18);for(const [rank,v]of Object.entries(r.ranks)){assert.ok(RANKS.includes(rank));assert.ok(validTriple(v));triples++;}}
assert.ok(rows.length>1800);assert.equal(months.size,22);assert.ok(seen.has('2025-01-01|13'));assert.ok(seen.has('2025-01-01|22'));assert.ok(seen.has('2025-01-01|24'));console.log({records:rows.length,rankTriples:triples,months:months.size});
