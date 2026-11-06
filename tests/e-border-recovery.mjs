import assert from 'node:assert/strict';import {eHarness} from './e-border-harness.mjs';import {E_SEEDS,E_SCHEMA,eValue,eMerge,eBackup,eReadCSV,eParseOCR,eKey} from '../calculator/e-border-core.mjs';import {E_KEY,E_DRAFT_KEY,E_RECOVERY_KEY,eState,eEncode,eWrite,eRemove,eDraftEncode,eArchive,eFilterPrefs,E_FILTER_KEY} from '../calculator/e-border-store.mjs';
const base=E_SEEDS[0],seed=eState(null),row={date:'2026-08-01',rank:'E',close:'22',values:['100','1K','2K'],source:'端末で確認した画面表示値',precision:'display'};
const plain=o=>JSON.parse(JSON.stringify(o));
async function fill(h,box,r){const a=h.inputs(box);for(const [i,v]of [r.date,r.rank,r.close,...r.values].entries()){a[i].value=v;await a[i].dispatch('input');}const cb=a.find(c=>c.type==='checkbox');cb.checked=true;await cb.dispatch('change');}
assert.equal(eValue('1.001K').n,1001);assert.equal(eValue('1.001M').n,1001000);assert.doesNotThrow(()=>eMerge([],[{...row,values:['1001','1.001K','2K']}]));
assert.equal(eParseOCR('2026年8月1日 22:00\n締め時間22:00','E1','').date,'');assert.equal(eParseOCR('2026年8月1日\n2026年8月2日\n締め時間24:00','E1','').date,'');
{
 const memory=new Map([[E_KEY,eEncode(seed)]]),store={getItem:k=>memory.get(k)??null,setItem(k,v){if(k===E_RECOVERY_KEY)throw Error('Quota');memory.set(k,v);}};const result=eWrite(store,{...seed,records:eMerge(seed.records,[row]).rows},memory.get(E_KEY));assert.equal(result.recoverySaved,false);assert.equal(result.state.records.length,11);
}
{
 const state={...seed,records:eMerge(seed.records,[row]).rows},draft=eDraftEncode([{...row,date:'2026-08-02',values:['101','1K','2K'],original:row}]);const h=eHarness({initial:eEncode(state),extras:{[E_DRAFT_KEY]:draft}});
 try{const cb=h.inputs(h.get('drafts').children[0]).at(-1);cb.checked=true;await cb.dispatch('change');await h.click('save');assert.equal(h.eval('app.records.length'),11);assert.equal(h.eval('app.records.some(r=>r.date==="2026-08-01"&&r.rank==="E")'),false);assert.equal(h.eval('app.records.some(r=>r.date==="2026-08-02"&&r.rank==="E")'),true);}finally{h.close();}
}
{
 const h=eHarness({extras:{[E_DRAFT_KEY]:'broken-draft'}});try{await h.event('pagehide');assert.equal(h.memory.get(E_DRAFT_KEY),'broken-draft');await h.click('manual');await h.event('pagehide');assert.equal(h.memory.get(E_DRAFT_KEY+'-unreadable'),'broken-draft');assert.ok(h.memory.get(E_DRAFT_KEY).startsWith('{'));}finally{h.close();}
}
{
 const deleted=eRemove(seed,eKey(base)),h=eHarness({initial:eEncode(deleted)});try{assert.equal(h.eval('app.records.length'),9);h.get('restore').files=[{name:'backup.json',size:100,text:async()=>eEncode(seed)}];await h.get('restore').dispatch('change');const controls=h.inputs(h.get('drafts').children[0]);controls[1].checked=true;await controls[1].dispatch('change');controls[0].checked=true;await h.click('save');assert.equal(h.eval('app.records.length'),10);assert.equal(h.eval('app.hiddenSeeds.length'),0);}finally{h.close();}
}
{
 const healthy=eEncode(seed),h=eHarness({initial:'broken-records',extras:{[E_RECOVERY_KEY]:healthy}});try{await h.click('recover');assert.equal(h.eval('storageBlocked'),false);assert.equal(h.eval('app.records.length'),10);assert.equal(h.memory.get(E_RECOVERY_KEY),healthy);}finally{h.close();}
}
{
 const h=eHarness();try{const original=h.eval('app.records.length');h.get('restore').files=[{name:'bad.csv',size:10,text:async()=> 'bad-header\n1,2'}];await h.get('restore').dispatch('change');assert.equal(h.eval('app.records.length'),original);assert.equal(h.eval('drafts.length'),0);assert.ok(h.get('status').textContent.includes('取込できません'));await h.click('manual');await fill(h,h.get('drafts').children[0],row);await h.click('manual');assert.equal(h.eval('drafts.length'),2);await h.click('save');assert.equal(h.eval('app.records.length'),11);assert.equal(h.eval('drafts.length'),1);assert.equal(h.inputs(h.get('drafts').children[0]).at(-1).checked,false);}finally{h.close();}
}
{
 const h=eHarness();try{const files=Array.from({length:2},()=>({name:'same.png',size:100,type:'image/png',arrayBuffer:async()=>new Uint8Array([7,7,7]).buffer}));h.get('images').files=files;await h.get('images').dispatch('change');assert.equal(h.eval('drafts.length'),1);assert.ok(h.get('status').textContent.includes('省略 1件'));assert.equal(h.stats().recognitions,5);}finally{h.close();}
}
console.log('復旧・編集下書き・部分保存・同一画像・CSV失敗・精度境界の追加回帰チェック合格');
// Latest import wins; discarding candidates cancels a delayed file read.
{
 const h=eHarness();let resolve;
 try{h.get('restore').files=[{name:'slow.json',size:100,text:()=>new Promise(r=>resolve=r)}];const slow=h.get('restore').dispatch('change');h.get('restore').files=[{name:'fast.json',size:100,text:async()=>eEncode(seed)}];await h.get('restore').dispatch('change');resolve(eEncode(seed));await slow;assert.equal(h.eval('drafts.length'),1);}finally{h.close();}
}
{
 const h=eHarness();let resolve;
 try{h.get('restore').files=[{name:'slow.json',size:100,text:()=>new Promise(r=>resolve=r)}];const slow=h.get('restore').dispatch('change');await h.click('discard');resolve(eEncode(seed));await slow;assert.equal(h.eval('drafts.length'),0);}finally{h.close();}
}
{
 const h=eHarness({extras:{[E_DRAFT_KEY]:eDraftEncode([{...row,values:['123','','2K']}])}});
 try{h.store.fail=true;await h.click('exportCurrentDrafts');assert.equal(h.downloads.length,1);assert.equal(JSON.parse(await h.downloads[0].blob.text()).drafts[0].values[0],'123');h.memory.set(E_DRAFT_KEY,'other-screen');await h.click('discard');assert.equal(h.memory.get(E_DRAFT_KEY),'other-screen');}finally{h.close();}
}

{
 const rows=Array.from({length:101},(_,i)=>({...row,date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10)})),state=eArchive(seed,rows);assert.equal(state.trash.length,100);assert.equal(state.trash[0].row.date,rows.at(-1).date);assert.equal(state.trash.at(-1).row.date,rows[1].date);assert.deepEqual(eArchive(state,[]).trash,state.trash);
}
for(const raw of ['{','null','[]','{"rank":"E9"}','{"month":"2026-13"}']){const h=eHarness({extras:{[E_FILTER_KEY]:raw}});try{assert.equal(h.eval('app.records.length'),10);assert.equal(h.get('filterRank').value,'');assert.equal(h.get('count').textContent,'10件');assert.ok(h.get('status').textContent.includes('全件表示'));}finally{h.close();}}

{
 const h=eHarness();try{h.eval('for(let i=0;i<99;i++)addDraft({date:"",rank:"E1",close:"24",values:["","",""]});addBatch([E_SEEDS[0]])');assert.equal(h.eval('drafts.length'),100);await h.click('manual');assert.equal(h.eval('drafts.length'),100);assert.ok(h.get('status').textContent.includes('100件まで'));}finally{h.close();}
}
{
 const memory=new Map([[E_KEY,'broken'],[E_RECOVERY_KEY,'healthy-copy']]),store={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};assert.throws(()=>eWrite(store,seed,'broken'),/上書きを停止/);assert.equal(memory.get(E_KEY),'broken');assert.equal(memory.get(E_RECOVERY_KEY),'healthy-copy');
}

{
 const h=eHarness();try{h.eval('for(let i=0;i<95;i++)addDraft({date:"",rank:"E1",close:"24",values:["","",""]})');await h.click('fillMissing');assert.equal(h.eval('drafts.length'),95);assert.ok(h.get('status').textContent.includes('空きが不足'));h.eval('busy=true');await h.click('fillMissing');assert.equal(h.eval('drafts.length'),95);}finally{h.close();}
}
{
 const h=eHarness();try{await h.click('manual');const box=h.get('drafts').children[0],inputs=h.inputs(box);for(const [i,v] of ['2026-08-01','E','24','9000','1K','2K'].entries()){inputs[i].value=v;await inputs[i].dispatch('input');}await h.click('nextDraft');assert.equal(h.focus(),inputs[3]);assert.equal(inputs[3].getAttribute('aria-invalid'),'true');}finally{h.close();}
}
{
 const h=eHarness();try{h.eval('addBatch([E_SEEDS[0],E_SEEDS[1]])');const cb=h.inputs(h.get('drafts').children[0])[0];cb.checked=true;await cb.dispatch('change');assert.ok(h.get('draftReviewSummary').textContent.includes('記録 2件'));assert.ok(h.get('draftReviewSummary').textContent.includes('確認済み 1組'));await h.click('nextDraft');assert.ok(h.get('status').textContent.includes('すべての候補'));await h.click('reload');assert.ok(h.get('draftReviewSummary').textContent.includes('確認済み 0組'));}finally{h.close();}
}
