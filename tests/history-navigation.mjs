import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistoryIndex, filterHistory, historyRecordDates, latestHistoryDate, adjacentHistoryDate, historyRecordNavigation, recentHistoryRange, historyMonthRange, localHistoryRows, mergeHistoryRows, historyCardText} from '../calculator/history-core.mjs';

const row=(date,origin='archive',close='22',rank='S2')=>({date,origin,close,rank,values:[0,1001,2002],source:'https://one-carat.com/campus/archives/123',checkedAt:'2026-10-17T00:00:00Z'});
const rows=[row('2026-09-28'),row('2026-10-02','remote'),row('2026-10-02','verified','13'),row('2026-10-03','manual'),row('2026-10-03','backup','22','S1'),row('2026-10-05','import'),row('2026-10-07','saved','24'),row('2026-10-09','manual','22','S1'),row('2026-11-01','remote','13')];
const index=createHistoryIndex(rows),scope={rank:'S2',close:'22'};

test('latest date, latest month and recent ranges respect the same rank, cutoff and origin',()=>{
 assert.equal(latestHistoryDate(index,scope),'2026-10-05');
 assert.equal(latestHistoryDate(index,{...scope,origin:'personal'}),'2026-10-05');
 assert.equal(latestHistoryDate(index,{...scope,origin:'published'}),'2026-10-02');
 assert.equal(historyMonthRange(latestHistoryDate(index,{rank:'S2',origin:'published'}).slice(0,7)).month,'2026-11');
 assert.equal(historyMonthRange(latestHistoryDate(index,{rank:'S2',origin:'personal'}).slice(0,7)).month,'2026-10');
 assert.deepEqual(recentHistoryRange(index,{...scope,origin:'published'},7),{start:'2026-09-26',end:'2026-10-02'});
 assert.deepEqual(recentHistoryRange(index,{...scope,origin:'personal'},30),{start:'2026-09-06',end:'2026-10-05'});
});

test('record dates ignore replaced range, keyword and order while retaining origin scope',()=>{
 const filters={...scope,origin:'personal',query:'存在しない検索',start:'2026-12-20',end:'2026-01-01',order:'old'};
 assert.deepEqual(historyRecordDates(index,filters),['2026-10-05','2026-10-03']);
 assert.equal(latestHistoryDate(index,filters),'2026-10-05');
 assert.deepEqual(recentHistoryRange(index,filters,7),{start:'2026-09-29',end:'2026-10-05'});
});

test('navigation deduplicates dates across ranks and cutoffs and skips unrecorded days',()=>{
 assert.deepEqual(historyRecordDates(index),['2026-11-01','2026-10-09','2026-10-07','2026-10-05','2026-10-03','2026-10-02','2026-09-28']);
 assert.equal(adjacentHistoryDate(index,scope,'2026-10-04',-1),'2026-10-03');
 assert.equal(adjacentHistoryDate(index,scope,'2026-10-04',1),'2026-10-05');
 assert.equal(adjacentHistoryDate(index,scope,'2026-10-03',-1),'2026-10-02');
 assert.equal(adjacentHistoryDate(index,scope,'2026-10-03',1),'2026-10-05');
 assert.equal(adjacentHistoryDate(index,{...scope,origin:'published'},'2026-10-03',-1),'2026-10-02');
 assert.equal(adjacentHistoryDate(index,{...scope,origin:'published'},'2026-10-03',1),null);
 assert.equal(adjacentHistoryDate(index,scope,'2026-09-28',-1),null);
 assert.equal(adjacentHistoryDate(index,scope,'2026-10-05',1),null);
});

test('single-day and range navigation use end then start then latest without wrapping at boundaries',()=>{
 assert.deepEqual(historyRecordNavigation(index,{...scope,start:'2026-10-04',end:'2026-10-04'}),{latest:'2026-10-05',previous:'2026-10-03',next:'2026-10-05',anchor:'2026-10-04',count:4});
 assert.deepEqual(historyRecordNavigation(index,{...scope,start:'2026-09-01',end:'2026-10-02'}),{latest:'2026-10-05',previous:'2026-09-28',next:'2026-10-03',anchor:'2026-10-02',count:4});
 assert.equal(historyRecordNavigation(index,{...scope,start:'2026-10-03'}).anchor,'2026-10-03');
 assert.deepEqual(historyRecordNavigation(index,scope),{latest:'2026-10-05',previous:'2026-10-03',next:null,anchor:'2026-10-05',count:4});
});

test('empty or invalid record scopes return no invented dates or zero-valued records',()=>{
 for(const filters of [{rank:'E'},{rank:'X'},{close:'12'},{origin:'unknown'},null]){
  assert.deepEqual(historyRecordDates(index,filters),[]);
  assert.equal(latestHistoryDate(index,filters),null);
  assert.equal(recentHistoryRange(index,filters,7),null);
  assert.equal(adjacentHistoryDate(index,filters,'2026-10-03',-1),null);
 }
 assert.deepEqual(historyRecordNavigation(createHistoryIndex([])),{latest:null,previous:null,next:null,anchor:null,count:0});
 assert.deepEqual(historyRecordNavigation(index,{rank:'E',end:'2026-10-03'}),{latest:null,previous:null,next:null,anchor:'2026-10-03',count:0});
 for(const date of ['2026-02-30','1999-12-31','2100-01-01','',null])assert.equal(adjacentHistoryDate(index,scope,date,1),null);
 for(const direction of [0,2,-2,'1',null])assert.equal(adjacentHistoryDate(index,scope,'2026-10-03',direction),null);
 for(const days of [0,1,8,31,'7',null])assert.equal(recentHistoryRange(index,scope,days),null);
});

test('latest seven and thirty days stay inside supported year bounds',()=>{
 const first=createHistoryIndex([row('2000-01-01')]);
 for(const days of [7,30]){
  const range=recentHistoryRange(first,{},days);
  assert.deepEqual(range,{start:'2000-01-01',end:'2000-01-01'});
  assert.equal(filterHistory(first,range).error,'');
 }
 assert.deepEqual(recentHistoryRange(createHistoryIndex([row('2000-01-10')]),{},30),{start:'2000-01-01',end:'2000-01-10'});
 assert.deepEqual(recentHistoryRange(createHistoryIndex([row('2099-12-31')]),{},7),{start:'2099-12-25',end:'2099-12-31'});
});

test('legacy and packed imported records retain source metadata and remain personal across live refresh',()=>{
 const meta={origin:'import',source:'https://one-carat.com/campus/archives/123',checkedAt:'2026-10-17T00:00:00Z'};
 for(const packed of [false,true]){
  const state={target:'private',current:'private',log:{'2026-10-05':{S2:[0,1001,2002]}},...(packed?{provenancePacked:{version:1,pool:[meta],refs:{22:{'2026-10-05':{S2:0}}}}}:{provenance:{22:{'2026-10-05':{S2:meta}}}})};
  const raw=JSON.stringify(state),local=localHistoryRows(raw);
  assert.deepEqual(local,[row('2026-10-05','import')]);
  assert.equal(JSON.stringify(state),raw);
  const merged=mergeHistoryRows([],local,[{...row('2026-10-05','remote'),values:[9999,99999,999999]}]),idx=createHistoryIndex(merged);
  assert.deepEqual(merged,local);
  assert.equal(filterHistory(idx,{origin:'personal'}).rows.length,1);
  assert.equal(filterHistory(idx,{origin:'published'}).rows.length,0);
  assert.match(historyCardText(local[0]),/記録：CSV・貼り付け/);
  assert.match(historyCardText(local[0]),/±0：0 pt/);
  assert.match(historyCardText(local[0]),/https:\/\/one-carat\.com\/campus\/archives\/123/);
 }
});

test('all navigation and origin filtering leave record values, metadata and input order untouched',()=>{
 const before=JSON.stringify(rows),preferences={...scope,origin:'personal',start:'2026-10-01',end:'2026-10-03',query:'S2'};
 const saved=JSON.stringify(preferences);
 historyRecordDates(index,preferences);latestHistoryDate(index,preferences);adjacentHistoryDate(index,preferences,'2026-10-03',1);historyRecordNavigation(index,preferences);recentHistoryRange(index,preferences,30);filterHistory(index,preferences);
 assert.equal(JSON.stringify(rows),before);
 assert.equal(JSON.stringify(preferences),saved);
});
