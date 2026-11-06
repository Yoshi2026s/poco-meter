import test from 'node:test';
import assert from 'node:assert/strict';
import {engine,pageEngine,plain} from './calculator-harness.mjs';
const KEY='pococha-meter-calc-v1';
const config=()=>({...plain(engine().state),seedVer:3,seedVer13:1,snapshotVersion:'2026-10-02-v3',
  target:'1000',current:'50',pick:'',log:{},log13:{},log24:{},provenance:{}});
const body=()=>({serverDate:'2026-10-03',sync:{status:'ok',last_attempt:'2026-10-03T12:00:00Z',last_success:'2026-10-03T12:00:00Z'},
  records:[{date:'2026-10-02',close:'22',sourceURL:'https://one-carat.com/campus/archives/89496',
    ranks:Object.fromEntries(engine().RANKS.filter(r=>r!=='E').map(r=>[r,[100,200,300]]))}]});
const response=b=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>b});
const flush=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
const saved=p=>JSON.parse(p.stored.get(KEY));

test('A malformed second row cannot partially merge a valid first row',async()=>{
  const b=body();b.records.push({...b.records[0],date:'2026-10-01',ranks:{S2:[300,100,200]}});
  const p=pageEngine(config(),{navigator:{onLine:true},fetch:async()=>response(b)});await flush();
  assert.deepEqual(saved(p).log,{});assert.equal(saved(p).borderSync,null);
  assert.match(p.element('borderSyncStatus').textContent,/取得・検証失敗/);
});
test('An ignored late fetch cannot overwrite the successful reconnect response',async()=>{
  let calls=0,late;const nav={onLine:true},fresh=body();
  fresh.records[0].ranks.S2=[400,500,600];
  const p=pageEngine(config(),{navigator:nav,fetch:()=>++calls===1?new Promise(resolve=>{late=resolve;}):Promise.resolve(response(fresh))});
  p.flushTimers(15000);await flush();nav.onLine=false;p.dispatchWindow('offline');nav.onLine=true;p.dispatchWindow('online');await flush();
  assert.deepEqual(saved(p).log['2026-10-02'].S2,[400,500,600]);late(response(body()));await flush();
  assert.deepEqual(saved(p).log['2026-10-02'].S2,[400,500,600]);assert.equal(calls,2);
});
test('The API date validates published records and a wrong device date is shown',async()=>{
  let deliver;const p=pageEngine(config(),{navigator:{onLine:true},fetch:()=>new Promise(resolve=>{deliver=resolve;})});
  p.setNow('2026-09-02T12:00:00+09:00');deliver(response(body()));await flush();
  assert.deepEqual(saved(p).log['2026-10-02'].S2,[100,200,300]);
  assert.match(p.element('borderSyncStatus').textContent,/端末の日付を確認/);
  assert.equal(saved(p).target,'1000');
});
test('Last confirmation survives offline restart without asking the network',async()=>{
  const p=pageEngine(config(),{navigator:{onLine:true},fetch:async()=>response(body())});await flush();
  let calls=0;const q=pageEngine(saved(p),{navigator:{onLine:false},fetch:()=>{calls++;throw Error();}});
  assert.equal(calls,0);assert.match(q.element('borderSyncStatus').textContent,/オフライン・保存済みデータ/);
  assert.match(q.element('borderSyncStatus').textContent,/2026-10-03 21:00/);
  assert.equal(saved(q).borderSync.last_success,'2026-10-03T12:00:00Z');
  assert.equal(saved(q).target,'1000');
});
test('Malformed stored confirmation metadata cannot become a successful API status',()=>{
  const cfg=config();cfg.borderSync={status:'ok',serverDate:'2026-02-31',last_attempt:'bad'};
  const p=pageEngine(cfg,{navigator:{onLine:false}});
  assert.equal(saved(p).borderSync,null);
  assert.doesNotMatch(p.element('borderSyncStatus').textContent,/確認 bad/);
  assert.equal(saved(p).target,'1000');
});
