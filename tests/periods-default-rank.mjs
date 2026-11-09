import test from 'node:test';
import assert from 'node:assert/strict';
import {engine,pageEngine,plain,html} from './calculator-harness.mjs';
// Standard rank S2; aggregation periods 前日・2日前・3日前・直近7日・直近14日.
// The harness clock is 2026-10-03 (JST), so "yesterday" is 2026-10-02.
const KEY='pococha-meter-calc-v1';
const saved=p=>JSON.parse(p.stored.get(KEY));
const days=[['2026-09-18',90],['2026-09-24',100],['2026-09-26',200],['2026-09-27',300],['2026-09-28',400],['2026-09-29',500],['2026-09-30',600],['2026-10-01',700],['2026-10-02',800],['2026-10-03',9999]];
const log=Object.fromEntries(days.map(([d,v])=>[d,{S1:[v,v+1,v+2],S2:[1,2,3]}]));
const cfg=extra=>({...plain(engine().state),seedVer:3,seedVer13:1,snapshotVersion:'2026-10-02-v3',goalDefaultsVersion:3,
  goalDefaults:{...plain(engine().state.goalDefaults),applyOnLoad:false},target:'1',current:'0',pick:0,bufferPct:0,roundUnit:1,targetMethod:'max',
  rank:'S1',log,log13:{},log24:{},provenance:{},...extra});
const page=extra=>pageEngine(cfg(extra),{navigator:{onLine:false}});
const choose=(p,id,value)=>{p.element(id).value=value;p.element(id).dispatchEvent(new Event('change'));};

test('Period choices are offered in order, shortest recent window first',()=>{
  const p=page();
  assert.deepEqual(p.element('pickPeriod').children.map(o=>o.value),['d1','d2','d3','7d','14d','30d','month','prev','3m','all']);
  const markup=html.match(/<select id="pickPeriod"[^>]*>(.*?)<\/select>/)[1];
  assert.deepEqual([...markup.matchAll(/<option value="[^"]+">([^<]+)<\/option>/g)].map(m=>m[1]),['前日','2日前','3日前','直近7日','直近14日','直近30日','当月','先月','3か月','全期間']);
});
for(const [period,max,min] of [['d1',800,800],['d2',700,700],['d3',600,600],['7d',800,200],['14d',800,100]])
  test(`${period} uses only its own days up to yesterday (today's record is excluded)`,()=>{
    const p=page();choose(p,'quickPeriod',period);assert.equal(saved(p).period,period);
    assert.equal(saved(p).target,String(max),'max');
    choose(p,'quickMethod','min');assert.equal(saved(p).target,String(min),'min');
    assert.equal(saved(p).targetOrigin.period,period);
  });
test('7-day window spans 2026-09-26..10-02 and 14-day 2026-09-19..10-02 (09-18 is outside)',()=>{
  const p=page();choose(p,'quickPeriod','7d');choose(p,'quickMethod','mean');
  assert.equal(saved(p).target,'500');                // (200+…+800)/7
  choose(p,'quickPeriod','14d');                     // 100 (09-24) joins; 90 (09-18) stays outside
  assert.equal(saved(p).target,String(Math.ceil((100+200+300+400+500+600+700+800)/8)));
});
test('A missing single day is not filled from other days',()=>{
  // Same as the existing periods (e.g. 当月 without records): no value is invented, and the target returns with a period that has records.
  const p=page({log:{...log,'2026-10-02':{S2:[1,2,3]}}});choose(p,'quickPeriod','d1');
  assert.equal(p.element('miniR').textContent,'データ無し');assert.equal(saved(p).target,'');
  choose(p,'quickPeriod','d2');assert.equal(saved(p).target,'700');
});
test('New periods survive reload and invalid periods fall back to 直近30日',()=>{
  for(const period of ['d1','d2','d3','7d','14d']){const p=page({period});assert.equal(p.element('pickPeriod').value,period);}
  const bad=page({period:'5d'});assert.equal(saved(bad).period,'30d');
});
test('New and recovered data use S2 for the standard rank',()=>{
  assert.equal(engine().state.rank,'S2');
  const fresh=pageEngine(undefined,{navigator:{onLine:false}});
  assert.equal(fresh.element('miniRank').value,'S2');
  assert.equal(saved(fresh).goalDefaults.rank,'S2');
  assert.equal(saved(fresh).goalDefaultsVersion,4);
  assert.equal(saved(page({rank:'invalid'})).rank,'S2');
});
test('Only the previous standard preset moves to S2; the current rank and saved custom presets survive',()=>{
  const old={...plain(engine().standardGoalDefaults()),rank:'S1'};
  const p=page({rank:'A2',goalDefaultsVersion:3,goalDefaults:old});
  assert.equal(saved(p).rank,'A2');
  assert.equal(saved(p).goalDefaults.rank,'S2');
  assert.equal(saved(p).goalDefaultsVersion,4);
  const custom=page({goalDefaultsVersion:3,goalDefaults:{...old,bufferPct:5}});
  assert.equal(saved(custom).goalDefaults.rank,'S1');
  assert.equal(saved(custom).goalDefaults.bufferPct,5);
  assert.equal(saved(page({goalDefaultsVersion:4,goalDefaults:old})).goalDefaults.rank,'S1');
  assert.equal(saved(page({goalDefaultsVersion:2,goalDefaults:{...old,rank:'S2'}})).goalDefaults.rank,'S2');
});
