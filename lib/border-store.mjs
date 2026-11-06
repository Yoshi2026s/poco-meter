import seed from '../db/seed.json' with {type:'json'};
import reviewedHistory from '../db/history-2025-2026.json' with {type:'json'};
import recentHistory from '../db/history-2026-10-02-03.json' with {type:'json'};
const historyByDay=new Map();
for(const row of [...reviewedHistory,...recentHistory]){if(!validDate(row.date)||!['13','22','24'].includes(row.close)||!sourceUrl(row.sourceURL)||Object.keys(row.ranks).length<1||Object.keys(row.ranks).length>18||Object.entries(row.ranks).some(([rank,values])=>!RANKS.includes(rank)||!validTriple(values)))throw new Error('Invalid reviewed historical border');const key=row.date+'|'+row.close,prior=historyByDay.get(key);historyByDay.set(key,{...row,ranks:{...prior?.ranks,...row.ranks}});}
const history=[...historyByDay.values()];
import {collectBorders,resolveBorderRows,jstDate,parseArticle,discoverArticles,SOURCE_INDEX,FALLBACK_URLS,validDate,validTriple,RANKS,sourceUrl} from './border-source.mjs';
import {borderWriterHeadersValid,verifyBorderWrite} from './border-writer-auth.mjs';
import {enforceRequestQuota,readLimitedBytes,RequestLimitError,quotaHeaders,claimSignedWrite} from './security-limits.mjs';

function dbFor(env){if(!env.DB)throw new Error('Border database unavailable');return env.DB;}
const borderReadCache=new WeakMap();
export async function readBorders(env) {
  // Internal callers may annotate their response. Never expose the shared
  // snapshot used to serve other visitors or calculate its validator.
  return structuredClone((await borderSnapshot(env)).data);
}
async function borderSnapshot(env) {
  const db=dbFor(env);
  const cached=borderReadCache.get(db),now=Date.now(),day=jstDate(new Date(now));
  if(cached&&cached.day===day&&cached.expires>now)return cached.promise;
  const entry={day,expires:now+15000,promise:null};
  entry.promise=readBordersUncached(db,day).then(async data=>{
    const body=JSON.stringify(data);
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body));
    const digest=Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
    // A weak validator remains valid if the delivery platform compresses JSON.
    return {data,body,etag:`W/"${digest}"`};
  }).catch(error=>{if(borderReadCache.get(db)===entry)borderReadCache.delete(db);throw error;});borderReadCache.set(db,entry);return entry.promise;
}
async function readBordersUncached(db,serverDate) {
  const [days,sync]=await Promise.all([
    db.prepare('SELECT date,close_time,ranks_json,source_url,checked_at FROM border_days ORDER BY date,close_time').all(),
    db.prepare('SELECT last_attempt,last_success,status,message FROM border_sync WHERE id=?').bind('daily').first(),
  ]);
  const records=days.results.map(d=>({date:d.date,close:d.close_time,ranks:JSON.parse(d.ranks_json),sourceURL:d.source_url,checkedAt:d.checked_at}));
  return {records,sync:sync??{status:'pending',message:'毎日の自動取得を準備しています。'},serverDate};
}
export async function refreshBorders(env,now=new Date(),fetcher=fetch,submitted=null) {
  const db=dbFor(env),stamp=now.toISOString(),seconds=Math.floor(now.getTime()/1000);
  borderReadCache.delete(db);
  await db.prepare('INSERT INTO border_sync (id) VALUES (?) ON CONFLICT(id) DO NOTHING').bind('daily').run();
  const lease=await db.prepare('UPDATE border_sync SET lock_until=?,last_attempt=? WHERE id=? AND lock_until<?').bind(seconds+180,stamp,'daily',seconds).run();
  if(!lease.meta.changes)return {busy:true,...await readBorders(env)};
  try {
    const existing=await db.prepare('SELECT id,date,close_time,ranks_json,source_url FROM border_days').all();
    const prior=new Map(existing.results.map(r=>[r.id,r]));
    const known=[...new Set(existing.results.sort((a,b)=>b.date.localeCompare(a.date)).slice(0,12).map(r=>r.source_url))];
    const collected=submitted?resolveBorderRows(submitted.map(a=>parseArticle(a.html,a.url,now))):await collectBorders(now,fetcher,known);
    // Seed only the first production refresh. Migrations never contain data.
    // A day has one source URL: filling ranks from another URL would assign
    // them unsupported provenance. Preserve that partial saved day instead.
    const backfill=collected.rows.length?history.filter(r=>r.date<jstDate(now)).flatMap(r=>{const old=prior.get(r.date+'|'+r.close),saved=old?JSON.parse(old.ranks_json):{};if(Object.keys(r.ranks).every(rank=>saved[rank]))return [];if(old&&old.source_url!==r.sourceURL)return [];return [{...r,ranks:{...r.ranks,...saved},sourceURL:old?.source_url||r.sourceURL}];}):[];
    const rows=existing.results.length?[...backfill,...collected.rows]:[...seed.filter(r=>r.date<jstDate(now)),...backfill,...collected.rows];
    const unique=new Map(rows.map(r=>[r.date+'|'+r.close,r]));
    // Rechecking the same observed values renews their confirmation time,
    // without reporting a numerical change or renewing archive-only rows.
    const confirmedIds=new Set(collected.rows.map(row=>row.date+'|'+row.close)),changes=[],writes=[];
    for(const [id,row] of unique) {
      const encoded=JSON.stringify(row.ranks),old=prior.get(id);
      const changed=old?.ranks_json!==encoded||old.source_url!==row.sourceURL;
      if(!changed&&!confirmedIds.has(id))continue;
      const write=[id,row.date,row.close,encoded,row.sourceURL,stamp];
      if(changed)changes.push(write);
      writes.push(write);
    }
    // Bound large historical imports to a small number of D1 queries. Each
    // batch is one bound JSON value; dates and rank values were validated above.
    for(let i=0;i<writes.length;i+=100){
      await db.prepare("INSERT INTO border_days (id,date,close_time,ranks_json,source_url,checked_at) SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]'),json_extract(value,'$[4]'),json_extract(value,'$[5]') FROM json_each(?) WHERE 1 ON CONFLICT(id) DO UPDATE SET ranks_json=excluded.ranks_json,source_url=excluded.source_url,checked_at=excluded.checked_at").bind(JSON.stringify(writes.slice(i,i+100))).run();
    }
    const ok=collected.rows.length>0,status=ok?(collected.partial?'partial':'ok'):'unavailable';
    const message=ok?(collected.partial?'一部の取得先を確認できませんでした。取得済みの値を保持しています。':'掲載済みの日別ボーダーを確認しました。'):'更新元を取得できませんでした。前回の値を保持しています。';
    if(ok)await db.prepare('UPDATE border_sync SET last_success=?,status=?,message=?,lock_until=0 WHERE id=?').bind(stamp,status,message,'daily').run();
    else await db.prepare('UPDATE border_sync SET status=?,message=?,lock_until=0 WHERE id=?').bind(status,message,'daily').run();
    borderReadCache.delete(db);
    return {changedDays:changes.length,fetchedDays:collected.rows.length,...await readBorders(env)};
  } catch(error) {
    console.error('Border refresh failed',error instanceof Error?error.message:'unknown');
    await db.prepare('UPDATE border_sync SET status=?,message=?,lock_until=0 WHERE id=?').bind('unavailable','更新できませんでした。前回の値を保持しています。','daily').run();
    borderReadCache.delete(db);
    throw error;
  }
}
const json = (data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function borderCors(response,request) {
  response.headers.set('Vary','Origin');
  if(request.headers.get('origin')==='https://pococha2026.github.io')response.headers.set('Access-Control-Allow-Origin','https://pococha2026.github.io');
  return response;
}
function matchesETag(header,etag) {
  if(!header)return false;
  if(header.trim()==='*')return true;
  const opaque=etag.replace(/^W\//,'');
  // Our generated opaque tag is a hex digest and never contains a comma.
  return header.split(',').some(value=>value.trim().replace(/^W\//,'')===opaque);
}
async function publicBorders(request,env) {
  // A validator does not authorize access or bypass the request quota.
  await enforceRequestQuota(request,env,'borderRead');
  const {body,etag}=await borderSnapshot(env);
  const unchanged=matchesETag(request.headers.get('If-None-Match'),etag);
  return borderCors(new Response(unchanged?null:body,{status:unchanged?304:200,headers:{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'public, max-age=0, must-revalidate',
    'ETag':etag,'X-Content-Type-Options':'nosniff',
  }}),request);
}
export async function borderApi(request,env) {
  const path=new URL(request.url).pathname;
  try {
    if(path==='/api/borders'&&request.method==='GET')return await publicBorders(request,env);
    if(path==='/api/borders/source-urls'&&request.method==='GET')return json({indexURL:SOURCE_INDEX});
    if((path==='/api/borders/refresh'||path==='/api/borders/source-urls')&&request.method==='POST') {
      // Public visitors may read and calculate, but only the owner updater can
      // submit source HTML or write shared border values.
      const origin=request.headers.get('origin');
      if(origin&&origin!==new URL(request.url).origin)return json({error:'Origin rejected'},403);
      if(!borderWriterHeadersValid(request,env))return json({error:'Border writer authorization required'},403);
      if(Number(request.headers.get('content-length'))>3000000)return json({error:'Payload too large'},413);
      const bytes=await readLimitedBytes(request,3000000);
      if(!await verifyBorderWrite(request,bytes,env))return json({error:'Border writer authorization required'},403);
      const raw=new TextDecoder().decode(bytes);
      const input=raw?JSON.parse(raw):null;
      if(path==='/api/borders/source-urls') {
        if(!input||typeof input.indexHTML!=='string'||input.indexHTML.length>1200000)return json({error:'Invalid index'},400);
        const urls=discoverArticles(input.indexHTML);
        return json({urls:urls.length?urls:FALLBACK_URLS,discovered:urls.length});
      }
      let articles=null;
      if(input) {
        if(!Array.isArray(input.articles)||input.articles.length<1||input.articles.length>3||input.articles.some(a=>!a||typeof a.html!=='string'||a.html.length>1200000||typeof a.url!=='string'))return json({error:'Invalid articles'},400);
        try {
          const rows=input.articles.map(a=>parseArticle(a.html,a.url));
          if(new Set(rows.map(r=>r.close)).size!==rows.length)return json({error:'Duplicate cutoff'},400);
        }catch{return json({error:'Unverified source data rejected'},422);}
        articles=input.articles;
      }
      await claimSignedWrite(request,env);
      return json(await refreshBorders(env,new Date(),fetch,articles));
    }
    return json({error:'Method not allowed'},405);
  } catch(error) {if(error instanceof RequestLimitError){const result=json({error:error.status===429?'Rate limit exceeded':'Request rejected'},error.status);for(const [key,value] of Object.entries(quotaHeaders()))result.headers.set(key,value);return borderCors(result,request);}const result=json({error:'ボーダー更新を利用できません。保存済みの値をご利用ください。'},503);return path==='/api/borders'&&request.method==='GET'?borderCors(result,request):result;}
}
