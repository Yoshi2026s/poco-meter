import test from 'node:test';
import assert from 'node:assert/strict';
import {engine,pageEngine,plain,html} from './calculator-harness.mjs';
// 2026-11: the simple menu is the main screen on every screen size (no ON/OFF).
// The auxiliary menus are integrated into the simple menu; the duplicated detailed meter stays hidden.
const key='pococha-meter-calc-v1';
const settings=()=>({...plain(engine().state),goalDefaultsVersion:2,pick:'',target:'1234',current:'50'});
test('Retired ON/OFF and separate-menu controls are removed from the delivered HTML',()=>{
 for(const id of ['hudToggle','hudVisibility','itemsHudToggle','closeItemsWindow','mainMenuToggle','closeMainMenus','menusReturn','mainMenuNav'])assert.doesNotMatch(html,new RegExp('id="'+id+'"'),id);
 assert.match(html,/#fullMeterMenu\{display:none!important\}/);
 assert.match(html,/<details class="main-meter-menu" id="fullMeterMenu" hidden aria-hidden="true">/);
});
for(const skip of [true,false])test(`Auxiliary menus are inside the simple menu, initialization skipped=${skip}`,()=>{
 const p=pageEngine(settings(),{navigator:{onLine:false},skipCalculatorInitialization:skip});
 const before=p.stored.get(key);
 assert.ok(p.element('mini').classList.contains('show'));assert.equal(p.element('mini').getAttribute('aria-hidden'),'false');
 for(const id of ['mainTools','mainSubMenus','menusToolbar','targetStudio','borderTargets','copyRemaining'])assert.ok(p.element(id).closest('#mini'),id);
 assert.equal(p.stored.get(key),before,'layout does not rewrite saved calculator data');
});
test('Detailed-meter targets are redirected to the simple-menu fields',()=>{
 const p=pageEngine(settings(),{navigator:{onLine:false}});
 p.element('miniPeriodReview').click();assert.equal(p.document.activeElement,p.element('currentMini'));
});
test('Storage unavailable does not disable the simple menu',()=>{
 const p=pageEngine(undefined,{skipCalculatorInitialization:true,localStorage:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}});
 assert.ok(p.element('mini').classList.contains('show'));
 assert.equal(p.element('itemsWindow').hidden,false);
});
for(const skip of [true,false])test(`Retired HUD and item preferences from older versions cannot hide the main screen, initialization skipped=${skip}`,()=>{
 const values=new Map([['pococha-meter-hud-v1','off'],['pococha-meter-items-window-v1','off']]),writes=[];
 const p=pageEngine(settings(),{navigator:{onLine:false},skipCalculatorInitialization:skip,localStorage:{getItem:k=>values.get(k)??null,setItem(k,v){writes.push(k);values.set(k,v);}}});
 assert.equal(p.element('itemsWindow').hidden,false);assert.equal(p.element('mini').classList.contains('hud-collapsed'),false);
 for(const [k,v] of [['pococha-meter-hud-v1','off'],['pococha-meter-items-window-v1','off'],['pococha-meter-hud-v1',null]])p.dispatchWindow('storage',{key:k,newValue:v});
 assert.equal(p.element('itemsWindow').hidden,false);assert.equal(p.element('mini').classList.contains('hud-collapsed'),false);
 assert.equal(p.element('targetMini').tabIndex,0);assert.equal(p.element('currentMini').tabIndex,0);
 assert.deepEqual(writes.filter(k=>k==='pococha-meter-hud-v1'||k==='pococha-meter-items-window-v1'),[],'retired keys are left untouched');
});
