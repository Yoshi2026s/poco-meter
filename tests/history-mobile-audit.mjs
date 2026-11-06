// Reproducible synthetic correctness audit. This is neither a user study nor a
// claim of distinct fixes or real-device UI testing. Run after implementation:
// node tests/history-mobile-audit.mjs --rounds 100 --cases-per-round 100000 --output /absolute/report.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import * as h from '../calculator/history-core.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i], value = process.argv[i + 1];
  if (!['--rounds', '--cases-per-round', '--seed', '--output'].includes(name) || value === undefined || args.has(name)) throw Error('Invalid audit argument');
  args.set(name, value);
}
const rounds = Number(args.get('--rounds') || 100), perRound = Number(args.get('--cases-per-round') || 100000), seed = Number(args.get('--seed') || 20261018);
if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 100 || !Number.isSafeInteger(perRound) || perRound < 10 || perRound > 100000 || perRound % 10 || !Number.isSafeInteger(seed) || seed < 1 || seed > 0xffffffff || !args.get('--output')) throw Error('Use 1..100 rounds, a multiple of 10 cases <=100000, a uint32 seed and an explicit output path');
const output = resolve(args.get('--output'));
const RANKS = ['S6','S5','S4','S3','S2','S1','A3','A2','A1','B3','B2','B1','C3','C2','C1','D3','D2','D1','E'], CLOSES = ['13','22','24'];
const ORIGINS = ['archive','verified','remote','manual','backup','saved','legacy','import'];
const PERSONAL = new Set(['manual','backup','saved','import']);
const LABELS = {archive:'掲載資料',verified:'掲載資料',remote:'取得記録',manual:'手入力',backup:'バックアップ',saved:'端末保存',legacy:'旧版参考値',import:'CSV・貼り付け'};
const MAX = Math.floor(Number.MAX_SAFE_INTEGER / 25), UINT32_MAX = 0xffffffff, HIGH_SAFE_MIN = 2 ** 52;
const root = new URL('../', import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
const sourcePaths = ['calculator/history-core.mjs','calculator/history-ui.mjs','calculator/history-page-template.html','tests/history-mobile-audit.mjs','db/history-2025-2026.json','db/history-2026-10-02-03.json','db/seed.json'];
const sourceHashes = () => Object.fromEntries(sourcePaths.map(path => [path, hash(readFileSync(new URL(path, root)))]));
const archive = ['history-2025-2026.json','history-2026-10-02-03.json','seed.json'].flatMap(name => JSON.parse(readFileSync(new URL('db/' + name, root), 'utf8')));
const pad = n => String(n).padStart(2, '0');
const leap = year => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
const monthDays = (year, month) => [31, leap(year) ? 29 : 28, 31,30,31,30,31,31,30,31,30,31][month - 1];
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y,m,d] = value.split('-').map(Number);
  return y >= 2000 && y <= 2099 && m >= 1 && m <= 12 && d >= 1 && d <= monthDays(y,m);
}
function expectedMonth(month, delta = 0) {
  if (typeof month !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month) || !Number.isInteger(delta) || Math.abs(delta) > 1200) return null;
  const value = Number(month.slice(0,4))*12 + Number(month.slice(5))-1 + delta, year = Math.floor(value/12), m = value-year*12+1;
  if (year < 2000 || year > 2099) return null;
  const selected = year + '-' + pad(m);
  return {month:selected,start:selected+'-01',end:selected+'-'+pad(monthDays(year,m))};
}
function weekday(year, month, day) {
  // Zeller's congruence, independent of Date parsing used in the application.
  if (month < 3) { month += 12; year--; }
  const century = Math.floor(year/100), y = year%100;
  return (day+Math.floor(13*(month+1)/5)+y+Math.floor(y/4)+Math.floor(century/4)+5*century+6)%7;
}
const group = text => text.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
function numberText(value, units) {
  if (!Number.isSafeInteger(value) || value < 0) return '—';
  const n = BigInt(value);
  if (units !== 'K') return group(n.toString());
  return group(((n+500n)/1000n).toString()) + 'K';
}
const compare = (a,b,old=false) => (a.date === b.date ? Number(a.close)-Number(b.close) || RANKS.indexOf(a.rank)-RANKS.indexOf(b.rank) : (a.date < b.date ? -1 : 1)*(old ? 1 : -1));
const belongs = (row,filters) => (!filters.rank || row.rank === filters.rank) && (!filters.close || row.close === filters.close) && (!filters.origin || (filters.origin === 'personal' ? PERSONAL.has(row.origin) : !PERSONAL.has(row.origin)));
const fullWidth = text => text.replace(/[!-~]/g, c => String.fromCharCode(c.charCodeAt(0)+0xfee0));
const names = ['dates_and_month_boundaries','calendar_layout_and_record_marks','search_rank_close_origin_and_order','pagination_and_units','numeric_and_triple_boundaries','merge_precedence_and_immutability','local_and_packed_data_preservation','archive_normalization_and_source_validation','copy_text_and_private_field_exclusion','latest_recent_and_adjacent_dates'];
let checks = 0, completed = 0, current = null, observed = 0, conditionBytes = 0;
const counts = Object.fromEntries(names.map(name => [name,0])), checkCounts = {...counts};
const coverage = {fixtureFamilies:{empty:0,sparse:0,dense:0},calendar:{forcedMatchingScope:0,recordMonthAnyScope:0,unrestrictedMonth:0,positiveMarkers:0,emptyMarkers:0},numbers:{upToUint32:0,aboveUint32ThroughStoredMax:0,aboveStoredMaxBelow53Bit:0,high53Bit:0,invalid:0},storedTripleBasesAboveUint32:0};
const digest = createHash('sha256'), digestBuffer = Buffer.alloc(16*4096);
let digestPosition = 0;
function check(actual, expected, label) {
  checks++; checkCounts[current.domain]++;
  if (actual !== expected) { const error = Error(label); error.details = {scenario:current,actual,expected}; throw error; }
  observed = Math.imul(observed ^ (typeof actual === 'number' ? actual|0 : typeof actual === 'string' ? actual.length : actual ? 1 : 0), 16777619) >>> 0;
}
function same(actual, expected, label) { check(JSON.stringify(actual),JSON.stringify(expected),label); }
function recordCondition(round, index, randomState) {
  digestBuffer.writeUInt32LE(round,digestPosition); digestBuffer.writeUInt32LE(index,digestPosition+4); digestBuffer.writeUInt32LE(randomState,digestPosition+8); digestBuffer.writeUInt32LE(observed,digestPosition+12);
  digestPosition += 16; conditionBytes += 16;
  if (digestPosition === digestBuffer.length) { digest.update(digestBuffer); digestPosition = 0; }
}
function generator(initial) {
  let state = initial >>> 0 || 0x6d2b79f5;
  const next = () => { state ^= state<<13; state ^= state>>>17; state ^= state<<5; return state>>>0; };
  // Small indices use one 32-bit draw. Values use two draws and BigInt so the
  // saved-record limit and the entire safe-integer interval are reachable.
  const wideInt = max => Number((((BigInt(next() & 0x1fffff) << 32n) | BigInt(next()))) % (BigInt(max) + 1n));
  return {next,int:max=>next()%max,wideInt,pick:items=>items[next()%items.length],get state(){return state>>>0;}};
}
function rowFixture(random, round, offset=0) {
  const year = 2000+(round+offset)%100, month=1+random.int(12), date=year+'-'+pad(month)+'-'+pad(1+random.int(monthDays(year,month))), n=random.wideInt(MAX-1000);
  return {date,rank:random.pick(RANKS),close:random.pick(CLOSES),values:[n,n+1+offset,n+100+offset],origin:random.pick(ORIGINS),source:'',checkedAt:''};
}
function roundDataset(random, round) {
  const rows=[],family=['empty','dense','sparse'][round%3],reference=rowFixture(random,round);
  if(family==='dense'){
    // Every rank and cutoff on the same three adjacent month-end dates; this
    // exercises tie ordering, many records per calendar day and deduplication.
    const year=2000+round%100,month=1+round%12,last=monthDays(year,month);
    for(let d=0;d<3;d++)for(let c=0;c<CLOSES.length;c++)for(let r=0;r<RANKS.length;r++){
      const row=rowFixture(random,round,d);row.date=year+'-'+pad(month)+'-'+pad(last-d);row.close=CLOSES[c];row.rank=RANKS[r];row.origin=ORIGINS[(d+c+r+round)%ORIGINS.length];rows.push(row);
    }
  }
  if(family==='sparse')for(let d=0;d<9;d++){
    const year=2000+(round+d*11)%100,month=1+(round+d*5)%12,row=rowFixture(random,round,d);row.date=year+'-'+pad(month)+'-'+pad(1+(round+d*7)%monthDays(year,month));row.close=CLOSES[(round+d)%3];row.rank=RANKS[(round+d*3)%RANKS.length];rows.push(row);
    if(d%3===0)rows.push({...row,close:CLOSES[(round+d+1)%3],values:[...row.values]});
  }
  // Keep the empty family truly empty; the other shapes include reviewed rows.
  if(family!=='empty')for (let i=0;i<4;i++) { const raw=archive[(round*97+i*131)%archive.length], pair=Object.entries(raw.ranks)[i%Object.keys(raw.ranks).length]; if(pair) rows.push({date:raw.date,close:String(raw.close),rank:pair[0],values:[...pair[1]],origin:'archive',source:'',checkedAt:''}); }
  rows.forEach(row=>{Object.freeze(row.values);Object.freeze(row);}); Object.freeze(rows);
  const index=h.createHistoryIndex(rows);for(const bucket of index.buckets.values())Object.freeze(bucket);
  return {rows,index,family,reference};
}
function expectedRows(rows,filters,predicate=()=>true) {
  return rows.filter(row=>belongs(row,filters)&&(!filters.start||row.date>=filters.start)&&(!filters.end||row.date<=filters.end)&&predicate(row)).sort((a,b)=>compare(a,b,filters.order==='old'));
}
function runCase(domain, random, round, index, dataset) {
  const {rows, index:lookup}=dataset, selected=rows.length?random.pick(rows):dataset.reference, units=random.pick(['pt','K']);
  switch(domain) {
    case 0: {
      const year=1998+random.int(104), month=random.int(14), day=random.int(33), value=year+'-'+pad(month)+'-'+pad(day), delta=random.int(2403)-1201;
      check(h.validHistoryDate(value),validDate(value),'date validation');
      const monthString=random.int(8) ? value.slice(0,7) : value.slice(0,7)+' ';
      same(h.historyMonthRange(monthString,delta),expectedMonth(monthString,delta),'month/year rollover');
      const q=fullWidth(selected.date.replaceAll('-','/'))+'　'+fullWidth(selected.rank.toLowerCase())+'　'+selected.close+'時';
      check(h.normalizeHistoryQuery(q),selected.date+' '+selected.rank+' '+selected.close+'時','full-width date and rank normalization');
      break;
    }
    case 1: {
      const mode=Math.floor(index/10)%3,useRecordMonth=rows.length>0&&mode<2,key=useRecordMonth?selected.date.slice(0,7):(2000+random.int(100))+'-'+pad(1+random.int(12)),[year,month]=key.split('-').map(Number),actual=h.historyCalendarMonth(key),first=weekday(year,month,1),length=monthDays(year,month);
      check(actual.cells.length,Math.ceil((first+length)/7)*7,'calendar week count');
      check(actual.start,key+'-01','calendar start');check(actual.end,key+'-'+pad(length),'calendar end');
      for(let i=0;i<actual.cells.length;i++)check(actual.cells[i],i<first||i>=first+length?null:key+'-'+pad(i-first+1),'calendar cell and blank');
      const forceMatching=useRecordMonth&&mode===0,close=forceMatching?selected.close:random.pick(['',...CLOSES]),rank=forceMatching?selected.rank:random.pick(['',...RANKS]),origin=forceMatching?(PERSONAL.has(selected.origin)?'personal':'published'):random.pick(['','personal','published']);
      const f={close,rank,origin,query:'',start:actual.start,end:actual.end};
      const expected=new Set(rows.filter(row=>belongs(row,f)&&row.date>=actual.start&&row.date<=actual.end).map(row=>row.date));
      same([...new Set(h.filterHistory(lookup,f).rows.map(row=>row.date))].sort(),[...expected].sort(),'calendar markers respect scope');
      coverage.calendar[forceMatching?'forcedMatchingScope':useRecordMonth?'recordMonthAnyScope':'unrestrictedMonth']++;
      coverage.calendar[expected.size?'positiveMarkers':'emptyMarkers']++;
      if(forceMatching)check(expected.size>0,true,'a forced matching calendar scope contains an actual record');
      break;
    }
    case 2: {
      const other=rows.length?random.pick(rows):dataset.reference, start=random.int(4)?(selected.date<other.date?selected.date:other.date):'',end=random.int(4)?(selected.date>other.date?selected.date:other.date):'';
      const f={start,end,rank:random.pick(['',...RANKS]),close:random.pick(['',...CLOSES]),origin:random.pick(['','personal','published']),order:random.pick(['new','old']),query:''};
      let predicate=()=>true;const queryKind=random.int(10);
      if(queryKind===1){f.query=selected.rank.toLowerCase();predicate=row=>row.rank===selected.rank;}
      if(queryKind===2){f.query=fullWidth(selected.rank);predicate=row=>row.rank===selected.rank;}
      if(queryKind===3){const [y,m,d]=selected.date.split('-');f.query=y+'年'+Number(m)+'月'+Number(d)+'日';predicate=row=>row.date===selected.date;}
      if(queryKind===4){f.query=selected.close+'時〆';predicate=row=>row.close===selected.close;}
      if(queryKind===5){f.query=selected.date.replaceAll('-','/')+' '+selected.rank+' '+selected.close+'時締め';predicate=row=>row.date===selected.date&&row.rank===selected.rank&&row.close===selected.close;}
      if(queryKind===6){f.query=selected.date.slice(0,7);predicate=row=>row.date.startsWith(f.query);}
      if(queryKind===7){f.query='NO-MATCH-'+random.next();predicate=()=>false;}
      if(queryKind===8){f.query=String(selected.values[2]);predicate=row=>[row.date,row.date.replaceAll('-','/'),row.date.slice(0,7),row.rank,row.close+'時',...row.values.map(String)].join(' ').includes(f.query);}
      if(queryKind===9){f.query=selected.rank+' '+RANKS[(RANKS.indexOf(selected.rank)+1)%RANKS.length];predicate=()=>false;}
      const actual=h.filterHistory(lookup,f);check(actual.error,'','valid search');same(actual.rows,expectedRows(rows,f,predicate),'indexed filters equal independent scan');
      if(index%17===0){const invalid=h.filterHistory(lookup,{...f,start:'2026-02-30'});check(invalid.rows.length,0,'invalid range has no rows');check(!!invalid.error,true,'invalid range reports error');}
      break;
    }
    case 3: {
      const length=random.int(503), source=Array.from({length},(_,i)=>(round+1)*1000000+index*503+i), size=random.pick([0,-1,1,10,20,30,50,100,101,2.5,NaN]), requested=random.pick([-10,0,1,2,random.int(10000),1.5,Infinity]);
      const selectedSize=Number.isInteger(size)&&size>=1&&size<=100?size:30,pages=Math.max(1,Math.ceil(length/selectedSize)),page=Number.isInteger(requested)?Math.max(1,Math.min(pages,requested)):1;
      const actual=h.historyPage(source,requested,size);check(actual.page,page,'page clamp');check(actual.pages,pages,'page count');check(actual.total,length,'unfiltered total');same(actual.rows,source.slice((page-1)*selectedSize,page*selectedSize),'page rows');
      check(h.historyNumber(random.next(),units).endsWith('K'),units==='K','units match page preference');break;
    }
    case 4: {
      const numericBand=Math.floor(index/10)%5,value=numericBand===0?random.pick([0,1000,1001,random.next()]):numericBand===1?UINT32_MAX+1+random.wideInt(MAX-UINT32_MAX-1):numericBand===2?HIGH_SAFE_MIN+random.wideInt(Number.MAX_SAFE_INTEGER-HIGH_SAFE_MIN):numericBand===3?random.pick([MAX-1,MAX,MAX+1,Number.MAX_SAFE_INTEGER-random.next()]):random.pick([-1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,random.next()+0.5]);
      check(h.historyNumber(value,units),numberText(value,units),'exact numeric formatting');
      coverage.numbers[!Number.isSafeInteger(value)||value<0?'invalid':value<=UINT32_MAX?'upToUint32':value<=MAX?'aboveUint32ThroughStoredMax':value<HIGH_SAFE_MIN?'aboveStoredMaxBelow53Bit':'high53Bit']++;
      const base=random.wideInt(MAX-2), triple=random.pick([[base,base,base+1],[MAX-2,MAX-1,MAX],[1,0,2],[-1,0,1],[0,1,MAX+1],[0,0.5,1],[1,2],null]);
      if(base>UINT32_MAX)coverage.storedTripleBasesAboveUint32++;
      const valid=Array.isArray(triple)&&triple.length===3&&triple.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=MAX)&&triple[0]<=triple[1]&&triple[1]<=triple[2];
      check(h.validHistoryTriple(triple),valid,'stored triple boundary');break;
    }
    case 5: {
      const base={...selected,values:[random.next(),random.next()+4294967296,random.next()+8589934592],origin:'archive'},origin=random.pick(ORIGINS),local={...base,origin,values:[index+1,index+2,index+3]},live={...base,origin:'remote',values:[round+100,round+200,round+300]},extra={...base,rank:RANKS[(RANKS.indexOf(base.rank)+1)%RANKS.length]};
      for(const row of [base,local,live,extra]){Object.freeze(row.values);Object.freeze(row);}
      const chosen=['archive','legacy','verified','remote'].includes(origin)?live:local;
      const merged=h.mergeHistoryRows([base,extra],[local],[live]);check(merged.length,2,'same-key rows merge only once');check(merged.find(row=>row.rank===base.rank),chosen,'personal provenance survives remote refresh');check(merged.find(row=>row.rank===extra.rank),extra,'other rank preserved');break;
    }
    case 6: {
      const close=random.pick(CLOSES),rank=random.pick(RANKS),date=selected.date,origin=random.pick([...ORIGINS,'untrusted']),source='https://one-carat.com/campus/archives/'+(1+random.int(10000000)),values=[index,index+round+1,index+round+2],checked='2026-10-17T00:00:'+pad(random.int(60))+'Z';
      const meta={origin,source,checkedAt:checked},state={target:'private-target-'+index,current:'private-current-'+round,[{13:'log13',22:'log',24:'log24'}[close]]:{[date]:{[rank]:values,UNSUPPORTED:[1,2,3]}}};
      if(random.int(2))state.provenance={[close]:{[date]:{[rank]:meta}}};else state.provenancePacked={version:1,pool:[meta],refs:{[close]:{[date]:{[rank]:0}}}};
      const raw=JSON.stringify(state),actual=h.localHistoryRows(raw),expectedOrigin=['manual','backup','legacy','verified','remote','saved','import'].includes(origin)?origin:'saved';
      same(actual,[{date,close,rank,values,origin:expectedOrigin,source,checkedAt:checked}],'legacy/plain/packed storage decoding');check(JSON.stringify(state),raw,'input settings and record preserved');check(JSON.stringify(actual).includes('private-'),false,'private calculator values excluded');break;
    }
    case 7: {
      const date=selected.date,close=random.pick(CLOSES),rank=random.pick(RANKS),value=random.wideInt(MAX-1000),values=[value,value+1,value+999],checked='x'.repeat(41+random.int(30));
      const good='https://one-carat.com/campus/archives/'+(random.next()+1),source=random.pick([good,good+'?private=1',good+'#fragment',good.replace('https:','http:'),good.replace('one-carat.com','one-carat.com.invalid'),good.replace('https://','https://u:p@')]);
      const input=[{date,close,ranks:{[rank]:values,UNKNOWN:[1,2,3]},sourceURL:source,checkedAt:checked},{date:'2026-02-30',close,ranks:{S2:[1,2,3]}}];
      const origin=random.pick(ORIGINS),actual=h.normalizeHistoryRows(input,origin),expectedSource=source===good?good:'';
      same(actual,[{date,close,rank,values,origin,source:expectedSource,checkedAt:checked.slice(0,40)}],'archive normalization and source allowlist');check(h.historySource(source),expectedSource,'untrusted source URL rejected');check(input[0].ranks[rank],values,'normalization leaves input data intact');break;
    }
    case 8: {
      const row={...rowFixture(random,round,index%100),origin:random.pick([...ORIGINS,'unknown']),source:random.int(2)?'https://one-carat.com/campus/archives/'+random.next():'',checkedAt:random.int(2)?'2026-10-17T10:20:'+pad(random.int(60))+'+09:00':'',target:'private-target',current:'private-current'};
      Object.freeze(row.values);Object.freeze(row);const label=LABELS[row.origin]||'出典未確認',checked=row.checkedAt?'確認 '+row.checkedAt.replace('T',' ').slice(0,19):'確認日時なし';
      const expected=['【過去のボーダー｜Pococha1012】',row.date.replaceAll('-','/')+' '+row.rank+' '+row.close+'時〆',...row.values.map((v,i)=>['±0','+1','+2'][i]+'：'+numberText(v,units)+(units==='K'?'':' pt')),'記録：'+label+' · '+checked,...(row.source?['出典：'+row.source]:[])].join('\n');
      const actual=h.historyCardText(row,units);check(actual,expected,'copy matches exact row and units');check(actual.includes('private-'),false,'copy excludes unrelated settings');check(h.historyOriginLabel(row.origin),label,'honest origin label');break;
    }
    case 9: {
      const f={rank:random.pick(['',...RANKS]),close:random.pick(['',...CLOSES]),origin:random.pick(['','personal','published']),query:'IGNORED-'+random.next(),start:random.pick(['','2000-01-01',selected.date,'2026-02-30']),end:random.pick(['','2099-12-31',selected.date,'2026-13-01']),order:random.pick(['new','old'])};
      const dates=[...new Set(rows.filter(row=>belongs(row,f)).map(row=>row.date))].sort().reverse(),latest=dates[0]||null;
      same(h.historyRecordDates(lookup,f),dates,'distinct record-date shortcut scope');check(h.latestHistoryDate(lookup,f),latest,'latest record follows origin/rank/close');
      const selectedDate=random.pick([selected.date,'2000-01-01','2099-12-31','2026-02-30']),direction=random.pick([-1,1,0]),eligible=dates.filter(date=>direction<0?date<selectedDate:date>selectedDate).sort();
      check(h.adjacentHistoryDate(lookup,f,selectedDate,direction),validDate(selectedDate)&&[-1,1].includes(direction)&&eligible.length?(direction<0?eligible.at(-1):eligible[0]):null,'nearest existing prior/next date');
      const anchor=validDate(f.end)?f.end:validDate(f.start)?f.start:latest,older=dates.filter(date=>date<anchor).sort(),newer=dates.filter(date=>date>anchor).sort();
      same(h.historyRecordNavigation(lookup,f),{latest,previous:older.at(-1)||null,next:newer[0]||null,anchor,count:dates.length},'mobile date navigation shares the selected scope');
      const days=random.pick([7,30]),recent=h.recentHistoryRange(lookup,f,days);let expected=null;
      if(latest){const d=new Date(latest+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-days+1);const start=d.toISOString().slice(0,10);expected={start:start<'2000-01-01'?'2000-01-01':start,end:latest};}
      same(recent,expected,'recent range anchored to matching records');break;
    }
  }
}

const started = new Date(), startTime=performance.now(), beforeHashes=sourceHashes(), roundResults=[];
const report={schemaVersion:2,kind:'synthetic-history-core-correctness-audit',requested:{rounds,casesPerRound:perRound,totalCases:rounds*perRound,seed},scope:{domains:names,coveredSourceFunctions:['validHistoryDate','validHistoryTriple','historySource','normalizeHistoryRows','localHistoryRows','mergeHistoryRows','createHistoryIndex','historyMonthRange','historyCalendarMonth','historyRecordDates','latestHistoryDate','adjacentHistoryDate','historyRecordNavigation','recentHistoryRange','normalizeHistoryQuery','filterHistory','historyPage','historyNumber','historyOriginLabel','historyCardText'],archiveRows:archive.length,indexedFixtureFamilies:{empty:'No indexed records; independent normalization/copy fixtures still exercise their own inputs.',dense:'All 19 ranks and 3 cutoffs across 3 adjacent month-end days, plus 4 reviewed archive rows.',sparse:'Nine widely separated dates, partial ranks/cutoffs and some same-day records, plus 4 reviewed archive rows.'},numericGeneration:'Two 32-bit PRNG outputs are combined via BigInt into 53 bits. Numeric-format scenarios guarantee low, middle stored-value, high 53-bit, boundary and invalid bands.'},limitations:['Synthetic conditions, not actual people or distinct implemented improvements.','Finite boundary values legitimately recur; each round uses a different PRNG seed and varies combined conditions and record values.','No DOM, real browser, iPhone, touch, keyboard, network or production data checks are counted here.','UI event and layout tests and the final ten debug rounds are separate.'],startedAt:started.toISOString(),sourceHashes:beforeHashes,rounds:roundResults};
let failure=null;
try {
  for(let round=0;round<rounds;round++){
    const roundStart=performance.now(),roundSeed=(Math.imul(seed^(round+1),0x9e3779b1)>>>0)||1,random=generator(roundSeed),dataset=roundDataset(random,round),before=hash(JSON.stringify(dataset.rows)),checkStart=checks,domainCounts=Object.fromEntries(names.map(name=>[name,0]));
    coverage.fixtureFamilies[dataset.family]++;
    for(let index=0;index<perRound;index++){
      const domain=index%names.length;current={round:round+1,index:index+1,domain:names[domain],rngState:random.state};
      runCase(domain,random,round,index,dataset);counts[names[domain]]++;domainCounts[names[domain]]++;completed++;recordCondition(round+1,index+1,random.state);
    }
    current={round:round+1,index:perRound,domain:'merge_precedence_and_immutability'};
    check(hash(JSON.stringify(dataset.rows)),before,'round dataset remains immutable');
    const result={round:round+1,seed:roundSeed,cases:perRound,assertions:checks-checkStart,domainCounts,fixtureFamily:dataset.family,indexedRows:dataset.rows.length,elapsedMs:Math.round(performance.now()-roundStart),finalRngState:random.state,datasetHash:before};roundResults.push(result);
    console.log(JSON.stringify({round:result.round,rounds,cases:completed,assertions:checks,elapsedMs:result.elapsedMs}));
  }
  if(rounds>=3){current={round:rounds,index:perRound,domain:'search_rank_close_origin_and_order'};for(const family of ['empty','dense','sparse'])check(coverage.fixtureFamilies[family]>0,true,'all indexed fixture families were exercised');}
  if(rounds>=2){current={round:rounds,index:perRound,domain:'calendar_layout_and_record_marks'};check(coverage.calendar.forcedMatchingScope>0,true,'calendar coverage includes matching record scopes');check(coverage.calendar.positiveMarkers>0,true,'calendar coverage includes visible record markers');}
  if(perRound>=50){current={round:rounds,index:perRound,domain:'numeric_and_triple_boundaries'};check(coverage.numbers.aboveUint32ThroughStoredMax>0,true,'numeric coverage exceeds the 32-bit range');check(coverage.numbers.high53Bit>0,true,'numeric coverage reaches high 53-bit safe integers');}
  current={round:rounds,index:perRound,domain:'merge_precedence_and_immutability'};
  same(sourceHashes(),beforeHashes,'audited sources did not change during execution');
}catch(error){failure={message:error.message,...(error.details||{}),stack:error.stack};}
if(digestPosition)digest.update(digestBuffer.subarray(0,digestPosition));
Object.assign(report,{finishedAt:new Date().toISOString(),elapsedMs:Math.round(performance.now()-startTime),completedCases:completed,assertions:checks,counts,checkCounts,coverage,conditionDigestSHA256:digest.digest('hex'),conditionDigestBytes:conditionBytes,failedCases:failure?1:0,completedRounds:roundResults.length,status:failure?'failed':'passed',failure,endingSourceHashes:sourceHashes()});
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,cases:completed,assertions:checks,elapsedMs:report.elapsedMs,output}));
if(failure){console.error(JSON.stringify(failure));process.exitCode=1;}
