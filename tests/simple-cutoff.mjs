import test from 'node:test';
import assert from 'node:assert/strict';
import {engine,pageEngine,plain,html} from './calculator-harness.mjs';
const key='pococha-meter-calc-v1';
const config=()=>({...plain(engine().state),goalDefaultsVersion:2,goalDefaults:{...plain(engine().standardGoalDefaults()),pick:'',target:'1234'},pick:'',target:'1234',current:'50',deadline:'22:00'});
test('Cutoff choices are present before scripts run',()=>{
 const tag=html.match(/<select id="miniClose"[^>]*>([\s\S]*?)<\/select>/)[0];
 for(const value of ['13:00','22:00','00:00','custom'])assert.ok(tag.includes('value="'+value+'"'));
 assert.match(tag,/tabindex="0"/);
});
for(const phone of [false,true])for(const event of ['input','change'])test(`Simple cutoff commits on ${event}, phone=${phone}, detail closed`,()=>{
 const p=pageEngine(config(),{navigator:{onLine:false},matchMedia:()=>({matches:phone,addEventListener(){}})});
 assert.equal(p.element('fullMeterMenu').open,false);
 const initial=JSON.parse(p.stored.get(key));
 for(const value of ['13:00','22:00','00:00','13:00']){
  p.element('miniClose').focus();p.element('miniClose').value=value;p.element('miniClose').dispatchEvent(new Event(event));
  const state=JSON.parse(p.stored.get(key));assert.equal(state.deadline,value);assert.equal(p.element('deadline').value,value);assert.equal(p.element('closeSel').value,value);
  assert.equal(state.current,initial.current);assert.notEqual(state.target,initial.target);assert.equal(state.targetOrigin.close,value==='00:00'?'24':value.slice(0,2));assert.equal(p.element('fullMeterMenu').open,false);
 }
});
test('Invalid cutoff is rejected and custom opens its input',()=>{
 const p=pageEngine(config(),{navigator:{onLine:false}});p.element('miniClose').value='invalid';p.element('miniClose').dispatchEvent(new Event('change'));assert.equal(JSON.parse(p.stored.get(key)).deadline,'22:00');
 p.element('miniClose').value='custom';p.element('miniClose').dispatchEvent(new Event('change'));assert.equal(p.document.activeElement,p.element('deadline'));assert.equal(p.element('deadline').closest('section.card').classList.contains('collapsed'),false);
});
