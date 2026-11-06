import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const html=await readFile(new URL('../calculator/index.html',import.meta.url),'utf8');
const code=html.split('// Compact repeated provenance without dropping historical or personal records.')[1].split('// END COMPACT HISTORY STORAGE')[0];
const ranks=['D1','D2','D3','C1','C2','C3','B1','B2','B3','A1','A2','A3','S1','S2','S3','S4','S5','S6'];
const ctx={Map,Number,Object,JSON,RANKS:['E',...ranks],isRecord:v=>v&&typeof v==='object'&&!Array.isArray(v),validDate:d=>/^\d{4}-\d{2}-\d{2}$/.test(d)};
vm.createContext(ctx);vm.runInContext(code,ctx);
const history=JSON.parse(await readFile(new URL('../db/history-2025-2026.json',import.meta.url),'utf8'));
const state={target:'12345',current:'678',provenance:{},log:{},log13:{},log24:{}};
for(const row of history){const c=row.close,key=c==='13'?'log13':c==='24'?'log24':'log';state[key][row.date]=row.ranks;state.provenance[c]??={};state.provenance[c][row.date]={};for(const rank of Object.keys(row.ranks))state.provenance[c][row.date][rank]={origin:'remote',source:row.sourceURL,checkedAt:'2026-10-06T04:00:00.000Z'};}
state.provenance['22']??={};state.provenance['22']['2026-10-05']??={};state.provenance['22']['2026-10-05'].S2={origin:'manual',source:'手入力',checkedAt:'2026-10-06T04:01:00.000Z'};
const packed=ctx.packStoredState(state),raw=JSON.stringify(packed),unpacked=ctx.unpackStoredState(JSON.parse(raw));
assert.deepEqual(JSON.parse(JSON.stringify(unpacked)),state);
assert.equal(ctx.unpackStoredState(state),state,'Old device saves remain readable');
assert.throws(()=>ctx.unpackStoredState({provenancePacked:{version:1,pool:[],refs:{'22':{'2025-01-01':{S2:0}}}}}));
assert.throws(()=>ctx.unpackStoredState({provenancePacked:{version:1,pool:[{}],refs:{'22':{'2025-01-01':{Unknown:0}}}}}));
assert.ok(raw.length*2<4_000_000,'Full archive must fit conservative 4 MB UTF-16 device storage budget');
console.log(JSON.stringify({records:history.length,rawCharacters:raw.length,utf16Bytes:raw.length*2,plainCharacters:JSON.stringify(state).length,compression:Math.round(100*(1-raw.length/JSON.stringify(state).length))+'%'}));
