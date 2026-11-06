import assert from 'node:assert/strict';import {writeFile,readFile} from 'node:fs/promises';
import {E_SEEDS,E_SCHEMA,eDate,eShift,eRow,eValue,eMerge,eKey,eSort,eParseOCR,eBackup,eFilter,eCoverage,eCSV,eReadCSV,eToday} from '../calculator/e-border-core.mjs';
import {E_KEY,E_DRAFT_KEY,E_RECOVERY_KEY,eState,eEncode,eWrite,eRemove,eRestoreTrash,eDraftEncode,eDraftDecode,eDraftWrite,eMergeState,eArchive,eFilterPrefs,E_FILTER_KEY,eDraftPlan,eMissingDrafts} from '../calculator/e-border-store.mjs';
import {eTimed} from '../calculator/e-border-async.mjs';import {eHarness} from './e-border-harness.mjs';
const started=Date.now(),report={schema:'e-border-100-rounds-v1',scope:'Core/data invariants and actual shipped UI handlers with DOM/storage/OCR doubles. No browser or physical-device test.',rounds:[]};let assertions=0;
const eq=(a,b)=>{assert.deepEqual(a,b);assertions++;},ok=a=>{assert.ok(a);assertions++;},throws=fn=>{assert.throws(fn);assertions++;},plain=o=>JSON.parse(JSON.stringify(o));
const base=E_SEEDS[0],oldSource=JSON.stringify(E_SEEDS);let seed=0xA1782026;
function random(n){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;}
async function fill(h,box,row){const controls=h.inputs(box),v=[row.date,row.rank,row.close,...row.values];for(let i=0;i<6;i++){controls[i].value=v[i];await controls[i].dispatch('input');}const cb=controls.find(c=>c.type==='checkbox');cb.checked=true;await cb.dispatch('change');return controls;}
function recordBox(h,row){return h.get('records').children.find(box=>box.children.some(c=>c?.tagName==='STRONG'&&c.textContent.startsWith(row.date+' · '+row.rank+' · '+row.close+'時')));}
for(let round=1;round<=100;round++){
 const before=assertions,rank=['E1','E2','E3'][random(3)],close=['13','22','24'][random(3)],day=1+random(28),date='2026-08-'+String(day).padStart(2,'0'),values=[String(100+round),'1.'+(1+random(8))+'K','4.'+random(9)+'K'];
 const row=eRow({date,rank,close,values});
 eq(eRow(row),row);eq(eValue(values[1]).approx,true);eq(eValue(values[0]).approx,false);eq(eValue('１.６ｋ〜').text,'1.6K');eq(eValue('1,234').n,1234);
 const merged=eMerge(E_SEEDS,[row]);eq(merged.added,1);eq(merged.rows.length,11);eq(eMerge(merged.rows,[row]).same,1);eq(eMerge(merged.rows,[row,row]).rows.length,11);eq(JSON.stringify(E_SEEDS),oldSource);
 const changed={...row,values:[String(101+round),...values.slice(1)]};throws(()=>eMerge(merged.rows,[changed]));eq(eMerge(merged.rows,[changed],true).replaced,1);throws(()=>eMerge(merged.rows,[row,changed],true));
 for(const bad of ['','0','-1','1e3','NaN','1,,000','1000,000','1.2','1~2K','<img>','Infinity','1e999','9999999999'])throws(()=>eValue(bad));
 for(const bad of ['2026-02-30','2026-04-31','2026-13-01',eToday(),'2099-12-31'])throws(()=>eRow({...row,date:bad}));
 throws(()=>eRow({...row,values:[values[2],values[1],values[0]]}));throws(()=>eRow({...row,rank:'E'}));throws(()=>eRow({...row,close:'23'}));throws(()=>eRow({...row,pending:true}));throws(()=>eRow({...row,precision:'exact'}));
 const raw=JSON.stringify({schema:E_SCHEMA,records:merged.rows});eq(eBackup(raw),merged.rows);eq(eBackup('\uFEFF'+raw),merged.rows);throws(()=>eBackup('null'));throws(()=>eBackup('{'));throws(()=>eBackup(JSON.stringify({schema:'wrong',records:[]})));
 const state=eState(raw);eq(state.records.length,11);eq(eState(eEncode(state)),state);
 const deleted=eRemove(state,eKey(base));ok(deleted.hiddenSeeds.includes(eKey(base)));ok(!eState(eEncode(deleted)).records.some(r=>eKey(r)===eKey(base)));eq(deleted.trash.length,1);eq(eRestoreTrash(deleted,eKey(base)).records.length,11);
 const deletedNew=eRemove(state,eKey(row));eq(eState(eEncode(deletedNew)).records.length,10);eq(eRestoreTrash(deletedNew,eKey(row)).records.length,11);
 throws(()=>eRemove(state,'missing'));throws(()=>eRestoreTrash(state,'missing'));const conflict={...deletedNew,records:[...deletedNew.records,changed]};throws(()=>eRestoreTrash(conflict,eKey(row)));eq(eRestoreTrash(conflict,eKey(row),true).records.find(r=>eKey(r)===eKey(row)).values,values);
 const memory=new Map([[E_KEY,raw]]),storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};
 const saved=eWrite(storage,deleted,raw);eq(memory.get(E_RECOVERY_KEY),raw);eq(saved.state.records.length,10);throws(()=>eWrite(storage,state,raw));const snapshot=memory.get(E_KEY);eq(snapshot,saved.raw);
 const quota={getItem:k=>memory.get(k)??null,setItem:()=>{throw Error('QuotaExceededError');}};throws(()=>eWrite(quota,state,snapshot));eq(memory.get(E_KEY),snapshot);
 const copyBefore=memory.get(E_RECOVERY_KEY);eWrite(storage,state,snapshot,{preserveRecovery:true});eq(memory.get(E_RECOVERY_KEY),copyBefore);
 const csv=eCSV(merged.rows),back=eReadCSV(csv);eq(back.map(r=>[r.date,r.rank,r.close,...r.values]),merged.rows.map(r=>[r.date,r.rank,r.close,...r.values]));eq(eReadCSV(csv.replaceAll('\r\n','\n')).length,11);throws(()=>eReadCSV(csv.replace(',display',',exact')));throws(()=>eReadCSV('date,rank\n2026-08-01,E1'));throws(()=>eReadCSV('date,rank,close,zero,plus1,plus2,precision\n=1,E1,24,1,2,3,display'));
 const f={rank,close,start:'2026-08-01',end:'2026-08-31'},expected=merged.rows.filter(r=>r.rank===rank&&r.close===close&&r.date>='2026-08-01'&&r.date<='2026-08-31');eq(eFilter(merged.rows,f),expected);eq(eFilter(merged.rows,{...f,order:'old'}),expected.slice().reverse());eq(eFilter(merged.rows,{month:'2026-08'}).length,1);throws(()=>eFilter(merged.rows,{start:'2026-09-30',end:'2026-08-01'}));
 const end='2026-08-28',coverage=eCoverage([row],rank,close,end,7),dates=[];for(let i=0;i<7;i++){const d=new Date('2026-08-22T00:00:00Z');d.setUTCDate(d.getUTCDate()+i);dates.push(d.toISOString().slice(0,10));}eq(coverage.missing,dates.filter(d=>d!==row.date));eq(coverage.recorded,dates.includes(row.date)?1:0);throws(()=>eCoverage([],rank,close,end,0));
 const text='2026年8月'+day+'日 0:00:00 JST\n2026年8月'+day+'日 23:59:59 JST\n締め時間'+close+':00:00 JST',ocr=eParseOCR(text,rank,'±0 '+values[0]+' +1 '+values[1]+' +2 '+values[2]+' 1位999K');eq(ocr.date,date);eq(ocr.rank,rank);eq(ocr.close,close);eq(ocr.values,values);eq(eParseOCR('2026年8月31日22:00\n2026年9月1日21:59\n締め時間22:00','E1','').date,'2026-09-01');eq(eParseOCR('2026年8月1日\n2026年9月1日\n締め時間24:00','E1','').date,'');eq(eParseOCR(text,'E1 E2','').rank,'');eq(eParseOCR(text+'集計中',rank,'').pending,true);
 const draftRaw=eDraftEncode([{...row,values:['','1.6K',''],original:row}]),draft=eDraftDecode(draftRaw)[0];eq(draft.values,['','1.6K','']);eq(draft.original,row);throws(()=>eDraftDecode('null'));throws(()=>eDraftEncode(Array(101).fill(row)));
 // Draft integrity and cross-screen collision checks use different values in every round.
 const partial={...row,values:[String(round),'','4K']},dm=new Map(),ds={getItem:k=>dm.get(k)??null,setItem:(k,v)=>dm.set(k,v),removeItem:k=>dm.delete(k)};
 const dr=eDraftWrite(ds,[partial],null);eq(eDraftDecode(dr)[0].values,partial.values);dm.set(E_DRAFT_KEY,'other-'+round);throws(()=>eDraftWrite(ds,[],dr));eq(dm.get(E_DRAFT_KEY),'other-'+round);
 throws(()=>eDraftEncode([{...partial,values:['x'.repeat(41),'','']} ]));throws(()=>eDraftEncode([{...partial,values:[round,'','']} ]));
 const dh=eHarness({extras:{[E_DRAFT_KEY]:eDraftEncode([partial])}});
 try{
  dh.memory.set(E_DRAFT_KEY,'remote-'+round);await dh.event('pagehide');eq(dh.memory.get(E_DRAFT_KEY),'remote-'+round);ok(dh.get('draftStatus').textContent.includes('別の画面'));
  await dh.click('exportCurrentDrafts');eq(eDraftDecode(await dh.downloads.at(-1).blob.text())[0].values,partial.values);
  dh.get('restore').files=[{name:'drafts.json',size:100,text:async()=>eDraftEncode([{...partial,values:[String(round+1),'','4K']}])}];await dh.get('restore').dispatch('change');eq(dh.eval('drafts.length'),2);eq(dh.inputs(dh.get('drafts').children[1]).at(-1).checked,false);
 }finally{dh.close();}
 // First-write recovery, canonical backup, BOM and invalid aggregation-state regressions.
 eq(eState('\uFEFF'+eEncode(state)),state);
 const firstMemory=new Map(),firstStore={getItem:k=>firstMemory.get(k)??null,setItem:(k,v)=>firstMemory.set(k,v)};
 const first=eWrite(firstStore,state,null);eq(eState(firstMemory.get(E_RECOVERY_KEY)).records.length,10);eq(first.recoverySaved,true);
 const dirty={...state,records:[row,row],hiddenSeeds:[]};eq(JSON.parse(eEncode(dirty)).records.length,11);eq(eState(eEncode(dirty)).records.length,11);
 throws(()=>eRow({...row,pending:'false'}));throws(()=>eDraftEncode([{...partial,pending:'true'}]));
 const bh=eHarness();
 try{
  const latest={...eState(null),records:eMerge(E_SEEDS,[row]).rows};bh.memory.set(E_KEY,eEncode(latest));await bh.click('export');eq(eBackup(await bh.downloads.at(-1).blob.text()).length,11);eq(bh.eval('app.records.length'),10);
  bh.get('restore').files=[{name:'bom.json',size:100,text:async()=>'\uFEFF'+eEncode(latest)}];await bh.get('restore').dispatch('change');eq(bh.eval('drafts.length'),1);
  ok(!bh.eval('recordText([{date:"2026-08-01",rank:"E1",close:"24",values:["100","200","300"]}])').includes('概数'));ok(bh.eval('recordText(app.records)').includes('概数'));
 }finally{bh.close();}
 // Improvement review: replacing values must retain the previous values and allow a reversible restoration.
 const replaceState=eMergeState(state,[changed],true);eq(replaceState.replaced,1);eq(replaceState.state.trash.find(t=>eKey(t.row)===eKey(row)).row.values,row.values);
 const undone=eRestoreTrash(replaceState.state,eKey(row),true);eq(undone.records.find(r=>eKey(r)===eKey(row)).values,row.values);eq(undone.trash.find(t=>eKey(t.row)===eKey(row)).row.values,changed.values);
 eq(eArchive(undone,[]).trash,undone.trash);eq(eState(eEncode(undone)).trash,undone.trash);throws(()=>eState(JSON.stringify({schema:E_SCHEMA,records:[],trash:[...undone.trash,...undone.trash]})));
 eq(eFilterPrefs({rank,close,month:'2026-08'}).order,'new');throws(()=>eFilterPrefs({month:'2026-13'}));throws(()=>eFilterPrefs({rank:'E4'}));throws(()=>eFilterPrefs({start:'2026-09-01',end:'2026-08-01'}));throws(()=>eFilterPrefs({approx:'false'}));
 const fh=eHarness();
 try{
  fh.get('filterRank').value=rank;fh.get('filterClose').value=close;fh.get('filterMonth').value='2026-08';await fh.get('filterMonth').dispatch('change');const savedFilter=fh.memory.get(E_FILTER_KEY);eq(JSON.parse(savedFilter).rank,rank);
  const reopened=eHarness({extras:{[E_FILTER_KEY]:savedFilter}});try{eq(reopened.get('filterRank').value,rank);eq(reopened.get('filterClose').value,close);eq(reopened.get('filterMonth').value,'2026-08');await reopened.click('resetFilters');eq(JSON.parse(reopened.memory.get(E_FILTER_KEY)).rank,'');}finally{reopened.close();}
  fh.memory.set(E_DRAFT_KEY+'-unreadable','damaged-'+round);await fh.click('downloadUnreadableDrafts');eq(await fh.downloads.at(-1).blob.text(),'damaged-'+round);
 }finally{fh.close();}
 const rh=eHarness({initial:eEncode(state)});
 try{
  await rh.click('manual');await fill(rh,rh.get('drafts').children[0],changed);rh.get('replace').checked=true;await rh.click('save');eq(plain(rh.eval('app.trash.find(t=>eKey(t.row)==='+JSON.stringify(eKey(row))+').row.values')),values);
  rh.get('trashPanel').open=true;await rh.get('trashPanel').dispatch('toggle');await rh.buttons(rh.get('trash'))[0].dispatch('click');eq(plain(rh.eval('app.records.find(r=>eKey(r)==='+JSON.stringify(eKey(row))+').values')),values);eq(plain(rh.eval('app.trash[0].row.values')),changed.values);
 }finally{rh.close();}
 // No-change saves preserve recovery; draft planning deduplicates only identical input.
 const unchangedMemory=new Map([[E_KEY,eEncode(state)],[E_RECOVERY_KEY,'keep-'+round]]),unchangedWrites=[],unchangedStore={getItem:k=>unchangedMemory.get(k)??null,setItem:(k,v)=>{unchangedWrites.push(k);unchangedMemory.set(k,v);}};
 const noChange=eWrite(unchangedStore,state,unchangedMemory.get(E_KEY));eq(noChange.unchanged,true);eq(unchangedWrites,[]);eq(unchangedMemory.get(E_RECOVERY_KEY),'keep-'+round);eq(noChange.state.lastChangedAt,state.lastChangedAt);
 const plan=eDraftPlan([partial],[partial,partial,{...partial,values:[String(round+10),'','4K']}]);eq(plan.duplicates,2);eq(plan.rows.length,1);eq(plan.rows[0].values[0],String(round+10));eq(eDraftPlan([partial],[partial],100).rows.length,0);throws(()=>eDraftPlan([partial],[{...partial,date:'2026-07-01'}],100));
 const nh=eHarness({initial:eEncode(state),extras:{[E_RECOVERY_KEY]:'keep-'+round}});
 try{
  const rec=recordBox(nh,row);await nh.buttons(rec)[0].dispatch('click');const checked=nh.inputs(nh.get('drafts').children[0]).at(-1);checked.checked=true;await checked.dispatch('change');const oldRaw=nh.memory.get(E_KEY);await nh.click('save');eq(nh.memory.get(E_KEY),oldRaw);eq(nh.memory.get(E_RECOVERY_KEY),'keep-'+round);eq(nh.eval('app.trash.length'),0);ok(nh.get('status').textContent.includes('変更はありません'));
  nh.get('restore').files=[{name:'drafts.json',size:100,text:async()=>eDraftEncode([partial,partial])}];await nh.get('restore').dispatch('change');eq(nh.eval('drafts.length'),1);ok(nh.get('status').textContent.includes('1件を省略'));
  nh.get('restore').files=[{name:'drafts.json',size:100,text:async()=>eDraftEncode([partial])}];await nh.get('restore').dispatch('change');eq(nh.eval('drafts.length'),1);
 }finally{nh.close();}
 // Daily convenience review: missing-day batch, progress, keyboard focus and midnight refresh.
 const pendingDay={date:coverage.missing[0],rank,close,values:['','','']},missingPlan=eMissingDrafts([row],[pendingDay],rank,close,1,end);eq(missingPlan.rows.length,coverage.missing.length-1);eq(missingPlan.queued,1);ok(missingPlan.rows.every(r=>r.values.every(v=>v==='')));throws(()=>eMissingDrafts([],[],rank,close,100,end));
 const mh=eHarness();
 try{
  mh.get('trackRank').value=rank;mh.get('trackClose').value=close;await mh.get('trackClose').dispatch('change');await mh.click('manual');await mh.click('fillMissing');eq(mh.eval('drafts.length'),7);await mh.click('fillMissing');eq(mh.eval('drafts.length'),7);ok(mh.get('status').textContent.includes('0日分'));
  const first=mh.get('drafts').children[0],second=mh.get('drafts').children[1];await mh.click('nextDraft');eq(mh.focus(),mh.inputs(first)[3]);const raw=plain(mh.eval('drafts[0].raw()'));await fill(mh,first,{...raw,values:['100','1K','2K']});ok(mh.get('draftReviewSummary').textContent.includes('確認済み 1組'));await mh.click('nextDraft');eq(mh.focus(),mh.inputs(second)[3]);
  mh.inputs(first)[3].value='101';await mh.inputs(first)[3].dispatch('input');ok(mh.get('draftReviewSummary').textContent.includes('確認済み 0組'));const unchanged=plain(mh.eval('drafts[0].raw()'));mh.setNow('2026-10-19T00:01:00+09:00');mh.eval('refreshCalendar()');eq(mh.inputs(first)[0].max,'2026-10-18');eq(mh.get('filterEnd').max,'2026-10-18');eq(plain(mh.eval('drafts[0].raw()')),unchanged);ok(mh.get('latest').textContent.includes('2026-10-18'));await mh.click('fillMissing');eq(mh.eval('drafts.length'),8);eq(mh.memory.get(E_KEY),undefined);
  const dateInput=mh.inputs(first)[0];dateInput.value='2026-10-19';await dateInput.dispatch('input');eq(dateInput.getAttribute('aria-invalid'),'true');mh.setNow('2026-10-20T00:01:00+09:00');mh.eval('refreshCalendar()');eq(dateInput.getAttribute('aria-invalid'),null);eq(dateInput.value,'2026-10-19');
 }finally{mh.close();}
 // Run the actual UI handlers: add, confirm, save, edit, delete, restore, export, copy, storage conflict.
 const h=eHarness({lock:round%2===0,clipboardFail:round%5===0});
 try{
  eq(h.eval('app.records.length'),10);eq(h.get('trackRank').value,'E1');eq(h.get('filterRank').children.map(o=>o.value),['','E1','E2','E3']);
  await h.click('manual');const box=h.get('drafts').children[0];eq(h.inputs(box).length,7);await h.click('save');eq(h.eval('app.records.length'),10);ok(h.get('status').className.includes('error'));
  await fill(h,box,row);await h.event('pagehide');ok(h.memory.has(E_DRAFT_KEY));await h.click('save');eq(h.eval('app.records.length'),11);eq(h.eval('drafts.length'),0);ok(!h.memory.has(E_DRAFT_KEY));
  eq(plain(h.eval('app.records.find(r=>r.date==="'+date+'"&&r.rank==="'+rank+'"&&r.close==="'+close+'")')).values,values);
  let rec=recordBox(h,row);ok(rec);await h.buttons(rec)[0].dispatch('click');await fill(h,h.get('drafts').children[0],changed);await h.click('save');eq(h.eval('app.records.length'),11);eq(h.eval('app.trash.length'),1);
  rec=recordBox(h,row);await h.buttons(rec)[2].dispatch('click');eq(h.eval('app.records.length'),10);eq(eState(h.memory.get(E_KEY)).records.length,10);
  h.get('trashPanel').open=true;await h.get('trashPanel').dispatch('toggle');await h.buttons(h.get('trash'))[0].dispatch('click');eq(h.eval('app.records.length'),11);eq(h.eval('app.trash.length'),0);
  h.get('filterRank').value=rank;h.get('filterClose').value=close;h.get('filterMonth').value='2026-08';await h.get('filterMonth').dispatch('change');eq(h.get('count').textContent,'1件');await h.click('copy');if(round%5===0){eq(h.get('copyFallback').hidden,false);ok(h.get('copyText').value.includes(date));}else ok(h.copy.at(-1).includes(date));
  await h.click('csv');const download=h.downloads.at(-1);ok(download.name.endsWith('.csv'));eq(eReadCSV(await download.blob.text()).length,1);
  await h.click('export');eq(eBackup(await h.downloads.at(-1).blob.text()).length,11);
  await h.click('manual');await fill(h,h.get('drafts').children[0],{...row,date:'2026-07-01'});const rawBefore=h.memory.get(E_KEY);h.memory.set(E_KEY,JSON.stringify({schema:E_SCHEMA,records:E_SEEDS}));await h.click('save');ok(h.get('status').textContent.includes('別の画面'));eq(h.eval('drafts.length'),1);eq(h.memory.get(E_KEY),JSON.stringify({schema:E_SCHEMA,records:E_SEEDS}));await h.click('reload');eq(h.eval('drafts.length'),1);eq(h.inputs(h.get('drafts').children[0]).at(-1).checked,false);
  ok(rawBefore!==h.memory.get(E_KEY));
 }finally{h.close();}
 report.rounds.push({round,seed,rank,close,date,assertions:assertions-before,passed:true,reviewAreas:['replacement history','reversible restore','trash order','duplicate rejection','filter validation','filter persistence','damaged draft export','no-change save','draft deduplication','draft capacity','missing-day batch','confirmation progress','draft focus','midnight refresh']});
}
// Failure/cancellation paths are independent of the 100 varied rounds.
for(const bad of ['{','null',JSON.stringify({schema:E_SCHEMA,records:[{...base,values:['9','1','2']}]})]){const h=eHarness({initial:bad});try{eq(h.eval('storageBlocked'),true);await h.click('export');ok(h.get('status').textContent.includes('そのまま保存'));eq(h.memory.get(E_KEY),bad);}finally{h.close();}}
{
 const h=eHarness({failStore:true});try{await h.click('manual');await fill(h,h.get('drafts').children[0],{date:'2026-07-01',rank:'E1',close:'24',values:['100','1K','2K']});await h.click('save');eq(h.eval('app.records.length'),10);eq(h.eval('drafts.length'),1);ok(h.get('status').textContent.includes('保存できません'));}finally{h.close();}
}
{
 const raw=eDraftEncode([{date:'2026-08-01',rank:'E1',close:'24',values:['123','','4K']}]),h=eHarness({extras:{[E_DRAFT_KEY]:raw}});try{eq(h.eval('drafts.length'),1);eq(h.inputs(h.get('drafts').children[0]).at(-1).checked,false);eq(h.inputs(h.get('drafts').children[0])[3].value,'123');}finally{h.close();}
}
{
 const h=eHarness({workerMode:'createHang'});try{h.get('images').files=[{size:100,type:'image/png',name:'test.png'}];const running=h.get('images').dispatch('change');for(let n=0;n<8;n++)await Promise.resolve();await h.click('cancel');await running;eq(h.eval('busy'),false);eq(h.get('chooseImages').disabled,false);ok(h.get('status').textContent.includes('中止'));}finally{h.close();}
}
{
 const h=eHarness();try{h.get('images').files=[{size:100,type:'image/png',name:'test.png',arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer}];await h.get('images').dispatch('change');eq(h.eval('drafts.length'),1);const item=plain(h.eval('drafts[0].raw()'));eq(item.date,'2026-08-01');eq(item.rank,'E1');eq(item.close,'24');eq(item.values,['250','1.6K','4.8K']);eq(h.stats().recognitions,5);ok(h.stats().terminations>=1);eq(h.get('chooseImages').disabled,false);eq(h.eval('app.records.length'),10);}finally{h.close();}
}
{
 const controller=new AbortController();const pending=eTimed(new Promise(()=>{}),10000,controller.signal);controller.abort();await assert.rejects(pending,/中止/);assertions++;await assert.rejects(eTimed(new Promise(()=>{}),1,null,'timeout'),/timeout/);assertions++;eq(await eTimed(Promise.resolve('ok'),100), 'ok');
}
report.totalAssertions=assertions;report.roundCount=report.rounds.length;report.durationMs=Date.now()-started;report.completedAt=new Date().toISOString();report.passed=true;
await writeFile(new URL('../docs/e-border-100-rounds.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({rounds:report.roundCount,assertions,durationMs:report.durationMs,passed:true,browserTested:false}));
