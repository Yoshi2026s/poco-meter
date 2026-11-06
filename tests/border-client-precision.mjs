import test from 'node:test';
import assert from 'node:assert/strict';
import {engine,pageEngine,plain} from './calculator-harness.mjs';

const sourceURL='https://one-carat.com/campus/archives/89496';
const row=(checkedAt,ranks={S2:[100,200,300]})=>({date:'2026-10-02',close:'22',sourceURL,ranks,
  ...(checkedAt===undefined?{}:{checkedAt})});
const packet=records=>({serverDate:'2026-10-03',sync:{status:'ok'},records});
function emptyEngine(){const e=engine();e.state.log={};e.state.log13={};e.state.log24={};e.state.provenance={};return e;}

test('Fractional and scientific millisecond durations retain a sufficient and minimal required pace',()=>{
  const e=engine();
  // Independent rational fixtures; no decimal parser is duplicated in the test.
  const durations=[[999.5,1999n,2n],[1000.1,10001n,10n],[0.5,1n,2n],
    [1.25,5n,4n],[0.0001,1n,10000n],[1e-7,1n,10000000n],[2.5e-7,1n,4000000n]];
  for(const [ms,numerator,denominator] of durations)for(const amount of [1,100001,e.MAX_VALUE]){
    const required=BigInt(amount)*3600000n*denominator,actual=e.ceilPace(amount,3600000,ms);
    assert.ok(actual*numerator>=required,'Pace covers '+ms+' ms');
    assert.ok((actual-1n)*numerator<required,'Pace is minimal for '+ms+' ms');
  }
  for(const ms of [0,-0.5,NaN,Infinity])assert.equal(e.ceilPace(100,3600000,ms),0n);
});

test('Same source values refresh their confirmation timestamp and absent legacy metadata does not erase it',()=>{
  const e=emptyEngine();
  assert.equal(e.mergeLiveBorders(packet([row('2026-10-03T00:00:00Z')])),1);
  assert.equal(e.mergeLiveBorders(packet([row('2026-10-03T06:00:00+00:00')])),1);
  assert.equal(e.state.provenance['22']['2026-10-02'].S2.checkedAt,'2026-10-03T06:00:00.000Z');
  assert.equal(e.mergeLiveBorders(packet([row('2026-10-03T01:00:00Z')])),0);
  assert.equal(e.state.provenance['22']['2026-10-02'].S2.checkedAt,'2026-10-03T06:00:00.000Z');
  assert.equal(e.mergeLiveBorders(packet([row(undefined)])),0);
  assert.equal(e.state.provenance['22']['2026-10-02'].S2.checkedAt,'2026-10-03T06:00:00.000Z');
  assert.deepEqual(Array.from(e.state.log['2026-10-02'].S2),[100,200,300]);
});

test('A malformed confirmation timestamp rejects every source row before any record changes',()=>{
  for(const checkedAt of ['arbitrary-text','2','',null,42,'2026-02-31T00:00:00Z',
    '2026-10-03T24:00:00Z','2026-10-03T00:60:00Z','2026-10-03T00:00:60Z',
    '2026-10-03T00:00:00+24:00','2026-10-03T00:00:00+09:60','2026-10-03T00:00:00Z'+' '.repeat(41)]){
    const e=emptyEngine(),first=row('2026-10-03T00:00:00Z'),second={...row(checkedAt),date:'2026-10-01'};
    assert.throws(()=>e.mergeLiveBorders(packet([first,second])));
    assert.deepEqual(plain(e.state.log),{});assert.deepEqual(plain(e.state.provenance),{});
  }
});

test('Malformed sync timestamps reject packets atomically and cannot restore a verified stored status',()=>{
  for(const field of ['last_attempt','last_success'])for(const stamp of ['2','2026-02-31T00:00:00Z','2026-10-03T24:00:00Z']){
    const e=emptyEngine(),payload=packet([row('2026-10-03T00:00:00Z')]);
    payload.sync[field]=stamp;
    assert.throws(()=>e.mergeLiveBorders(payload));
    assert.deepEqual(plain(e.state.log),{});assert.deepEqual(plain(e.state.provenance),{});
    const p=pageEngine({...plain(e.state),seedVer:3,seedVer13:1,snapshotVersion:'2026-10-02-v3',
      target:'1000',pick:'',borderSync:{...payload.sync,serverDate:payload.serverDate}},
      {navigator:{onLine:false}});
    assert.equal(JSON.parse(p.stored.get('pococha-meter-calc-v1')).borderSync,null);
    assert.doesNotMatch(p.element('borderSyncStatus').textContent,/（確認 /);
  }
  const e=emptyEngine(),valid={status:'ok',serverDate:'2026-10-03',
    last_attempt:'2026-10-03T09:00:00+09:00',last_success:'2026-10-03T00:00:00Z'};
  assert.deepEqual(plain(e.cleanBorderSync(valid)),valid,'Valid sync timestamp representations are preserved');
});

test('Remote confirmation updates preserve user-owned values and their original metadata',()=>{
  const e=emptyEngine();
  e.state.log={'2026-10-02':{S2:[11,22,33]}};
  e.state.provenance={'22':{'2026-10-02':{S2:{origin:'manual',source:'手入力',checkedAt:'2026-10-03'}}}};
  const before=plain(e.state.provenance);
  assert.equal(e.mergeLiveBorders(packet([row('2026-10-03T06:00:00Z')])),0);
  assert.deepEqual(Array.from(e.state.log['2026-10-02'].S2),[11,22,33]);
  assert.deepEqual(plain(e.state.provenance),before);
});

test('Latest source status excludes current and future records while retaining them for later review',()=>{
  const baseline=plain(engine().state),log={'2026-10-02':{S2:[100,200,300]},
    '2026-10-03':{S2:[200,300,400]},'2026-11-01':{S2:[300,400,500]}};
  const provenance={'22':Object.fromEntries(Object.keys(log).map(date=>[date,{S2:{origin:'remote',source:sourceURL}}]))};
  const p=pageEngine({...baseline,seedVer:3,seedVer13:1,snapshotVersion:'2026-10-02-v3',
    log,log13:{},log24:{},provenance,pick:0},{navigator:{onLine:false}});
  assert.match(p.element('borderSyncStatus').textContent,/最新 2026-10-02/);
  assert.match(p.element('borderSyncStatus').textContent,/集計 1日/);
  assert.doesNotMatch(p.element('borderSyncStatus').textContent,/前日分未取得/);
  assert.equal(p.element('target').value,'100');
  const saved=JSON.parse(p.stored.get('pococha-meter-calc-v1'));
  assert.deepEqual(saved.log['2026-10-03'].S2,[200,300,400]);
  assert.deepEqual(saved.log['2026-11-01'].S2,[300,400,500]);
});

test('Successful source confirmation labels missing previous-day records using the API day when the device date is wrong',async()=>{
  const baseline=plain(engine().state),payload=packet([{...row('2026-10-12T00:00:00Z'),date:'2026-10-10'}]);
  payload.serverDate='2026-10-12';payload.sync.last_attempt='2026-10-12T00:00:00Z';
  const p=pageEngine({...baseline,seedVer:3,seedVer13:1,snapshotVersion:'2026-10-02-v3',log:{},log13:{},log24:{},provenance:{},pick:''},
    {navigator:{onLine:true},fetch:async url=>{assert.equal(url,'/api/borders');return {ok:true,headers:{get:()=> 'application/json'},json:async()=>payload};}});
  for(let i=0;i<50;i++)await Promise.resolve();
  assert.match(p.element('borderSyncStatus').textContent,/最新 2026-10-10/);
  assert.match(p.element('borderSyncStatus').textContent,/前日分未取得/);
  assert.match(p.element('borderSyncStatus').textContent,/掲載済みデータを確認/);
  assert.match(p.element('borderSyncStatus').textContent,/端末の日付を確認/);
  assert.doesNotMatch(p.element('borderSyncStatus').textContent,/未掲載/);
});
