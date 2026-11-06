import test from 'node:test';
import assert from 'node:assert/strict';
import {pageEngine,plain} from './calculator-harness.mjs';

// Run shipped focus/viewport handlers with geometry doubles. This checks
// scroll decisions, rather than claiming mobile browser rendering coverage.
function phone(){
  const p=pageEngine(undefined,{navigator:{onLine:false},matchMedia:query=>({matches:query.includes('max-width:700px')})});
  const pageScroll=[];p.window.scrollBy=options=>pageScroll.push(plain(options));
  p.window.innerHeight=700;p.window.visualViewport.height=400;p.window.visualViewport.offsetTop=0;
  p.element('mini').getBoundingClientRect=()=>({top:0,bottom:90,height:90});
  return {p,pageScroll};
}
function focusAndResize(p,field,rect={top:20,bottom:64}){
  field.getBoundingClientRect=()=>rect;field.focus();p.flushTimers(80);p.resizeViewport();p.flushTimers(80);
}

for(const id of ['backgroundColor','hudBackgroundColor','screenTheme'])test('Fixed display panel '+id+' scrolls its control without moving the page',()=>{
  const {p,pageScroll}=phone();p.element('displaySettings').open=true;
  const field=p.element(id);assert.ok(field.closest('.display-settings-panel'));
  focusAndResize(p,field);
  assert.deepEqual(pageScroll,[]);assert.deepEqual(plain(field.lastScroll),{behavior:'auto',block:'nearest'});
  assert.equal(p.document.activeElement,field);assert.equal(p.element('mini').getAttribute('aria-hidden'),'false');
});

for(const id of ['miniRank','coreCountItems'])test('Fixed HUD control '+id+' stays within its panel during focus and keyboard resize',()=>{
  const {p,pageScroll}=phone();const field=p.element(id);
  assert.ok(field.closest('#mini, #itemsWindow'));p.element('itemsWindow').hidden=false;
  focusAndResize(p,field);
  assert.deepEqual(pageScroll,[]);assert.deepEqual(plain(field.lastScroll),{behavior:'auto',block:'nearest'});
  assert.equal(p.document.activeElement,field);
});

test('Opening the custom selector focuses a real dialog row without moving the page',()=>{
  const {p,pageScroll}=phone();p.element('displaySettings').open=true;
  p.element('backgroundColor').dispatchEvent({type:'keydown',key:'Enter',preventDefault(){}});
  const dialog=p.nodes.find(node=>node.id==='selectWindow'),row=p.document.activeElement;
  assert.equal(dialog.hidden,false);assert.equal(row.tagName,'BUTTON');assert.equal(row.closest('#selectWindow'),dialog);
  row.getBoundingClientRect=()=>({top:20,bottom:64});p.flushTimers(80);p.resizeViewport();p.flushTimers(80);
  assert.deepEqual(pageScroll,[]);assert.deepEqual(plain(row.lastScroll),{block:'nearest'});
});

test('Ordinary page input under the HUD still moves the page into the visible region',()=>{
  const {p,pageScroll}=phone();const field=p.element('currentTop');assert.equal(field.closest('#mini, #itemsWindow, #selectWindow, .display-settings-panel'),null);
  focusAndResize(p,field);
  assert.deepEqual(pageScroll,[{top:-78,behavior:'auto'},{top:-78,behavior:'auto'}]);assert.equal(field.lastScroll.block,'nearest');
});

test('Ordinary page input below the mobile keyboard still scrolls above it',()=>{
  const {p,pageScroll}=phone();const field=p.element('currentTop');
  focusAndResize(p,field,{top:420,bottom:464});
  assert.deepEqual(pageScroll,[{top:72,behavior:'auto'},{top:72,behavior:'auto'}]);assert.equal(field.lastScroll.block,'nearest');
});
