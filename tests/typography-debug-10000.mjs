import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {engine, pageEngine, plain, pointsFromK, html} from './calculator-harness.mjs';

// Five batches cover exactly 10,000 distinct deterministic input conditions.
// The browser-shipped functions and real input handlers are exercised in a
// source/DOM double. This is not physical-device or browser-rendered visual QA,
// and does not claim 10,000 independent implementation changes or bug fixes.
const KEY = 'pococha-meter-calc-v1';
const MAX = 360287970189639n;
const DAY = 86400000, JST = 32400000;
const counts = {}, signatures = new Set(), cases = [];
const fixture = plain(engine().state);
const expectedCounts = {items:4000, format:3000, realtime:1000, number:1000, time:1000};
const ceil = (a,b) => (a+b-1n)/b;
const grouped = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const fullwidth = text => text.replace(/[!-~]/g, c => String.fromCharCode(c.charCodeAt(0)+0xfee0));
// An independent expectation fixture, rather than reading the implementation's
// CORE_TIERS back as its own expected answer.
const tiers = [[2,1],[5,2],[10,3],[15,4],[20,5],[25,6],[30,7],[35,8],[40,9],
  [45,10],[50,11],[60,12],[70,13],[80,14],[90,15],[100,16],[150,17],[200,18],
  [250,19],[300,20],[400,21],[500,22]];
const bonusFor = core => tiers.filter(([threshold]) => core>=threshold).at(-1)?.[1] ?? 0;
function condition(group,index,parameters,run) {
  const signature = group+'|'+JSON.stringify(parameters);
  assert.ok(!signatures.has(signature), 'Duplicate matrix condition: '+signature);
  signatures.add(signature);
  const id = group+'-'+String(index+1).padStart(4,'0');
  try { run(); } catch(error) { error.message=id+' '+JSON.stringify(parameters)+': '+error.message; throw error; }
  counts[group]=(counts[group]??0)+1;
  cases.push({id,parameters});
}
function offlinePage(settings) {
  return pageEngine(settings ?? {...fixture,seedVer:3,seedVer13:1,
    snapshotVersion:'2026-10-02-v3',goalDefaultsVersion:1,pick:'',
    target:'100001',current:'500',coreCount:'40',rank:'S2',period:'30d',
    log:{},log13:{},log24:{},provenance:{}}, {
    navigator:{onLine:false},fetch:()=>new Promise(()=>{}),
  });
}
function input(p,id,value,type='input') {
  p.element(id).value=String(value);
  p.element(id).dispatchEvent(new Event(type));
}

test('T01 4,000 core/item cases satisfy the goal with the smallest whole item count',()=>{
  const e=engine();
  assert.equal(BigInt(e.MAX_VALUE), MAX);
  const prices=[55n,111n,1080n,5555n];
  for(let core=0;core<1000;core++) for(let j=0;j<prices.length;j++) {
    const index=core*4+j,price=prices[j];
    const remainder=index===0?0n:index%11===0?MAX-BigInt(index)
      :index%17===0?BigInt(index%4+1):BigInt(index*104729+(index%4));
    condition('items',index,{core,price:String(price),remainder:String(remainder)},()=>{
      e.state.coreCount=String(core);
      const coefficient=BigInt(100+bonusFor(core)),required=remainder*25n;
      assert.equal(e.coreInfo().bonus, bonusFor(core));
      assert.equal(e.readCoreCount(fullwidth(String(core))), core);
      const coins=BigInt(e.needCoins(Number(remainder)));
      const items=BigInt(e.itemRange(Number(remainder),Number(price)).replaceAll(',',''));
      assert.equal(coins,ceil(required,coefficient));
      assert.equal(items,ceil(required,coefficient*price));
      assert.ok(coins*coefficient>=required, 'The required coins must suffice');
      assert.ok(items*price*coefficient>=required, 'The required item count must suffice');
      if(remainder>0n) {
        assert.ok((coins-1n)*coefficient<required, 'One fewer coin must be insufficient');
        assert.ok((items-1n)*price*coefficient<required, 'One fewer item must be insufficient');
      } else { assert.equal(coins,0n); assert.equal(items,0n); }
    });
  }
});

test('T02 3,000 remaining values retain every point in their displayed K representation',()=>{
  const e=engine();
  for(let index=0;index<3000;index++) {
    const points=index<1000?BigInt(index):index<2000?1000n+BigInt(index-1000)*997n
      :MAX-BigInt(index-2000);
    condition('format',index,{points:String(points)},()=>{
      const text=e.fmtRemainingK(Number(points));
      assert.equal(pointsFromK(text),points, 'Displayed K must round-trip without point loss');
      assert.equal(e.fmtK(Number(points)),text, 'Other remainder output must share exact precision');
      if(points<1000n) assert.equal(text,String(points));
      else {
        assert.match(text,/^[1-9]\d*(?:\.\d{1,3})?K$/);
        assert.doesNotMatch(text,/\.\d*0K$/, 'Do not pad unnecessary decimal zeros');
      }
    });
  }
});

test('T03 1,000 offline input-event cases immediately update the meter and all four item estimates',()=>{
  let p=offlinePage();
  const itemOutputs=[['dogcatNeed',55n],['pandaNeed',111n],['hanabiNeed',1080n],['bashaNeed',5555n]];
  for(let index=0;index<1000;index++) {
    const target=index%17===0?Number(MAX-BigInt(index)):100000+index*7919;
    const current=index%7===0?Math.min(Number(MAX),target+index+1)
      :index%11===0?target:Math.floor(target*(index%101)/101);
    const core=index*43%1001,eventType=index%2?'input':'change';
    condition('realtime',index,{target,current,core,eventType},()=>{
      input(p,'target',index%2?String(target):fullwidth(String(target)),eventType);
      input(p,'currentTop',index%3?String(current):grouped(current),eventType);
      input(p,'coreCountTop',fullwidth(String(core)),eventType);
      const saved=JSON.parse(p.stored.get(KEY));
      assert.equal(saved.target,String(target));
      assert.equal(saved.current,String(current));
      assert.equal(saved.coreCount,String(core));
      const remainder=Math.max(0,target-current);
      const required=ceil(BigInt(remainder)*25n,BigInt(100+bonusFor(core)));
      if(remainder) assert.equal(pointsFromK(p.element('remain').textContent),BigInt(remainder));
      else assert.equal(p.element('remain').textContent,'達成！');
      const ratio=BigInt(current)*10000n/BigInt(target);
      const percentage=Number(ratio>10000n?10000n:ratio)/100;
      assert.equal(p.element('pct').textContent,percentage+'%');
      assert.equal(p.element('fill').style.width,percentage+'%');
      assert.equal(BigInt(p.element('coinNeed').textContent.replaceAll(',','')),required);
      for(const [id,price] of itemOutputs)
        assert.equal(BigInt(p.element(id).textContent.replace(/[^\d]/g,'')),ceil(required,price),id);
      assert.equal(p.element('coreBonusTop').textContent,String(100+bonusFor(core))+'%');
      const length=p.element('remain').textContent.length;
      assert.equal(p.element('remain').dataset.size,length>12?'long':length>8?'compact':'standard');
      assert.equal(p.element('remain').getAttribute('aria-label'),p.element('remainExact').textContent);
    });
    if(index%50===49) p=offlinePage(JSON.parse(p.stored.get(KEY)));
  }
});

test('T04 1,000 decimal/unit/fullwidth strings follow independently calculated exact rounding',()=>{
  const e=engine();
  for(let index=0;index<1000;index++) {
    const unit=['','K','万','M'][index%4], multiplier=[1n,1000n,10000n,1000000n][index%4];
    const digits=1+(Math.floor(index/4)%10), denominator=10n**BigInt(digits);
    const base=index%7===0?MAX/multiplier-BigInt(index):BigInt(index*7919+1);
    const fraction=[0n,denominator/2n-1n,denominator/2n,denominator/2n+1n,denominator-1n][Math.floor(index/40)%5];
    const fractionalText=String(fraction).padStart(digits,'0');
    let text=String(base)+'.'+fractionalText+unit;
    const variant=Math.floor(index/5)%4;
    if(variant===1) text=fullwidth(text);
    if(variant===2) text=grouped(base)+'.'+fractionalText+'\t'+unit;
    if(variant===3) text='  '+text+'  ';
    const rounded=(base*denominator*multiplier+fraction*multiplier+denominator/2n)/denominator;
    condition('number',index,{text},()=>assert.equal(e.readNumber(text),rounded>MAX?null:Number(rounded)));
  }
});

test('T05 1,000 JST closing windows include boundary instants in the correct meter day',()=>{
  const e=engine();
  for(let index=0;index<1000;index++) {
    const minutes=index*197%1440;
    const deadline=String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
    const offset=[-1001,-1,0,1,999,1000,DAY-1][index%7];
    const now=Date.UTC(2026,0,1)+index*DAY+minutes*60000-JST+offset;
    condition('time',index,{deadline,now},()=>{
      e.state.deadline=deadline;
      const actual=e.meterWindow(now);
      // Divide epoch time into JST meter days; do not call implementation date
      // helpers to manufacture the expected start or end.
      const start=Math.floor((now+JST-minutes*60000)/DAY)*DAY+minutes*60000-JST;
      assert.deepEqual([actual.start,actual.end],[start,start+DAY]);
      assert.ok(actual.start<=now && now<actual.end);
      assert.equal(actual.end-actual.start,DAY);
      const seconds=Math.ceil((actual.end-now)/1000);
      const countdown=String(Math.floor(seconds/3600)).padStart(2,'0')+':'
        +String(Math.floor(seconds/60)%60).padStart(2,'0')+':'
        +String(seconds%60).padStart(2,'0');
      assert.equal(e.countdownTime(actual.end-now),countdown);
    });
  }
});

test.after(()=>{
  assert.deepEqual(counts,expectedCounts);
  assert.equal(signatures.size,10000);
  assert.equal(cases.length,10000);
  console.log('TYPOGRAPHY_DEBUG_MATRIX_RESULT '+JSON.stringify({
    matrix:'typography-debug-10000',nodeTestBatches:5,distinctMatrixConditions:10000,
    groups:counts,sourceSha256:createHash('sha256').update(html).digest('hex'),
    deterministicCasesSha256:createHash('sha256').update(JSON.stringify(cases)).digest('hex'),
    limitation:'Source and DOM doubles; no physical devices or rendered browsers',status:'passed',
  }));
});
