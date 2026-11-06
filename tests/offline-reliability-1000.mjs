import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {pageEngine,engine,plain,pointsFromK} from './calculator-harness.mjs';

// 1,000 distinct response, recovery, persistence and offline-calculation
// conditions. Actual page JavaScript runs against DOM, storage and time doubles.
const KEY = 'pococha-meter-calc-v1';
const PUBLIC_RANKS = ['D1','D2','D3','C1','C2','C3','B1','B2','B3','A1','A2','A3','S1','S2','S3','S4','S5','S6'];
const CLOSE_TIMES = {13:'13:00',22:'22:00',24:'00:00'};
const ORIGINS = ['manual','import','backup','saved','implicit-saved'];
const STATUSES = ['ok','partial','unavailable','pending'];
const NOW = '2026-10-03T21:00:00+09:00';
const SOURCE = 'https://one-carat.com/campus/archives/88712';
const fixture = plain(engine(NOW).state);
const seen = new Set(), completed = new Set(), cases = [], groupCounts = {};
const flush = async () => { for (let i=0;i<50;i++) await Promise.resolve(); };
const clone = value => JSON.parse(JSON.stringify(value));
const saved = p => JSON.parse(p.stored.get(KEY));
const input = (p,id,value,type='input') => { p.element(id).value=String(value); p.element(id).dispatchEvent(new Event(type)); };
const localTriple = variant => [1000+variant*37,2000+variant*61,4000+variant*83];
const freshTriple = variant => [5000+variant*47,9000+variant*73,14000+variant*101];

function parameters(variant) {
  return {rank:PUBLIC_RANKS[variant%18],close:['13','22','24'][Math.floor(variant/3)%3],
    core:[0,2,5,10,15,20,25,30,35,40,45,50,60,70,80,90,100,150,200,250,300,400,500,999,1][variant%25],
    target:15000+variant*197,current:500+variant*29,local:localTriple(variant),incoming:freshTriple(variant)};
}
function config(params,extra={}) {
  const logs={log:{},log13:{},log24:{}};
  logs[params.close==='13'?'log13':params.close==='24'?'log24':'log']['2026-10-01']={[params.rank]:params.local};
  return {...clone(fixture),seedVer:3,seedVer13:1,snapshotVersion:'2026-10-02-v3',goalDefaultsVersion:1,
    target:String(params.target),current:String(params.current),coreCount:String(params.core),
    deadline:CLOSE_TIMES[params.close],rank:params.rank,pick:'',period:'30d',
    targetOrigin:null,goalDefaults:{...clone(engine(NOW).standardGoalDefaults()),applyOnLoad:false},
    ...logs,provenance:{[params.close]:{'2026-10-01':{[params.rank]:{origin:'remote',source:SOURCE}}}},...extra};
}
function row(params,date='2026-10-02') {
  const ranks=Object.fromEntries(PUBLIC_RANKS.map((rank,i)=>[rank,
    rank===params.rank?params.incoming:[3000+i*337+params.current,7000+i*431+params.current,11000+i*523+params.current]]));
  return {date,close:params.close,ranks,sourceURL:SOURCE,checkedAt:'2026-10-03T12:00:00Z'};
}
function payload(params,status='ok') {
  return {records:[row(params)],serverDate:'2026-10-03',sync:{status,last_attempt:'2026-10-03T12:00:00Z',
    last_success:'2026-10-03T12:00:00Z',message:status==='ok'?'掲載済みデータを確認':'前回値を保持'}};
}
function response(body,extra={}) {
  return {ok:true,status:200,headers:{get:name=>name==='content-type'?'application/json; charset=utf-8':null},
    json:async()=>clone(body),...extra};
}
function open(cfg,caps={}) { return pageEngine(cfg,{navigator:{onLine:false},fetch:()=>new Promise(()=>{}),...caps}); }
function memory(seed) {
  const map=new Map(Object.entries(seed));
  return {map,getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};
}
function caseOf(group,params,run) {
  const signature=JSON.stringify({group,params});
  assert.ok(!seen.has(signature),'Duplicate scenario signature: '+signature);
  seen.add(signature);cases.push({group,params,signature,run});groupCounts[group]=(groupCounts[group]??0)+1;
}
function existingRecord(p,params) {
  return saved(p)[params.close==='13'?'log13':params.close==='24'?'log24':'log']['2026-10-01'][params.rank];
}
function noFalseSuccess(p) {
  const status=p.element('borderSyncStatus').textContent;
  assert.doesNotMatch(status,/確認中/,'Failure must release the busy indicator');
  assert.match(status,/取得・検証失敗/,'Invalid or failed acquisition must report a failure');
}

// A: 10 malformed response contracts x 25 different rank/cutoff/core/value states.
const malformedKinds=['missing-sync','unknown-status','missing-server-date','invalid-server-date',
  'missing-public-rank','unexpected-E-rank','unordered-triple','unpublished-day','untrusted-source','duplicate-date-cutoff'];
for (const kind of malformedKinds) for (let variant=0;variant<25;variant++) {
  const params=parameters(variant),body=payload(params);
  if(kind==='missing-sync')delete body.sync;
  if(kind==='unknown-status')body.sync.status='completed';
  if(kind==='missing-server-date')delete body.serverDate;
  if(kind==='invalid-server-date')body.serverDate='2026-02-30';
  if(kind==='missing-public-rank')delete body.records[0].ranks[PUBLIC_RANKS[(variant+7)%18]];
  if(kind==='unexpected-E-rank')body.records[0].ranks.E=[100+variant,200+variant,300+variant];
  if(kind==='unordered-triple')body.records[0].ranks[params.rank]=[10000+variant,2000+variant,14000+variant];
  if(kind==='unpublished-day')body.records[0].date=body.serverDate;
  if(kind==='untrusted-source')body.records[0].sourceURL='http://one-carat.com/campus/archives/88712';
  if(kind==='duplicate-date-cutoff')body.records.push(clone(body.records[0]));
  caseOf('contract',{kind,...params,response:body},async()=>{
    const p=open(config(params),{navigator:{onLine:true},fetch:async()=>response(body)});await flush();
    assert.deepEqual(existingRecord(p,params),params.local);assert.equal(saved(p).target,String(params.target));
    const log=saved(p)[params.close==='13'?'log13':params.close==='24'?'log24':'log'];
    assert.equal(log['2026-10-02'],undefined,'Malformed response must not enter saved history');
    if(kind!=='unpublished-day')noFalseSuccess(p);
    // A listed current/unpublished day may be rejected as an acquisition error
    // or explicitly reported as excluded; it must never be saved or imputed.
  });
}

// B: 8 communication failures x 25 real input states. Timed promises must be
// released even if fetch or body ignores AbortSignal; late body data is stale.
const networkKinds=['ignored-fetch-abort','ignored-body-abort','abort-reject','http-503',
  'http-403','bad-mime','json-reject','late-body-after-timeout'];
for (const kind of networkKinds) for (let variant=0;variant<25;variant++) {
  const params=parameters(variant);
  caseOf('network',{kind,...params},async()=>{
    let calls=0,signal,lateResolve;
    const fetcher=(_url,options)=>{
      calls++;signal=options.signal;
      if(kind==='ignored-fetch-abort')return new Promise(()=>{});
      if(kind==='ignored-body-abort'||kind==='late-body-after-timeout')return Promise.resolve(response(payload(params),
        {json:()=>new Promise(resolve=>{lateResolve=resolve;})}));
      if(kind==='abort-reject')return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('AbortError')),{once:true}));
      if(kind==='http-503')return Promise.resolve(response(payload(params),{ok:false,status:503}));
      if(kind==='http-403')return Promise.resolve(response(payload(params),{ok:false,status:403}));
      if(kind==='bad-mime')return Promise.resolve(response(payload(params),{headers:{get:()=> 'text/html'}}));
      return Promise.resolve(response(payload(params),{json:async()=>{throw new Error('Invalid JSON');}}));
    };
    const nav={onLine:true},p=open(config(params),{navigator:nav,fetch:fetcher});await flush();
    if(['ignored-fetch-abort','ignored-body-abort','abort-reject','late-body-after-timeout'].includes(kind)){
      p.flushTimers(16000);await flush();assert.equal(signal.aborted,true,'Deadline should also abort transport');
    }
    noFalseSuccess(p);assert.deepEqual(existingRecord(p,params),params.local);
    assert.equal(saved(p).target,String(params.target));
    if(kind==='late-body-after-timeout'){
      lateResolve(payload(params));await flush();
      assert.equal(saved(p)[params.close==='13'?'log13':params.close==='24'?'log24':'log']['2026-10-02'],undefined);
      noFalseSuccess(p);
    }
    if(['ignored-fetch-abort','ignored-body-abort','late-body-after-timeout'].includes(kind)){
      const before=calls;nav.onLine=false;p.dispatchWindow('offline');nav.onLine=true;p.dispatchWindow('online');await flush();
      assert.ok(calls>before,'A timed-out operation must allow a later reconnect request');
    }
  });
}

// C: write/read storage failure x server ok/partial x 25 value states. Keep the
// RAM calculation usable, label persistence failure, then recover on valid input.
for (const failure of ['write-quota','read-failure']) for (const status of ['ok','partial']) for (let variant=0;variant<25;variant++) {
  const params=parameters(variant);
  caseOf('storage',{failure,status,...params},async()=>{
    const cfg=config(params),mem=memory({[KEY]:JSON.stringify(cfg)});let blocked=false,deliver;
    const storage={getItem:key=>{if(blocked&&failure==='read-failure'&&key===KEY)throw Error('storage read disabled');return mem.getItem(key);},
      setItem:(key,value)=>{if(blocked&&failure==='write-quota'&&key===KEY)throw Error('QuotaExceededError');mem.setItem(key,value);}};
    const p=open(undefined,{navigator:{onLine:true},localStorage:storage,fetch:()=>new Promise(resolve=>{deliver=resolve;})});
    blocked=true;deliver(response(payload(params,status)));await flush();
    const retained=JSON.parse(mem.map.get(KEY));
    assert.equal(retained.target,String(params.target));
    assert.equal(retained[params.close==='13'?'log13':params.close==='24'?'log24':'log']['2026-10-02'],undefined);
    assert.match(p.element('storageStatus').textContent,/保存できません/);
    assert.match(p.element('borderSyncStatus').textContent,/未保存|この画面|保存できません/,
      'Sync status must distinguish received values from values available after offline restart');
    assert.equal(pointsFromK(p.element('remain').textContent),BigInt(params.target-params.current));
    blocked=false;input(p,'currentTop',params.current+1);
    const recovered=JSON.parse(mem.map.get(KEY));
    assert.deepEqual(recovered[params.close==='13'?'log13':params.close==='24'?'log24':'log']['2026-10-02'][params.rank],params.incoming);
    assert.equal(recovered.current,String(params.current+1));
    assert.equal(p.element('storageStatus').hidden,true);
    let offlineCalls=0;const q=open(recovered,{navigator:{onLine:false},fetch:()=>{offlineCalls++;throw Error('offline must not fetch');}});
    assert.equal(offlineCalls,0);assert.deepEqual(existingRecord(q,params),params.local);
  });
}

// D: three reconnect paths x 50 conditions, including clustered focus/pageshow
// events and offline abort. Automatic target refresh must happen immediately.
for(const mode of ['cold-offline-reconnect','rapid-offline-bounce','timeout-reconnect'])for(let variant=0;variant<50;variant++){
  const params=parameters(variant);
  caseOf('reconnect',{mode,...params},async()=>{
    const nav={onLine:mode!=='cold-offline-reconnect'},cfg=config(params,{pick:0});let calls=0,deliver;
    const fetcher=(_url,options)=>{
      calls++;
      if(mode!=='cold-offline-reconnect'&&calls===1){
        if(mode==='rapid-offline-bounce')return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('offline abort')),{once:true}));
        return new Promise(()=>{});
      }
      return new Promise(resolve=>{deliver=resolve;});
    };
    const p=open(cfg,{navigator:nav,fetch:fetcher});await flush();
    if(mode==='timeout-reconnect'){p.flushTimers(16000);await flush();}
    nav.onLine=false;p.dispatchWindow('offline');nav.onLine=true;p.dispatchWindow('online');
    p.dispatchWindow('focus');p.dispatchWindow('pageshow');p.dispatchWindow('online');await flush();
    assert.equal(calls,mode==='cold-offline-reconnect'?1:2,'Restoring focus must not duplicate the active request');
    assert.equal(typeof deliver,'function');deliver(response(payload(params)));await flush();
    const expected=Number((BigInt(params.local[0])+BigInt(params.incoming[0])+1n)/2n);
    assert.equal(saved(p).target,String(expected));
    assert.equal(pointsFromK(p.element('remain').textContent),BigInt(Math.max(0,expected-params.current)));
    assert.deepEqual(saved(p)[params.close==='13'?'log13':params.close==='24'?'log24':'log']['2026-10-02'][params.rank],params.incoming);
    assert.equal(saved(p).coreCount,String(params.core));
  });
}

// E: five personal record origins x four server states x five selected ranks.
// Online merge may refresh public rows but must not overwrite personal input.
for(const origin of ORIGINS)for(const status of STATUSES)for(let rankIndex=0;rankIndex<5;rankIndex++){
  const params=parameters(rankIndex*5+2),date='2026-10-02',incoming=row(params),personal=[111+rankIndex*41,444+rankIndex*59,888+rankIndex*71];
  caseOf('personal-protection',{origin,status,...params,personal},async()=>{
    const cfg=config(params),key=params.close==='13'?'log13':params.close==='24'?'log24':'log';
    cfg[key][date]={[params.rank]:personal};
    if(origin!=='implicit-saved')cfg.provenance[params.close][date]={[params.rank]:{origin,source:'個人のテスト記録'}};
    cfg.items=[{name:'テスト登録 '+rankIndex,val:50+rankIndex}];cfg.presets=[{name:'テスト保存 '+rankIndex,val:100+rankIndex}];
    const body=payload(params,status);body.records=[incoming];
    const p=open(cfg,{navigator:{onLine:true},fetch:async()=>response(body)});await flush();const actual=saved(p);
    assert.deepEqual(actual[key][date][params.rank],personal);
    assert.equal(actual.target,String(params.target));assert.equal(actual.current,String(params.current));assert.equal(actual.coreCount,String(params.core));
    assert.deepEqual(actual.items,cfg.items);assert.deepEqual(actual.presets,cfg.presets);
    assert.equal(actual.deadline,cfg.deadline);assert.equal(actual.rank,cfg.rank);
  });
}

// F: five statistical methods x four periods x two cutoffs x five ranks. Each
// uses six saved observations and exact rational arithmetic as its oracle.
const methods=['mean','median','p75','max','min'],periods=['30d','month','prev','all'],offlineRanks=['D1','C2','B3','A3','S2'];
const dates=['2026-09-06','2026-09-07','2026-09-08','2026-09-09','2026-10-01','2026-10-02'];
function expectedTarget(values,method,buffer,unit){
  const order=values.slice().sort((a,b)=>a-b);let numerator,denominator=1n;
  if(method==='mean'){numerator=order.reduce((sum,v)=>sum+BigInt(v),0n);denominator=BigInt(order.length);}
  else if(method==='median'&&order.length%2===0){numerator=BigInt(order[order.length/2-1])+BigInt(order[order.length/2]);denominator=2n;}
  else numerator=BigInt(method==='median'?order[Math.floor(order.length/2)]:method==='p75'?order[Math.ceil(order.length*0.75)-1]:method==='max'?order.at(-1):order[0]);
  const upper=numerator*BigInt(1000+Math.round(buffer*10)),lower=denominator*1000n*BigInt(unit);
  return Number((upper+lower-1n)/lower*BigInt(unit));
}
const TIERS=[[2,1],[5,2],[10,3],[15,4],[20,5],[25,6],[30,7],[35,8],[40,9],[45,10],[50,11],[60,12],[70,13],[80,14],[90,15],[100,16],[150,17],[200,18],[250,19],[300,20],[400,21],[500,22]];
for(const method of methods)for(const period of periods)for(const close of ['13','22'])for(let ri=0;ri<5;ri++){
  const params={...parameters(ri*5+methods.indexOf(method)),rank:offlineRanks[ri],close};
  const buffer=ri*3.5,unit=[1,100,1000,10000,1][ri],border=ri%3;
  const observations=dates.map((date,i)=>({date,value:10001+ri*547+i*1171+(i%2?73:0)}));
  caseOf('offline-calculation',{method,period,...params,buffer,unit,border,observations},async()=>{
    const cfg=config(params,{pick:border,period,targetMethod:method,bufferPct:buffer,roundUnit:unit,log:{},log13:{},log24:{},provenance:{}});
    const key=close==='13'?'log13':'log',origin={};
    for(const observation of observations){
      const triple=[observation.value,observation.value+2000,observation.value+7000];cfg[key][observation.date]={[params.rank]:triple};
      origin[observation.date]={[params.rank]:{origin:'remote',source:SOURCE}};
    }
    cfg.provenance[close]=origin;
    const selected=observations.filter(item=>period==='month'?item.date.startsWith('2026-10'):period==='prev'?item.date.startsWith('2026-09'):true)
      .map(item=>item.value+[0,2000,7000][border]);
    const expected=expectedTarget(selected,method,buffer,unit);let calls=0;
    const p=open(cfg,{navigator:{onLine:false},fetch:()=>{calls++;throw Error('offline must not fetch');}});await flush();
    assert.equal(calls,0);assert.equal(saved(p).target,String(expected));
    const remain=Math.max(0,expected-params.current);assert.equal(pointsFromK(p.element('remain').textContent),BigInt(remain));
    const bonus=TIERS.filter(pair=>params.core>=pair[0]).at(-1)?.[1]??0;
    const denominator=BigInt(100+bonus),coins=(BigInt(remain)*25n+denominator-1n)/denominator;
    assert.equal(BigInt(p.element('coinNeed').textContent.replace(/,/g,'')),coins);
    assert.equal(saved(p).targetOrigin.n,selected.length,'Missing days must not be filled with zero or guessed values');
    input(p,'currentTop',params.current+1);assert.equal(saved(p).target,String(expected));
    const q=open(saved(p),{navigator:{onLine:false},fetch:()=>{calls++;throw Error('offline restart must not fetch');}});await flush();
    assert.equal(calls,0);assert.equal(saved(q).target,String(expected));assert.equal(saved(q).current,String(params.current+1));
    assert.equal(saved(q).coreCount,String(params.core));assert.equal(saved(q).bufferPct,buffer);
  });
}

assert.equal(cases.length,1000);assert.equal(seen.size,1000);
assert.deepEqual(groupCounts,{contract:250,network:200,storage:100,reconnect:150,'personal-protection':100,'offline-calculation':200});
const signatureHash=crypto.createHash('sha256').update(cases.map(item=>item.signature).join('\n')).digest('hex');
console.log(JSON.stringify({matrix:'offline-reliability-1000',uniqueConditions:seen.size,groups:groupCounts,
  signatureHash,status:'registered',contract:'18 public ranks, sync.status and serverDate are required'}));
for(const [group,count]of Object.entries(groupCounts))test('Offline reliability: '+group+' / '+count+' unique scenarios',async()=>{
  for(const item of cases.filter(item=>item.group===group)){
    try{await item.run();completed.add(item.signature);}
    catch(error){error.message='Scenario '+item.signature+'\n'+error.message;throw error;}
  }
});
test('Offline reliability: 1,000 distinct completed signatures',()=>{
  assert.equal(completed.size,1000,'A condition counts as completed only after every assertion passes');
  console.log(JSON.stringify({matrix:'offline-reliability-1000',uniqueConditions:seen.size,completedConditions:completed.size,
    groups:groupCounts,signatureHash,status:'passed',
    limitations:['DOM/storage/fetch/time doubles; no physical devices or rendered browsers','No claim of 1,000 independent implementation changes','Source URLs are fixture values; no public source is requested']}));
});
