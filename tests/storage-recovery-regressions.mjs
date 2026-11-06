import test from 'node:test';
import assert from 'node:assert/strict';
import {engine,pageEngine,plain} from './calculator-harness.mjs';

const KEY='pococha-meter-calc-v1',e=engine();
const original=()=>({...plain(e.state),seedVer:3,seedVer13:1,snapshotVersion:'2026-10-02-v3',
  goalDefaultsVersion:1,target:'2000',current:'500',coreCount:'12',pick:'',log:{'2025-02-01':{S2:[110,220,330],D1:[11,22,33]}},log13:{},log24:{},
  provenancePacked:{version:1,pool:[{origin:'manual',source:'personal',checkedAt:''}],refs:{'22':{'2025-02-01':{D1:0,S2:99}}}}});

for(const [name,mutate] of [
  ['missing reference',()=>{}],
  ['empty pool',s=>{s.provenancePacked.pool=[];}],
  ['wrong version',s=>{s.provenancePacked.version=2;}],
  ['invalid pool',s=>{s.provenancePacked.pool=[null];}],
  ['invalid refs',s=>{s.provenancePacked.refs=null;}],
  ['invalid cutoff',s=>{s.provenancePacked.refs.bad={};}],
  ['invalid date',s=>{s.provenancePacked.refs['22'].bad={S2:0};}],
  ['invalid rank',s=>{s.provenancePacked.refs['22']['2025-02-01'].Unknown=0;}],
])test('Startup retains valid personal data with '+name,()=>{
  const s=original();mutate(s);const raw=JSON.stringify(s),p=pageEngine(s,{navigator:{onLine:false}});
  const actual=plain(e.unpackStoredState(JSON.parse(p.stored.get(KEY))));
  assert.equal(actual.target,'2000');assert.equal(actual.current,'500');assert.equal(actual.coreCount,'0');
  assert.deepEqual(actual.log['2025-02-01'].S2,[110,220,330]);assert.deepEqual(actual.log['2025-02-01'].D1,[11,22,33]);
  assert.equal(p.stored.get(KEY+'-recovery'),raw,'Untouched raw data remains recoverable');
  assert.match(p.element('storageStatus').textContent,/有効な記録/);
  assert.equal(actual.provenance['22']['2025-02-01'].S2.origin,'saved','Recovered values stay locally saved, never fabricated as verified source data');
  assert.throws(()=>e.unpackStoredState(s),'Explicit compact decode stays strict');
});

test('Recovery retains valid provenance and drops only corrupt records',()=>{
  const s=original();s.log['2025-02-02']={S2:[330,220,110]};
  const p=pageEngine(s,{navigator:{onLine:false}}),actual=plain(e.unpackStoredState(JSON.parse(p.stored.get(KEY))));
  assert.deepEqual(actual.provenance['22']['2025-02-01'].D1,{origin:'manual',source:'personal',checkedAt:''});
  assert.equal(actual.log['2025-02-02'],undefined);assert.deepEqual(actual.log['2025-02-01'].S2,[110,220,330]);
});

test('Phone opening keeps requested defaults while retaining recovered personal records',()=>{
  const s=original(),p=pageEngine(s,{navigator:{onLine:false},matchMedia:q=>({matches:q==='(max-width:700px)',addEventListener(){},addListener(){}})});
  const actual=plain(e.unpackStoredState(JSON.parse(p.stored.get(KEY))));
  assert.equal(actual.current,'0');assert.deepEqual(actual.log['2025-02-01'].S2,[110,220,330]);
  assert.equal(p.stored.get(KEY+'-recovery'),JSON.stringify(s));
});
