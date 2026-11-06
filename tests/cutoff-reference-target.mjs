import test from 'node:test';
import assert from 'node:assert/strict';
import {pageEngine,engine,plain} from './calculator-harness.mjs';
const key='pococha-meter-calc-v1';
const read=p=>JSON.parse(p.stored.get(key));
function change(p,id,value){p.element(id).value=value;p.element(id).dispatchEvent(new Event('change'));}
for(const control of ['miniClose','closeSel'])test(`Reference targets follow all cutoff datasets through ${control}`,()=>{
 const p=pageEngine(undefined,{navigator:{onLine:false}});
 for(const [label,period] of [['30日','30d'],['当月','month'],['先月','prev'],['3か月','3m'],['全期間','all']]){
  const b=p.element('borders').querySelectorAll('button').find(x=>x.textContent===label+'を目標に'&&!x.disabled);assert.ok(b);b.click();
  const targets=[];
  for(const [time,close] of [['22:00','22'],['00:00','24'],['13:00','13'],['22:00','22']]){
   change(p,control,time);const s=read(p);assert.equal(s.period,period);assert.equal(s.targetMethod,'mean');if(s.targetOrigin){assert.equal(s.targetOrigin.close,close);assert.equal(s.targetOrigin.border,0);assert.equal(p.element('targetMini').value,Number(s.target).toLocaleString('en-US'));}else{assert.equal(s.target,'');assert.equal(p.element('remain').textContent,'データ無し');}targets.push(s.target);
  }
  assert.equal(new Set(targets.slice(0,3)).size,3);assert.equal(targets[0],targets[3]);
 }
});
test('Previously saved reference snapshots and manual goals follow a changed cutoff',()=>{
 const saved={...plain(engine().state),goalDefaultsVersion:2,pick:'',analysisBorder:1,target:'999',targetOrigin:{kind:'reference',value:999,label:'22時締め S2 +1 / 30日平均（整数に四捨五入）'}};
 const p=pageEngine(saved,{navigator:{onLine:false}});assert.equal(read(p).pick,1);
 const vals=[];for(const d of ['22:00','00:00','13:00']){change(p,'miniClose',d);vals.push(read(p).target);}assert.equal(new Set(vals).size,3);
 const q=pageEngine({...saved,targetOrigin:null},{navigator:{onLine:false}});
 assert.equal(read(q).target,'999');change(q,'miniClose','13:00');assert.notEqual(read(q).target,'999');assert.equal(read(q).pick,1);assert.equal(read(q).targetOrigin.close,'13');
});
