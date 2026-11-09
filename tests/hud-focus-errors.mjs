import test from 'node:test';
import assert from 'node:assert/strict';
import {pageEngine,plain,html} from './calculator-harness.mjs';
import {createAudit} from './theme-cascade.mjs';

test.afterEach(()=>global.gc?.());

// Run the shipped focus/error handlers and authored CSS cascade. Geometry
// doubles exercise keyboard decisions; native rendering and mobile keyboards
// still need browser/device verification.
const desktop={theme:'dark',accent:'standard',weight:'standard',width:1280,pointer:'fine'};
function input(p,id,value){const field=p.element(id);field.focus();field.value=value;field.dispatchEvent(new Event('input'));return field;}

test('Auxiliary menus live inside the simple menu and the duplicated detailed meter stays hidden',()=>{
  const p=pageEngine(undefined,{navigator:{onLine:false}});
  for(const id of ['copyRemaining','appliedContext'])assert.ok(p.element(id).closest('#mini'),id+' inside the simple menu');
  for(const id of ['targetStudio','borderTargets','menusToolbar'])assert.ok(p.element(id).closest('#mainSubMenus'),id+' in the auxiliary menus');
  assert.ok(html.indexOf('id="mini"')<html.indexOf('id="mainSubMenus"')&&html.indexOf('id="mainSubMenus"')<html.indexOf('<div class="wrap">'),'auxiliary menus follow the simple menu directly');
  assert.match(html,/<details class="main-meter-menu" id="fullMeterMenu" hidden aria-hidden="true">/);
  assert.equal(p.element('itemsWindow').hidden,false,'The item estimate stays visible');
  // Duplicated goal controls in the detailed goal settings are hidden in favour of the simple-menu selects.
  assert.match(html,/<div class="pickgrid" hidden>/);
  for(const id of ['targetMethod','bufferPct'])assert.match(html,new RegExp('<div hidden><label for="'+id+'">'),id);
});

for(const [id,errorId] of [['targetMini','targetMiniError'],['currentMini','currentMiniError']])test('Desktop HUD '+id+' exposes its local error without relying on border color',()=>{
  const p=pageEngine(undefined,{navigator:{onLine:false}}),field=input(p,id,'abc'),error=p.element(errorId);
  assert.equal(field.getAttribute('aria-invalid'),'true');assert.ok(field.validationMessage);
  assert.equal(error.hidden,false);assert.ok(error.textContent);
  assert.ok(field.getAttribute('aria-describedby').split(/\s+/).includes(errorId));
  const audit=createAudit({root:p.document.documentElement,nodes:p.nodes});
  for(const width of [701,1280]){
    const ctx={...desktop,width},paint=audit.computed(error,ctx);
    assert.notEqual(paint.display,'none');assert.equal(paint.visibility,'visible');
    assert.ok(audit.textContrast(error,ctx).ratio>=4.5,'The visible explanation keeps readable HUD colors');
  }
  field.value=id==='targetMini'?'500000':'123456';field.dispatchEvent(new Event('input'));
  assert.equal(field.getAttribute('aria-invalid'),'false');assert.equal(field.validationMessage,'');assert.equal(error.hidden,true);
});

test('HUD buffer invalid input exposes a described local error and clears it after correction',()=>{
  const p=pageEngine(undefined,{navigator:{onLine:false}}),field=input(p,'miniBuffer','51'),error=p.element('miniBufferError');
  assert.ok(error,'A local HUD buffer error exists');assert.equal(error.hidden,false);assert.match(error.textContent,/0[〜～-]50/);
  assert.equal(field.getAttribute('aria-invalid'),'true');assert.match(field.validationMessage,/0[〜～-]50/);
  assert.ok(field.getAttribute('aria-describedby').split(/\s+/).includes('miniBufferError'));
  assert.equal(p.element('quickBufferPct').getAttribute('aria-invalid'),'true');
  field.value='2.5';field.dispatchEvent(new Event('input'));
  assert.equal(field.getAttribute('aria-invalid'),'false');assert.equal(field.validationMessage,'');assert.equal(error.hidden,true);
  assert.equal(JSON.parse(p.stored.get('pococha-meter-calc-v1')).bufferPct,2.5);
});

test('HUD buffer blur retains an invalid draft and its local error while keeping the saved value',()=>{
  const p=pageEngine(undefined,{navigator:{onLine:false}}),before=JSON.parse(p.stored.get('pococha-meter-calc-v1')).bufferPct;
  const field=input(p,'miniBuffer','abc');field.blur();p.tick(1000);p.flushTimers(80);
  assert.equal(field.value,'abc');assert.equal(field.getAttribute('aria-invalid'),'true');assert.ok(field.validationMessage);
  assert.equal(p.element('miniBufferError').hidden,false);assert.ok(p.element('miniBufferError').textContent);
  assert.equal(JSON.parse(p.stored.get('pococha-meter-calc-v1')).bufferPct,before);
});

for(const id of ['targetMini','currentMini'])test('HUD '+id+' stays visible when the keyboard reduces the visual viewport',()=>{
  const p=pageEngine(undefined,{navigator:{onLine:false},matchMedia:query=>({matches:query.includes('max-width:700px')})});
  const field=p.element(id),pageScroll=[];
  let top=130;
  field.getBoundingClientRect=()=>({top,bottom:top+44,height:44});
  p.window.scrollBy=options=>{pageScroll.push(plain(options));top-=options.top;};
  p.window.innerHeight=700;
  p.window.visualViewport.height=700;
  field.focus();p.flushTimers(80);
  assert.deepEqual(pageScroll,[],'A visible field does not move when focused');

  p.window.visualViewport.height=120;p.window.visualViewport.offsetTop=24;
  p.resizeViewport();p.flushTimers(80);
  assert.deepEqual(pageScroll,[{top:38,behavior:'instant'}]);
  assert.equal(field.getBoundingClientRect().bottom,136);
  p.resizeViewport();p.flushTimers(80);
  assert.equal(pageScroll.length,1,'A repeated resize does not move a field that already fits');
  assert.equal(p.document.activeElement?.id,id);assert.equal(p.element('mini').getAttribute('aria-hidden'),'false');
});
