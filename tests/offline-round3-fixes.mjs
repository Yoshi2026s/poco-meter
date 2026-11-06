import test from 'node:test';
import assert from 'node:assert/strict';
import {engine,pageEngine,plain} from './calculator-harness.mjs';

const KEY='pococha-meter-calc-v1',DRAFT=KEY+'-drafts';
const base=()=>({...plain(engine().state),pick:'',target:'2000',current:'500',
  rank:'S2',coreCount:'40',seedVer:3,seedVer13:1,snapshotVersion:'2026-10-02-v3',
  goalDefaultsVersion:1,log:{'2026-09-01':{S2:[100,200,300]}},log13:{},log24:{},provenance:{}});
const origin=()=>({kind:'analysis',value:2000,periodLabel:'全期間',period:'all',
  start:'2026-09-01',end:'2026-09-30',rank:'S2',close:'22',border:0,
  method:'mean',n:30,buffer:0,unit:1});
function input(p,id,value,type='input'){p.element(id).value=value;p.element(id).dispatchEvent(new Event(type));}
function memory(seed){const map=new Map(Object.entries(seed));return {map,getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};}
function page(options={}){const m=memory({[KEY]:JSON.stringify(base()),...(options.seed||{})});return {m,p:pageEngine(undefined,{navigator:{onLine:false},localStorage:m,...options.capabilities})};}

const invalidOrigins=[
  {kind:'unknown'},{kind:{toString:'bad'}},{value:'2000'},{value:0},
  {value:Number.MAX_SAFE_INTEGER},{periodLabel:{toString:'bad'}},{periodLabel:'x'.repeat(257)},
  {start:'2026-02-30'},{start:'2026-10-01'},{end:null},{rank:{}},{close:{}},
  {border:'0'},{method:{}},{n:'30'},{n:0},{buffer:NaN},{buffer:0.123},
  {unit:2},{period:{}}, {kind:'reference',label:{toString:'bad'}},
];
for(const patch of invalidOrigins)test('F origin reject '+JSON.stringify(patch),()=>{
  const e=engine(),before=JSON.stringify(e.state),data={pmcBackup:1,log:{},settings:{...base(),targetOrigin:{...origin(),...patch}}};
  assert.throws(()=>e.validateBackupPayload(data),/目標設定時/);
  e.element('paste').value=JSON.stringify(data);e.element('importBtn').onclick();
  assert.equal(e.element('importMsg').className,'toast err');assert.equal(JSON.stringify(e.state),before);
});
test('F startup repairs invalid origin and retains its original recovery data',()=>{
  const raw=JSON.stringify({...base(),targetOrigin:{...origin(),periodLabel:{toString:'bad'}}});
  const m=memory({[KEY]:raw}),p=pageEngine(undefined,{navigator:{onLine:false},localStorage:m});
  assert.equal(m.map.get(KEY+'-recovery'),raw);assert.equal(JSON.parse(m.map.get(KEY)).targetOrigin,null);
  input(p,'currentTop','900');assert.equal(p.element('remain').textContent,'1.1K');
  input(p,'quickRank','S3','change');assert.equal(p.element('remain').textContent,'1.1K');
});
test('F legacy origin with omitted period remains readable and strips unrelated objects',()=>{
  const e=engine(),value={...origin(),extra:{toString:'bad'}};delete value.period;
  const clean=plain(e.cleanTargetOrigin(value,true));assert.equal(clean.period,'30d');assert.equal(clean.extra,undefined);
  assert.deepEqual(plain(e.cleanTargetOrigin({kind:'reference',value:2000,label:'表から設定'},true)),{kind:'reference',value:2000,label:'表から設定'});
  assert.equal(e.cleanTargetOrigin(null,true),null);assert.equal(e.cleanTargetOrigin(undefined,true),null);
});
for(const action of ['save','delete'])test('F '+action+' reports failed draft cleanup after a successful record write',()=>{
  let blocked=false;const key='22|S2|2026-09-01',draft={version:1,drafts:{[key]:['111','222','333']},lastKey:key};
  const m=memory({[KEY]:JSON.stringify(base()),[DRAFT]:JSON.stringify(draft)});
  const p=pageEngine(undefined,{navigator:{onLine:false},localStorage:{getItem:m.getItem,setItem:(key,value)=>{if(blocked&&key===DRAFT)throw Error('quota');m.setItem(key,value);}}});
  blocked=true;
  if(action==='save')p.element('saveDay').click();else{p.element('deleteDay').click();p.element('deleteDay').click();}
  assert.equal(p.element('editorMsg').className,'toast err');assert.match(p.element('editorMsg').textContent,/下書きを端末から消せません/);
  assert.deepEqual(JSON.parse(m.map.get(DRAFT)),draft);
  const record=JSON.parse(m.map.get(KEY)).log['2026-09-01']?.S2;
  if(action==='save')assert.deepEqual(record,[111,222,333]);else assert.equal(record,undefined);
});

function readers(){const pending=[];class Reader{readAsText(file,encoding){this.file=file;this.encoding=encoding;pending.push(this);}abort(){this.aborted=true;this.onabort?.();}finish(text){this.result=text;this.onload();}}return {pending,Reader};}
function begin(p){p.element('offlineFile').files=[{name:'borders.csv',size:64}];p.element('offlineFile').dispatchEvent(new Event('change'));}
const csv='date,rank,zero,plus1,plus2,close\n2026-09-01,S2,111,222,333,22';
test('F latest offline file is validated and waits for explicit commit',()=>{
  const kit=readers(),{p,m}=page({capabilities:{FileReader:kit.Reader,navigator:{onLine:false}}});begin(p);
  kit.pending[0].finish(csv);assert.equal(p.element('paste').value,csv);assert.equal(p.element('importPreview').hidden,false);
  assert.deepEqual(JSON.parse(m.map.get(KEY)).log['2026-09-01'].S2,[100,200,300]);
  p.element('importBtn').click();assert.deepEqual(JSON.parse(m.map.get(KEY)).log['2026-09-01'].S2,[111,222,333]);
});
for(const operation of ['paste','date','deadline','commit','new-file','cancel-file'])test('F stale file result cannot replace '+operation,()=>{
  const kit=readers(),{p,m}=page({capabilities:{FileReader:kit.Reader,navigator:{onLine:false}}});begin(p);const old=kit.pending[0];
  if(operation==='paste')input(p,'paste','keep this');
  if(operation==='date')input(p,'logDate','2026-08-31');
  if(operation==='deadline')input(p,'closeSel','13:00','change');
  if(operation==='commit'){p.element('paste').value=csv;p.element('importBtn').click();}
  if(operation==='new-file'){begin(p);kit.pending[1].finish(csv.replace('111,222,333','444,555,666'));}
  if(operation==='cancel-file'){p.element('offlineFile').files=[];p.element('offlineFile').dispatchEvent(new Event('change'));}
  const before=p.element('paste').value,status=p.element('offlineFileMsg').textContent,stored=m.map.get(KEY);
  assert.equal(old.aborted,true);old.finish(csv);
  assert.equal(p.element('paste').value,before);assert.equal(p.element('offlineFileMsg').textContent,status);assert.equal(m.map.get(KEY),stored);
});
test('F final file context check catches a programmatic date change without an input event',()=>{
  const kit=readers(),{p}=page({capabilities:{FileReader:kit.Reader,navigator:{onLine:false}}});begin(p);
  p.element('logDate').value='2026-08-31';kit.pending[0].finish(csv);
  assert.equal(p.element('paste').value,'');assert.match(p.element('offlineFileMsg').textContent,/条件が変わりました/);
});
test('F missing FileReader leaves calculation and manual pasting usable',()=>{
  const {p}=page();begin(p);assert.match(p.element('offlineFileMsg').textContent,/コピーしてください/);
  input(p,'currentTop','900');assert.equal(p.element('remain').textContent,'1.1K');
  input(p,'paste',csv);p.element('importBtn').click();assert.equal(p.element('importMsg').className,'toast');
});
test('F unchanged seconds preserve record rows, while changed records and rank refresh them',()=>{
  const {p}=page(),row=p.element('logList').children[0];p.tick(1000);p.tick(1000);assert.equal(p.element('logList').children[0],row);
  input(p,'quickRank','S3','change');assert.notEqual(p.element('logList').children[0],row);
  const button=p.element('logList').children[0].children.find(node=>node.tagName==='BUTTON'&&node.textContent==='編集');assert.match(button.getAttribute('aria-label'),/S3/);
  input(p,'paste','date,rank,zero,plus1,plus2,close\n2026-08-31,S3,11,22,33,22');p.element('importBtn').click();
  assert.equal(p.element('recordCount').textContent,'2日');
});
test('F collapsed border view skips timer redraw and refreshes when opened',()=>{
  const {p}=page(),box=p.element('borders'),sec=box.closest('section.card'),original=box.children[0];
  assert.equal(sec.classList.contains('collapsed'),true);p.setNow('2026-10-03T21:01:00+09:00');p.tick(1000);assert.equal(box.children[0],original);
  sec.querySelector('.sectionToggle').dispatchEvent(new Event('click'));assert.equal(sec.classList.contains('collapsed'),false);assert.notEqual(box.children[0],original);
});
test('F chart matches dates and gaps with one date lookup per available row',()=>{
  const e=engine(),dates=['2026-09-01','2026-09-02','2026-09-03','2026-09-04','2026-09-05'];let lookups=0;
  const days=[{date:dates[0],value:100},{date:dates[2],value:200},{date:dates[4],value:300}].map(row=>new Proxy(row,{get(target,key){if(key==='date')lookups++;return target[key];}}));
  e.renderChart({n:3,min:100,max:300,days,window:{dates,start:dates[0],end:dates[4]}},null);
  const svg=e.element('recentChart').innerHTML;assert.equal((svg.match(/<circle /g)||[]).length,3);assert.equal((svg.match(/<polyline /g)||[]).length,3);
  for(const row of days)assert.ok(svg.includes('<title>'+row.date+' '+row.value+' pt</title>'));
  assert.equal(lookups,6); // three map entries plus three test-side accesses above
});
