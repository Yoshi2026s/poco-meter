import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {contactApi} from '../lib/contact-store.mjs';
import {recordVisit} from '../lib/visitor-stats.mjs';
import {readLimitedBytes,claimSignedWrite,enforceRequestQuota} from '../lib/security-limits.mjs';
import {fetchHtml} from '../lib/border-source.mjs';
import {sealCalculatorHTML,pagePolicy,scriptSources} from '../lib/browser-security.mjs';
import {validateAndStripPNG} from '../lib/png-security.mjs';
import {engine,permitRefresh,plain,html} from './calculator-harness.mjs';
const origin='https://meter.example';
test('F05-F14 PNG CRC corruption is rejected and text metadata is removed from a valid image',async()=>{
 const bytes=readFileSync(new URL('./fixtures/contact-with-text.png',import.meta.url));
 const clean=await validateAndStripPNG(bytes);assert.ok(!Buffer.from(clean).includes(Buffer.from('harmless metadata')));
 const corrupted=Buffer.from(bytes);corrupted[corrupted.length-1]^=1;await assert.rejects(validateAndStripPNG(corrupted),/PNG CRC/);
});
function setup(){
 const sql=new DatabaseSync(':memory:');for(const name of ['0001_fine_monster_badoon','0002_magenta_solo','0003_large_blackheart','0004_dizzy_the_leader','0005_blushing_madrox','0006_security_rate_windows','0007_contact_sessions'])sql.exec(readFileSync(new URL('../drizzle/'+name+'.sql',import.meta.url),'utf8'));
 const DB={prepare(q){let values=[];return{bind(...v){values=v;return this},async run(){return sql.prepare(q).run(...values)},async all(){return{results:sql.prepare(q).all(...values)}},async first(){return sql.prepare(q).get(...values)}}},async batch(items){sql.exec('BEGIN');try{const result=[];for(const item of items)result.push(await item.run());sql.exec('COMMIT');return result}catch(e){sql.exec('ROLLBACK');throw e}}};
 const objects=new Map(),env={DB,BUCKET:{async put(k,b){objects.set(k,b)},async delete(k){objects.delete(k)}}};return{sql,env,objects};
}
test('F01 rotation of contact cookies cannot bypass the per-IP new-thread limit',async()=>{
 const s=setup();for(let i=0;i<11;i++){
 const bootstrap=await contactApi(new Request(origin+'/api/contact',{headers:{'CF-Connecting-IP':'203.0.113.42'}}),s.env);assert.equal(bootstrap.status,200);const cookie=bootstrap.headers.get('Set-Cookie').split(';')[0];const r=await contactApi(new Request(origin+'/api/contact',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,'CF-Connecting-IP':'203.0.113.42'},body:JSON.stringify({requestId:crypto.randomUUID(),subject:'その他',content:'隔離検証'})}),s.env);assert.equal(r.status,i<10?200:429);}
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM contact_threads').get().n,10);s.sql.close();
});
test('F02 visitor quota stops fresh event IDs and keeps another IP usable',async()=>{
 const s=setup(),now=new Date('2026-10-13T03:00:10Z');
 async function send(ip){return recordVisit(new Request(origin+'/api/visits',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':ip},body:JSON.stringify({eventId:crypto.randomUUID()})}),s.env,now);}
 for(let i=0;i<121;i++)assert.equal((await send('203.0.113.42')).status,i<120?204:429);
 assert.equal((await send('203.0.113.43')).status,204);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM site_visit_events').get().n,121);s.sql.close();
});
test('F04 exhausted upload quota rejects before reading the body or writing images',async()=>{
 const s=setup(),headers={Origin:origin,Cookie:'__Host-pococha-contact='+'ab'.repeat(32),'CF-Connecting-IP':'203.0.113.42','Content-Type':'multipart/form-data; boundary=test'};
 for(let i=0;i<20;i++)await enforceRequestQuota(new Request(origin,{headers}),s.env,'contactUpload');
 let read=false;const stream=new ReadableStream({pull(){read=true;}},{highWaterMark:0});
 const req=new Request(origin+'/api/contact',{method:'POST',headers,body:stream,duplex:'half'});
 assert.equal((await contactApi(req,s.env)).status,429);assert.equal(read,false);assert.equal(s.objects.size,0);s.sql.close();
});
test('F06 reads reject size overflow and stop a never-finishing stream',async()=>{
 await assert.rejects(readLimitedBytes(new Response('12345'),4),error=>error.status===413);
 await assert.rejects(readLimitedBytes(new Response(new ReadableStream({start(){}})),20,20),error=>error.status===408);
});
test('F07 source content is bounded during streaming before text allocation',async()=>{
 let cancelled=false;const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(3600001));},cancel(){cancelled=true;}});
 await assert.rejects(fetchHtml('https://one-carat.com/campus/archives/89495',async()=>new Response(stream,{headers:{'Content-Type':'text/html'}})),error=>error.status===413);
 assert.equal(cancelled,true);
});
test('F08 unverified backup provenance is downgraded while values and manual records are preserved',()=>{
 const e=engine('2026-10-13T12:00:00+09:00');permitRefresh(e);e.state.log={'2026-10-10':{S2:[100,200,300]}};
 const bk={pmcBackup:1,log:{'2026-10-12':{S2:[1,2,3]}},provenance:{22:{'2026-10-12':{S2:{origin:'verified',source:'unverified',checkedAt:'fabricated'}}}}};
 e.element('paste').value=JSON.stringify(bk);e.element('logDate').value='2026-10-12';e.element('importBtn').onclick();
 assert.deepEqual(plain(e.state.log['2026-10-10'].S2),[100,200,300]);assert.deepEqual(plain(e.state.log['2026-10-12'].S2),[1,2,3]);assert.equal(e.state.provenance['22']['2026-10-12'].S2.origin,'backup');assert.equal(e.state.provenance['22']['2026-10-12'].S2.checkedAt,'');
});
test('F09 malformed oversized imports fail before state changes',()=>{
 const e=engine();assert.throws(()=>e.parseBackupText('x'.repeat(8*1024*1024+1)));assert.throws(()=>e.cleanList(Array.from({length:501},()=>({name:'a',val:1})),true));assert.throws(()=>e.cleanList([{name:'a'.repeat(257),val:1}],true));
});
test('F10-F12 script hashes match actual inline content and frame restrictions are separate',()=>{
 const sealed=sealCalculatorHTML(html),policy=pagePolicy(sealed);assert.ok(!/script-src[^;]*unsafe-inline/.test(policy));assert.ok(policy.includes(scriptSources(html)));assert.ok(policy.includes("frame-ancestors 'self' https://chatgpt.com"));assert.ok(pagePolicy('<html><script>safe()</script></html>',true).includes("frame-ancestors 'none'"));
});
test('F16 one signed write can only claim its atomic replay record once',async()=>{
 const s=setup(),r=new Request(origin+'/api/borders/refresh',{headers:{'X-Border-Writer-Time':'1791860410','X-Border-Writer-Signature':'ab'.repeat(32)}});
 await claimSignedWrite(r,s.env);await assert.rejects(claimSignedWrite(r,s.env),error=>error.status===409);assert.equal(s.sql.prepare("SELECT COUNT(*) n FROM security_rate_windows WHERE id LIKE 'signed:%'").get().n,1);s.sql.close();
});
test('quota claims stay bounded under concurrent requests',async()=>{
 const s=setup(),req=new Request(origin,{headers:{'CF-Connecting-IP':'203.0.113.42'}});const results=await Promise.allSettled(Array.from({length:30},()=>enforceRequestQuota(req,s.env,'contactNew',Date.parse('2026-10-13T03:00:10Z'))));assert.equal(results.filter(r=>r.status==='fulfilled').length,10);assert.equal(results.filter(r=>r.status==='rejected').length,20);s.sql.close();
});
test('braces project patch bounds nested strings before recursive compilation',()=>{
 const braces=createRequire(new URL('../node_modules/.pnpm/node_modules/micromatch/package.json',import.meta.url))('braces');assert.deepEqual(braces('a/{b,c}',{expand:true}),['a/b','a/c']);assert.throws(()=>braces.compile('{'.repeat(65)+'x'+'}'.repeat(65)),/project nesting limit/);assert.throws(()=>braces.parse('x'.repeat(16385)),/project size limit/);
});
