import test from 'node:test';
import assert from 'node:assert/strict';
import {engine,pageEngine,plain} from './calculator-harness.mjs';
// 2026-11: the remaining-items estimate is always shown inside the simple menu (no ON/OFF).
const key='pococha-meter-calc-v1';
const settings=()=>({...plain(engine().state),goalDefaultsVersion:2,pick:'',target:'1234',current:'50'});
for(const skip of [true,false])test(`Items are always visible inside the simple menu, initialization skipped=${skip}`,()=>{
 const p=pageEngine(settings(),{navigator:{onLine:false},skipCalculatorInitialization:skip});const before=p.stored.get(key);
 assert.equal(p.element('itemsWindow').hidden,false);assert.ok(p.element('itemsWindow').closest('#mini'));
 assert.equal(p.element('itemsWindowRow').children.length,5);
 assert.deepEqual(Array.from(p.element('itemsWindowRow').children).map(card=>card.querySelector('span').textContent),['必要コイン','犬・猫','笹パンダ','花火','馬車']);
 assert.equal(p.stored.get(key),before);
});
test('Items values mirror calculator output after an input change',()=>{
 const p=pageEngine(settings(),{navigator:{onLine:false}});p.element('currentMini').value='200';p.element('currentMini').dispatchEvent(new Event('input'));
 const mirrors=Array.from(p.element('itemsWindowRow').children).map(card=>card.querySelector('b'));assert.equal(mirrors.length,5);
 ['coinNeed','dogcatNeed','pandaNeed','hanabiNeed','bashaNeed'].forEach((id,i)=>assert.equal(mirrors[i].getAttribute('data-value'),p.element(id).textContent,id));
 assert.equal(p.element('itemsWindow').hidden,false);
});
