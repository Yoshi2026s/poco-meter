import test from 'node:test';import assert from 'node:assert/strict';import {eHarness} from './e-border-harness.mjs';import {E_SEEDS,eKey} from '../calculator/e-border-core.mjs';import {eEncode,E_KEY} from '../calculator/e-border-store.mjs';
const row=(close,date='2026-08-01')=>({date,rank:'E',close,values:['100','1K','2K'],source:'端末で確認した画面表示値',precision:'display'});
const initial=records=>eEncode({records,hiddenSeeds:E_SEEDS.map(eKey),trash:[],lastChangedAt:''});
const groups=h=>h.get('records').children;const text=(h,g)=>h.all(g,()=>true).map(e=>e.textContent).join(' ');
test('all cutoffs have independent groups, counts, and empty state',()=>{const raw=initial([row('22'),row('24')]),h=eHarness({initial:raw});try{assert.deepEqual(groups(h).map(g=>g.getAttribute('data-close')),['13','22','24']);assert.match(text(h,groups(h)[0]),/保存済みの記録がありません/);assert.match(text(h,groups(h)[1]),/22時〆 · 1件/);assert.match(text(h,groups(h)[2]),/24時〆 · 1件/);assert.equal(h.memory.get(E_KEY),raw);assert.match(h.get('storageSummary').textContent,/22時〆 1件/);}finally{h.close();}});
test('filtered-out data is distinguished from missing saved data',async()=>{const h=eHarness({initial:initial([row('22')])});try{h.get('filterMonth').value='2026-09';await h.get('filterMonth').dispatch('change');assert.match(text(h,groups(h)[1]),/全記録 1件/);assert.match(text(h,groups(h)[1]),/条件に合う記録がありません/);h.get('filterClose').value='22';await h.get('filterClose').dispatch('change');assert.equal(groups(h).length,1);assert.equal(groups(h)[0].getAttribute('data-close'),'22');}finally{h.close();}});
test('each cutoff gets its own first page and more reveals its remaining records',async()=>{const rows=Array.from({length:31},(_,i)=>row('13','2026-08-'+String(i+1).padStart(2,'0'))).concat(row('22'));const h=eHarness({initial:initial(rows)});try{const count=g=>h.all(g,e=>e.tagName==='ARTICLE').length;assert.equal(count(groups(h)[0]),30);assert.equal(count(groups(h)[1]),1);assert.equal(h.get('more').hidden,false);await h.click('more');assert.equal(count(groups(h)[0]),31);assert.equal(h.get('more').hidden,true);}finally{h.close();}});

test('record copy fallback stays in the card and returns focus to its copy button',async()=>{
 const h=eHarness({initial:initial([row('22')]),clipboardFail:true});
 try{
  const card=h.all(groups(h)[1],e=>e.tagName==='ARTICLE')[0];
  const copy=h.buttons(card).find(e=>e.textContent==='コピー');
  await copy.dispatch('click');
  assert.equal(h.get('copyFeedback').parentElement,card);
  assert.equal(h.get('copyFallback').hidden,false);
  assert.match(h.get('copyText').value,/2026-08-01/);
  assert.equal(h.focus(),h.get('copyText'));
  await h.click('closeCopy');
  assert.equal(h.get('copyFallback').hidden,true);
  assert.equal(h.focus(),copy);
  await h.get('filterClose').dispatch('change');
  assert.equal(h.get('copyFeedback').parentElement,h.get('recordActions').parentElement);
 }finally{h.close();}
});
// 2026-11-15: saved records open as a month calendar by default; days show ±0, tapping a day shows its record with edit/copy/delete,
// and an unrecorded past day opens a manual-entry draft. The list view stays available and the choice is remembered.
test('calendar view is the default, shows ±0 per day and the tapped day record, and switches to the list',async()=>{const h=eHarness({initial:initial([row('22','2026-08-03'),row('22','2026-08-05'),row('24','2026-08-05')]),view:'calendar'});try{
 const cal=h.get('eCalendar'),days=()=>h.all(cal,e=>e.tagName==='BUTTON'&&e.getAttribute('data-date')),day=(d,i=0)=>days().filter(b=>b.getAttribute('data-date')===d)[i];
 assert.equal(cal.hidden,false);assert.equal(h.get('records').hidden,true);assert.equal(h.get('viewCalendar').getAttribute('aria-pressed'),'true');
 assert.match(text(h,cal),/2026年8月/);assert.equal(h.all(cal,e=>e.tagName==='SECTION').length,3);
 const d3=day('2026-08-03',1);assert.match(d3.getAttribute('aria-label'),/22時〆 ±0 100/);await d3.dispatch('click');
 assert.match(text(h,h.get('eCalendar')),/2026\/08\/03の記録（1件）/);assert.ok(h.all(h.get('eCalendar'),e=>e.tagName==='ARTICLE').length===1);
 const gap=day('2026-08-04',1);assert.match(gap.getAttribute('aria-label'),/未記録/);
 await h.click('viewList');assert.equal(h.get('eCalendar').hidden,true);assert.equal(h.get('records').hidden,false);assert.equal(h.memory.get('pococha-e-records-view-v1'),'list');
}finally{h.close();}});
