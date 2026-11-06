import test from 'node:test';
import assert from 'node:assert/strict';
import {engine,pageEngine,plain,html} from './calculator-harness.mjs';
// 2026-11: the simple menu is the main screen on every screen size (no ON/OFF).
// Other menus stay closed at start and open from buttons inside the simple menu.
const key='pococha-meter-calc-v1';
const settings=()=>({...plain(engine().state),goalDefaultsVersion:2,pick:'',target:'1234',current:'50'});
const region=['menusReturn','fullMeterMenu','menusToolbar'];
test('Retired ON/OFF controls are removed from the delivered HTML',()=>{
 for(const id of ['hudToggle','hudVisibility','itemsHudToggle','closeItemsWindow'])assert.doesNotMatch(html,new RegExp('id="'+id+'"'),id);
 assert.match(html,/body:not\(\.menus-open\) \.wrap>:is\(#menusReturn,header\.card,\.history-portal,#fullMeterMenu,#menusToolbar,\.secondary-menus\)\{display:none!important\}/);
});
for(const skip of [true,false])test(`Other menus open from buttons and close back to the simple menu, initialization skipped=${skip}`,()=>{
 const p=pageEngine(settings(),{navigator:{onLine:false},skipCalculatorInitialization:skip});
 const before=p.stored.get(key),body=p.document.body,toggle=p.element('mainMenuToggle');
 assert.ok(p.element('mini').classList.contains('show'));assert.equal(p.element('mini').getAttribute('aria-hidden'),'false');
 assert.equal(body.classList.contains('menus-open'),false);assert.equal(toggle.getAttribute('aria-expanded'),'false');
 for(let i=0;i<3;i++){
  toggle.click();assert.equal(body.classList.contains('menus-open'),true);assert.equal(toggle.getAttribute('aria-expanded'),'true');assert.equal(toggle.textContent,'その他のメニューを閉じる');
  toggle.click();assert.equal(body.classList.contains('menus-open'),false);assert.equal(toggle.textContent,'その他のメニューを開く');
 }
 p.element('navFullMeter').click();
 assert.equal(body.classList.contains('menus-open'),true);assert.equal(p.element('fullMeterMenu').open,true);
 p.element('closeMainMenus').click();assert.equal(body.classList.contains('menus-open'),false);assert.equal(p.document.activeElement,toggle);
 p.element('navDisplay').click();assert.equal(body.classList.contains('menus-open'),true);assert.equal(p.element('displaySettings').open,true);
 for(const id of region)assert.ok(p.element(id),id);
 assert.equal(p.stored.get(key),before,'opening menus does not rewrite saved calculator data');
});
test('History and E-border shortcuts reuse the portal link targets',()=>{
 const p=pageEngine(settings(),{navigator:{onLine:false}});
 assert.equal(p.element('mainHistoryLink').getAttribute('href'),p.element('historyPortalLink').getAttribute('href'));
 assert.equal(p.element('mainEBorderLink').getAttribute('href'),p.element('eBorderPortalLink').getAttribute('href'));
});
test('Storage unavailable does not disable the simple menu or menu buttons',()=>{
 const p=pageEngine(undefined,{skipCalculatorInitialization:true,localStorage:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}});
 assert.ok(p.element('mini').classList.contains('show'));p.element('mainMenuToggle').click();assert.equal(p.document.body.classList.contains('menus-open'),true);
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
