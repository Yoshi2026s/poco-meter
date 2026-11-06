// Ten distinct deterministic rounds. Scenario counts are cases, not assertions,
// fixes, browser sessions, real phones, or verification of future border values.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {engine,pageEngine,plain,pointsFromK} from './calculator-harness.mjs';
import {parseArticle} from '../lib/border-source.mjs';
import {contactApi,contactAttachmentApi} from '../lib/contact-store.mjs';

const mode=process.env.METER_MATRIX||'all',roundCount=Number(process.env.METER_ROUNDS||10);
const roundStart=Number(process.env.METER_ROUND_START||0),worker=process.env.METER_VALIDATION_WORKER==='1';
assert.ok(['all','border','app'].includes(mode));
assert.ok(Number.isInteger(roundCount)&&roundCount>=1&&roundCount<=10);
assert.ok(Number.isInteger(roundStart)&&roundStart>=0&&roundStart+roundCount<=10);
const started=Date.now(),DAY=86400000,MAX=BigInt(engine().MAX_VALUE),ranks=Array.from(engine().RANKS);
const hash=s=>createHash('sha256').update(s).digest('hex');
const sourcePaths=['calculator/index.html','calculator/sw.js','lib/border-source.mjs','lib/border-store.mjs','lib/contact-store.mjs'];
const sourceHashes=()=>Object.fromEntries(sourcePaths.map(path=>[path,hash(readFileSync(new URL('../'+path,import.meta.url)))]));
const sourceSHA256=sourceHashes(),reports={};
const limitation='Shipped source functions, DOM doubles, isolated SQLite and in-memory object storage. No rendered browser, physical phone, production writes, prediction accuracy, or independent verification of all live source values.';
const ceil=(n,d)=>(n+d-1n)/d;
const signatures={border:new Set(),app:new Set()};
function startMatrix(name,perRound){
 const report={matrix:name,status:'running',plannedRounds:roundCount,scenariosPerRound:perRound,rounds:[],executedScenarios:0,passedScenarios:0,failedScenarios:0,sourceSHA256,limitation};
 reports[name]=report;return report;
}
function checkpoint(report){
 report.durationMs=Date.now()-started;
 const file=worker?process.env.METER_WORKER_RESULT:new URL('../docs/'+report.matrix+'-ten-rounds-result.json',import.meta.url);
 writeFileSync(file,JSON.stringify(report,null,2)+'\n');
}
function roundRecord(report,round){
 const rec={round:round+1,status:'running',executed:0,passed:0,failed:0,counts:{},failures:[],caseHasher:createHash('sha256')};
 report.rounds.push(rec);return rec;
}
function recordCase(report,rec,group,condition){
 const signature=JSON.stringify([group,condition]);
 assert.ok(!signatures[report.matrix].has(signature),'Duplicate effective test inputs: '+signature);
 signatures[report.matrix].add(signature);rec.caseHasher.update(signature+'\n');
 rec.executed++;report.executedScenarios++;rec.counts[group]=(rec.counts[group]||0)+1;
 return signature;
}
function failure(report,rec,group,signature,error){
 rec.failed++;report.failedScenarios++;
 if(rec.failures.length<20)rec.failures.push({group,condition:JSON.parse(signature)[1],message:error.message});
}
function check(report,rec,group,condition,fn){
 const signature=recordCase(report,rec,group,condition);
 try{fn();rec.passed++;report.passedScenarios++;}catch(error){failure(report,rec,group,signature,error);}
}
async function checkAsync(report,rec,group,condition,fn){
 const signature=recordCase(report,rec,group,condition);
 try{await fn();rec.passed++;report.passedScenarios++;}catch(error){failure(report,rec,group,signature,error);}
}
function finishRound(report,rec){
 assert.equal(rec.executed,report.scenariosPerRound);
 rec.deterministicCasesSHA256=rec.caseHasher.digest('hex');delete rec.caseHasher;
 rec.status=rec.failed?'failed':'passed';checkpoint(report);
 console.log('METER_VALIDATION_ROUND '+JSON.stringify({matrix:report.matrix,...rec}));
}
function finishMatrix(report){
 const finalHashes=sourceHashes();report.sourceUnchangedDuringRun=JSON.stringify(finalHashes)===JSON.stringify(sourceSHA256);
 if(!report.sourceUnchangedDuringRun)report.finalSourceSHA256=finalHashes;
 assert.equal(report.executedScenarios,report.scenariosPerRound*roundCount);
 report.distinctScenariosAcrossRounds=signatures[report.matrix].size;
 report.status=report.failedScenarios||!report.sourceUnchangedDuringRun?'failed':'passed';
 if(worker)report.caseInputSHA256=[...signatures[report.matrix]].map(hash);
 checkpoint(report);const {caseInputSHA256,...printable}=report;console.log('METER_VALIDATION_RESULT '+JSON.stringify(printable));
 if(report.status!=='passed')process.exitCode=1;
}

function statsFixture(round){
 const e=engine('2026-10-04T12:00:00+09:00');
 e.state.log={};e.state.log13={};e.state.log24={};e.state.provenance={};
 for(const [close,key]of [['13','log13'],['22','log'],['24','log24']]){
  e.state.provenance[close]={};
  for(let day=0;day<66;day++){
   const date=new Date(Date.UTC(2026,7,1)+day*DAY).toISOString().slice(0,10);
   e.state[key][date]={};e.state.provenance[close][date]={};
   ranks.forEach((rank,r)=>{
    if((day+r+round)%7===0)return;
    const base=(day+r+round)%13===0?Number(MAX-10000n-BigInt(day*103+r*7+round*991))
     :10000+day*103+r*7+Number(close)*100+round*104729;
    e.state[key][date][rank]=[base,base+1,base+2];
    e.state.provenance[close][date][rank]={origin:(day+r+round)%5===0?'legacy':'manual'};
   });
  }
 }
 return e;
}
const fixtureHTML=Object.fromEntries(['13','22','24'].map(close=>[close,readFileSync(new URL('./fixtures/'+close+'.html',import.meta.url),'utf8')]));
const fixtureURLs={'13':'https://one-carat.com/campus/archives/89497','22':'https://one-carat.com/campus/archives/89496','24':'https://one-carat.com/campus/archives/89495'};
const fixtureDates={'13':'2026-09-30','22':'2026-10-01','24':'2026-10-01'};
const sourceRanks=['D1','D2','D3','C1','C2','C3','B1','B2','B3','A1','A2','A3','S1','S2','S3','S4','S5','S6'];
const parserKinds=['plain-valid','grouped-valid','entity-valid','date-whitespace-valid','bad-grouping','duplicate-rank','missing-rank','reversed-values','zero-value','overflow-value','incomplete-day','negative-value'];
function sourceCase(close,values,kind){
 let vals=values.map(String);
 if(kind===1)vals=values.map(n=>n.toLocaleString('en-US'));
 if(kind===2)vals=values.map(n=>String(n).replace(/\d/g,d=>'&#'+d.charCodeAt(0)+';'));
 if(kind===4)vals[0]=String(values[0])+',1';
 if(kind===7)vals=[...values].reverse().map(String);
 if(kind===8)vals[0]='0';
 if(kind===9)vals[2]=String(MAX+1n);
 if(kind===11)vals[0]='-'+values[0];
 const row='<pre><span style="font-size: 8pt;">【S2】\n［±0］'+vals[0]+'　［+1］'+vals[1]+'　［+2］'+vals[2]+'</span></pre>';
 let html=fixtureHTML[close].replace(/<pre\b[^>]*>(?:(?!<\/pre>)[\s\S])*【S2】(?:(?!<\/pre>)[\s\S])*<\/pre>/,row);
 assert.ok(html.includes(row));
 if(kind===3)html=html.replace(/(<h3\b[^>]*>)([\s\S]*?)(<\/h3>)/,(_,a,b,c)=>a+'\n\t&nbsp;'+b+'　\n'+c);
 if(kind===5)html=html.replace('<h2>End</h2>',row+'<h2>End</h2>');
 if(kind===6)html=html.replace(/<pre\b[^>]*>(?:(?!<\/pre>)[\s\S])*【D1】(?:(?!<\/pre>)[\s\S])*<\/pre>/,'');
 if(kind===10)html=html.replace(/<h3\b[^>]*>[\s\S]*?<\/h3>/,'<h3>10月4日</h3>');
 return html;
}
function borderRound(report,rec,round){
 const e=statsFixture(round),fixtureDigest=hash(JSON.stringify([plain(e.state.log),plain(e.state.log13),plain(e.state.log24),plain(e.state.provenance)]));
 for(let i=0;i<400;i++){
  const close=['13','22','24'][(i+round)%3],rank=ranks[Math.floor((i+round*17)/3)%ranks.length];
  const period=['30d','month','prev','3m','all'][Math.floor(i/57)%5],border=Math.floor(i/133)%3;
  const method=['mean','median','p75','max','min'][(i+round)%5],buffer=((i+round*400)*37%501)/10,unit=[1,100,1000,10000][Math.floor(i/5)%4];
  const asOfDate=period==='30d'&&i%2?'2026-09-25':'';
  e.state.deadline=close==='24'?'00:00':close+':00';e.state.period=period;e.state.asOfDate=asOfDate;
  check(report,rec,'statisticsAndTarget',{fixtureDigest,close,rank,period,border,method,buffer,unit,asOfDate},()=>{
   const log=e.state[close==='13'?'log13':close==='24'?'log24':'log'];
   let start,end=Date.UTC(2026,9,3);
   if(period==='30d'){if(asOfDate)end=Date.parse(asOfDate+'T00:00:00Z');start=end-29*DAY;}
   else if(period==='month')start=Date.UTC(2026,9,1);
   else if(period==='prev'){start=Date.UTC(2026,8,1);end=Date.UTC(2026,8,30);}
   else start=Date.UTC(2026,7,1);
   const dates=Object.keys(log).filter(date=>{
    const ms=Date.parse(date+'T00:00:00Z');
    return ms>=start&&ms<=end&&Array.isArray(log[date][rank])&&!(period==='30d'&&e.state.provenance[close][date][rank].origin==='legacy');
   }).sort();
   const ordered=dates.map(date=>BigInt(log[date][rank][border])).sort((a,b)=>a<b?-1:a>b?1:0);
   const n=ordered.length,sum=ordered.reduce((a,b)=>a+b,0n),stats=e.selectedStats(rank,border);
   assert.equal(stats.n,n);assert.equal(stats.sum,String(sum));
   assert.deepEqual(Array.from(stats.days,day=>day.date),dates);assert.equal(stats.latest,dates.at(-1)??null);
   assert.ok(Array.from(stats.days).every(day=>day.date<'2026-10-04'));
   if(period==='30d')assert.equal(stats.window.dates.length,30);
   let num,den=1n;
   if(method==='mean'){num=sum;den=BigInt(n);}
   else if(method==='median'){num=n%2?ordered[(n-1)/2]:ordered[n/2-1]+ordered[n/2];den=n%2?1n:2n;}
   else num=method==='p75'?ordered[Math.ceil(n*3/4)-1]:method==='min'?ordered[0]:ordered.at(-1);
   const required=num*BigInt(1000+Math.round(buffer*10)),denWithBuffer=den*1000n;
   const expected=ceil(required,denWithBuffer*BigInt(unit))*BigInt(unit),actual=e.targetCalc(stats,method,buffer,unit);
   if(expected>MAX)assert.equal(actual,null);
   else{
    assert.equal(BigInt(actual.target),expected);
    assert.equal(BigInt(actual.baseNumerator)*den,num*BigInt(actual.baseDenominator));
    assert.ok(expected*denWithBuffer>=required&&(expected-BigInt(unit))*denWithBuffer<required);
   }
  });
 }
 for(let i=0;i<300;i++){
  const g=round*300+i,close=['13','22','24'][Math.floor(g/12)%3],kind=g%12,base=100001+g*137,values=[base,base+1000,base+2000];
  const html=sourceCase(close,values,kind),condition={close,kind:parserKinds[kind],values,htmlSHA256:hash(html)};
  check(report,rec,'sourceParser',condition,()=>{
   if(kind>=4)assert.throws(()=>parseArticle(html,fixtureURLs[close],new Date('2026-10-04T12:00:00+09:00')));
   else{
    const actual=parseArticle(html,fixtureURLs[close],new Date('2026-10-04T12:00:00+09:00'));
    assert.equal(actual.date,fixtureDates[close]);assert.equal(actual.close,close);assert.equal(actual.sourceURL,fixtureURLs[close]);
    assert.deepEqual(actual.ranks.S2,values);assert.deepEqual(Object.keys(actual.ranks).sort(),[...sourceRanks].sort());
   }
  });
 }
 const merge=engine();
 for(let i=0;i<300;i++){
  const g=round*300+i,kind=g%18,close=['13','22','24'][Math.floor(g/18)%3],base=500001+g*211;
  const old=[base,base+10,base+20],incoming=kind>=15?old:[base+30,base+40,base+50],origin=kind>=15?'remote':['manual','import','saved','verified','remote','legacy'][kind%6];
  const previousCheck='2026-10-03T01:00:00.000Z',latestCheck=new Date(Date.parse('2026-10-03T02:00:00Z')+g).toISOString();
  merge.state.log={};merge.state.log13={};merge.state.log24={};merge.state.provenance={};
  const log=merge.state[close==='13'?'log13':close==='24'?'log24':'log'];
  log['2026-10-01']={S2:old};merge.state.provenance[close]={'2026-10-01':{S2:{origin,source:fixtureURLs[close],checkedAt:kind>=15?previousCheck:''}}};
  const row={date:'2026-10-01',close,sourceURL:fixtureURLs[close],ranks:{S2:incoming,D1:[base+1,base+2,base+3]}};
  if(kind===15)row.checkedAt=latestCheck;
  if(kind===17)row.sourceURL='https://one-carat.com/campus/archives/99998';
  const payload={serverDate:'2026-10-04',sync:{status:'ok'},records:[row]};
  if(kind>=6&&kind<=14){
   const second={...row,date:'2026-10-02',ranks:{S2:[base+4,base+5,base+6]}};payload.records.push(second);
   if(kind===6)second.date=row.date;
   if(kind===7)second.date=payload.serverDate;
   if(kind===8)second.sourceURL='https://invalid.example/'+g;
   if(kind===9)second.ranks.S2=[base+6,base+5,base+4];
   if(kind===10)second.ranks={E:[base+4,base+5,base+6]};
   if(kind===11)payload.serverDate='2026-02-31';
   if(kind===12)second.checkedAt='invalid-'+g;
   if(kind===13)second.checkedAt={time:latestCheck};
   if(kind===14)second.checkedAt=latestCheck+' '.repeat(50);
  }
  check(report,rec,'liveMergeValidation',{kind,origin,old,payload},()=>{
   const before=JSON.stringify([plain(merge.state.log),plain(merge.state.log13),plain(merge.state.log24),plain(merge.state.provenance)]);
   if(kind>=6&&kind<=14){
    assert.throws(()=>merge.mergeLiveBorders(payload));
    assert.equal(JSON.stringify([plain(merge.state.log),plain(merge.state.log13),plain(merge.state.log24),plain(merge.state.provenance)]),before,'Reject the whole packet before any mutation');
   }else{
    assert.equal(merge.mergeLiveBorders(payload),kind<3||kind===16?1:2);
    assert.deepEqual(Array.from(log['2026-10-01'].S2),kind<3?old:incoming);
    assert.deepEqual(Array.from(log['2026-10-01'].D1),row.ranks.D1);
    assert.equal(log['2026-10-01'].S1,undefined,'Absent ranks remain absent');
    if(kind===15)assert.equal(merge.state.provenance[close]['2026-10-01'].S2.checkedAt,latestCheck,'Same values still receive current confirmation timestamp');
    if(kind===16)assert.equal(merge.state.provenance[close]['2026-10-01'].S2.checkedAt,previousCheck,'Omitted confirmation does not erase an existing same-source timestamp');
    if(kind===17)assert.equal(merge.state.provenance[close]['2026-10-01'].S2.checkedAt,'','A new source cannot inherit another source confirmation timestamp');
    assert.equal(merge.mergeLiveBorders(payload),0,'Repeat packet is idempotent');
   }
  });
 }
}

function exactUnit(n,places,suffix){const value=BigInt(n),base=10n**BigInt(places);return `${value/base}.${String(value%base).padStart(places,'0')}${suffix}`;}
function fullwidth(text){return text.replace(/[0-9.,]/g,c=>String.fromCharCode(c.charCodeAt(0)+0xfee0));}
function timeText(ms,fractional){
 const ticks=Math.ceil(Math.max(0,ms)/(fractional?100:1000)),s=Math.floor(ticks/(fractional?10:1));
 return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(n=>String(n).padStart(2,'0')).join(':')+(fractional?'.'+ticks%10:'');
}
const prices=[55,111,1080,5555];
// The established conversion contract, independent of coreInfo() output.
const coreTiers=[[2,1],[5,2],[10,3],[15,4],[20,5],[25,6],[30,7],[35,8],[40,9],[45,10],[50,11],[60,12],[70,13],[80,14],[90,15],[100,16],[150,17],[200,18],[250,19],[300,20],[400,21],[500,22]];
const expectedCoreBonus=core=>coreTiers.filter(([threshold])=>core>=threshold).at(-1)?.[1]||0;
// Explicit rational fixtures avoid using the production decimal parser as an oracle.
const paceDurations=[{ms:999.5,n:1999n,d:2n},{ms:1000.1,n:10001n,d:10n},{ms:0.5,n:1n,d:2n},
 {ms:0.0001,n:1n,d:10000n},{ms:1e-7,n:1n,d:10000000n},{ms:60000.75,n:240003n,d:4n},
 {ms:3599999.25,n:14399997n,d:4n},{ms:0},{ms:-0.5},{ms:Infinity},{ms:NaN},{ms:-Infinity}];
const key='pococha-meter-calc-v1';
function domConfig(){const e=engine();return {...plain(e.state),target:'100000',current:'0',pick:'',coreCount:'0',seedVer:3,seedVer13:1,snapshotVersion:'2026-10-02-v3',log:{},log13:{},log24:{},provenance:{},goalDefaults:{...plain(e.standardGoalDefaults()),applyOnLoad:false}};}
function input(p,id,value){const el=p.element(id);el.value=String(value);el.dispatchEvent(new Event('input'));}
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
async function synchronizedPage(phone){
 let monotonic=1000,reply;
 const p=pageEngine(domConfig(),{navigator:{onLine:true},performance:{now:()=>monotonic},
  matchMedia:query=>({matches:query.includes('max-width:700px')?phone:false}),
  fetch:url=>url==='/api/pococha-time'?new Promise(resolve=>{reply=resolve;}):new Promise(()=>{})});
 await settle();assert.ok(reply,'Initialization starts an official-time request');
 monotonic+=600.5;
 reply({ok:true,json:async()=>({schema:'pococha-site-time-v1',source:'pococha-official-website-http-date',sourceURL:'https://www.pococha.com/',
  serverTimeMs:Date.parse('2026-10-03T21:59:58+09:00'),sampleAgeMs:0,uncertaintyMs:500,upstreamRoundTripMs:20,processingMs:0})});
 await settle();assert.equal(p.element('clockTimeSource').textContent,'Pocochaサーバー時刻');
 let elapsedEighths=0;
 return {p,advance(){monotonic+=0.125;elapsedEighths++;return 13598-elapsedEighths;}};
}

async function contactCases(report,rec,round){
 const sql=new DatabaseSync(':memory:');
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>/^\d+_.*\.sql$/.test(name)).sort())sql.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 sql.exec('PRAGMA foreign_keys=ON');
 const DB={prepare(query){let values=[];return {bind(...args){values=args;return this;},run(){return sql.prepare(query).run(...values);},async first(){return sql.prepare(query).get(...values);},async all(){return {results:sql.prepare(query).all(...values)};}};},async batch(statements){sql.exec('BEGIN');try{const result=statements.map(s=>s.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 const objects=new Map();let writes=0,reads=0;
 const BUCKET={async put(objectKey,bytes){writes++;objects.set(objectKey,Uint8Array.from(bytes));},async get(objectKey){reads++;const bytes=objects.get(objectKey);return bytes?{size:bytes.length,body:bytes}:null;},async delete(objectKey){objects.delete(objectKey);}};
 const env={DB,BUCKET,ANALYTICS_ADMIN_EMAIL:'owner@example.test'},origin='https://meter.example';
 const jpg=readFileSync(new URL('./fixtures/contact-small.jpg',import.meta.url)),webp=readFileSync(new URL('./fixtures/contact-small.webp',import.meta.url));
 const brokenPNG=Buffer.alloc(33);brokenPNG.set([137,80,78,71,13,10,26,10]);brokenPNG.writeUInt32BE(13,8);brokenPNG.write('IHDR',12);brokenPNG.writeUInt32BE(1,16);brokenPNG.writeUInt32BE(1,20);
 try{
  for(let i=0;i<500;i++){
   const g=round*500+i,kind=g%10,id=`00000000-0000-4000-8000-${g.toString(16).padStart(12,'0')}`,cookie='__Host-pococha-contact='+(g+1).toString(16).padStart(64,'0');
   const payload={requestId:id,subject:'不具合の報告',content:`検証${g}\n改行 😀`};let body,expected=200;
   const headers={Cookie:cookie,Origin:origin};
   if(kind===2){headers['Content-Type']='application/json';body=JSON.stringify(payload);}
   else{
    const form=new FormData(),count=kind===0?1:kind===3?6:5;
    if(kind===8){payload.unrecognized=true;expected=400;}if(kind===9){payload.requestId='invalid-'+g;expected=400;}
    form.append('data',JSON.stringify(payload));
    for(let index=0;index<count;index++)form.append('image',new Blob([kind===4&&index===4?brokenPNG:index%2?webp:jpg],{type:'image/png'}),'private-'+index+'.png');
    if(kind===3)expected=400;if(kind===4)expected=415;
    if(kind===5){form.append('data','{}');expected=400;}
    if(kind===6){headers.Origin='https://other.example';expected=403;}
    if(kind===7){delete headers.Cookie;expected=401;}
    body=form;
   }
   await checkAsync(report,rec,'contactFilesAndPrivacy',{payload,cookie,kind,expected},async()=>{
    const beforeWrites=writes,beforeMessages=sql.prepare('SELECT COUNT(*) n FROM contact_messages').get().n;
    const response=await contactApi(new Request(origin+'/api/contact',{method:'POST',headers,body}),env);
    assert.equal(response.status,expected);
    if(expected!==200){assert.equal(writes,beforeWrites);assert.equal(sql.prepare('SELECT COUNT(*) n FROM contact_messages').get().n,beforeMessages);}
    else{
     const result=await response.json();assert.equal(result.id,id);
     const inbox=await (await contactApi(new Request(origin+'/api/contact',{headers:{Cookie:cookie}}),env)).json();
     assert.equal(inbox.messages[0].content,payload.content);assert.equal(inbox.messages[0].attachments.length,kind===2?0:kind===0?1:5);
     if(kind!==2){
      const url=inbox.messages[0].attachments.at(-1).url;
      assert.equal((await contactAttachmentApi(new Request(origin+url,{headers:{Cookie:cookie}}),env)).status,200);
      const beforeReads=reads;
      assert.equal((await contactAttachmentApi(new Request(origin+url,{headers:{Cookie:'__Host-pococha-contact='+(g+10001).toString(16).padStart(64,'0')}}),env)).status,404);
      assert.equal(reads,beforeReads,'Other visitor cannot even read private object storage');
     }
    }
   });
  }
 }finally{sql.close();}
}
async function appRound(report,rec,round){
 const e=engine();
 for(let i=0;i<4000;i++){
  const g=round*4000+i,n=1001+Math.floor(g/4)*104729,kind=g%4;
  const value=[String(n),n.toLocaleString('en-US'),exactUnit(n,3,'K'),fullwidth(exactUnit(n,4,'万'))][kind];
  check(report,rec,'pointParsingAndExactDisplay',{n,value},()=>{assert.equal(e.readNumber(value),n);assert.equal(pointsFromK(e.fmtRemainingK(n)),BigInt(n));});
 }
 for(let i=0;i<3000;i++){
  const g=round*3000+i,core=g%1001,rem=g%17===0?e.MAX_VALUE:(g+1)*65537,price=prices[g%4],duration=paceDurations[g%paceDurations.length],unit=g%2?600000:3600000;e.state.coreCount=String(core);
  check(report,rec,'coinItemAndFractionalPaceRounding',{core,rem,price,duration:String(duration.ms),unit},()=>{
   const den=BigInt(100+expectedCoreBonus(core)),num=BigInt(rem)*25n,coins=BigInt(e.needCoins(rem)),items=BigInt(e.itemRange(rem,price).replaceAll(',',''));
   assert.equal(e.coreInfo().bonus,expectedCoreBonus(core));
   assert.ok(coins*den>=num&&(coins-1n)*den<num);
   assert.ok(items*BigInt(price)*den>=num&&(items-1n)*BigInt(price)*den<num);
   assert.equal(e.readCoreCount(fullwidth(String(core))),core);
   const expectedPace=duration.n?ceil(BigInt(rem)*BigInt(unit)*duration.d,duration.n):0n;
   assert.equal(e.ceilPace(rem,unit,duration.ms),expectedPace);
   assert.equal(e.ceilPace(0,unit,duration.ms),0n);
  });
 }
 const anchor=Date.parse('2026-01-01T00:00:00+09:00');
 for(let i=0;i<2000;i++){
  const g=round*2000+i,minute=g%1440,deadline=`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
  const cutoff=anchor+minute*60000,now=cutoff+Math.floor(g/3)*DAY+[-1,0,1][g%3];e.state.deadline=deadline;
  check(report,rec,'jstCutoffsAndFractionalCountdown',{deadline,now},()=>{
   const result=e.meterWindow(now),expected=cutoff+(Math.floor((now-cutoff)/DAY)+1)*DAY;
   assert.equal(result.end,expected);assert.ok(result.start<=now&&now<result.end);assert.equal(result.end-result.start,DAY);
   assert.equal(e.countdownTime(result.end-now),timeText(result.end-now,false));
   assert.equal(e.countdownTime(result.end-now,true),timeText(result.end-now,true));
  });
 }
 const pages=await Promise.all([false,true].map(synchronizedPage));
 for(let i=0;i<500;i++){
  const g=round*500+i,clock=pages[g%2],p=clock.p,target=200000+g*101,current=g*97,core=g%1001,remainingEighths=clock.advance();
  check(report,rec,'desktopAndPhoneSynchronizedDOMHandlers',{phone:!!(g%2),target,current,core,remainingEighths,networkRTT:600.5},()=>{
   input(p,['target','targetMini'][g%2],target);input(p,['currentTop','currentMini'][g%2],current);input(p,['coreCountTop','coreCountItems'][g%2],core);p.tick(1000);
   const saved=JSON.parse(p.stored.get(key));assert.equal(saved.target,String(target));assert.equal(saved.current,String(current));assert.equal(saved.coreCount,String(core));
   assert.equal(pointsFromK(p.element('miniR').textContent),BigInt(target-current));assert.equal(p.element('coreCountTop').value,p.element('coreCountItems').value);
   const den=BigInt(100+expectedCoreBonus(core)),coins=BigInt(p.element('coinNeed').textContent.replaceAll(',',''));
   assert.ok(coins*den>=BigInt(target-current)*25n&&(coins-1n)*den<BigInt(target-current)*25n);
   assert.equal(pointsFromK(p.element('perHour').textContent),ceil(BigInt(target-current)*3600000n*8n,BigInt(remainingEighths)));
   assert.equal(p.element('miniT').textContent,p.element('left').textContent);
   assert.equal(p.element('left').textContent,timeText(remainingEighths/8,true));
   if(g%7===0){input(p,'coreCountTop','1001');assert.equal(JSON.parse(p.stored.get(key)).coreCount,String(core));assert.equal(p.element('coreCountTop').getAttribute('aria-invalid'),'true');input(p,'coreCountTop',core);}
  });
 }
 await contactCases(report,rec,round);
}

if(mode==='all'||mode==='border'){
 const report=startMatrix('border',1000);
 for(let round=roundStart;round<roundStart+roundCount;round++){const rec=roundRecord(report,round);borderRound(report,rec,round);finishRound(report,rec);}
 finishMatrix(report);
}
if(mode==='all'||mode==='app'){
 const report=startMatrix('app',10000);
 if(worker||roundCount===1){
  for(let round=roundStart;round<roundStart+roundCount;round++){const rec=roundRecord(report,round);await appRound(report,rec,round);finishRound(report,rec);}
  finishMatrix(report);
 }else{
  // Separate VM, DOM, database, storage and process for each round. Four workers
  // run at once; each retains its complete case inputs for aggregate deduplication.
  const directory=mkdtempSync(join(tmpdir(),'pococha-meter-validation-')),caseHashes=new Set();
  report.isolatedWorkerConcurrency=4;let next=roundStart;
  async function runWorker(round){
   const resultPath=join(directory,'round-'+round+'.json');
   const {error,stderr}=await new Promise(resolve=>execFile(process.execPath,['--expose-gc','--max-old-space-size=384',process.argv[1]],
    {env:{...process.env,METER_MATRIX:'app',METER_ROUNDS:'1',METER_ROUND_START:String(round),METER_VALIDATION_WORKER:'1',METER_WORKER_RESULT:resultPath},maxBuffer:2*1024*1024},
    (error,stdout,stderr)=>resolve({error,stdout,stderr})));
   let result;try{result=JSON.parse(readFileSync(resultPath,'utf8'));}catch(readError){throw new Error('Round '+(round+1)+' did not produce a report: '+(stderr||error?.message||readError.message));}
   assert.equal(result.rounds.length,1);assert.equal(result.rounds[0].executed,10000);
   for(const digest of result.caseInputSHA256){assert.ok(!caseHashes.has(digest),'A duplicate actual scenario crossed round boundaries');caseHashes.add(digest);}
   assert.equal(JSON.stringify(result.sourceSHA256),JSON.stringify(sourceSHA256),'Every worker must test exactly the same source');
   if(!result.sourceUnchangedDuringRun)report.workerSourceChanged=true;
   report.rounds.push(result.rounds[0]);report.rounds.sort((a,b)=>a.round-b.round);
   report.executedScenarios+=result.executedScenarios;report.passedScenarios+=result.passedScenarios;report.failedScenarios+=result.failedScenarios;
   if(error&&result.status==='passed')throw error;
   checkpoint(report);console.log('METER_VALIDATION_ROUND '+JSON.stringify({matrix:'app',...result.rounds[0]}));
  }
  async function pool(){for(;;){const round=next++;if(round>=roundStart+roundCount)return;await runWorker(round);}}
  try{
   const workers=await Promise.allSettled(Array.from({length:Math.min(4,roundCount)},pool));
   const errors=workers.filter(result=>result.status==='rejected').map(result=>result.reason?.message||String(result.reason));
   if(errors.length){report.status='failed';report.infrastructureFailures=errors;checkpoint(report);throw new Error(errors.join('\n'));}
   const finalHashes=sourceHashes();report.sourceUnchangedDuringRun=!report.workerSourceChanged&&JSON.stringify(finalHashes)===JSON.stringify(sourceSHA256);
   if(!report.sourceUnchangedDuringRun)report.finalSourceSHA256=finalHashes;
   report.distinctScenariosAcrossRounds=caseHashes.size;
   assert.equal(report.executedScenarios,10000*roundCount);assert.equal(caseHashes.size,10000*roundCount);
   report.status=report.failedScenarios||!report.sourceUnchangedDuringRun?'failed':'passed';
   checkpoint(report);console.log('METER_VALIDATION_RESULT '+JSON.stringify(report));
   if(report.status!=='passed')process.exitCode=1;
  }finally{rmSync(directory,{recursive:true,force:true});}
 }
}
