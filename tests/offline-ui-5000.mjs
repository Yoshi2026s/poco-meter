import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';

// 10 node:test batches execute exactly 5,000 different deterministic matrix
// conditions. A condition can have several related assertions. These are
// source/DOM-double checks, not 5,000 physical-device or browser-rendering runs.
import {engine,pageEngine,plain,pointsFromK,statsForValues} from './calculator-harness.mjs';
const KEY='pococha-meter-calc-v1', DRAFT=KEY+'-drafts';
const MAX=360287970189639n, DAY=86400000, JST=32400000;
const fixture=plain(engine().state);
const ranks=Array.from(engine().RANKS);
const counts={}, signatures=new Set(), cases=[];
function condition(group,index,parameters,run){
  const signature=group+'|'+JSON.stringify(parameters);
  assert.ok(!signatures.has(signature),'Each matrix condition must differ: '+signature);
  signatures.add(signature);
  const id=group+'-'+String(index+1).padStart(4,'0');
  try{run();}catch(error){error.message=id+' '+JSON.stringify(parameters)+': '+error.message;throw error;}
  counts[group]=(counts[group]||0)+1;cases.push({id,parameters});
  if(process.env.POCOCHA_MATRIX_RESULT&&(index%50===0))fs.writeFileSync(process.env.POCOCHA_MATRIX_RESULT+'.progress',JSON.stringify({lastPassed:id,conditionsCompleted:cases.length,counts})+'\n');
}
const ceil=(a,b)=>(a+b-1n)/b;
const group=n=>String(n).replace(/\B(?=(\d{3})+(?!\d))/g,',');
const fullwidth=s=>s.replace(/[!-~]/g,c=>String.fromCharCode(c.charCodeAt(0)+0xfee0));
const dateFor=i=>new Date(Date.UTC(2025,0,1)+i*DAY).toISOString().slice(0,10);
const input=(p,id,value,type='input')=>{p.element(id).value=String(value);p.element(id).dispatchEvent(new Event(type));};
const storageEngine=engine();
const saved=p=>plain(storageEngine.unpackStoredState(JSON.parse(p.stored.get(KEY))));
const cfg=extra=>({...fixture,seedVer:3,seedVer13:1,snapshotVersion:'2026-10-02-v3',
  goalDefaultsVersion:1,pick:'',target:'100001',current:'500',coreCount:'40',
  rank:'S2',period:'30d',log:{},log13:{},log24:{},provenance:{},...extra});
const offlinePage=extra=>pageEngine(cfg(extra),{navigator:{onLine:false},fetch:()=>new Promise(()=>{})});
function reload(p){const store=p.stored;const next=pageEngine(undefined,{navigator:{onLine:false},localStorage:{getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value)},fetch:()=>new Promise(()=>{})});next.stored=store;return next;}
const tierFixture=[[2,1],[5,2],[10,3],[15,4],[20,5],[25,6],[30,7],[35,8],[40,9],[45,10],[50,11],[60,12],[70,13],[80,14],[90,15],[100,16],[150,17],[200,18],[250,19],[300,20],[400,21],[500,22]];
const bonusFor=core=>tierFixture.filter(([at])=>core>=at).at(-1)?.[1]??0;
function exportBackup(p){input(p,'saveContent','backup','change');input(p,'saveMethod','file','change');p.element('saveExport').click();return JSON.parse(p.element('backupText').value);}
function restore(p,data){p.element('paste').value=JSON.stringify(data);p.element('importBtn').click();assert.equal(p.element('importMsg').className,'toast');}

test('M01 1,000 point strings: units, decimal ties, grouping, fullwidth and upper bounds',()=>{
  const e=engine();assert.equal(BigInt(e.MAX_VALUE),MAX);
  for(let i=0;i<1000;i++){
    const unit=['','K','万','M'][i%4],mult=[1n,1000n,10000n,1000000n][i%4];
    const digits=1+(Math.floor(i/4)%10),denominator=10n**BigInt(digits);
    const base=i%7===0?MAX/mult-BigInt(i):BigInt(i*7919+1);
    const fraction=[0n,denominator/2n-1n,denominator/2n,denominator/2n+1n,denominator-1n][Math.floor(i/40)%5];
    const rawMantissa=String(base)+'.'+String(fraction).padStart(digits,'0');
    const variant=Math.floor(i/5)%4;
    let text=rawMantissa+unit;
    if(variant===1)text=fullwidth(text);
    if(variant===2)text=group(base)+'.'+String(fraction).padStart(digits,'0')+'\t'+unit;
    if(variant===3)text='  '+text+'  ';
    const rounded=(base*denominator*mult+fraction*mult+denominator/2n)/denominator;
    condition('number',i,{text},()=>assert.equal(e.readNumber(text),rounded>MAX?null:Number(rounded)));
  }
});

test('M02 1,000 core/remainder/item conditions: BigInt sufficiency and minimality',()=>{
  const e=engine();
  for(let i=0;i<1000;i++){
    const core=i===999?1000:i,price=[55,111,1080,5555,1,MAX][i%6];
    const remaining=i===0?0:i%9===0?Number(MAX-BigInt(i)):i*104729+(i%4);
    e.state.coreCount=String(core);
    condition('items',i,{core,price:String(price),remaining},()=>{
      const bonus=bonusFor(core),coefficient=BigInt(100+bonus),needed=BigInt(remaining)*25n;
      assert.equal(e.coreInfo().bonus,bonus);
      const coins=BigInt(e.needCoins(remaining)),count=BigInt(e.itemRange(remaining,Number(price)).replaceAll(',',''));
      assert.equal(coins,ceil(needed,coefficient));
      assert.equal(count,ceil(needed,coefficient*BigInt(price)));
      assert.ok(coins*coefficient>=needed);
      assert.ok(count*BigInt(price)*coefficient>=needed);
      if(remaining){assert.ok((coins-1n)*coefficient<needed);assert.ok((count-1n)*BigInt(price)*coefficient<needed);}
      else{assert.equal(coins,0n);assert.equal(count,0n);}
      assert.equal(e.readCoreCount(fullwidth(String(core))),core);
    });
  }
});

test('M03 500 pace, exact K formatting and independently derived JST windows',()=>{
  const e=engine();
  for(let i=0;i<500;i++){
    const amount=i%11===0?Number(MAX-BigInt(i)):i*17011+1;
    const remainingMs=[1,999,1000,1001,599999,600000,3600001,86399999][i%8]+Math.floor(i/8);
    const unitMs=[600000,3600000,86400000][i%3];
    const cutoffMinutes=i*197%1440,deadline=String(Math.floor(cutoffMinutes/60)).padStart(2,'0')+':'+String(cutoffMinutes%60).padStart(2,'0');
    const offset=[-1,0,1,-1000,1000,43200000][i%6];
    const now=Date.UTC(2026,0,1)+i*DAY+cutoffMinutes*60000-JST+offset;
    condition('time',i,{amount,remainingMs,unitMs,deadline,now},()=>{
      const observed=e.ceilPace(amount,unitMs,remainingMs),required=BigInt(amount)*BigInt(unitMs);
      assert.equal(observed,ceil(required,BigInt(remainingMs)));
      assert.ok(observed*BigInt(remainingMs)>=required);assert.ok((observed-1n)*BigInt(remainingMs)<required);
      assert.equal(pointsFromK(e.fmtPaceK(observed)),observed);
      e.state.deadline=deadline;const actual=e.meterWindow(now);
      // Quotient-based reference partitions epoch time directly into meter days.
      const start=Math.floor((now+JST-cutoffMinutes*60000)/DAY)*DAY+cutoffMinutes*60000-JST;
      assert.deepEqual([actual.start,actual.end],[start,start+DAY]);
      assert.ok(actual.start<=now&&now<actual.end);assert.equal(actual.end-actual.start,DAY);
      const seconds=Math.ceil((actual.end-now)/1000),expected=String(Math.floor(seconds/3600)).padStart(2,'0')+':'+String(Math.floor(seconds/60)%60).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
      assert.equal(e.countdownTime(actual.end-now),expected);
    });
  }
});

test('M04 500 statistics targets: independent rational mean/median/rank oracle',()=>{
  const e=engine();
  for(let i=0;i<500;i++){
    const n=1+i%30,base=i%7===0?MAX-1000000n:BigInt(100+i*73);
    const values=Array.from({length:n},(_,j)=>Number(base-BigInt((j*47+i)%251)));
    const ordered=values.map(BigInt).sort((a,b)=>a<b?-1:a>b?1:0);
    const method=['mean','median','p75','min','max'][i%5],buffer=(i*37%501)/10,unit=[1,100,1000,10000][Math.floor(i/5)%4];
    condition('statistics',i,{values,method,buffer,unit},()=>{
      const stats=statsForValues(e,values);let numerator,denominator=1n;
      assert.equal(stats.n,n);assert.equal(stats.sum,String(ordered.reduce((sum,value)=>sum+value,0n)));
      if(method==='mean'){numerator=ordered.reduce((sum,value)=>sum+value,0n);denominator=BigInt(n);}
      else if(method==='median'){numerator=n%2?ordered[(n-1)/2]:ordered[n/2-1]+ordered[n/2];denominator=n%2?1n:2n;}
      else numerator=method==='p75'?ordered[Math.ceil(n*3/4)-1]:method==='min'?ordered[0]:ordered.at(-1);
      const required=numerator*BigInt(1000+Math.round(buffer*10));
      const denominatorWithBuffer=denominator*1000n,expected=ceil(required,denominatorWithBuffer*BigInt(unit))*BigInt(unit);
      const actual=e.targetCalc(stats,method,buffer,unit);
      if(expected>MAX){assert.equal(actual,null);return;}
      assert.ok(actual);assert.equal(BigInt(actual.target),expected);
      assert.equal(BigInt(actual.baseNumerator)*denominator,numerator*BigInt(actual.baseDenominator));
      assert.ok(expected*denominatorWithBuffer>=required);
      assert.ok((expected-BigInt(unit))*denominatorWithBuffer<required);
    });
  }
});

test('M05 500 offline input updates: persistence, remainder, percentage and four item displays',()=>{
  let p=offlinePage();
  for(let i=0;i<500;i++){
    const target=i%17===0?Number(MAX-BigInt(i)):100000+i*7919;
    const current=i%7===0?Math.min(Number(MAX),target+i+1):i%11===0?target:Math.floor(target*(i%101)/101);
    const core=i*43%1001;
    condition('realtime',i,{target,current,core},()=>{
      input(p,'target',i%2?String(target):fullwidth(String(target)));
      input(p,'currentTop',i%3?String(current):group(current));input(p,'coreCountTop',fullwidth(String(core)));
      const state=saved(p);assert.equal(state.target,String(target));assert.equal(state.current,String(current));assert.equal(state.coreCount,String(core));
      const remainder=Math.max(0,target-current),need=ceil(BigInt(remainder)*25n,BigInt(100+bonusFor(core)));
      if(remainder)assert.equal(pointsFromK(p.element('remain').textContent),BigInt(remainder));else assert.equal(p.element('remain').textContent,'達成！');
      const percentage=BigInt(current)*10000n/BigInt(target),pct=Number(percentage>10000n?10000n:percentage)/100;
      assert.equal(p.element('pct').textContent,pct+'%');assert.equal(p.element('fill').style.width,pct+'%');
      assert.equal(BigInt(p.element('coinNeed').textContent.replaceAll(',','')),need);
      for(const [id,price] of [['dogcatNeed',55n],['pandaNeed',111n],['hanabiNeed',1080n],['bashaNeed',5555n]]){
        assert.equal(BigInt(p.element(id).textContent.replace(/[^\d]/g,'')),ceil(need,price));
      }
    });
    if(i%20===19)p=reload(p);
  }
});

test('M06 500 different malformed offline UI inputs retain last valid state and meter',()=>{
  let p=offlinePage();
  for(let i=0;i<500;i++){
    const slot=i%3,id=['target','currentTop','coreCountTop'][slot];
    const bad=slot===2?String(1001+i):['-'+(i+1),(i+1)+'e3',(i+1)+'.2.3',String(i+1)+',12',String(i+1)+'\rK'][Math.floor(i/3)%5];
    condition('invalid-ui',i,{id,bad},()=>{
      const before=p.stored.get(KEY),remainder=p.element('remain').textContent,coins=p.element('coinNeed').textContent;
      input(p,id,bad);assert.equal(p.stored.get(KEY),before);assert.equal(p.element('remain').textContent,remainder);assert.equal(p.element('coinNeed').textContent,coins);
      assert.equal(p.element('inputStatus').hidden,false);assert.equal(p.element(id).getAttribute('aria-invalid'),'true');
    });
    if(i%20===19)p=reload(p);
  }
});

test('M07 400 JSON exports/restores preserve settings, display, records and drafts separately',()=>{
  let source=offlinePage(),destination=offlinePage({log:{'2024-12-01':{S1:[1,2,3]}}});
  for(let i=0;i<400;i++){
    const target=100000+i*997,current=i*137,core=i*11%1001,date=dateFor(i%32),rank=ranks[i%ranks.length];
    const color=['standard','pink','blue','green'][i%4],weight=['standard','bold','thin'][Math.floor(i/4)%3],theme=['light','dark'][Math.floor(i/12)%2];
    const draftValues=[String(i+1)+'K','未確定'+i,String(i+3)];
    condition('backup',i,{target,current,core,date,rank,color,weight,theme,draftValues},()=>{
      input(source,'target',target);input(source,'currentTop',current);input(source,'coreCountTop',core);input(source,'quickRank',rank,'change');
      input(source,'screenColor',color,'change');input(source,'textWeight',weight,'change');input(source,'screenTheme',theme,'change');input(source,'editDate',date,'change');
      input(source,'editZero',draftValues[0]);input(source,'editPlus1',draftValues[1]);input(source,'editPlus2',draftValues[2]);
      const data=exportBackup(source);assert.equal(data.pmcBackup,1);assert.deepEqual(data.display,{color,weight,theme,background:'theme',listColor:'white',numberColor:'blue'});
      const key='22|'+rank+'|'+date;assert.deepEqual(data.editorDrafts.drafts[key],draftValues);
      restore(destination,data);const actual=saved(destination);
      assert.equal(actual.target,String(target));assert.equal(actual.current,String(current));assert.equal(actual.coreCount,String(core));assert.equal(actual.rank,rank);
      assert.deepEqual(actual.log['2024-12-01'].S1,[1,2,3]);
      assert.deepEqual(JSON.parse(destination.stored.get(DRAFT)).drafts[key],draftValues);
      assert.deepEqual(['editZero','editPlus1','editPlus2'].map(id=>destination.element(id).value),draftValues);
      assert.equal(destination.element('screenColor').value,color);assert.equal(destination.element('textWeight').value,weight);assert.equal(destination.element('screenTheme').value,theme);
      assert.deepEqual(exportBackup(destination).editorDrafts.drafts[key],draftValues);
    });
    if(i%10===9){source=reload(source);destination=reload(destination);}
  }
});

test('M08 200 draft contexts preserve literal input and enforce bounded persistent history',()=>{
  let p=offlinePage();
  for(let i=0;i<200;i++){
    const date=dateFor(i),rank=ranks[i%ranks.length],length=1+i%250;
    const values=['1.'+'0'.repeat(length)+'K','編集中'+i,String(i*3+1)];
    condition('draft',i,{date,rank,values},()=>{
      input(p,'quickRank',rank,'change');input(p,'editDate',date,'change');
      ['editZero','editPlus1','editPlus2'].forEach((id,j)=>input(p,id,values[j]));
      const data=JSON.parse(p.stored.get(DRAFT)),key='22|'+rank+'|'+date;
      assert.equal(data.lastKey,key);assert.deepEqual(data.drafts[key],values);assert.ok(Object.keys(data.drafts).length<=32);
      assert.ok(!saved(p).log[date]?.[rank],'Uncommitted drafts must not become border records');
      if(i%10===9){p=reload(p);
        assert.deepEqual(['editZero','editPlus1','editPlus2'].map(id=>p.element(id).value),values);
      }
    });
  }
});

test('M09 200 invalid backup payloads cannot mutate any state before rejection',()=>{
  const e=engine();e.state.target='777777';e.state.current='555';e.state.log={'2026-09-01':{S2:[111,222,333]}};
  for(let i=0;i<200;i++){
    const data={pmcBackup:1,log:{[dateFor(i)]:{S2:[i+1,i+2,i+3]}},settings:plain(e.state)};
    const kind=i%10;
    if(kind===0)data.settings.coreCount=String(1001+i);
    if(kind===1)data.settings.target='-'+(i+1);
    if(kind===2)data.settings.bufferPct=50+(i+1)/10;
    if(kind===3)data.settings.roundUnit=i+2;
    if(kind===4)data.display={color:'unknown-'+i,weight:'bold'};
    if(kind===5)data.editorDrafts={version:1,drafts:{['22|S2|'+dateFor(i)]:['x'.repeat(257+i),'2','3']},lastKey:''};
    if(kind===6)data.log[dateFor(i)].S2=[i+3,i+2,i+1];
    if(kind===7)data.settings.pick=String(i+3);
    if(kind===8)data.items=[{name:'invalid'+i,val:-i-1}];
    if(kind===9)data.settings.deadline='24:'+String(i%60).padStart(2,'0');
    condition('invalid-backup',i,{kind,data},()=>{
      const before=JSON.stringify(e.state);assert.throws(()=>e.validateBackupPayload(data));assert.equal(JSON.stringify(e.state),before);
      e.element('paste').value=JSON.stringify(data);e.element('importBtn').onclick();
      assert.equal(e.element('importMsg').className,'toast err');assert.equal(JSON.stringify(e.state),before);
    });
  }
});

test('M10 200 offline manual record commits persist and clear only matching drafts',()=>{
  let p=offlinePage();
  for(let i=0;i<200;i++){
    const date=dateFor(i),rank=ranks[i%ranks.length],values=[i*719+1,i*719+2,i*719+3];
    condition('records',i,{date,rank,values},()=>{
      input(p,'quickRank',rank,'change');input(p,'editDate',date,'change');
      ['editZero','editPlus1','editPlus2'].forEach((id,j)=>input(p,id,j===1?fullwidth(String(values[j])):String(values[j])));
      const key='22|'+rank+'|'+date;assert.ok(JSON.parse(p.stored.get(DRAFT)).drafts[key]);
      p.element('saveDay').click();assert.deepEqual(saved(p).log[date][rank],values);assert.equal(saved(p).provenance['22'][date][rank].origin,'manual');
      assert.equal(JSON.parse(p.stored.get(DRAFT)).drafts[key],undefined);assert.equal(p.element('editorMsg').className,'toast');
      if(i%10===9){p=reload(p);
        assert.deepEqual(saved(p).log[date][rank],values);
      }
    });
  }
});

test.after(()=>{
  assert.deepEqual(counts,{number:1000,items:1000,time:500,statistics:500,realtime:500,'invalid-ui':500,backup:400,draft:200,'invalid-backup':200,records:200});
  assert.equal(cases.length,5000);assert.equal(signatures.size,5000);
  const result={matrix:'offline-ui-5000',nodeTestBatches:10,distinctMatrixConditions:5000,groups:counts,
    deterministicCasesSha256:createHash('sha256').update(JSON.stringify(cases)).digest('hex'),
    limitations:['DOM and storage doubles; no physical devices or rendered browsers','No claim of 5,000 independent implementation changes','No network access needed by the matrix'],status:'passed'};
  console.log('OFFLINE_UI_MATRIX_RESULT '+JSON.stringify(result));
  if(process.env.POCOCHA_MATRIX_RESULT)fs.writeFileSync(process.env.POCOCHA_MATRIX_RESULT,JSON.stringify(result,null,2)+'\n');
});
