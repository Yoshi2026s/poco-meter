import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { contactApi, contactAttachmentApi } from '../lib/contact-store.mjs';
import { iconData } from '../calculator/offline-assets.mjs';
import { enforceRequestQuota } from '../lib/security-limits.mjs';
import { stripJPEGMetadata, stripWebPMetadata } from '../lib/image-metadata-security.mjs';
import { exifFixture, jpegSegment, webpChunk, webpFixture } from './fixtures/image-metadata.mjs';
const origin='https://meter.example',owner={'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'};
const png=Buffer.from(iconData['180'],'base64'),otherPNG=Buffer.from(iconData['192'],'base64');
function setup(){
 const sql=new DatabaseSync(':memory:');
 for(const name of ['0003_large_blackheart','0004_dizzy_the_leader','0005_blushing_madrox','0007_contact_sessions'])sql.exec(readFileSync(new URL('../drizzle/'+name+'.sql',import.meta.url),'utf8'));
 sql.exec('PRAGMA foreign_keys=ON');
 const DB={prepare(query){let args=[];return {bind(...values){args=values;return this;},run(){return sql.prepare(query).run(...args);},async all(){return {results:sql.prepare(query).all(...args)};},async first(){return sql.prepare(query).get(...args);}};},async batch(statements){sql.exec('BEGIN');try{const rows=statements.map(s=>s.run());sql.exec('COMMIT');return rows;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const objects=new Map();let reads=0,puts=0;
 const BUCKET={async put(key,bytes){puts++;objects.set(key,Uint8Array.from(bytes));return {key};},async get(key){reads++;const bytes=objects.get(key);return bytes?{size:bytes.length,body:bytes}:null;},async delete(key){objects.delete(key);}};
 const env={DB,BUCKET,ANALYTICS_ADMIN_EMAIL:'owner@example.test'};
 const get=(cookie='',admin=false)=>contactApi(new Request(origin+(admin?'/api/admin/contact':'/api/contact'),{headers:{Cookie:cookie,...(admin?owner:{})}}),env,admin);
 const payload=content=>({requestId:crypto.randomUUID(),subject:'不具合の報告',content});
 function form(data,bytes=png,type='image/png'){const f=new FormData();f.append('data',JSON.stringify(data));f.append('image',new Blob([bytes],{type}),'untrusted-name.png');return f;}
 const post=(cookie,data,bytes=png,type='image/png',modify)=>{const body=form(data,bytes,type);modify?.(body);return contactApi(new Request(origin+'/api/contact',{method:'POST',headers:{Cookie:cookie,Origin:origin},body}),env);};
 const image=(id,cookie='',admin=false,headers={})=>contactAttachmentApi(new Request(origin+'/api/'+(admin?'admin/':'')+'contact/attachments/'+id,{headers:{Cookie:cookie,...(admin?owner:{}),...headers}}),env,admin);
 return {env,sql,objects,get,post,payload,image,form,reads:()=>reads,puts:()=>puts,async cookie(){return (await get()).headers.get('Set-Cookie').split(';')[0];}};
}
test('private image-only send, own and owner reads; outsiders cannot touch R2; metadata stays private',async()=>{
 const s=setup(),cookie=await s.cookie(),data=s.payload('');assert.equal((await s.post(cookie,data)).status,200);
 const own=await (await s.get(cookie)).json();assert.equal(own.messages[0].content,'');assert.equal(own.messages[0].attachment.type,'image/png');
 assert.ok(!JSON.stringify(own).includes('contact-images/'));assert.ok(!JSON.stringify(own).includes('untrusted-name'));
 let response=await s.image(data.requestId,cookie);assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
 assert.match(response.headers.get('Cache-Control'),/private, no-store/);assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(response.headers.get('Cross-Origin-Resource-Policy'),'same-origin');
 assert.equal((await s.image(data.requestId,'',true)).status,200);
 const before=s.reads(),stranger=await s.cookie();assert.equal((await s.image(data.requestId,stranger)).status,404);assert.equal((await s.image(data.requestId)).status,401);assert.equal((await s.image(data.requestId,'',true,{'oai-authenticated-user-id':''})).status,403);assert.equal(s.reads(),before);
 assert.equal((await s.image(data.requestId,cookie,false,{'Sec-Fetch-Site':'cross-site'})).status,403);
});
test('repeat and concurrent uploads retain exactly one image and reject a changed attachment',async()=>{
 const s=setup(),cookie=await s.cookie(),data=s.payload('写真\n説明');
 const responses=await Promise.all([s.post(cookie,data),s.post(cookie,data)]);assert.deepEqual(responses.map(r=>r.status),[200,200]);assert.equal(s.objects.size,1);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM contact_messages').get().n,1);
 assert.equal((await s.post(cookie,data)).status,200);assert.equal(s.objects.size,1);
 assert.equal((await s.post(cookie,data,otherPNG)).status,409);assert.equal(s.objects.size,1);
 const textRetry=await contactApi(new Request(origin+'/api/contact',{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)}),s.env);assert.equal(textRetry.status,409);
 assert.deepEqual(Buffer.from(await (await s.image(data.requestId,cookie)).arrayBuffer()),png);
});
test('format, duplicated fields, extra payload and size rejected before R2; bytes determine MIME',async()=>{
 const s=setup(),cookie=await s.cookie();
 assert.equal((await s.post(cookie,s.payload('画像'),png,'text/plain')).status,200);
 const before=s.puts();
 for(const [bytes,type] of [[Buffer.from('<svg><script>alert(1)</script></svg>'),'image/png'],[Buffer.from('<html>bad</html>'),'image/jpeg']])assert.equal((await s.post(cookie,s.payload('偽装'),bytes,type)).status,415);
 assert.equal((await s.post(cookie,s.payload('大'),new Uint8Array(2*1024*1024+1))).status,413);
 assert.equal((await s.post(cookie,s.payload('重複'),png,'image/png',form=>form.append('data','{}'))).status,400);
 assert.equal((await s.post(cookie,s.payload('余分'),png,'image/png',form=>form.append('extra','x'))).status,400);
 assert.equal((await s.post(cookie,{...s.payload('不正'),attachment_key:'forged'})).status,400);assert.equal(s.puts(),before);
});
test('upload failure, unavailable bucket, and uncertain commit preserve recoverable state',async()=>{
 const s=setup(),cookie=await s.cookie(),data=s.payload('失敗');s.env.BUCKET.put=async()=>{throw new Error('upload failed');};assert.equal((await s.post(cookie,data)).status,503);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM contact_messages').get().n,0);
 const committed=setup(),own=await committed.cookie(),input=committed.payload('コミット後応答失敗'),batch=committed.env.DB.batch;
 committed.env.DB.batch=async statements=>{await batch(statements);throw new Error('lost response');};assert.equal((await committed.post(own,input)).status,200);assert.equal(committed.objects.size,1);assert.equal((await committed.image(input.requestId,own)).status,200);
 const uncertain=setup(),visitor=await uncertain.cookie();uncertain.env.DB.batch=async()=>{throw new Error('unknown outcome');};assert.equal((await uncertain.post(visitor,uncertain.payload('不確定'))).status,503);assert.equal(uncertain.objects.size,1,'Keep unverified private object instead of risking a committed image');
 const unavailable=setup(),c=await unavailable.cookie();delete unavailable.env.BUCKET;assert.equal((await unavailable.post(c,unavailable.payload('画像'))).status,503);
});
test('quota blocks uploads before R2 while previously saved retry succeeds',async()=>{
 const s=setup(),cookie=await s.cookie(),first=s.payload('最初');await s.post(cookie,first);
 for(let i=1;i<5;i++)assert.equal((await s.post(cookie,s.payload('別件'+i))).status,200);
 const n=s.puts();assert.equal((await s.post(cookie,s.payload('上限'))).status,429);assert.equal(s.puts(),n);assert.equal((await s.post(cookie,first)).status,200);assert.equal(s.puts(),n);
});

test('direct JPEG and WebP callers cannot bypass decoded dimension limits',async()=>{
 const s=setup(),cookie=await s.cookie();
 const jpeg=Buffer.from([255,216,255,192,0,8,8,255,255,255,255,1,255,217]);
 const webp=Buffer.alloc(30);webp.write('RIFF',0);webp.writeUInt32LE(22,4);webp.write('WEBP',8);webp.write('VP8 ',12);webp.writeUInt32LE(10,16);webp.set([0x9d,1,0x2a],23);webp.writeUInt16LE(16383,26);webp.writeUInt16LE(16383,28);
 for(const [bytes,type] of [[jpeg,'image/jpeg'],[webp,'image/webp']])assert.equal((await s.post(cookie,s.payload('巨大'),bytes,type)).status,400);
 assert.equal(s.puts(),0);
});

test('real encoded JPEG and WebP images retain their bytes and server-derived type',async()=>{
 const s=setup(),cookie=await s.cookie();
 for(const [extension,type] of [['jpg','image/jpeg'],['webp','image/webp']]){
  const bytes=readFileSync(new URL('./fixtures/contact-small.'+extension,import.meta.url)),data=s.payload('写真');
  assert.equal((await s.post(cookie,data,bytes,type)).status,200);const response=await s.image(data.requestId,cookie);assert.equal(response.headers.get('Content-Type'),type);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 }
});

function postImages(s,cookie,data,images){
 return s.post(cookie,data,images[0], 'image/png',form=>images.slice(1).forEach((bytes,index)=>form.append('image',new Blob([bytes],{type:'image/png'}),'image-'+(index+2)+'.png')));
}
const fiveImages=[png,otherPNG,readFileSync(new URL('./fixtures/contact-small.jpg',import.meta.url)),readFileSync(new URL('./fixtures/contact-small.webp',import.meta.url)),png];
test('five ordered private images save and read individually; count/type/order remain verifiable',async()=>{
 const s=setup(),cookie=await s.cookie(),stranger=await s.cookie(),data=s.payload('5枚');
 assert.equal((await postImages(s,cookie,data,fiveImages)).status,200);
 const own=await (await s.get(cookie)).json(),images=own.messages[0].attachments;
 assert.equal(images.length,5);assert.deepEqual(images.map(image=>image.type),['image/png','image/png','image/jpeg','image/webp','image/png']);
 assert.equal(s.objects.size,5);assert.ok(!JSON.stringify(own).includes('contact-images/'));assert.ok(!JSON.stringify(own).includes('"hash"'));
 for(let index=0;index<5;index++){
  const suffix=data.requestId+(index?'?image='+(index+1):'');
  const response=await s.image(suffix,cookie);assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),fiveImages[index]);
  assert.equal((await s.image(suffix,'',true)).status,200);
  const reads=s.reads();assert.equal((await s.image(suffix,stranger)).status,404);assert.equal((await s.image(suffix)).status,401);assert.equal(s.reads(),reads);
 }
 for(const suffix of ['?image=0','?image=6','?image=2&image=3','?extra=2'])assert.equal((await s.image(data.requestId+suffix,cookie)).status,400);
 assert.equal((await s.image(data.requestId+'?image=1',cookie)).status,200);
});
test('sixth, invalid later image, duplicate JSON, and oversized later image fail before all R2 writes',async()=>{
 const s=setup(),cookie=await s.cookie();
 assert.equal((await postImages(s,cookie,s.payload('多すぎ'),[...fiveImages,png])).status,400);
 assert.equal((await postImages(s,cookie,s.payload('形式'),[png,Buffer.from('<svg>bad</svg>')])).status,415);
 assert.equal((await postImages(s,cookie,s.payload('サイズ'),[png,new Uint8Array(2*1024*1024+1)])).status,413);
 assert.equal(s.puts(),0);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM contact_messages').get().n,0);
});
test('five-image concurrent retry retains one complete set; changed count/order conflict',async()=>{
 const s=setup(),cookie=await s.cookie(),data=s.payload('同時送信');
 assert.deepEqual((await Promise.all([postImages(s,cookie,data,fiveImages),postImages(s,cookie,data,fiveImages)])).map(r=>r.status),[200,200]);
 assert.equal(s.objects.size,5);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM contact_messages').get().n,1);
 const puts=s.puts();assert.equal((await postImages(s,cookie,data,fiveImages)).status,200);assert.equal(s.puts(),puts);
 assert.equal((await postImages(s,cookie,data,fiveImages.slice(0,4))).status,409);
 assert.equal((await postImages(s,cookie,data,[otherPNG,png,...fiveImages.slice(2)])).status,409);assert.equal(s.objects.size,5);
});
test('partial fifth-image upload failure leaves no message or objects; lost commit retains all images',async()=>{
 const s=setup(),cookie=await s.cookie(),put=s.env.BUCKET.put;let attempts=0;
 s.env.BUCKET.put=async(...args)=>{await put(...args);if(++attempts===3)throw new Error('lost upload response');};
 assert.equal((await postImages(s,cookie,s.payload('部分失敗'),fiveImages)).status,503);assert.equal(s.objects.size,0);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM contact_messages').get().n,0);
 const committed=setup(),own=await committed.cookie(),data=committed.payload('コミット応答失敗'),batch=committed.env.DB.batch;
 committed.env.DB.batch=async statements=>{await batch(statements);throw new Error('lost commit response');};
 assert.equal((await postImages(committed,own,data,fiveImages)).status,200);assert.equal(committed.objects.size,5);
 assert.equal((await committed.image(data.requestId+'?image=5',own)).status,200);
 const uncertain=setup(),visitor=await uncertain.cookie();uncertain.env.DB.batch=async()=>{throw new Error('unknown outcome');};
 assert.equal((await postImages(uncertain,visitor,uncertain.payload('不確定'),fiveImages)).status,503);assert.equal(uncertain.objects.size,5);
});
test('legacy single-image manifest absence retains old links, metadata and matching retry',async()=>{
 const s=setup(),cookie=await s.cookie(),data=s.payload('既存画像');await s.post(cookie,data);
 s.sql.prepare('UPDATE contact_messages SET attachments_json=NULL WHERE id=?').run(data.requestId);
 const history=await (await s.get(cookie)).json();assert.equal(history.messages[0].attachments.length,1);assert.equal(history.messages[0].attachment.url,'/api/contact/attachments/'+data.requestId);
 assert.equal((await s.image(data.requestId,cookie)).status,200);assert.equal((await s.image(data.requestId+'?image=2',cookie)).status,404);
 const puts=s.puts();assert.equal((await s.post(cookie,data)).status,200);assert.equal(s.puts(),puts);
});

test('truncated PNG/JPEG structure is rejected before any R2 writes or messages',async()=>{
 const s=setup(),cookie=await s.cookie();
 const headerOnly=Buffer.from(png.subarray(0,33)),missingEnd=png.subarray(0,png.length-12),oversizedChunk=Buffer.from(png);
 oversizedChunk.writeUInt32BE(0xffffffff,33);
 const jpeg=Buffer.from([255,216,255,192,0,11,8,0,1,0,1,1,1,0x11,0,255,217]);
 for(const image of [headerOnly,missingEnd,oversizedChunk,jpeg])assert.equal((await s.post(cookie,s.payload('不完全画像'),image)).status,415);
 assert.equal(s.puts(),0);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM contact_messages').get().n,0);
});

test('JPEG and WebP private metadata is removed before persistence and returned image hashes match cleaned bytes',async()=>{
 const s=setup(),cookie=await s.cookie(),jpeg=readFileSync(new URL('./fixtures/contact-small.jpg',import.meta.url)),webp=readFileSync(new URL('./fixtures/contact-small.webp',import.meta.url));
 const images=[['image/jpeg',Buffer.concat([jpeg.subarray(0,2),jpegSegment(0xe1,exifFixture()),jpegSegment(0xfe,Buffer.from('private comment')),jpeg.subarray(2)]),stripJPEGMetadata],['image/webp',webpFixture(webp,[webpChunk('EXIF',exifFixture()),webpChunk('XMP ','private comment')]),stripWebPMetadata]];
 for(const [type,bytes,cleaner] of images){
  const data=s.payload('metadata');assert.equal((await s.post(cookie,data,bytes,type)).status,200);
  const actual=Buffer.from(await(await s.image(data.requestId,cookie)).arrayBuffer()),expected=Buffer.from(cleaner(bytes));assert.deepEqual(actual,expected);assert.equal(actual.includes(Buffer.from('synthetic-gps-camera-owner')),false);assert.equal(actual.includes(Buffer.from('private comment')),false);
  const row=s.sql.prepare('SELECT * FROM contact_messages WHERE id=?').get(data.requestId);assert.equal(row.attachment_size,expected.length);assert.equal(row.attachment_hash,Buffer.from(await crypto.subtle.digest('SHA-256',expected)).toString('hex'));
  const puts=s.puts();assert.equal((await s.post(cookie,data,bytes,type)).status,200);assert.equal(s.puts(),puts);
 }
});

test('same exact legacy JPEG retry keeps previously stored data without a false conflict or rewrite',async()=>{
 const s=setup(),cookie=await s.cookie(),base=readFileSync(new URL('./fixtures/contact-small.jpg',import.meta.url)),bytes=Buffer.concat([base.subarray(0,2),jpegSegment(0xe1,exifFixture()),base.subarray(2)]),data=s.payload('legacy');
 assert.equal((await s.post(cookie,data,bytes,'image/jpeg')).status,200);
 const row=s.sql.prepare('SELECT * FROM contact_messages WHERE id=?').get(data.requestId),manifest=JSON.parse(row.attachments_json),hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
 manifest[0].hash=hash;manifest[0].size=bytes.length;s.objects.set(row.attachment_key,bytes);
 s.sql.prepare('UPDATE contact_messages SET attachment_hash=?,attachment_size=?,attachments_json=? WHERE id=?').run(hash,bytes.length,JSON.stringify(manifest),data.requestId);
 const puts=s.puts();assert.equal((await s.post(cookie,data,bytes,'image/jpeg')).status,200);assert.equal(s.puts(),puts);assert.deepEqual(Buffer.from(await(await s.image(data.requestId,cookie)).arrayBuffer()),bytes);
});

test('exhausted attachment read quota rejects GET and HEAD before message lookup or R2, leaving owner access intact',async()=>{
 const s=setup(),cookie=await s.cookie(),data=s.payload('quota');assert.equal((await s.post(cookie,data)).status,200);
 // Fill current and next-minute buckets so this test can cross a window boundary.
 await enforceRequestQuota(new Request(origin),s.env,'contactRead');await enforceRequestQuota(new Request(origin),s.env,'contactRead',Date.now()+60000);s.sql.prepare("UPDATE security_rate_windows SET hits=2000 WHERE id LIKE 'contactRead:%'").run();
 let lookedUp=false;const prepare=s.env.DB.prepare;s.env.DB.prepare=query=>{if(query.startsWith('SELECT m.*'))lookedUp=true;return prepare(query);};
 const reads=s.reads();let response=await s.image(data.requestId,cookie);assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'60');assert.equal(lookedUp,false);assert.equal(s.reads(),reads);
 response=await contactAttachmentApi(new Request(origin+'/api/contact/attachments/'+data.requestId,{method:'HEAD',headers:{Cookie:cookie}}),s.env);assert.equal(response.status,429);assert.equal(lookedUp,false);assert.equal(s.reads(),reads);
 assert.equal((await s.image(data.requestId,'',true)).status,200);
});
