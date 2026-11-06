import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import {createHash,createHmac} from 'node:crypto';
import {parseArticle,discoverArticles,collectBorders,validTriple,SOURCE_INDEX} from '../lib/border-source.mjs';
import {refreshBorders,readBorders,borderApi} from '../lib/border-store.mjs';
const now=new Date('2026-10-03T07:00:00Z');
const fixture={};for(const c of ['13','22','24','category'])fixture[c]=await readFile(new URL('./fixtures/'+c+'.html',import.meta.url),'utf8');
const urls={'13':'https://one-carat.com/campus/archives/89497','22':'https://one-carat.com/campus/archives/89496','24':'https://one-carat.com/campus/archives/89495'};
const fetcher=async url=>new Response(url===SOURCE_INDEX?fixture.category:fixture[Object.keys(urls).find(c=>urls[c]===url)],{headers:{'Content-Type':'text/html'}});
const expected={'13':['2026-09-30',[393062,644772,1084913]],'22':['2026-10-01',[434382,862727,1083522]],'24':['2026-10-01',[414738,859578,1079566]]};
for(const c of Object.keys(urls)) {const row=parseArticle(fixture[c],urls[c],now);assert.equal(row.date,expected[c][0]);assert.equal(row.close,c);assert.deepEqual(row.ranks.S2,expected[c][1]);assert.equal(Object.keys(row.ranks).length,18);assert.equal(row.ranks.E,undefined);}
// Real articles wrap the explicit data day in tabs/newlines. Whitespace must
// not invalidate a complete record or relax date/rank validation.
for(const c of Object.keys(urls)) for(const padding of ['\t','\n  ','&nbsp;','&#9;','　']) {
  const padded=fixture[c].replace(/(<h3\b[^>]*>)([\s\S]*?)(<\/h3>)/i,(_,open,text,close)=>open+padding+text+padding+close);
  assert.deepEqual(parseArticle(padded,urls[c],now),parseArticle(fixture[c],urls[c],now));
  assert.throws(()=>parseArticle(padded,urls[c],new Date(expected[c][0]+'T00:00:00Z')));
}
assert.equal(discoverArticles(fixture.category).length,3);
const discovered=discoverArticles(fixture.category);
for(const broken of [
  '<a href="http://[">unrelated navigation</a>',
  '<a href="http://[">2026年10月 Pococha ボーダー 22時締め</a>',
  '<a href="https://one-carat.com:bad/campus/archives/99999">2026年10月 Pococha ボーダー 13時締め</a>',
  '<a href="/campus/archives/99999">&#9999999999; broken title</a>',
])assert.deepEqual(discoverArticles(broken+fixture.category),discovered,'A malformed anchor must not discard verified source URLs');
assert.deepEqual(discoverArticles('<a href="http://[">2026年10月 Pococha ボーダー 22時締め</a>'),[]);
assert.throws(()=>parseArticle(fixture['22'],urls['22'],new Date('2026-10-01T12:00:00Z')));
assert.throws(()=>parseArticle(fixture['22'].replace('【D1】','【D2】'),urls['22'],now));
assert.throws(()=>parseArticle(fixture['22'].replace('［+2］16,659','［+2］1'),urls['22'],now));
assert.throws(()=>parseArticle(fixture['22'].replaceAll('10月1日','10月32日'),urls['22'],now));
assert.throws(()=>parseArticle(fixture['22'],'https://example.org/89496',now));
assert.equal((await collectBorders(now,fetcher)).rows.length,3);
const noisy=await collectBorders(now,async url=>url===SOURCE_INDEX?new Response('<a href="http://[">unrelated</a>'+fixture.category,{headers:{'Content-Type':'text/html'}}):fetcher(url));
assert.equal(noisy.rows.length,3);assert.equal(noisy.partial,false);
assert.equal((await collectBorders(now,async()=>new Response('Blocked',{status:403}))).rows.length,0);
// Real SQLite exercises the generated production schema and D1-style statements.
const sqlite=new DatabaseSync(':memory:');sqlite.exec(await readFile(new URL('../drizzle/0000_sweet_corsair.sql',import.meta.url),'utf8'));
let executedQueries=0;
const DB={prepare(sql){let args=[];return {bind(...values){args=values;return this;},async all(){executedQueries++;return {results:sqlite.prepare(sql).all(...args)};},async first(){executedQueries++;return sqlite.prepare(sql).get(...args)??null;},async run(){executedQueries++;return {meta:sqlite.prepare(sql).run(...args)};}};},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
const env={DB,BORDER_WRITER_KEY:'ab'.repeat(32)};
function writerRequest(path,data){const body=JSON.stringify(data),stamp=String(Math.floor(Date.now()/1000)),digest=createHash('sha256').update(body).digest('hex'),signature=createHmac('sha256',Buffer.from(env.BORDER_WRITER_KEY,'hex')).update(`POST\n${path}\n${stamp}\n${digest}`).digest('hex');return new Request('https://example.chatgpt.site'+path,{method:'POST',body,headers:{'X-Border-Writer-Time':stamp,'X-Border-Writer-Signature':signature}});}
const first=await refreshBorders(env,now,fetcher);assert.ok(executedQueries<50,'The complete historical import stays below the free D1 per-invocation query budget');assert.equal(first.fetchedDays,3);assert.equal(first.sync.status,'ok');assert.ok(first.records.length>=89);
const repeated=await refreshBorders(env,new Date(now.getTime()+1000),fetcher);assert.equal(repeated.changedDays,0);
const before=await readBorders(env);
const failed=await refreshBorders(env,new Date(now.getTime()+2000),async()=>new Response('Blocked',{status:403}));
assert.deepEqual(failed.records,before.records);assert.equal(failed.sync.status,'unavailable');assert.equal(failed.sync.last_success,repeated.sync.last_success);
const rejected=await borderApi(new Request('https://example.chatgpt.site/api/borders/refresh',{method:'POST',headers:{Origin:'https://other.example'}}),env);assert.equal(rejected.status,403);
assert.equal((await borderApi(new Request('https://example.chatgpt.site/api/borders/refresh'),env)).status,405);
const lookup=await borderApi(writerRequest('/api/borders/source-urls',{indexHTML:fixture.category}),env);
assert.equal((await lookup.json()).urls.length,3);
const submitted=await refreshBorders(env,new Date(now.getTime()+3000),async()=>{throw new Error('Worker source access unavailable');},Object.keys(urls).map(c=>({url:urls[c],html:fixture[c]})));
assert.equal(submitted.sync.status,'ok');assert.equal(submitted.fetchedDays,3);
const malformed=await borderApi(writerRequest('/api/borders/refresh',{articles:[{url:urls['22'],html:'fake HTML'}]}),env);
assert.equal(malformed.status,422);
const html=await readFile(new URL('../calculator/index.html',import.meta.url),'utf8');
new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
assert.ok(html.includes("connect-src 'self'"));assert.ok(!html.includes('Webデータの自動更新は行いません'));
// Execute the actual client merge. Local manual/import data must win; source
// updates only replace source-owned records, and malformed packets add nothing.
const state={log:{'2026-10-01':{S2:[10,20,30],S1:[40,50,60]}},log13:{},log24:{},provenance:{'22':{'2026-10-01':{S2:{origin:'manual'},S1:{origin:'verified'}}}}};
const context={state,RANKS:['E',...Object.keys(parseArticle(fixture['22'],urls['22'],now).ranks)],isRecord:v=>v&&typeof v==='object'&&!Array.isArray(v),validDate:d=>/^\d{4}-\d{2}-\d{2}$/.test(d),validTriple,todayMs:()=>Date.parse('2026-10-03'),logFor:c=>c==='13'?state.log13:c==='24'?state.log24:state.log,metaFor:(c,d,r)=>state.provenance[c]?.[d]?.[r]??{origin:'saved'},setMeta(c,d,r,origin,source,checkedAt){state.provenance[c]??={};state.provenance[c][d]??={};state.provenance[c][d][r]={origin,source,checkedAt};}};
vm.createContext(context);vm.runInContext(html.split('// BEGIN LIVE BORDER MERGE')[1].split('// END LIVE BORDER MERGE')[0],context);
const row=parseArticle(fixture['22'],urls['22'],now);
const packet=records=>({records,sync:{status:'ok'},serverDate:'2026-10-03'});
assert.ok(context.mergeLiveBorders(packet([row]))>0);assert.deepEqual(state.log['2026-10-01'].S2,[10,20,30]);assert.deepEqual(state.log['2026-10-01'].S1,row.ranks.S1);
assert.equal(context.mergeLiveBorders(packet([row])),0);
assert.throws(()=>context.mergeLiveBorders(packet([{...row,date:'2026-10-03'}])));
assert.throws(()=>context.mergeLiveBorders(packet([{...row,sourceURL:'https://evil.example/x'}])));
assert.throws(()=>context.mergeLiveBorders({records:null}));
const partialRow={date:'2025-01-01',close:'22',ranks:{D1:[1,2,3]},sourceURL:urls['22']};
assert.equal(context.mergeLiveBorders(packet([partialRow])),1);
assert.deepEqual(state.log['2025-01-01'].D1,[1,2,3]);
assert.equal(state.log['2025-01-01'].S2,undefined,'Unpublished historical ranks are never filled');
assert.throws(()=>context.mergeLiveBorders(packet([{...partialRow,ranks:{E:[1,2,3]}}])));

// Reviewed historical source images backfill missing dates only after a successful source refresh.
const history=JSON.parse(await readFile(new URL('../db/history-2026-10-02-03.json',import.meta.url),'utf8'));
assert.equal(history.length,6);
assert.ok(first.records.every(r=>r.date<'2026-10-03'),'Never seed an incomplete or future day');
const historical=await refreshBorders(env,new Date('2026-10-06T00:00:00Z'),fetcher);
for(const row of history){const stored=historical.records.find(r=>r.date===row.date&&r.close===row.close);assert.deepEqual(stored.ranks,row.ranks);assert.equal(stored.sourceURL,row.sourceURL);assert.equal(Object.keys(stored.ranks).length,18);assert.equal(stored.ranks.E,undefined);}
const preserved=history.find(r=>r.close==='22'&&r.date==='2026-10-03');
const custom={...preserved.ranks,S2:[11,22,33]};sqlite.prepare('UPDATE border_days SET ranks_json=? WHERE id=?').run(JSON.stringify(custom),'2026-10-03|22');
const again=await refreshBorders(env,new Date('2026-10-06T00:00:01Z'),fetcher);
assert.deepEqual(again.records.find(r=>r.date==='2026-10-03'&&r.close==='22').ranks.S2,[11,22,33],'Reviewed history never overwrites an existing saved record');
sqlite.prepare('DELETE FROM border_days WHERE id=?').run('2026-10-02|22');
const unavailable=await refreshBorders(env,new Date('2026-10-06T00:00:02Z'),async()=>new Response('Blocked',{status:403}));
assert.ok(!unavailable.records.some(r=>r.date==='2026-10-02'&&r.close==='22'),'Failed collection does not trigger historical writes');
const recovered=await refreshBorders(env,new Date('2026-10-06T00:00:03Z'),fetcher);
assert.deepEqual(recovered.records.find(r=>r.date==='2026-10-02'&&r.close==='22').ranks,history.find(r=>r.date==='2026-10-02'&&r.close==='22').ranks);

const archive=JSON.parse(await readFile(new URL('../db/history-2025-2026.json',import.meta.url),'utf8'));
const archived=archive.find(r=>Object.keys(r.ranks).length===18);
sqlite.prepare('UPDATE border_days SET ranks_json=? WHERE id=?').run(JSON.stringify({S2:[11,22,33]}),archived.date+'|'+archived.close);
const merged=await refreshBorders(env,new Date('2026-10-06T00:00:04Z'),fetcher);
const restored=merged.records.find(r=>r.date===archived.date&&r.close===archived.close);
assert.deepEqual(restored.ranks.S2,[11,22,33]);assert.deepEqual(restored.ranks.D1,archived.ranks.D1);assert.equal(Object.keys(restored.ranks).length,18,'Missing ranks are filled without overwriting a previously saved rank');
sqlite.close();console.log('Daily border tests passed: real source fixtures, dates/cutoffs, schema, repeat refresh, failure preservation, origin checks and client merge.');
