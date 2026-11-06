import test from 'node:test';import assert from 'node:assert/strict';
import {pageEngine,engine,plain} from './calculator-harness.mjs';
const key='pococha-meter-calc-v1';const read=p=>JSON.parse(p.stored.get(key));
for(const phone of [false,true])for(const control of ['miniClose','closeSel','deadline'])test(`Changing ${control} resumes cutoff calculation after manual defaults, phone=${phone}`,()=>{
 const settings={...plain(engine().state),goalDefaultsVersion:2,pick:'',analysisBorder:1,target:'777777',current:'123',goalDefaults:{...plain(engine().standardGoalDefaults()),pick:'',target:'777777'}};
 const p=pageEngine(settings,{navigator:{onLine:false},matchMedia:()=>({matches:phone,addEventListener(){}})});
 assert.equal(read(p).pick,'');assert.equal(read(p).target,'777777');
 const expected=new Map();
 for(const d of ['13:00','00:00','22:00','13:00']){
  p.element(control).value=d;p.element(control).dispatchEvent(new Event(control==='deadline'?'input':'change'));
  const s=read(p);assert.notEqual(s.target,'777777');assert.equal(s.pick,phone?0:1);assert.equal(s.targetOrigin.close,d==='00:00'?'24':d.slice(0,2));
  if(expected.has(d))assert.equal(s.target,expected.get(d));expected.set(d,s.target);
  assert.equal(p.element('targetMini').value,Number(s.target).toLocaleString('en-US'));assert.equal(s.current,phone?'0':'123');
 }
 assert.equal(new Set(expected.values()).size,3);
});
