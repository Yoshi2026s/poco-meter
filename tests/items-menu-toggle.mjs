import test from 'node:test';
import assert from 'node:assert/strict';
import {engine,pageEngine,plain} from './calculator-harness.mjs';
const key='pococha-meter-calc-v1';
const settings=()=>({...plain(engine().state),goalDefaultsVersion:2,pick:'',target:'1234',current:'50'});
for(const skip of [true,false])test(`Items toggle and close work with calculator initialization ${skip?'unavailable':'complete'}`,()=>{
 const p=pageEngine(settings(),{navigator:{onLine:false},skipCalculatorInitialization:skip});const before=p.stored.get(key);
 assert.equal(p.element('itemsWindow').hidden,true);assert.equal(p.element('itemsWindowRow').children.length,5);
 for(let i=0;i<3;i++){
  p.element('itemsHudToggle').click();assert.equal(p.element('itemsWindow').hidden,false);assert.equal(p.element('itemsHudToggle').getAttribute('aria-checked'),'true');assert.equal(p.element('itemsHudToggle').textContent,'残りアイテム目安OFF');
  p.element('itemsHudToggle').click();assert.equal(p.element('itemsWindow').hidden,true);assert.equal(p.element('itemsHudToggle').textContent,'残りアイテム目安ON');
 }
 p.element('itemsHudToggle').click();p.element('closeItemsWindow').click();assert.equal(p.element('itemsWindow').hidden,true);assert.equal(p.element('itemsHudToggle').getAttribute('aria-checked'),'false');
 p.element('itemsHudToggle').click();p.element('hudToggle').click();assert.equal(p.element('itemsWindow').hidden,false);p.element('closeItemsWindow').click();assert.equal(p.element('itemsWindow').hidden,true);assert.equal(p.document.activeElement,p.element('hudToggle'));
 assert.equal(p.element('itemsWindowRow').children.length,5);assert.equal(p.stored.get(key),before);
});
test('Items values mirror calculator output after an input change',()=>{
 const p=pageEngine(settings(),{navigator:{onLine:false}});p.element('itemsHudToggle').click();p.element('currentMini').value='200';p.element('currentMini').dispatchEvent(new Event('input'));
 for(const el of p.document.querySelectorAll('#itemsWindow [data-mirror-source]'))assert.equal(el.textContent,p.element(el.dataset.mirrorSource).textContent);
 assert.equal(p.element('itemsWindow').hidden,false);
});
test('Blocked storage does not prevent items ON/OFF',()=>{
 const p=pageEngine(undefined,{skipCalculatorInitialization:true,localStorage:{getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}}});p.element('itemsHudToggle').click();assert.equal(p.element('itemsWindow').hidden,false);p.element('closeItemsWindow').click();assert.equal(p.element('itemsWindow').hidden,true);
});
for(const skip of [true,false])test(`Remote item and HUD changes sync without writeback, initialization skipped=${skip}`,()=>{
 const p=pageEngine(settings(),{navigator:{onLine:false},skipCalculatorInitialization:skip});
 const before=new Map(p.stored);
 const remote=(key,newValue,extra={})=>p.dispatchWindow('storage',{key,newValue,...extra});
 const itemKey='pococha-meter-items-window-v1';
 remote(itemKey,'on');assert.equal(p.element('itemsWindow').hidden,false);
 remote(itemKey,'off');assert.equal(p.element('itemsWindow').hidden,true);
 remote(itemKey,'on');remote(itemKey,'invalid');assert.equal(p.element('itemsWindow').hidden,false);
 remote(itemKey,'off',{storageArea:{}});assert.equal(p.element('itemsWindow').hidden,false);
 remote(itemKey,null);assert.equal(p.element('itemsWindow').hidden,true);
 remote('pococha-meter-hud-v1','off');assert.equal(p.element('hudVisibility').value,'off');
 remote('pococha-meter-hud-v1',null);assert.equal(p.element('hudVisibility').value,'on');
 assert.deepEqual(p.stored,before);
});
for(const skip of [true,false])test(`Closing a focused panel restores a visible control, initialization skipped=${skip}`,()=>{
 const p=pageEngine(settings(),{navigator:{onLine:false},skipCalculatorInitialization:skip});
 p.element('currentMini').focus();
 p.dispatchWindow('storage',{key:'pococha-meter-hud-v1',newValue:'off'});
 assert.equal(p.document.activeElement,p.element('hudToggle'));
 p.element('hudToggle').click();p.element('itemsHudToggle').click();p.element('coreCountItems').focus();
 p.dispatchWindow('storage',{key:'pococha-meter-items-window-v1',newValue:'off'});
 assert.equal(p.document.activeElement,p.element('itemsHudToggle'));
 p.element('itemsHudToggle').click();p.element('hudToggle').click();p.element('coreCountItems').focus();
 p.dispatchWindow('storage',{key:'pococha-meter-items-window-v1',newValue:'off'});
 assert.equal(p.document.activeElement,p.element('hudToggle'));
});
for(const skip of [true,false])test(`Items Escape respects composition and selection then restores focus, initialization skipped=${skip}`,()=>{
 const p=pageEngine(settings(),{navigator:{onLine:false},skipCalculatorInitialization:skip});
 // The lightweight harness does not register IDs assigned after createElement.
 const dialog=p.nodes.find(node=>node.id==='selectWindow')||p.document.createElement('dialog');dialog.id='selectWindow';dialog.hidden=true;
 const getById=p.document.getElementById;p.document.getElementById=id=>id==='selectWindow'?dialog:getById(id);
 const press=(props={})=>{const e=new Event('keydown',{cancelable:true});Object.assign(e,{key:'Escape',...props});p.element('itemsWindow').dispatchEvent(e);return e;};
 p.element('itemsHudToggle').click();p.element('coreCountItems').focus();
 press({isComposing:true});assert.equal(p.element('itemsWindow').hidden,false);
 dialog.hidden=false;press();assert.equal(p.element('itemsWindow').hidden,false);
 dialog.hidden=true;press({key:'Enter'});assert.equal(p.element('itemsWindow').hidden,false);
 assert.equal(press().defaultPrevented,true);assert.equal(p.element('itemsWindow').hidden,true);assert.equal(p.document.activeElement,p.element('itemsHudToggle'));
 p.element('itemsHudToggle').click();p.element('hudToggle').click();press();assert.equal(p.document.activeElement,p.element('hudToggle'));
});
