// Exactly 10,000 distinct automated scenarios against the shipped code.
// DOM doubles and isolated SQLite/R2 are used here, not production data or phones.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { engine, pageEngine, plain, pointsFromK } from './calculator-harness.mjs';
import { contactApi, contactAttachmentApi } from '../lib/contact-store.mjs';

const started=Date.now(), e=engine(), counts={}, signatures=new Set();
function record(group,condition){
 const signature=JSON.stringify([group,condition]);assert.ok(!signatures.has(signature),'No repeated test conditions');
 signatures.add(signature);counts[group]=(counts[group]||0)+1;
}
function exactUnit(n,places,suffix){const value=BigInt(n),base=10n**BigInt(places);return `${value/base}.${String(value%base).padStart(places,'0')}${suffix}`;}
function fullwidth(text){return text.replace(/[0-9.,]/g,c=>String.fromCharCode(c.charCodeAt(0)+0xfee0));}
for(let i=0;i<4000;i++){
 const n=1001+Math.floor(i/4)*104729,kind=i%4;
 const input=[String(n),n.toLocaleString('en-US'),exactUnit(n,3,'K'),fullwidth(exactUnit(n,4,'万'))][kind];
 assert.equal(e.readNumber(input),n);assert.equal(pointsFromK(e.fmtRemainingK(n)),BigInt(n));
 record('pointParsingAndDisplay',{n,input});
}
const prices=[55,111,1080,5555];
for(let i=0;i<3000;i++){
 const core=i%1001,rem=i%17===0?e.MAX_VALUE:(i+1)*65537,price=prices[i%4];e.state.coreCount=String(core);
 const denominator=BigInt(100+e.coreInfo().bonus),numerator=BigInt(rem)*25n,coins=BigInt(e.needCoins(rem)),items=BigInt(e.itemRange(rem,price).replaceAll(',',''));
 assert.ok(coins*denominator>=numerator&&(coins-1n)*denominator<numerator);
 assert.ok(items*BigInt(price)*denominator>=numerator&&(items-1n)*BigInt(price)*denominator<numerator);
 assert.equal(e.readCoreCount(fullwidth(String(core))),core);
 record('coinAndItemRounding',{i,core,rem,price});
}
const day=86400000,anchor=Date.parse('2026-01-01T00:00:00+09:00');
for(let i=0;i<2000;i++){
 const minute=i%1440,deadline=`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
 const cutoff=anchor+minute*60000,now=cutoff+(Math.floor(i/3)*day)+[-1,0,1][i%3];e.state.deadline=deadline;
 const result=e.meterWindow(now),expected=cutoff+(Math.floor((now-cutoff)/day)+1)*day;
 assert.equal(result.end,expected);assert.ok(result.start<=now&&now<result.end);assert.equal(result.end-result.start,day);
 assert.equal(e.countdownTime(result.end-now),new Date(Math.ceil((result.end-now)/1000)*1000).toISOString().slice(11,19).replace(/^00:00:00$/,'24:00:00'));
 record('jstCutoffsAndCountdown',{deadline,now});
}
const config={...plain(engine().state),target:'100000',current:'0',pick:'',coreCount:'0',seedVer:3,seedVer13:1,snapshotVersion:'2026-10-02-v3',goalDefaults:{...plain(engine().standardGoalDefaults()),applyOnLoad:false}};
const pages=[false,true].map(phone=>pageEngine(config,{navigator:{onLine:false},matchMedia:query=>({matches:query.includes('max-width:700px')?phone:false})}));
function input(p,id,value){const el=p.element(id);el.value=String(value);el.dispatchEvent(new Event('input'));}
for(let i=0;i<500;i++){
 const p=pages[i%2],target=200000+(i*101),current=i*97,core=i%1001;
 input(p,['target','targetMini'][i%2],target);input(p,['currentTop','currentMini'][i%2],current);input(p,['coreCountTop','coreCountItems'][i%2],core);p.tick(1000);
 const saved=JSON.parse(p.stored.get('pococha-meter-calc-v1'));
 assert.equal(saved.target,String(target));assert.equal(saved.current,String(current));assert.equal(saved.coreCount,String(core));
 assert.equal(pointsFromK(p.element('miniR').textContent),BigInt(target-current));
 assert.equal(p.element('coreCountTop').value,p.element('coreCountItems').value);
 e.state.coreCount=String(core);const denominator=BigInt(100+e.coreInfo().bonus),coins=BigInt(p.element('coinNeed').textContent.replaceAll(',',''));
 assert.ok(coins*denominator>=BigInt(target-current)*25n&&(coins-1n)*denominator<BigInt(target-current)*25n);
 record('desktopAndPhoneInputSync',{phone:!!(i%2),target,current,core});
}

const sql=new DatabaseSync(':memory:');
for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>/^\d+_.*\.sql$/.test(name)).sort())sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
sql.exec('PRAGMA foreign_keys=ON');
const DB={prepare(query){let values=[];return {bind(...args){values=args;return this;},run(){return sql.prepare(query).run(...values);},async first(){return sql.prepare(query).get(...values);},async all(){return {results:sql.prepare(query).all(...values)};}};},async batch(statements){sql.exec('BEGIN');try{const result=statements.map(s=>s.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
const objects=new Map();let writes=0,reads=0;
const BUCKET={async put(key,bytes){writes++;objects.set(key,Uint8Array.from(bytes));},async get(key){reads++;const bytes=objects.get(key);return bytes?{size:bytes.length,body:bytes}:null;},async delete(key){objects.delete(key);}};
const env={DB,BUCKET,ANALYTICS_ADMIN_EMAIL:'owner@example.test'},origin='https://meter.example';
const jpg=readFileSync(new URL('./fixtures/contact-small.jpg',import.meta.url)),webp=readFileSync(new URL('./fixtures/contact-small.webp',import.meta.url));
const brokenPNG=Buffer.alloc(33);brokenPNG.set([137,80,78,71,13,10,26,10]);brokenPNG.writeUInt32BE(13,8);brokenPNG.write('IHDR',12);brokenPNG.writeUInt32BE(1,16);brokenPNG.writeUInt32BE(1,20);
try{
 for(let i=0;i<500;i++){
  const kind=i%10,id=`00000000-0000-4000-8000-${i.toString(16).padStart(12,'0')}`,cookie='__Host-pococha-contact='+(i+1).toString(16).padStart(64,'0');
  const payload={requestId:id,subject:'不具合の報告',content:`確認${i}\n改行 😀`};let body,expected=200;
  const headers={Cookie:cookie,Origin:origin};
  if(kind===2){headers['Content-Type']='application/json';body=JSON.stringify(payload);}
  else{
   const form=new FormData(),count=kind===0?1:kind===3?6:5;
   if(kind===8){payload.unrecognized=true;expected=400;}if(kind===9){payload.requestId='invalid-'+i;expected=400;}
   form.append('data',JSON.stringify(payload));
   for(let index=0;index<count;index++)form.append('image',new Blob([kind===4&&index===4?brokenPNG:index%2?webp:jpg],{type:'image/png'}),'private-'+index+'.png');
   if(kind===3)expected=400;if(kind===4)expected=415;
   if(kind===5){form.append('data','{}');expected=400;}
   if(kind===6){headers.Origin='https://other.example';expected=403;}
   if(kind===7){delete headers.Cookie;expected=401;}
   body=form;
  }
  const beforeWrites=writes,beforeMessages=sql.prepare('SELECT COUNT(*) n FROM contact_messages').get().n;
  const response=await contactApi(new Request(origin+'/api/contact',{method:'POST',headers,body}),env);
  assert.equal(response.status,expected,`contact scenario ${i}/${kind}`);
  if(expected!==200){assert.equal(writes,beforeWrites);assert.equal(sql.prepare('SELECT COUNT(*) n FROM contact_messages').get().n,beforeMessages);}
  else{
   const result=await response.json();assert.equal(result.id,id);
   const inbox=await (await contactApi(new Request(origin+'/api/contact',{headers:{Cookie:cookie}}),env)).json();
   assert.equal(inbox.messages[0].content,payload.content);assert.equal(inbox.messages[0].attachments.length,kind===2?0:kind===0?1:5);
   if(kind!==2){
    const url=inbox.messages[0].attachments.at(-1).url;
    assert.equal((await contactAttachmentApi(new Request(origin+url,{headers:{Cookie:cookie}}),env)).status,200);
    const beforeReads=reads;
    assert.equal((await contactAttachmentApi(new Request(origin+url,{headers:{Cookie:'__Host-pococha-contact='+(i+1001).toString(16).padStart(64,'0')}}),env)).status,404);assert.equal(reads,beforeReads);
   }
  }
  record('contactFilesValidationAndPrivacy',{i,kind,id,expected});
 }
}finally{sql.close();}
assert.equal(signatures.size,10000);
const report={status:'passed',distinctScenarios:signatures.size,counts,sourceSHA256:Object.fromEntries(['calculator/index.html','calculator/sw.js','lib/contact-store.mjs'].map(file=>[file,createHash('sha256').update(readFileSync(new URL('../'+file,import.meta.url))).digest('hex')])),durationMs:Date.now()-started,scope:'Point parsing, exact item rounding, JST cutoff boundaries, desktop/phone DOM-handler sync, isolated contact API validation and private image access.',limitations:'These are automated scenarios, not 10,000 browser sessions or physical iPhone/Android runs.'};
writeFileSync(new URL('../docs/debug-current-10000-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
