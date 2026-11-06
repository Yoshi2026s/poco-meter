import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {createRequire} from 'node:module';
import {normalizeHistoryRows,mergeHistoryRows,localHistoryRows,createHistoryIndex,filterHistory,historyMonthRange,recentHistoryRange,historyPage,historyNumber,validHistoryDate,historySource,HISTORY_RANKS} from '../calculator/history-core.mjs';
const datasets=['history-2025-2026.json','history-2026-10-02-03.json','seed.json'].flatMap(name=>JSON.parse(fs.readFileSync(new URL('../db/'+name,import.meta.url),'utf8')));
const records=mergeHistoryRows(normalizeHistoryRows(datasets)),index=createHistoryIndex(records);
test('Date/month boundaries, exact pt and rounded K units, empty data and missing ranks remain distinct from zero',()=>{
 for(const date of ['2026-02-30','2026-13-01','2026-00-01','2026-99-99','bad',null])assert.equal(validHistoryDate(date),false);
 assert.equal(historyMonthRange('2024-02').end,'2024-02-29');assert.equal(historyMonthRange('2025-02').end,'2025-02-28');assert.equal(historyMonthRange('2025-12',1).start,'2026-01-01');assert.equal(historyMonthRange('2026-01',-1).month,'2025-12');
 assert.equal(historyNumber(1001,'K'),'1K');assert.equal(historyNumber(1000,'K'),'1K');assert.equal(historyNumber(0),'0');assert.equal(historyNumber(null),'—');for(const size of [10,20,30,50]){const rows=Array.from({length:121},(_,i)=>i);assert.deepEqual(historyPage(rows,0,size).rows,rows.slice(0,size));assert.equal(historyPage(rows,999999,size).page,Math.ceil(rows.length/size));assert.equal(historyPage(rows,1.5,size).page,1);}
 for(const [value,text] of [[0,'0K'],[1,'0K'],[499,'0K'],[500,'1K'],[999,'1K'],[1499,'1K'],[1500,'2K'],[123499,'123K'],[123500,'124K'],[999499,'999K'],[999500,'1,000K']]){assert.equal(historyNumber(value,'K'),text);assert.equal(historyNumber(value,'pt'),value.toLocaleString('ja-JP'));}
 for(const limit of [Math.floor(Number.MAX_SAFE_INTEGER/25),Number.MAX_SAFE_INTEGER])for(let offset=0;offset<=2000;offset++){const value=limit-offset;assert.equal(BigInt(historyNumber(value,'K').replaceAll(',','').slice(0,-1)),(BigInt(value)+500n)/1000n);}
 for(const value of [NaN,Infinity,-1,1.5,'500',undefined,Number.MAX_SAFE_INTEGER+1])assert.equal(historyNumber(value,'K'),'—');
 assert.ok(filterHistory(index,{start:'2026-10-05',end:'2026-10-01'}).error);assert.equal(filterHistory(index,{rank:'X'}).rows.length,0);assert.equal(filterHistory(index,{rank:'E'}).rows.length,0);
 const range=recentHistoryRange(index,{rank:'S2',close:'22'},7);assert.equal((Date.parse(range.end)-Date.parse(range.start))/864e5,6);
});
test('Local and compact stored records are read without any mutation and personal values survive live refresh',()=>{
 const state={target:'900000',current:'700000',rank:'S2',log:{'2026-10-01':{S2:[1,2,3]}},provenancePacked:{version:1,pool:[{origin:'manual',source:'https://evil.example',checkedAt:'x'}],refs:{22:{'2026-10-01':{S2:0}}}}};const raw=JSON.stringify(state);
 const local=localHistoryRows(raw);assert.equal(local.length,1);assert.equal(local[0].origin,'manual');assert.equal(local[0].source,'');assert.equal(JSON.stringify(state),raw);
 const live=normalizeHistoryRows([{date:'2026-10-01',close:'22',ranks:{S2:[100,200,300]}}],'remote');assert.deepEqual(mergeHistoryRows([],local,live)[0].values,[1,2,3]);
 assert.equal(localHistoryRows('{broken').length,0);assert.equal(localHistoryRows('x'.repeat(8*1024*1024+1)).length,0);
 for(const url of ['javascript:alert(1)','http://one-carat.com/campus/archives/1','https://one-carat.com.evil.example/campus/archives/1','https://u:p@one-carat.com/campus/archives/1'])assert.equal(historySource(url),'');
});
test('Independent page is sealed, has usable labels and preserves a bounded read-only interface',()=>{
 const html=fs.readFileSync(new URL('../calculator/border-history.html',import.meta.url),'utf8');const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);assert.equal(ids.length,new Set(ids).size);
 for(const id of ['query','rank','close','month','start','end','units','order','origin','view','pageSize','pageJump'])assert.match(html,new RegExp('for="'+id+'"'));
 assert.match(html,/max-width:350px/);assert.match(html,/min-height:44px/);assert.match(html,/font-size:16px/);assert.match(html,/filter-chip\{[^}]*overflow-wrap:anywhere/);assert.match(html,/role="status" aria-live="polite"/);
 assert.match(html,/script-src 'sha256-/);assert.doesNotMatch(html,/script-src 'unsafe-inline'/);
 const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1]);const require=createRequire(import.meta.url);const {parse}=(()=>{try{return require('next/dist/compiled/acorn');}catch{return require('acorn');}})();scripts.forEach(s=>parse(s,{ecmaVersion:'latest',sourceType:'module'}));
 const ui=fs.readFileSync(new URL('../calculator/history-ui.mjs',import.meta.url),'utf8');assert.doesNotMatch(ui,/localStorage\.setItem\(MAIN_KEY/);assert.doesNotMatch(ui,/\.innerHTML\s*=/);assert.match(ui,/slice=historyPage/);
});
test('10000 distinct filter/date/pagination/unit conditions, repeated for ten independently checked rounds',()=>{
 const cases=[],seen=new Set();for(let i=0;i<10000;i++){
  const row=records[(i*71)%records.length],anchor=records[(i*137+91)%records.length],dateA=row.date,dateB=anchor.date;
  const f={rank:i%19===0?'':HISTORY_RANKS[i%18],close:i%4===0?'':['13','22','24'][i%3],start:dateA<dateB?dateA:dateB,end:dateA>dateB?dateA:dateB,order:i%2?'old':'new',query:i%17===0?row.date.replaceAll('-','/'):i%13===0?row.rank:'',origin:i%23===0?'published':''};
  const signature=JSON.stringify(f);if(seen.has(signature)){f.start=row.date;f.end=row.date;f.query=(i%2?row.rank+' ':'')+String(row.values[i%3]);}
  const expected=records.filter(r=>(!f.rank||r.rank===f.rank)&&(!f.close||r.close===f.close)&&r.date>=f.start&&r.date<=f.end&&(!f.origin||!['manual','backup','saved'].includes(r.origin))&&(!f.query||r.date===f.query.replaceAll('/','-')||r.rank===f.query||f.query.split(' ').every(t=>t===r.rank||r.values.some(v=>String(v).includes(t))))).sort((a,b)=>(f.order==='old'?a.date.localeCompare(b.date):b.date.localeCompare(a.date))||Number(a.close)-Number(b.close)||HISTORY_RANKS.indexOf(a.rank)-HISTORY_RANKS.indexOf(b.rank));
  // Number matching also includes date/close tokens; date or rank text makes the rare duplicate fallback unambiguous.
  if(seen.has(signature))f.query='';
  const sig=JSON.stringify({...f,page:(i%120)+1,size:[10,20,30,50][i%4],units:i%3?'pt':'K'});assert.ok(!seen.has(sig),'Matrix conditions must be distinct');seen.add(sig);
  cases.push({f,expected:expected.map(r=>r.date+'|'+r.close+'|'+r.rank),page:i%120+1,size:[10,20,30,50][i%4],units:i%3?'pt':'K'});
  assert.deepEqual(filterHistory(index,f).rows.map(r=>r.date+'|'+r.close+'|'+r.rank),expected.map(r=>r.date+'|'+r.close+'|'+r.rank));
 }
 let assertions=0;for(let round=0;round<10;round++){
  for(let j=0;j<cases.length;j++){const i=(j*7919+round*37)%cases.length,c=cases[i],actual=filterHistory(index,c.f);assert.deepEqual(actual.rows.map(r=>r.date+'|'+r.close+'|'+r.rank),c.expected);const page=historyPage(actual.rows,c.page,c.size);assert.ok(page.rows.length<=c.size);assert.equal(page.pages,Math.max(1,Math.ceil(c.expected.length/c.size)));assert.equal(page.page,Math.min(page.pages,c.page));
   for(const row of page.rows){assert.ok(row.values.every(Number.isSafeInteger));for(const value of row.values){const text=historyNumber(value,c.units);assert.ok(!/NaN|Infinity|undefined/.test(text));if(c.units==='K'){const s=text.replaceAll(',','').slice(0,-1);assert.equal(BigInt(s),(BigInt(value)+500n)/1000n);}}}assertions++;
  }console.log('HISTORY_ROUND '+JSON.stringify({round:round+1,conditions:10000,status:'passed'}));
 }assert.equal(assertions,100000);console.log('HISTORY_MATRIX '+JSON.stringify({rounds:10,conditionsPerRound:10000,total:assertions,records:records.length,scope:'Actual shipped core; no physical-phone rendering'}));
});
