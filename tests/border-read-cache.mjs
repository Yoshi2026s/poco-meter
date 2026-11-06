import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { borderApi, readBorders, refreshBorders } from '../lib/border-store.mjs';

const origin='https://meter.example',github='https://pococha2026.github.io';
function setup() {
  const sql=new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../drizzle/0000_sweet_corsair.sql',import.meta.url),'utf8'));
  const reads={days:0,sync:0};
  const DB={prepare(query){let args=[];return{
    bind(...values){args=values;return this;},
    async all(){if(query.startsWith('SELECT date,close_time'))reads.days++;return{results:sql.prepare(query).all(...args)};},
    async first(){if(query.startsWith('SELECT last_attempt'))reads.sync++;return sql.prepare(query).get(...args)??null;},
    async run(){return{meta:sql.prepare(query).run(...args)};},
  };}};
  sql.prepare('INSERT INTO border_days (id,date,close_time,ranks_json,source_url,checked_at) VALUES (?,?,?,?,?,?)').run('2026-10-15|22','2026-10-15','22',JSON.stringify({S2:[10,20,30]}),'https://one-carat.com/campus/archives/89496','2026-10-16T00:00:00.000Z');
  return{sql,reads,env:{DB}};
}
const request=(etag,requestOrigin=github)=>new Request(origin+'/api/borders',{headers:{
  'CF-Connecting-IP':'203.0.113.42',...(requestOrigin?{Origin:requestOrigin}:{}),...(etag?{'If-None-Match':etag}:{}),
}});
function checkPublic(response,expectedOrigin=github){
  assert.equal(response.headers.get('Cache-Control'),'public, max-age=0, must-revalidate');
  assert.equal(response.headers.get('Vary'),'Origin');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),expectedOrigin);
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'),null);
  assert.match(response.headers.get('ETag'),/^W\/"[a-f0-9]{64}"$/);
}

test('public reads reuse one snapshot and validators return an empty 304 with strict CORS',async()=>{
  const s=setup();
  try{
    const first=await borderApi(request(),s.env);assert.equal(first.status,200);checkPublic(first);
    const etag=first.headers.get('ETag'),body=await first.text();
    const ordinary=await borderApi(request(null,null),s.env);assert.equal(ordinary.status,200);checkPublic(ordinary,null);assert.equal(await ordinary.text(),body);
    for(const value of [etag,etag.replace(/^W\//,''),`"different", ${etag}`,'*']){
      const matched=await borderApi(request(value),s.env);assert.equal(matched.status,304);checkPublic(matched);assert.equal(await matched.text(),'');
    }
    const untrusted=await borderApi(request(etag,'https://untrusted.example'),s.env);assert.equal(untrusted.status,304);checkPublic(untrusted,null);
    const different=await borderApi(request('"different"'),s.env);assert.equal(different.status,200);assert.equal(await different.text(),body);
    assert.deepEqual(s.reads,{days:1,sync:1});
  }finally{s.sql.close();}
});

test('internal response mutations cannot alter cached public data or its validator',async()=>{
  const s=setup();
  try{
    const first=await borderApi(request(),s.env),etag=first.headers.get('ETag'),body=await first.text();
    const internal=await readBorders(s.env);internal.records[0].ranks.S2[0]=999;internal.records.push({date:'fake'});internal.sync.status='fake';internal.serverDate='1900-01-01';
    const second=await borderApi(request(),s.env);assert.equal(second.headers.get('ETag'),etag);assert.equal(await second.text(),body);
    const again=await readBorders(s.env);assert.equal(again.records.length,1);assert.deepEqual(again.records[0].ranks.S2,[10,20,30]);assert.equal(again.sync.status,'pending');
  }finally{s.sql.close();}
});

test('expiration checks the database again and changed values get a fresh validator',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-17T03:11:17Z')});
  const s=setup();
  try{
    const first=await borderApi(request(),s.env),etag=first.headers.get('ETag');
    s.sql.prepare('UPDATE border_days SET ranks_json=?').run(JSON.stringify({S2:[40,50,60]}));
    t.mock.timers.tick(14999);assert.equal((await borderApi(request(etag),s.env)).status,304);
    t.mock.timers.tick(1);const refreshed=await borderApi(request(etag),s.env);assert.equal(refreshed.status,200);assert.notEqual(refreshed.headers.get('ETag'),etag);assert.deepEqual((await refreshed.json()).records[0].ranks.S2,[40,50,60]);
    assert.deepEqual(s.reads,{days:2,sync:2});
    t.mock.timers.tick(15000);const stable=await borderApi(request(refreshed.headers.get('ETag')),s.env);assert.equal(stable.status,304);assert.equal(s.reads.days,3);
  }finally{s.sql.close();}
});

test('JST midnight replaces serverDate and validator before the cache TTL expires',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-17T14:59:59Z')});
  const s=setup();
  try{
    const first=await borderApi(request(),s.env),etag=first.headers.get('ETag');assert.equal((await first.json()).serverDate,'2026-10-17');
    t.mock.timers.tick(1000);const next=await borderApi(request(etag),s.env);assert.equal(next.status,200);assert.equal((await next.json()).serverDate,'2026-10-18');assert.notEqual(next.headers.get('ETag'),etag);assert.equal(s.reads.days,2);
  }finally{s.sql.close();}
});

test('refresh invalidates the serialized response immediately, including failed source fetches',async()=>{
  const s=setup();
  try{
    const first=await borderApi(request(),s.env),etag=first.headers.get('ETag');
    const now=new Date();await refreshBorders(s.env,now,async()=>new Response('unavailable',{status:503}));
    const updated=await borderApi(request(etag),s.env);assert.equal(updated.status,200);assert.notEqual(updated.headers.get('ETag'),etag);assert.equal((await updated.json()).sync.status,'unavailable');assert.equal(s.reads.days,2);
  }finally{s.sql.close();}
});

test('a successful source refresh invalidates validators without waiting for cache expiry',async()=>{
  const s=setup();
  try{
    const first=await borderApi(request(),s.env),etag=first.headers.get('ETag');
    const article=readFileSync(new URL('./fixtures/22.html',import.meta.url),'utf8');
    await refreshBorders(s.env,new Date(),async()=>{throw Error('Submitted source should not fetch');},[{url:'https://one-carat.com/campus/archives/89496',html:article}]);
    const updated=await borderApi(request(etag),s.env);assert.equal(updated.status,200);assert.notEqual(updated.headers.get('ETag'),etag);
    const data=await updated.json();assert.equal(data.sync.status,'partial');assert.ok(data.records.some(row=>row.date==='2026-10-01'&&row.close==='22'));assert.equal(s.reads.days,2);
  }finally{s.sql.close();}
});

test('conditional requests still exhaust quota and denied or unavailable responses are not cacheable',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-17T03:12:23Z')});
  const s=setup();
  try{
    const first=await borderApi(request(),s.env),etag=first.headers.get('ETag');
    for(let i=1;i<120;i++)assert.equal((await borderApi(request(etag),s.env)).status,304);
    const limited=await borderApi(request(etag),s.env);assert.equal(limited.status,429);assert.equal(limited.headers.get('Cache-Control'),'private, no-store');assert.equal(limited.headers.get('ETag'),null);assert.equal(limited.headers.get('Vary'),'Origin');assert.equal(limited.headers.get('Access-Control-Allow-Origin'),github);
    const unavailable=await borderApi(request('*'),{});assert.equal(unavailable.status,503);assert.match(unavailable.headers.get('Cache-Control'),/no-store/);assert.equal(unavailable.headers.get('ETag'),null);assert.equal(unavailable.headers.get('Access-Control-Allow-Origin'),github);
    assert.equal(s.reads.days,1);
  }finally{s.sql.close();}
});
