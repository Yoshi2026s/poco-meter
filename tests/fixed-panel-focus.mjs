import test from 'node:test';
import assert from 'node:assert/strict';
import {pageEngine,plain} from './calculator-harness.mjs';

// Run shipped focus/viewport handlers with geometry doubles. This checks
// scroll decisions, rather than claiming mobile browser rendering coverage.
// 現行仕様（v2026.11.07.8〜）：シンプルメニューは通常配置で、固定パネルはない。
// スマホ（max-width:700px か pointer:coarse）で入力欄が見える範囲（上下8px内側）から外れたときだけ、
// その差だけページを instant で動かす。見えている欄では動かさない。
function phone(matches=query=>query.includes('max-width:700px')){
  const p=pageEngine(undefined,{navigator:{onLine:false},matchMedia:query=>({matches:matches(query)})});
  const pageScroll=[];p.window.scrollBy=options=>pageScroll.push(plain(options));
  p.window.innerHeight=700;p.window.visualViewport.height=400;p.window.visualViewport.offsetTop=0;
  p.element('mini').getBoundingClientRect=()=>({top:0,bottom:90,height:90});
  return {p,pageScroll};
}
function focusAndResize(p,field,rect={top:20,bottom:64}){
  field.getBoundingClientRect=()=>rect;field.focus();p.flushTimers(80);p.resizeViewport();p.flushTimers(80);
}

for(const id of ['backgroundColor','screenTheme','miniRank','coreCountItems','currentTop'])test('Visible field '+id+' keeps the page still during focus and keyboard resize',()=>{
  const {p,pageScroll}=phone();p.element('displaySettings').open=true;p.element('itemsWindow').hidden=false;
  const field=p.element(id);focusAndResize(p,field);
  assert.deepEqual(pageScroll,[]);assert.equal(p.document.activeElement,field);
});

test('Opening the custom selector focuses a real dialog row without moving the page',()=>{
  const {p,pageScroll}=phone();p.element('displaySettings').open=true;
  p.element('backgroundColor').dispatchEvent({type:'keydown',key:'Enter',preventDefault(){}});
  const dialog=p.nodes.find(node=>node.id==='selectWindow'),row=p.document.activeElement;
  assert.equal(dialog.hidden,false);assert.equal(row.tagName,'BUTTON');assert.equal(row.closest('#selectWindow'),dialog);
  row.getBoundingClientRect=()=>({top:20,bottom:64});p.flushTimers(80);p.resizeViewport();p.flushTimers(80);
  assert.deepEqual(pageScroll,[]);assert.deepEqual(plain(row.lastScroll),{block:'nearest'});
});

test('A field above the visible area moves the page down to it by the exact gap',()=>{
  const {p,pageScroll}=phone();const field=p.element('currentTop');
  focusAndResize(p,field,{top:-40,bottom:4});
  assert.deepEqual(pageScroll,[{top:-48,behavior:'instant'},{top:-48,behavior:'instant'}]);
});

for(const id of ['currentTop','coreCountItems'])test('Field '+id+' below the mobile keyboard scrolls above it',()=>{
  const {p,pageScroll}=phone();p.element('itemsWindow').hidden=false;const field=p.element(id);
  focusAndResize(p,field,{top:420,bottom:464});
  assert.deepEqual(pageScroll,[{top:72,behavior:'instant'},{top:72,behavior:'instant'}]);
});

test('Desktop pointer layouts never move the page on focus',()=>{
  const {p,pageScroll}=phone(()=>false);const field=p.element('currentTop');
  focusAndResize(p,field,{top:420,bottom:464});
  assert.deepEqual(pageScroll,[]);
});
