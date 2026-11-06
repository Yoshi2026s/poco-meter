import assert from 'node:assert/strict';
import {readFile,stat,readdir} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,createHmac} from 'node:crypto';
import {validateSnapshot} from '../deployment/cloudflare-pages/snapshot.mjs';
const folder=resolve(process.argv[2]),assets=resolve(folder,'public');
const packet=JSON.parse(await readFile(resolve(folder,'verified-borders.json'),'utf8'));
validateSnapshot(packet);
assert.deepEqual((await readdir(assets)).sort(),['404.html','_headers','_routes.json','_worker.js','index.html','meter-icon-180.png','meter-icon-192.png','meter-icon-512.png','meter-sw.js','meter.webmanifest'].sort());
const sourceHTML=await readFile(new URL('../calculator/index.html',import.meta.url));
assert.deepEqual(await readFile(resolve(assets,'index.html')),sourceHTML);
assert.deepEqual(await readFile(resolve(assets,'meter-sw.js')),await readFile(new URL('../calculator/sw.js',import.meta.url)));
for(const size of [180,192,512]) {
  const icon=await readFile(resolve(assets,`meter-icon-${size}.png`));
  assert.equal(icon.subarray(1,4).toString(),'PNG');assert.equal(icon.readUInt32BE(16),size);assert.equal(icon.readUInt32BE(20),size);
}
const manifest=JSON.parse(await readFile(resolve(assets,'meter.webmanifest'),'utf8'));
assert.equal(manifest.start_url,'/');assert.equal(manifest.scope,'/');
assert.deepEqual(JSON.parse(await readFile(resolve(assets,'_routes.json'),'utf8')),{version:1,include:['/api/*'],exclude:[]});
assert.match(await readFile(resolve(assets,'_headers'),'utf8'),/Service-Worker-Allowed: \/\n/);
const workerSource=await readFile(resolve(assets,'_worker.js'),'utf8');
assert.ok(!workerSource.includes('freefreelife2000'));assert.ok(!workerSource.includes('chatgpt.site'));
// Cloudflare's 2026-09-04 limit is the uncompressed bundle size: 64 MiB on all plans.
// https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/
const uncompressedWorkerBytes=(await stat(resolve(assets,'_worker.js'))).size;
assert.ok(uncompressedWorkerBytes<64*1024*1024,'The uncompressed Worker bundle stays below the current 64 MiB limit');
const worker=(await import(pathToFileURL(resolve(assets,'_worker.js')).href)).default;
const sqlite=new DatabaseSync(':memory:');
sqlite.exec(await readFile(resolve(folder,'01-schema.sql'),'utf8'));
sqlite.exec(await readFile(resolve(folder,'02-borders.sql'),'utf8'));
const DB={prepare(sql){let args=[];return {bind(...values){args=values;return this;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async first(){return sqlite.prepare(sql).get(...args)??null;},async run(){return {meta:sqlite.prepare(sql).run(...args)};}};},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
const key='ab'.repeat(32),origin='https://example.pages.dev';
const env={DB,BORDER_WRITER_KEY:key,BORDER_WRITER_ORIGIN:origin,ASSETS:{async fetch(request){const path=new URL(request.url).pathname;return new Response(await readFile(resolve(assets,path==='/'?'index.html':path.slice(1))),{headers:{'Content-Type':path.endsWith('.js')?'text/javascript':'text/html'}});}}};
function request(path,body,options={}) {
  const stamp=options.stamp??String(Math.floor(Date.now()/1000)),digest=createHash('sha256').update(body).digest('hex');
  const signature=createHmac('sha256',Buffer.from(key,'hex')).update(`POST\n${path}\n${stamp}\n${digest}`).digest('hex');
  return new Request((options.origin??origin)+path,{method:'POST',body,headers:{'X-Border-Writer-Time':stamp,'X-Border-Writer-Signature':signature,...options.headers}});
}
const read=()=>worker.fetch(new Request(origin+'/api/borders'),env).then(r=>r.json());
const saved=await read();
const order=rows=>[...rows].sort((a,b)=>(a.date+'|'+a.close).localeCompare(b.date+'|'+b.close));
assert.deepEqual(order(saved.records),order(packet.records));assert.deepEqual(saved.sync,packet.sync);
assert.equal(sqlite.prepare('SELECT lock_until FROM border_sync WHERE id=?').get('daily').lock_until,0);
assert.equal((await worker.fetch(new Request(origin+'/'),env)).status,200);
assert.equal((await worker.fetch(new Request(origin+'/meter-sw.js'),env)).status,200);
assert.equal((await worker.fetch(new Request(origin+'/api/unknown'),env)).status,404);
for(const path of ['/api/borders/refresh','/api/borders/source-urls']) {
  assert.equal((await worker.fetch(new Request(origin+path,{method:'POST',body:'{}'}),env)).status,403);
  assert.equal((await worker.fetch(request(path,'{}',{headers:{'X-Border-Writer-Signature':'0'.repeat(64)}}),env)).status,403);
  assert.equal((await worker.fetch(request(path,'{}',{origin:'https://preview.example.pages.dev'}),env)).status,403);
  assert.equal((await worker.fetch(request(path,'{}'),{...env,BORDER_WRITER_ORIGIN:undefined})).status,403);
  assert.equal((await worker.fetch(request(path,'{}'),{...env,BORDER_WRITER_KEY:undefined})).status,403);
}
assert.deepEqual(await read(),saved);
const category=await readFile(new URL('./fixtures/category.html',import.meta.url),'utf8');
const lookup=await worker.fetch(request('/api/borders/source-urls',JSON.stringify({indexHTML:category})),env);
assert.equal(lookup.status,200);assert.equal((await lookup.json()).urls.length,3);
const url='https://one-carat.com/campus/archives/89496',html=await readFile(new URL('./fixtures/22.html',import.meta.url),'utf8');
for(const input of [html.replace('【D1】','【E】'),html.replace('【D1】','【D2】'),html.replaceAll('10月1日','10月32日'),'invalid HTML']) {
  assert.equal((await worker.fetch(request('/api/borders/refresh',JSON.stringify({articles:[{url,html:input}]})),env)).status,422);
  assert.deepEqual(await read(),saved);
}
const payload=JSON.stringify({articles:[{url,html}]});
assert.equal((await worker.fetch(request('/api/borders/refresh',payload,{stamp:String(Math.floor(Date.now()/1000)-301)}),env)).status,403);
assert.equal((await worker.fetch(request('/api/borders/refresh',JSON.stringify({articles:[{url,html},{url,html}]})),env)).status,400);
const updatedResponse=await worker.fetch(request('/api/borders/refresh',payload),env);
assert.equal(updatedResponse.status,200);const updated=await updatedResponse.json();assert.equal(updated.sync.status,'partial');
assert.deepEqual((await read()).records,updated.records);
const mutated=structuredClone(packet);mutated.records[0].ranks.E=[1,2,3];assert.throws(()=>validateSnapshot(mutated));
sqlite.close();
console.log(JSON.stringify({status:'passed',recordCount:packet.records.length,uncompressedWorkerBytes,frontendBytesUnchanged:true,offlineWorkerBytesUnchanged:true,sqliteImportMatchesSnapshot:true,anonymousRead:true,protectedWrites:true,realSourceWriteReadback:true,cloudflareProductionCPUVerified:false}));
