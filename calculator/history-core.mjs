export const HISTORY_RANKS=['S6','S5','S4','S3','S2','S1','A3','A2','A1','B3','B2','B1','C3','C2','C1','D3','D2','D1','E'];
export const HISTORY_CLOSES=['13','22','24'];
export const HISTORY_RESPONSE_MAX_BYTES=8*1024*1024;
// Count bytes delivered by Fetch (after content decoding), before UTF-8 decoding.
// Content-Length alone cannot bound a compressed or incorrectly declared body.
export async function readHistoryResponse(response,signal){
 const body=response?.body;
 let reader=null,cancelled=false,rejectRead=null;
 const abortError=()=>Object.assign(new Error('記録の取得を中断しました。'),{name:'AbortError'});
 const cancel=()=>{
  if(cancelled)return;cancelled=true;
  // Cancellation must not delay rejection if a stream's cancel never settles.
  try{Promise.resolve(reader?reader.cancel():body?.cancel?.()).catch(()=>{});}catch{}
 };
 const onAbort=()=>{cancel();rejectRead?.(abortError());};
 try{
  if(signal?.aborted)throw abortError();
  const length=response?.headers?.get('content-length');
  if(typeof length==='string'&&/^\d+$/.test(length.trim())&&Number(length)>HISTORY_RESPONSE_MAX_BYTES)throw new RangeError('取得する記録が大きすぎます。');
  if(body===null)return '';
  // A text()/arrayBuffer() fallback would allocate an unbounded response first.
  if(!body||typeof body.getReader!=='function')throw new TypeError('この環境では記録を安全に取得できません。');
  reader=body.getReader();
  signal?.addEventListener('abort',onAbort,{once:true});
  const decoder=new TextDecoder('utf-8',{fatal:true}),parts=[];
  let received=0,pending='';
  while(true){
   if(signal?.aborted)throw abortError();
   // One abort listener and one pending reject avoid retaining a Promise.race
   // subscription for every chunk until a long response completes.
   const packet=await new Promise((resolve,reject)=>{
    rejectRead=reject;
    try{Promise.resolve(reader.read()).then(resolve,reject);}catch(error){reject(error);}
   });
   rejectRead=null;
   if(signal?.aborted)throw abortError();
   if(packet.done)break;
   const chunk=packet.value;
   if(!ArrayBuffer.isView(chunk)||chunk.BYTES_PER_ELEMENT!==1)throw new TypeError('取得した記録の形式が正しくありません。');
   if(chunk.byteLength>HISTORY_RESPONSE_MAX_BYTES-received)throw new RangeError('取得する記録が大きすぎます。');
   received+=chunk.byteLength;
   pending+=decoder.decode(chunk,{stream:true});
   // Bound the number of retained string fragments for very small chunks.
   if(pending.length>=65536){parts.push(pending);pending='';}
  }
  parts.push(pending+decoder.decode());
  return parts.join('');
 }catch(error){cancel();throw error;}
 finally{
  rejectRead=null;
  signal?.removeEventListener('abort',onAbort);
  try{reader?.releaseLock();}catch{}
 }
}
const MAX=Math.floor(Number.MAX_SAFE_INTEGER/25);
const PERSONAL_HISTORY_ORIGINS=['manual','import','backup','saved','e-display'];
export const isObject=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function validHistoryDate(v){return typeof v==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;}
export function validHistoryTriple(v){return Array.isArray(v)&&v.length===3&&v.every(x=>Number.isSafeInteger(x)&&x>=0&&x<=MAX)&&v[0]<=v[1]&&v[1]<=v[2];}
export function historySource(v){if(typeof v!=='string')return '';try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&u.hostname==='one-carat.com'&&/^\/campus\/archives\/\d+$/.test(u.pathname)&&!u.search&&!u.hash?u.href:'';}catch{return '';}}
export function normalizeHistoryRows(rows,origin='archive'){
 if(!Array.isArray(rows)||rows.length>5000)throw Error('記録の件数・形式が正しくありません。');
 return rows.flatMap(row=>{
  if(!isObject(row)||!validHistoryDate(row.date)||!HISTORY_CLOSES.includes(String(row.close))||!isObject(row.ranks))return [];
  return Object.entries(row.ranks).flatMap(([rank,values])=>HISTORY_RANKS.includes(rank)&&validHistoryTriple(values)?[{date:row.date,close:String(row.close),rank,values:values.slice(),origin,source:historySource(row.sourceURL),checkedAt:typeof row.checkedAt==='string'?row.checkedAt.slice(0,40):''}]:[]);
 });
}
export function localHistoryRows(raw){
 if(typeof raw!=='string'||raw.length>8*1024*1024)return [];
 let state;try{state=JSON.parse(raw);}catch{return [];}
 if(!isObject(state))return [];
 const rows=[];const packed=state.provenancePacked;
 for(const close of HISTORY_CLOSES){const log=state[{13:'log13',22:'log',24:'log24'}[close]];if(!isObject(log))continue;
  for(const [date,ranks] of Object.entries(log)){if(!validHistoryDate(date)||!isObject(ranks))continue;
   for(const [rank,values] of Object.entries(ranks)){if(!HISTORY_RANKS.includes(rank)||!validHistoryTriple(values))continue;
    let meta=state.provenance?.[close]?.[date]?.[rank];
    const ref=packed?.version===1?packed.refs?.[close]?.[date]?.[rank]:undefined;
    if(Number.isSafeInteger(ref)&&ref>=0&&Array.isArray(packed.pool)&&isObject(packed.pool[ref]))meta=packed.pool[ref];
    const origin=isObject(meta)&&['manual','import','backup','legacy','verified','remote','saved'].includes(meta.origin)?meta.origin:'saved';
    rows.push({date,close,rank,values:values.slice(),origin,source:historySource(meta?.source),checkedAt:typeof meta?.checkedAt==='string'?meta.checkedAt.slice(0,40):''});
   }
  }
 }
 return rows;
}
export function mergeHistoryRows(seed,local=[],live=[]){
 const byKey=new Map();for(const row of seed)byKey.set(row.date+'|'+row.close+'|'+row.rank,row);
 for(const row of local)byKey.set(row.date+'|'+row.close+'|'+row.rank,row);
 for(const row of live){const key=row.date+'|'+row.close+'|'+row.rank,old=byKey.get(key);if(!old||['archive','legacy','verified','remote'].includes(old.origin))byKey.set(key,row);}
 return [...byKey.values()];
}
export function createHistoryIndex(rows){
 const buckets=new Map();for(const row of rows){for(const key of ['|',row.close+'|','|'+row.rank,row.close+'|'+row.rank]){if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(row);}}
 for(const bucket of buckets.values())bucket.sort((a,b)=>b.date.localeCompare(a.date)||Number(a.close)-Number(b.close)||HISTORY_RANKS.indexOf(a.rank)-HISTORY_RANKS.indexOf(b.rank));
 return {rows,buckets};
}
export function historyMonthRange(month,delta=0){if(typeof month!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)||!Number.isInteger(delta)||Math.abs(delta)>1200)return null;
 const date=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7))-1+delta,1));const start=date.toISOString().slice(0,10);date.setUTCMonth(date.getUTCMonth()+1);date.setUTCDate(0);const end=date.toISOString().slice(0,10);return validHistoryDate(start)&&validHistoryDate(end)?{month:start.slice(0,7),start,end}:null;
}
export function historyCalendarMonth(month){
 const range=historyMonthRange(month);if(!range)return null;
 const weekday=new Date(range.start+'T00:00:00Z').getUTCDay(),days=Number(range.end.slice(8)),cells=Array(weekday).fill(null);
 for(let day=1;day<=days;day++)cells.push(range.month+'-'+String(day).padStart(2,'0'));
 while(cells.length%7)cells.push(null);
 return {...range,cells};
}
// Date shortcuts clear the current range and keyword; retain the same rank,
// cutoff and origin scope used for calendar record markers.
function historyNavigationRows(index,filters={}){if(!isObject(filters))return [];return filterHistory(index,{close:filters.close??'',rank:filters.rank??'',origin:filters.origin??''}).rows;}
export function historyRecordDates(index,filters={}){return [...new Set(historyNavigationRows(index,filters).map(row=>row.date))];}
export function latestHistoryDate(index,filters={}){return historyNavigationRows(index,filters)[0]?.date||null;}
export function adjacentHistoryDate(index,filters,date,direction){if(!validHistoryDate(date)||![-1,1].includes(direction))return null;const dates=historyRecordDates(index,filters);return (direction===-1?dates.find(value=>value<date):dates.reverse().find(value=>value>date))||null;}
export function historyRecordNavigation(index,filters={}){
 const dates=historyRecordDates(index,filters),latest=dates[0]||null,anchor=validHistoryDate(filters?.end)?filters.end:validHistoryDate(filters?.start)?filters.start:latest;
 return {latest,previous:dates.find(date=>date<anchor)||null,next:dates.slice().reverse().find(date=>date>anchor)||null,anchor,count:dates.length};
}
export function recentHistoryRange(index,filters,days){if(![7,30].includes(days))return null;const end=latestHistoryDate(index,filters);if(!end)return null;const date=new Date(end+'T00:00:00Z');date.setUTCDate(date.getUTCDate()-days+1);const start=date.toISOString().slice(0,10);return {start:start<'2000-01-01'?'2000-01-01':start,end};}
export function normalizeHistoryQuery(q){return String(q||'').normalize('NFKC').trim().slice(0,100).replace(/(20\d{2})[\/年-](\d{1,2})[\/月-](\d{1,2})日?/g,(_,y,m,d)=>`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`).replace(/(^|\s)(20\d{2})[\/年-](\d{1,2})月?(?=\s|$)/g,(_,space,y,m)=>`${space}${y}-${m.padStart(2,'0')}`).toUpperCase();}
export function filterHistory(index,filters={}){
 const {start='',end='',close='',rank='',order='new',origin=''}=filters;
 if(start&&!validHistoryDate(start)||end&&!validHistoryDate(end)||start&&end&&start>end)return {rows:[],error:'開始日・終了日を正しい順序で指定してください。'};
 if(close&&!HISTORY_CLOSES.includes(close)||rank&&!HISTORY_RANKS.includes(rank)||!['new','old'].includes(order)||origin&&!['personal','published'].includes(origin))return {rows:[],error:'検索条件が正しくありません。'};
 const tokens=normalizeHistoryQuery(filters.query).split(/\s+/).filter(Boolean),bucket=index.buckets.get(close+'|'+rank)||[];
 const rows=bucket.filter(row=>(!start||row.date>=start)&&(!end||row.date<=end)&&(!origin||(origin==='personal'?PERSONAL_HISTORY_ORIGINS.includes(row.origin):!PERSONAL_HISTORY_ORIGINS.includes(row.origin)))&&tokens.every(token=>{
  if(/^20\d{2}-\d{2}$/.test(token))return row.date.slice(0,7)===token;
  if(HISTORY_RANKS.includes(token))return row.rank===token;
  if(/^(13|22|24)時(?:〆|締め)?$/.test(token))return row.close===token.slice(0,2);
  const text=[row.date,row.date.replaceAll('-','/'),row.date.slice(0,7),row.rank,row.close+'時',...row.values.map(String),...(row.displayValues||[])].join(' ').toUpperCase();return text.includes(token);
 }));
 return {rows:order==='old'?rows.slice().sort((a,b)=>a.date.localeCompare(b.date)||Number(a.close)-Number(b.close)||HISTORY_RANKS.indexOf(a.rank)-HISTORY_RANKS.indexOf(b.rank)):rows,error:''};
}
export function historyPage(rows,page=1,size=30){if(!Number.isInteger(size)||size<1||size>100)size=30;const pages=Math.max(1,Math.ceil(rows.length/size));page=Number.isInteger(page)?Math.min(pages,Math.max(1,page)):1;return {rows:rows.slice((page-1)*size,page*size),page,pages,total:rows.length};}
export function historyNumber(value,units='pt'){if(!Number.isSafeInteger(value)||value<0)return '—';if(units==='K'){const remainder=value%1000,rounded=(value-remainder)/1000+(remainder>=500?1:0);return rounded.toLocaleString('ja-JP')+'K';}return value.toLocaleString('ja-JP');}
export function historyRowNumber(row,i,units='pt'){return row.displayValues?String(row.displayValues[i]):historyNumber(row.values[i],units);}
export function historyOriginLabel(origin){return {archive:'掲載資料',verified:'掲載資料',remote:'取得記録',manual:'手入力',import:'CSV・貼り付け',backup:'バックアップ',saved:'端末保存',legacy:'旧版参考値','e-display':'E帯画像の画面表示値（概数）'}[origin]||'出典未確認';}
export function historyCardText(row,units='pt'){
 const suffix=units==='K'?'':' pt',checked=row.checkedAt?'確認 '+row.checkedAt.replace('T',' ').slice(0,19):'確認日時なし';
 const lines=['【過去のボーダー｜Pococha1012】',row.date.replaceAll('-','/')+' '+row.rank+' '+row.close+'時〆'];
 row.values.forEach((value,i)=>lines.push(['±0','+1','+2'][i]+'：'+historyRowNumber(row,i,units)+(row.displayValues?'（画面表示値・概数）':suffix)));
 lines.push('記録：'+historyOriginLabel(row.origin)+' · '+checked);
 if(row.source)lines.push('出典：'+row.source);
 return lines.join('\n');
}

export const METER_CALENDAR_RANKS=HISTORY_RANKS.slice();
export function historyMeterCalendar(index,filters,month){
 const calendar=historyCalendarMonth(month);if(!calendar)return null;
 const scope={rank:filters?.rank||'',close:filters?.close||'',origin:filters?.origin||''};
 if(scope.rank&&!METER_CALENDAR_RANKS.includes(scope.rank)||scope.close&&!HISTORY_CLOSES.includes(scope.close)||!['','personal','published'].includes(scope.origin))return null;
 const rows=index.rows.filter(row=>row.date>=calendar.start&&row.date<=calendar.end&&(!scope.rank||row.rank===scope.rank)&&(!scope.close||row.close===scope.close)&&(!scope.origin||(scope.origin==='personal'?PERSONAL_HISTORY_ORIGINS.includes(row.origin)||row.origin==='e-display':!PERSONAL_HISTORY_ORIGINS.includes(row.origin)&&row.origin!=='e-display')));
 const ranks=scope.rank?[scope.rank]:METER_CALENDAR_RANKS,closes=scope.close?[scope.close]:HISTORY_CLOSES,byKey=new Map();for(const row of rows){const key=row.rank+'|'+row.date+'|'+row.close;if(!byKey.has(key))byKey.set(key,[]);byKey.get(key).push(row);}
 return {...calendar,count:rows.length,closes,ranks:ranks.map(rank=>({rank,count:rows.filter(row=>row.rank===rank).length,cells:calendar.cells.map(date=>date?{date,records:closes.flatMap(close=>{const matches=byKey.get(rank+'|'+date+'|'+close)||[];return matches.length?matches.map(row=>({close,row,conflict:matches.length>1})):[{close,row:null}];})}:null)}))};
}
