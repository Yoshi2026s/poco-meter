// Current built-Worker boundary: public intake is retired; existing owner records stay private.
import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFileSync,readdirSync} from 'node:fs';import path from 'node:path';
const require=createRequire(import.meta.url);const {Miniflare,createFetchMock}=createRequire(require.resolve('wrangler/package.json'))('miniflare');
const root=path.resolve(import.meta.dirname,'..'),built=path.join(root,'dist/server');
const fetchMock=createFetchMock();fetchMock.disableNetConnect();fetchMock.get('https://pococha-comment-access.freefreelife2000.chatgpt.site').intercept({path:'/api/catalog/access/meter'}).reply(200,JSON.stringify({id:'meter',enabled:true})).persist();
const mf=new Miniflare({fetchMock,modules:['index.js',...readdirSync(built,{recursive:true}).filter(f=>/\.(mjs|js)$/.test(f)&&f!=='index.js')].map(f=>({type:'ESModule',path:path.join(built,f)})),modulesRoot:built,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['BUCKET'],bindings:{ANALYTICS_ADMIN_EMAIL:'owner@example.test'},cf:false});
const origin='https://meter.example',owner={'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'};let checks=0;
const equal=(a,b)=>{assert.equal(a,b);checks++};
try{
 const db=await mf.getD1Database('DB');for(const f of readdirSync(path.join(root,'drizzle')).filter(f=>/^\d+_.*\.sql$/.test(f)).sort())for(const q of readFileSync(path.join(root,'drizzle',f),'utf8').split('--> statement-breakpoint'))if(q.trim())await db.prepare(q).run();
 const worker=await mf.getWorker(),get=(p,h={})=>worker.fetch(origin+p,{headers:h,redirect:'manual'});
 for(const method of ['GET','POST']){const r=await mf.dispatchFetch(origin+'/api/contact',{method,...(method==='POST'?{headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'}:{})});assert.equal(r.status,410,await r.text());checks++;}
 const thread=crypto.randomUUID(),message=crypto.randomUUID(),stamp=Date.now(),secret='<img src=x onerror=alert(1)> private inquiry';
 await db.prepare('INSERT INTO contact_threads(id,visitor_hash,subject,created_at,updated_at) VALUES(?,?,?,?,?)').bind(thread,'fixture-hash','その他',stamp,stamp).run();
 await db.prepare('INSERT INTO contact_messages(id,thread_id,author,content,created_at) VALUES(?,?,?,?,?)').bind(message,thread,'visitor',secret,stamp).run();
 for(const identity of [{},{'oai-authenticated-user-email':owner['oai-authenticated-user-email']},{'oai-authenticated-user-id':'owner'},{...owner,'oai-authenticated-user-email':'stranger@example.test'}]){
  const api=await get('/api/admin/contact',identity);equal(api.status,403);assert(!(await api.text()).includes(secret));checks++;
  const page=await get('/admin/messages',identity);equal(page.status,200);assert(!(await page.text()).includes('private inquiry'));checks++;
 }
 const privateApi=await get('/api/admin/contact',owner);equal(privateApi.status,200);assert((await privateApi.text()).includes('private inquiry'));checks++;
 const page=await get('/admin/messages',owner),html=await page.text();equal(page.status,200);assert(html.includes('&lt;img'));assert(!html.includes(secret));checks+=2;assert(page.headers.get('Cache-Control').includes('no-store'));assert(page.headers.get('Content-Security-Policy').includes("frame-ancestors 'none'"));checks+=2;
 const denied=await worker.fetch(origin+'/api/admin/contact',{method:'POST',headers:{...owner,Origin:'https://evil.test','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),threadId:thread,content:'unexpected'})});equal(denied.status,403);
 equal((await db.prepare('SELECT COUNT(*) n FROM contact_messages').first()).n,1);
 console.log(JSON.stringify({checks,result:'passed',scope:'built Worker + isolated D1, retired public intake, existing record privacy, owner reads, escaped HTML and cross-origin write refusal'}));
}finally{await mf.dispose();}
