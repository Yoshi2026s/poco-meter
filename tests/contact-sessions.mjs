import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { contactApi, contactAttachmentApi, contactSessionApi } from '../lib/contact-store.mjs';
import { CONTACT_SESSION_SECONDS, requireContactSession, revokeContactSession } from '../lib/contact-sessions.mjs';
import { enforceRequestQuota } from '../lib/security-limits.mjs';
import { iconData } from '../calculator/offline-assets.mjs';
const origin='https://meter.example',owner={'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'},lifetime=CONTACT_SESSION_SECONDS*1000;
const png=Buffer.from(iconData['180'],'base64');
const hash = async cookie => Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(cookie.split('=')[1]))).toString('hex');
const message = (content='session test') => ({requestId:crypto.randomUUID(),subject:'その他',content});
function setup(){
 const sql=new DatabaseSync(':memory:');for(const name of ['0003_large_blackheart','0004_dizzy_the_leader','0005_blushing_madrox','0006_security_rate_windows','0007_contact_sessions'])sql.exec(readFileSync(new URL('../drizzle/'+name+'.sql',import.meta.url),'utf8'));
 sql.exec('PRAGMA foreign_keys=ON');const state={messageReads:0,gets:0,puts:0,beforeBatch:null,beforeRun:null,afterFirst:null};
 const DB={prepare(query){let args=[];return{bind(...v){args=v;return this;},async run(){await state.beforeRun?.(query,args);return sql.prepare(query).run(...args);},async first(){if(/SELECT .*contact_messages/s.test(query))state.messageReads++;const row=sql.prepare(query).get(...args);await state.afterFirst?.(query,args,row);return row;},async all(){if(/SELECT .*contact_messages/s.test(query))state.messageReads++;return{results:sql.prepare(query).all(...args)};}};},async batch(statements){await state.beforeBatch?.();sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 const objects=new Map(),BUCKET={async put(k,b){state.puts++;objects.set(k,Uint8Array.from(b));},async get(k){state.gets++;const b=objects.get(k);return b?{size:b.length,body:b}:null;},async delete(k){objects.delete(k);}};
 const env={DB,BUCKET,ANALYTICS_ADMIN_EMAIL:owner['oai-authenticated-user-email']};
 const get=(cookie='',admin=false)=>contactApi(new Request(origin+(admin?'/api/admin/contact':'/api/contact'),{headers:{Cookie:cookie,...(admin?owner:{})}}),env,admin);
 const post=(cookie,data,attachment=false)=>{let body,headers={Cookie:cookie,Origin:origin};if(attachment){body=new FormData();body.append('data',JSON.stringify(data));body.append('image',new Blob([png],{type:'image/png'}),'test.png');}else{headers['Content-Type']='application/json';body=JSON.stringify(data);}return contactApi(new Request(origin+'/api/contact',{method:'POST',headers,body}),env);};
 const image=(cookie,id,admin=false)=>contactAttachmentApi(new Request(origin+'/api/'+(admin?'admin/':'')+'contact/attachments/'+id,{headers:{Cookie:cookie,...(admin?owner:{})}}),env,admin);
 const revoke=(threadId,overrides={})=>contactSessionApi(new Request(origin+'/api/admin/contact/session',{method:'POST',headers:{...owner,Origin:origin,'Content-Type':'application/json',...overrides},body:JSON.stringify({threadId})}),env);
 return{sql,env,state,objects,get,post,image,revoke,async cookie(){const response=await get();assert.equal(response.status,200);return response.headers.get('Set-Cookie').split(';')[0];},async legacy(){const cookie='__Host-pococha-contact='+'ab'.repeat(32),visitorHash=await hash(cookie),input=message('legacy'),created=Date.now()-86400000;sql.prepare('INSERT INTO contact_threads VALUES (?,?,?,?,?)').run(input.requestId,visitorHash,input.subject,created,created);sql.prepare('INSERT INTO contact_messages (id,thread_id,author,content,created_at) VALUES (?,?,?,?,?)').run(input.requestId,input.requestId,'visitor',input.content,created);return{cookie,visitorHash,input,created};}};
}
test('server issues random hashed sessions with a fixed year, without sliding renewal on read or send',async()=>{
 const s=setup(),cookie=await s.cookie(),visitorHash=await hash(cookie),first=s.sql.prepare('SELECT * FROM contact_sessions').get();
 assert.equal(first.visitor_hash,visitorHash);assert.equal(first.expires_at-first.created_at,lifetime);assert.equal(first.revoked_at,null);assert.ok(!JSON.stringify(first).includes(cookie.split('=')[1]));
 assert.equal((await s.post(cookie,message())).status,200);const read=await s.get(cookie);assert.equal(read.status,200);assert.equal(read.headers.get('Set-Cookie'),null);
 assert.deepEqual(s.sql.prepare('SELECT * FROM contact_sessions').get(),first);
});
test('unknown caller-supplied tokens cannot create a session or read a POST body',async()=>{
 const s=setup(),cookie='__Host-pococha-contact='+'cd'.repeat(32);let read=false;
 const body=new ReadableStream({pull(){read=true;}},{highWaterMark:0});
 const request=new Request(origin+'/api/contact',{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body,duplex:'half'});
 const response=await contactApi(request,s.env);assert.equal(response.status,401);assert.match(response.headers.get('Set-Cookie'),/Max-Age=0/);assert.equal(read,false);
 assert.equal((await s.get(cookie)).status,401);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM contact_sessions').get().n,0);assert.equal(s.state.messageReads,0);
 assert.notEqual(await s.cookie(),cookie);
});
test('legacy history can be adopted on GET or POST once, using earliest thread time without renewal',async()=>{
 for(const method of ['GET','POST']){
  const s=setup(),legacy=await s.legacy();
  const response=method==='GET'?await s.get(legacy.cookie):await s.post(legacy.cookie,{...message('follow-up'),threadId:legacy.input.requestId});assert.equal(response.status,200);
  const row=s.sql.prepare('SELECT * FROM contact_sessions').get();assert.equal(row.created_at,legacy.created);assert.equal(row.expires_at,legacy.created+lifetime);assert.equal(row.revoked_at,null);
  const inbox=await(await s.get(legacy.cookie)).json();assert.equal(inbox.messages[0].content,'legacy');assert.equal(inbox.messages.length,method==='GET'?1:2);
 }
});
test('expired existing and expired legacy cookies fail before message or object reads and can bootstrap a separate new session',async()=>{
 for(const legacy of [false,true]){
  const s=setup();let cookie;
  if(legacy){const old=await s.legacy();cookie=old.cookie;s.sql.prepare('UPDATE contact_threads SET created_at=?').run(Date.now()-lifetime-1);}
  else{cookie=await s.cookie();assert.equal((await s.post(cookie,message(),true)).status,200);s.sql.prepare('UPDATE contact_sessions SET expires_at=?').run(Date.now()-1);}
  const before=s.state.messageReads,response=await s.get(cookie);assert.equal(response.status,401);assert.match(response.headers.get('Set-Cookie'),/Max-Age=0/);assert.equal(s.state.messageReads,before);
  assert.equal((await s.post(cookie,message(),true)).status,401);assert.equal(s.state.messageReads,before);
  const thread=s.sql.prepare('SELECT id FROM contact_threads').get();assert.equal((await s.image(cookie,thread.id)).status,401);assert.equal(s.state.gets,0);assert.equal(s.state.messageReads,before);
  const fresh=await s.cookie();assert.notEqual(fresh,cookie);assert.equal((await(await s.get(fresh)).json()).total,0);assert.equal((await(await s.get('',true)).json()).total,1);
 }
});
test('owner revocation covers every thread of that visitor, retains messages/images, is idempotent and cannot renew',async()=>{
 const s=setup(),cookie=await s.cookie(),a=message(),b=message('second');await s.post(cookie,a,true);await s.post(cookie,b);const before=s.sql.prepare('SELECT * FROM contact_sessions').get();
 const response=await s.revoke(a.requestId);assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,threadId:a.requestId,revoked:true});
 const revoked=s.sql.prepare('SELECT * FROM contact_sessions').get();assert.equal(revoked.expires_at,before.expires_at);assert.equal(revoked.created_at,before.created_at);assert.ok(revoked.revoked_at>=before.created_at);
 assert.equal((await s.revoke(b.requestId)).status,200);assert.deepEqual(s.sql.prepare('SELECT * FROM contact_sessions').get(),revoked);
 const reads=s.state.messageReads;assert.equal((await s.get(cookie)).status,401);assert.equal((await s.post(cookie,{...message(),threadId:b.requestId})).status,401);assert.equal((await s.image(cookie,a.requestId)).status,401);assert.equal(s.state.messageReads,reads);assert.equal(s.state.gets,0);
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM contact_messages').get().n,2);assert.equal(s.objects.size,1);assert.equal((await s.image('',a.requestId,true)).status,200);assert.equal((await(await s.get('',true)).json()).total,2);
});
test('revoke before first legacy adoption writes a permanent tombstone',async()=>{
 const s=setup(),legacy=await s.legacy();assert.equal((await s.revoke(legacy.input.requestId)).status,200);
 const first=s.sql.prepare('SELECT * FROM contact_sessions').get();assert.equal(first.visitor_hash,legacy.visitorHash);assert.ok(first.revoked_at);assert.equal((await s.get(legacy.cookie)).status,401);assert.equal((await s.post(legacy.cookie,message())).status,401);assert.deepEqual(s.sql.prepare('SELECT * FROM contact_sessions').get(),first);
});
test('legacy adoption racing with revocation never overwrites the tombstone',async()=>{
 const s=setup(),legacy=await s.legacy();let adoptionReached=false;
 await assert.rejects(requireContactSession(s.env.DB,legacy.visitorHash,async()=>{adoptionReached=true;await revokeContactSession(s.env.DB,legacy.input.requestId);}),error=>error.status===401);
 assert.equal(adoptionReached,true);assert.ok(s.sql.prepare('SELECT revoked_at FROM contact_sessions').get().revoked_at);
});
test('revocation during an R2 upload removes only the uncommitted new image and prevents the message',async()=>{
 const s=setup(),cookie=await s.cookie(),original=message('existing');await s.post(cookie,original,true);const put=s.env.BUCKET.put;
 s.env.BUCKET.put=async(...args)=>{await put(...args);await s.revoke(original.requestId);};
 const next={...message('not committed'),threadId:original.requestId};assert.equal((await s.post(cookie,next,true)).status,401);
 assert.equal(s.objects.size,1);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM contact_messages').get().n,1);assert.equal((await s.image('',original.requestId,true)).status,200);
});
test('revocation immediately before DB batch blocks inserts and thread timestamp changes atomically',async()=>{
 const s=setup(),cookie=await s.cookie(),original=message();await s.post(cookie,original);const before=s.sql.prepare('SELECT updated_at FROM contact_threads').get().updated_at;
 s.state.beforeBatch=async()=>{await s.revoke(original.requestId);};
 assert.equal((await s.post(cookie,{...message(),threadId:original.requestId})).status,401);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM contact_messages').get().n,1);assert.equal(s.sql.prepare('SELECT updated_at FROM contact_threads').get().updated_at,before);
});
test('a DB batch queued beyond fixed session expiry cannot create a message or an empty thread',async()=>{
 const s=setup(),cookie=await s.cookie(),deadline=Date.now()+100;s.sql.prepare('UPDATE contact_sessions SET expires_at=?').run(deadline);
 s.state.beforeBatch=async()=>{await new Promise(resolve=>setTimeout(resolve,Math.max(0,deadline-Date.now())+50));};
 const response=await s.post(cookie,message());assert.equal(response.status,401);assert.match(response.headers.get('Set-Cookie'),/Max-Age=0/);
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM contact_messages').get().n,0);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM contact_threads').get().n,0);
});
test('revocation while an attachment is being retrieved prevents response disclosure',async()=>{
 const s=setup(),cookie=await s.cookie(),input=message();await s.post(cookie,input,true);const get=s.env.BUCKET.get;
 s.env.BUCKET.get=async key=>{const result=await get(key);await s.revoke(input.requestId);return result;};
 const response=await s.image(cookie,input.requestId);assert.equal(response.status,401);assert.match(response.headers.get('Set-Cookie'),/Max-Age=0/);assert.equal(response.headers.get('Content-Type'),'application/json; charset=utf-8');assert.equal(s.objects.size,1);
});
test('revocation during inbox retrieval prevents message content in the response',async()=>{
 const s=setup(),cookie=await s.cookie(),input=message('private-content');await s.post(cookie,input);
 s.state.afterFirst=async query=>{if(query.startsWith('SELECT COUNT(*) AS total FROM contact_threads')){s.state.afterFirst=null;await s.revoke(input.requestId);}};
 const response=await s.get(cookie);assert.equal(response.status,401);assert.ok(!(await response.text()).includes('private-content'));
});
test('owner revocation requires full existing identity, strict Origin/JSON, one UUID and bounded body',async()=>{
 const s=setup(),cookie=await s.cookie(),input=message();await s.post(cookie,input);
 for(const headers of [{'oai-authenticated-user-id':''},{'oai-authenticated-user-email':''},{'oai-authenticated-user-email':'outsider@example.test'},{Origin:'https://evil.example'},{Origin:''},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await s.revoke(input.requestId,headers)).status,403);
 assert.equal((await s.revoke(input.requestId,{'Content-Type':'text/plain'})).status,415);
 for(const body of ['{}','null','[]','{','{"threadId":"bad"}',JSON.stringify({threadId:input.requestId,extra:true})])assert.equal((await contactSessionApi(new Request(origin+'/api/admin/contact/session',{method:'POST',headers:{...owner,Origin:origin,'Content-Type':'application/json'},body}),s.env)).status,400);
 assert.equal((await contactSessionApi(new Request(origin+'/api/admin/contact/session',{method:'POST',headers:{...owner,Origin:origin,'Content-Type':'application/json'},body:'x'.repeat(8193)}),s.env)).status,413);
 assert.equal((await s.revoke(crypto.randomUUID())).status,404);assert.equal((await contactSessionApi(new Request(origin+'/api/admin/contact/session',{headers:owner}),s.env)).status,405);assert.equal(s.sql.prepare('SELECT revoked_at FROM contact_sessions').get().revoked_at,null);
});
test('revocation lost write response is idempotently recovered without deleting data',async()=>{
 const s=setup(),legacy=await s.legacy(),prepare=s.env.DB.prepare;
 s.env.DB.prepare=query=>{const statement=prepare(query),run=statement.run;statement.run=async()=>{const result=await run();if(query.startsWith('INSERT INTO contact_sessions'))throw new Error('lost write response');return result;};return statement;};
 assert.equal((await s.revoke(legacy.input.requestId)).status,200);assert.equal((await s.revoke(legacy.input.requestId)).status,200);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM contact_messages').get().n,1);assert.ok(s.sql.prepare('SELECT revoked_at FROM contact_sessions').get().revoked_at);
});
test('session issuance quota stops persistent rows before insertion while existing sessions remain usable',async()=>{
 const s=setup(),cookie=await s.cookie();for(let i=1;i<30;i++)assert.equal((await s.get()).status,200);
 const response=await s.get();assert.equal(response.status,429);assert.equal(response.headers.get('Set-Cookie'),null);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM contact_sessions').get().n,30);assert.equal((await s.get(cookie)).status,200);
});
test('exhausted read quota prevents any session issuance or legacy adoption write',async()=>{
 for(const legacy of [false,true]){
  const s=setup(),old=legacy?await s.legacy():null;await enforceRequestQuota(new Request(origin),s.env,'contactRead');await enforceRequestQuota(new Request(origin),s.env,'contactRead',Date.now()+60000);s.sql.prepare("UPDATE security_rate_windows SET hits=2000 WHERE id LIKE 'contactRead:%'").run();
  assert.equal((await s.get(old?.cookie||'')).status,429);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM contact_sessions').get().n,0);
 }
});
