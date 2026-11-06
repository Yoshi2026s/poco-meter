import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {engine,html} from './calculator-harness.mjs';

// Independent exact-arithmetic expectations for the shipped target functions.
// These are source-function checks; no physical devices or rendered browsers.
const MAX=BigInt(engine().MAX_VALUE),DAY=86400000;
const ranks=Array.from(engine().RANKS),cases=[],signatures=new Set();
const ceil=(numerator,denominator)=>(numerator+denominator-1n)/denominator;
const firstFixtureDay=Date.UTC(2026,7,1),yesterday=Date.UTC(2026,9,3);

function mixedFixture(){
  const e=engine('2026-10-04T12:00:00+09:00');
  e.state.log={};e.state.log13={};e.state.log24={};e.state.provenance={};
  for(const [close,key]of [['13','log13'],['22','log'],['24','log24']]){
    e.state.provenance[close]={};
    // Includes 10/04 and 10/05 so excluding current/future dates is tested.
    for(let day=0;day<66;day++){
      const date=new Date(firstFixtureDay+day*DAY).toISOString().slice(0,10);
      e.state[key][date]={};e.state.provenance[close][date]={};
      ranks.forEach((rank,r)=>{
        if((day+r)%7===0)return; // A missing day must not count as zero.
        const base=(day+r)%13===0?Number(MAX-10000n-BigInt(day*103+r*7))
          :10000+day*103+r*7+Number(close)*100;
        e.state[key][date][rank]=[base,base+1,base+2];
        e.state.provenance[close][date][rank]={origin:(day+r)%5===0?'legacy':'manual'};
      });
    }
  }
  return e;
}

test('A 1,000 unique mixed-border target conditions match an independent BigInt oracle',()=>{
  const e=mixedFixture();
  for(let index=0;index<1000;index++){
    const close=['13','22','24'][index%3],rank=ranks[Math.floor(index/3)%ranks.length];
    const period=['30d','month','prev','3m','all'][Math.floor(index/57)%5];
    const border=Math.floor(index/285)%3,method=['mean','median','p75','max','min'][index%5];
    const buffer=(index*37%501)/10,unit=[1,100,1000,10000][Math.floor(index/5)%4];
    e.state.deadline=close==='24'?'00:00':close+':00';e.state.period=period;
    e.state.asOfDate=period==='30d'&&index%2?'2026-09-25':'';
    const parameters={close,rank,period,border,method,buffer,unit,asOfDate:e.state.asOfDate};
    const signature=JSON.stringify(parameters);
    assert.ok(!signatures.has(signature),'Conditions must be distinct: '+signature);
    signatures.add(signature);
    try{
      const log=e.state[close==='13'?'log13':close==='24'?'log24':'log'];
      let start,end;
      if(period==='30d'){
        end=e.state.asOfDate?Date.parse(e.state.asOfDate+'T00:00:00Z'):yesterday;start=end-29*DAY;
      }else if(period==='month'){start=Date.UTC(2026,9,1);end=yesterday;}
      else if(period==='prev'){start=Date.UTC(2026,8,1);end=Date.UTC(2026,8,30);}
      else if(period==='3m'){start=Date.UTC(2026,7,1);end=yesterday;}
      else{start=firstFixtureDay;end=yesterday;}
      const dates=Object.keys(log).filter(date=>{
        const ms=Date.parse(date+'T00:00:00Z');
        return ms>=start&&ms<=end&&Array.isArray(log[date][rank])
          &&!(period==='30d'&&e.state.provenance[close][date][rank].origin==='legacy');
      }).sort();
      const ordered=dates.map(date=>BigInt(log[date][rank][border])).sort((a,b)=>a<b?-1:a>b?1:0);
      const count=ordered.length,sum=ordered.reduce((a,b)=>a+b,0n),stats=e.selectedStats(rank,border);
      assert.equal(stats.n,count);
      assert.equal(stats.sum,String(sum));
      assert.deepEqual(Array.from(stats.days,day=>day.date),dates);
      assert.equal(stats.latest,dates.at(-1)??null);
      assert.ok(Array.from(stats.days).every(day=>day.date<'2026-10-04'));
      if(period==='30d')assert.equal(stats.window.dates.length,30);
      let numerator,denominator=1n;
      if(method==='mean'){numerator=sum;denominator=BigInt(count);}
      else if(method==='median'){
        numerator=count%2?ordered[(count-1)/2]:ordered[count/2-1]+ordered[count/2];
        denominator=count%2?1n:2n;
      }else numerator=method==='p75'?ordered[Math.ceil(count*3/4)-1]
        :method==='min'?ordered[0]:ordered.at(-1);
      const required=numerator*BigInt(1000+Math.round(buffer*10));
      const denominatorWithBuffer=denominator*1000n;
      const expected=ceil(required,denominatorWithBuffer*BigInt(unit))*BigInt(unit);
      const actual=e.targetCalc(stats,method,buffer,unit);
      if(expected>MAX)assert.equal(actual,null);
      else{
        assert.equal(BigInt(actual.target),expected);
        assert.equal(BigInt(actual.baseNumerator)*denominator,numerator*BigInt(actual.baseDenominator));
        assert.equal(actual.target%unit,0);
        assert.ok(expected*denominatorWithBuffer>=required);
        assert.ok((expected-BigInt(unit))*denominatorWithBuffer<required);
      }
      cases.push(parameters);
    }catch(error){error.message='calculation-'+String(index+1).padStart(4,'0')+' '+signature+': '+error.message;throw error;}
  }
  assert.equal(cases.length,1000);assert.equal(signatures.size,1000);
  console.log('TARGET_ACCURACY_MATRIX_RESULT '+JSON.stringify({
    matrix:'target-accuracy-1000',distinctCalculationConditions:1000,
    ranks:ranks.length,sourceSha256:createHash('sha256').update(html).digest('hex'),
    deterministicCasesSha256:createHash('sha256').update(JSON.stringify(cases)).digest('hex'),
    limitation:'Source function tests; no physical devices or rendered browsers',status:'passed',
  }));
});

test('R01 changing only the legacy exclusion policy must not reuse another cached population',()=>{
  const e=engine();
  e.state.log={'2026-09-01':{S2:[100,100,100]},'2026-09-02':{S2:[200,200,200]}};
  e.state.provenance={'22':{'2026-09-02':{S2:{origin:'legacy'}}}};
  const window={period:'30d',start:'2026-09-01',end:'2026-09-02',
    dates:['2026-09-01','2026-09-02'],excludeLegacy:false};
  const included=e.statsForWindow(window,'S2',0);
  const excluded=e.statsForWindow({...window,excludeLegacy:true},'S2',0);
  assert.equal(included.n,2);
  assert.equal(excluded.n,1,'A new exclusion policy needs a different cache entry');
  assert.equal(excluded.sum,'100');
  assert.deepEqual(Array.from(excluded.days,day=>day.date),['2026-09-01']);
});

test('R02 equally valued records on different dates must keep their own date identities',()=>{
  const e=engine();
  e.state.log={
    '2026-09-01':{S2:[50,50,50]},'2026-09-02':{S2:[100,100,100]},
    '2026-09-03':{S2:[100,100,100]},'2026-09-04':{S2:[200,200,200]},
  };e.state.provenance={};
  const bounds={period:'all',start:'2026-09-01',end:'2026-09-04',excludeLegacy:false};
  const firstDates=['2026-09-01','2026-09-02','2026-09-04'];
  const secondDates=['2026-09-01','2026-09-03','2026-09-04'];
  const first=e.statsForWindow({...bounds,dates:firstDates},'S2',0);
  const second=e.statsForWindow({...bounds,dates:secondDates},'S2',0);
  assert.equal(first.sum,second.sum);
  assert.deepEqual(Array.from(first.days,day=>day.date),firstDates);
  assert.deepEqual(Array.from(second.days,day=>day.date),secondDates,'Date identity belongs in the cache signature');
  assert.deepEqual(Array.from(second.window.dates),secondDates);
});
