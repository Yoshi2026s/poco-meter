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
