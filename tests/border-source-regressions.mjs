import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {parseArticle,collectBorders,resolveBorderRows,validDate,RANKS,SOURCE_INDEX} from '../lib/border-source.mjs';
import {refreshBorders} from '../lib/border-store.mjs';

const now=new Date('2026-10-03T07:00:00Z');
const fixture=Object.fromEntries(await Promise.all(['13','22','24','category'].map(async close=>[close,await readFile(new URL('./fixtures/'+close+'.html',import.meta.url),'utf8')])));
const urls={'13':'https://one-carat.com/campus/archives/89497','22':'https://one-carat.com/campus/archives/89496','24':'https://one-carat.com/campus/archives/89495'};
const row=close=>parseArticle(fixture[close],urls[close],now);
const htmlResponse=body=>new Response(body,{headers:{'Content-Type':'text/html'}});
async function database(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(await readFile(new URL('../drizzle/0000_sweet_corsair.sql',import.meta.url),'utf8'));
  const DB={prepare(sql){let args=[];return {bind(...values){args=values;return this;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async first(){return sqlite.prepare(sql).get(...args)??null;},async run(){return {meta:sqlite.prepare(sql).run(...args)};}};}};
  return {sqlite,env:{DB}};
}

test('Every confirmed real fixture still parses unchanged',()=>{
  for(const close of ['13','22','24']){
    const parsed=row(close);
    assert.equal(parsed.close,close);assert.equal(Object.keys(parsed.ranks).length,18);
    assert.deepEqual(Object.keys(parsed.ranks).sort(),[...RANKS].sort());
  }
});

for(const invalid of ['2026-13-01','2026-00-01','2026-10-00','2026-02-29','2026-02-31','bad',null,undefined,42])test('Invalid date '+String(invalid)+' safely returns false',()=>{
  assert.equal(validDate(invalid),false);
});
test('Date validation accepts actual leap days and ordinary completed dates',()=>{
  assert.equal(validDate('2024-02-29'),true);assert.equal(validDate('2026-10-01'),true);
});

for(const value of ['16,659.9','16,65','16,,659','16,659,','16,659 999','16,659 extra','16,659k','16,659［+3］20,000'])test('Daily border rejects ambiguous integer text '+value,()=>{
  const changed=fixture['22'].replace('［+2］16,659','［+2］'+value);
  assert.throws(()=>parseArticle(changed,urls['22'],now),/Border format changed/);
});
test('Daily border allows the same integer without comma grouping',()=>{
  const changed=fixture['22'].replace('［+2］16,659','［+2］16659');
  assert.deepEqual(parseArticle(changed,urls['22'],now),row('22'));
});
test('Invalid article months cannot assign apparently valid data dates',()=>{
  assert.throws(()=>parseArticle(fixture['22'].replace('2026年10月','2026年13月').replace('10月1日','12月1日'),urls['22'],new Date('2027-01-03T00:00:00Z')),/Source title changed/);
});

test('A second date heading cannot supply ranks to the first day',()=>{
  const changed=fixture['22'].replace('<h4>Dランク帯</h4>','<h3>10月2日</h3><h4>Dランク帯</h4>');
  assert.throws(()=>parseArticle(changed,urls['22'],now),/Incomplete ranks/);
});
test('Rows after a later heading cannot contaminate a complete first day',()=>{
  const changed=fixture['22'].replace('<h2>End</h2>','<h3>10月2日</h3><pre>【D1】［±0］1 ［+1］2 ［+2］3</pre><h2>End</h2>');
  assert.deepEqual(parseArticle(changed,urls['22'],now),row('22'));
});

test('Three discovered URLs do not imply successful coverage of three actual cutoffs',async()=>{
  const result=await collectBorders(now,async url=>htmlResponse(url===SOURCE_INDEX?fixture.category:fixture['22']));
  assert.equal(result.rows.length,1);assert.equal(result.rows[0].close,'22');assert.equal(result.partial,true);
});
test('Exact duplicate observations are safe, but conflicting observations are excluded',()=>{
  const original=row('22'),duplicate={...original,sourceURL:urls['13']};
  const exact=resolveBorderRows([row('13'),original,duplicate,row('24')]);
  assert.equal(exact.rows.length,3);assert.equal(exact.partial,false);
  const conflicting={...duplicate,ranks:{...duplicate.ranks,D1:[2002,8633,16660]}};
  for(const candidates of [[original,conflicting,original],[conflicting,original,conflicting]]){
    const resolved=resolveBorderRows([row('13'),...candidates,row('24')]);
    assert.deepEqual(resolved.rows.map(item=>item.close),['13','24']);assert.equal(resolved.partial,true);
  }
});
test('Fetched conflicting copies cannot win through URL ordering',async()=>{
  const conflicting=fixture['22'].replace('［+2］16,659','［+2］16,660');
  const result=await collectBorders(now,async url=>htmlResponse(url===SOURCE_INDEX?fixture.category:url===urls['13']?fixture['22']:url===urls['22']?conflicting:fixture['24']));
  assert.deepEqual(result.rows.map(item=>item.close),['24']);assert.equal(result.partial,true);
});

test('Submitted conflicts preserve stored values and report partial coverage',async()=>{
  const {sqlite,env}=await database();
  try{
    const saved=Object.fromEntries(RANKS.map(rank=>[rank,[100,200,300]]));
    sqlite.prepare('INSERT INTO border_days (id,date,close_time,ranks_json,source_url,checked_at) VALUES (?,?,?,?,?,?)').run('2026-10-01|22','2026-10-01','22',JSON.stringify(saved),urls['22'],'2026-10-02T00:00:00Z');
    const conflicting=fixture['22'].replace('［+2］16,659','［+2］16,660');
    const result=await refreshBorders(env,now,()=>{throw Error('Submitted collection must not fetch');},[
      {url:urls['13'],html:fixture['22']},{url:urls['22'],html:conflicting},{url:urls['24'],html:fixture['24']},
    ]);
    const stored=result.records.find(item=>item.date==='2026-10-01'&&item.close==='22');
    assert.deepEqual(stored.ranks,saved);assert.equal(stored.sourceURL,urls['22']);
    assert.equal(stored.checkedAt,'2026-10-02T00:00:00Z','Conflicts do not claim a new confirmation');
    assert.equal(result.sync.status,'partial');assert.equal(result.fetchedDays,1);
  }finally{sqlite.close();}
});

test('Identical freshly confirmed values refresh their confirmation time without claiming a data change',async()=>{
  const {sqlite,env}=await database(),submitted=['13','22','24'].map(close=>({url:urls[close],html:fixture[close]}));
  try{
    const first=await refreshBorders(env,now,undefined,submitted);
    const later=new Date(now.getTime()+1000),second=await refreshBorders(env,later,undefined,submitted);
    assert.equal(second.changedDays,0);assert.equal(second.sync.status,'ok');
    for(const close of ['13','22','24']){
      const expected=row(close),observed=first.records.find(item=>item.date===expected.date&&item.close===close);
      const confirmed=second.records.find(item=>item.date===observed.date&&item.close===observed.close);
      assert.deepEqual(confirmed.ranks,observed.ranks);assert.equal(confirmed.checkedAt,later.toISOString());
    }
    const failed=await refreshBorders(env,new Date(now.getTime()+2000),async()=>new Response('Blocked',{status:403}));
    assert.deepEqual(failed.records,second.records,'Source failure does not refresh any confirmation');
  }finally{sqlite.close();}
});

test('Historical backfill does not attribute new ranks to a different existing source URL',async()=>{
  const {sqlite,env}=await database();
  try{
    const archive=JSON.parse(await readFile(new URL('../db/history-2025-2026.json',import.meta.url),'utf8'));
    const historical=archive.find(item=>Object.keys(item.ranks).length===18&&item.sourceURL!==urls['22']);
    const original={S2:[11,22,33]},stamp='2026-10-02T00:00:00Z';
    sqlite.prepare('INSERT INTO border_days (id,date,close_time,ranks_json,source_url,checked_at) VALUES (?,?,?,?,?,?)').run(historical.date+'|'+historical.close,historical.date,historical.close,JSON.stringify(original),urls['22'],stamp);
    const result=await refreshBorders(env,now,undefined,['13','22','24'].map(close=>({url:urls[close],html:fixture[close]})));
    const preserved=result.records.find(item=>item.date===historical.date&&item.close===historical.close);
    assert.deepEqual(preserved.ranks,original);assert.equal(preserved.sourceURL,urls['22']);assert.equal(preserved.checkedAt,stamp);
  }finally{sqlite.close();}
});
