import test from 'node:test';
import assert from 'node:assert/strict';
import {engine,pageEngine,plain} from './calculator-harness.mjs';
const key='pococha-meter-calc-v1';
const settings=()=>({...plain(engine().state),goalDefaultsVersion:2,pick:'',target:'1234',current:'50'});
for(const skip of [true,false])test(`ON/OFF works when calculator initialization is ${skip?'unavailable':'complete'}`,()=>{
 const p=pageEngine(settings(),{navigator:{onLine:false},skipCalculatorInitialization:skip});
 const before=p.stored.get(key);
 for(let i=0;i<4;i++){
  p.element('hudToggle').click();assert.ok(p.element('mini').classList.contains('hud-collapsed'));assert.equal(p.element('hudToggle').textContent,'シンプルメニューON');assert.equal(p.element('hudVisibility').value,'off');assert.equal(p.element('hudToggle').getAttribute('aria-checked'),'false');
  p.element('hudToggle').click();assert.ok(!p.element('mini').classList.contains('hud-collapsed'));assert.equal(p.element('hudToggle').textContent,'シンプルメニューOFF');assert.equal(p.element('hudVisibility').value,'on');assert.equal(p.element('hudToggle').getAttribute('aria-checked'),'true');
 }
 assert.equal(p.stored.get(key),before);
 p.element('hudVisibility').value='off';p.element('hudVisibility').dispatchEvent(new Event('change'));assert.ok(p.element('mini').classList.contains('hud-collapsed'));
 p.element('hudToggle').click();assert.equal(p.element('hudVisibility').value,'on');
});
test('Storage unavailable does not disable switching',()=>{
 const p=pageEngine(undefined,{skipCalculatorInitialization:true,localStorage:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}});
 p.element('hudToggle').click();assert.ok(p.element('mini').classList.contains('hud-collapsed'));p.element('hudToggle').click();assert.ok(!p.element('mini').classList.contains('hud-collapsed'));
});
for(const skip of [true,false])test(`Invalid visibility selections preserve ON/OFF and do not write, initialization skipped=${skip}`,()=>{
 const p=pageEngine(settings(),{navigator:{onLine:false},skipCalculatorInitialization:skip});
 for(const on of [true,false]){
  if(!on)p.element('hudToggle').click();
  const before=new Map(p.stored);
  for(const bad of ['','false','ON','unknown']){
   p.element('hudVisibility').value=bad;p.element('hudVisibility').dispatchEvent(new Event('change'));
   assert.equal(p.element('hudVisibility').value,on?'on':'off');
   assert.equal(p.element('mini').classList.contains('hud-collapsed'),!on);
   assert.deepEqual(p.stored,before);
  }
 }
});
for(const skip of [true,false])test(`Menu save failures are independent and clear only after successful retries, initialization skipped=${skip}`,()=>{
 const blocked=new Set(),saved=new Map();
 const p=pageEngine(settings(),{navigator:{onLine:false},skipCalculatorInitialization:skip,localStorage:{getItem:k=>saved.get(k)??null,setItem(k,v){if(blocked.has(k))throw Error('quota');saved.set(k,v);}}});
 const hud='pococha-meter-hud-v1',items='pococha-meter-items-window-v1',status=p.element('menuPreferenceStatus');
 blocked.add(hud);blocked.add(items);
 p.element('hudToggle').click();assert.equal(status.hidden,false);assert.match(status.textContent,/保存できません/);
 p.element('hudToggle').click();p.element('itemsHudToggle').click();assert.equal(p.element('itemsWindow').hidden,false);
 blocked.delete(hud);p.element('hudToggle').click();assert.equal(status.hidden,false);
 p.dispatchWindow('storage',{key:items,newValue:'off'});assert.equal(status.hidden,false);
 blocked.delete(items);p.element('closeItemsWindow').click();assert.equal(status.hidden,true);assert.equal(status.textContent,'');
});
