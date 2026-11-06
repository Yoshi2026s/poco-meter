export const E_SCHEMA='pococha-e-display-v1';
export const E_MAX=3000;
// Legacy sublabels remain readable as storage identities; user-facing rank is E.
export const eRankLabel=rank=>/^E(?:[123])?$/.test(rank)?'E':rank;
export const E_SEEDS=[['2026-09-04','244','1.8K','4.8K'],['2026-09-08','258','1.7K','4.7K'],['2026-09-09','272','1.9K','5.0K'],['2026-09-13','363','2.4K','7.2K'],['2026-09-19','251','2.0K','5.7K'],['2026-09-22','260','1.6K','4.5K'],['2026-09-23','237','1.4K','3.4K'],['2026-09-24','243','1.5K','3.9K'],['2026-09-28','245','1.6K','4.9K'],['2026-10-05','235','1.6K','5.1K']].map(([date,...values])=>({date,rank:'E1',close:'24',values,source:'提供画像・目視確認',precision:'display'}));
export const eToday=(now=Date.now())=>new Date(now+9*3600000).toISOString().slice(0,10);
export function eDate(s){return typeof s==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}
export function eShift(date,days){if(!eDate(date)||!Number.isInteger(days)||Math.abs(days)>36600)throw Error('日付の範囲を確認してください。');const d=new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);if(!eDate(d))throw Error('日付の範囲外です。');return d;}
export const eYesterday=()=>eShift(eToday(),-1);
export function eValue(value){
 if(typeof value!=='string'&&typeof value!=='number')throw Error('数値は画面の表記どおりに入力してください。');
 let s=String(value).normalize('NFKC').trim().toUpperCase();
 if(s.length>40)throw Error('数値が長すぎます。');
 s=s.replace(/\s*[〜～~]\s*$/,'').trim();
 if(s.includes(',')&&!/^\d{1,3}(?:,\d{3})+$/.test(s))throw Error('カンマ区切りを確認してください。');
 s=s.replace(/,/g,'');
 if(!/^(?:\d{1,10}|\d{1,7}(?:\.\d{1,3})?[KM])$/.test(s))throw Error('235、1.6Kなど画面の表記で入力してください。');
 const unit=s.endsWith('K')?1000n:s.endsWith('M')?1000000n:1n,[whole,fraction='']=s.replace(/[KM]$/,'').split('.'),denominator=10n**BigInt(fraction.length);
 const n=Number((BigInt(whole)*denominator+BigInt(fraction||'0'))*unit/denominator);
 if(!(n>0&&n<=1e9&&Number.isFinite(n)))throw Error('数値の範囲を確認してください。');
 return {text:s,n,approx:/[KM]$/.test(s)};
}
export function eRow(row){
 if(!row||typeof row!=='object'||!eDate(row.date)||!/^E(?:[123])?$/.test(row.rank)||!['13','22','24'].includes(row.close)||!Array.isArray(row.values)||row.values.length!==3)throw Error('日付・E帯・締め時間・3つの値を確認してください。');
 if(row.pending!==undefined&&typeof row.pending!=='boolean')throw Error('集計状態の形式を確認してください。');
 if(row.pending===true)throw Error('集計中の画面は確定記録として保存できません。');
 if(row.precision!==undefined&&row.precision!=='display')throw Error('この画面では画面表示値だけを取り込みます。');
 const v=row.values.map(eValue);
 if(v[0].n>v[1].n||v[1].n>v[2].n)throw Error('±0 ≦ ＋1 ≦ ＋2の順になるか、画像を確認してください。');
 if(row.date>=eToday())throw Error('対象日は昨日以前を選んでください。');
 const source=['提供画像・目視確認','バックアップ（未再照合）','CSV取込（未再照合）'].includes(row.source)?row.source:'端末で確認した画面表示値';
 return {date:row.date,rank:row.rank,close:row.close,values:v.map(x=>x.text),source,precision:'display'};
}
export const eKey=r=>[r.date,r.rank,r.close].join('|');
export const eSort=rows=>rows.slice().sort((a,b)=>b.date.localeCompare(a.date)||a.rank.localeCompare(b.rank)||Number(a.close)-Number(b.close));
export function eMerge(existing,incoming,replace=false){
 if(!Array.isArray(existing)||!Array.isArray(incoming)||existing.length>E_MAX||incoming.length>E_MAX)throw Error('保存上限3000件です。');
 const map=new Map(),batch=new Map();let added=0,same=0,replaced=0;
 for(const r of existing){const v=eRow(r),k=eKey(v);if(map.has(k)&&JSON.stringify(map.get(k).values)!==JSON.stringify(v.values))throw Error('保存済みの同じ記録に相違があります。');map.set(k,v);}
 for(const r of incoming){const v=eRow(r),k=eKey(v);if(batch.has(k)&&JSON.stringify(batch.get(k).values)!==JSON.stringify(v.values))throw Error('取込内で同じ日・ランク・締めの値が食い違います。');batch.set(k,v);}
 for(const [k,v]of batch){const old=map.get(k);if(old&&JSON.stringify(old.values)===JSON.stringify(v.values)){same++;continue;}if(old&&!replace)throw Error(v.date+' '+eRankLabel(v.rank)+' '+v.close+'時：保存済みと異なります。確認後に「相違を置換」を選んでください。');if(old)replaced++;else added++;map.set(k,v);}
 if(map.size>E_MAX)throw Error('保存上限3000件です。バックアップを保存して記録を整理してください。');
 return {rows:eSort([...map.values()]),added,same,replaced};
}
export function eOCRRank(text){
 const rt=String(text).normalize('NFKC').toUpperCase(),ranks=[...rt.matchAll(/\b(E(?:\s*[123])?|[DCBA]\s*[123]|S\s*[1-6])\b/g)];
 return ranks.length===1?eRankLabel(ranks[0][1].replace(/\s/g,'')):'';
}
export function eParseOCR(header,rankText,borderText){
 const h=String(header).normalize('NFKC').replace(/\s/g,''),bt=String(borderText).normalize('NFKC');
 const dates=[...h.matchAll(/(20\d{2})(?:年|[\/.-])(\d{1,2})(?:月|[\/.-])(\d{1,2})(?:日)?/g)].map(d=>[d[1],d[2].padStart(2,'0'),d[3].padStart(2,'0')].join('-'));
 const explicit=[...h.matchAll(/(?:締め時間|締め時刻|締切時間|締切|締め|〆時間|〆)(?:[:：])?(13|22|24|00)(?::00|時)/g),...h.matchAll(/(13|22|24|00)(?::00|時)(?:締め|〆)/g)].map(m=>m[1]==='00'?'24':m[1]);
 const endings=[...h.matchAll(/(12|21|23):59(?::59)?/g)].map(m=>({'12':'13','21':'22','23':'24'})[m[1]]);
 const marked=[...new Set(explicit)],ended=[...new Set(endings)];
 let close=marked.length===1?marked[0]:!marked.length&&ended.length===1?ended[0]:'';
 if(ended.length>1||marked.length>1||close&&ended.length===1&&close!==ended[0])close='';
 const issues=[];let date=dates.at(-1)||'';
 if(!dates.every(eDate)||dates.length>2||dates.length===2&&(dates[1]<dates[0]||Date.parse(dates[1])-Date.parse(dates[0])>86400000))date='';
 if(['13','22'].includes(close)&&dates.length!==2)date='';
 if(close==='24'&&dates.length===2&&dates[0]!==dates[1])date='';
 if(dates.length===2&&['13','22'].includes(close)&&Date.parse(dates[1])-Date.parse(dates[0])!==86400000){date='';issues.push('13・22時〆は前日から翌日までの期間が必要です');}
 const period=[...h.matchAll(/(20\d{2})(?:年|[\/.-])(\d{1,2})(?:月|[\/.-])(\d{1,2})(?:日)?(\d{1,2}):(\d{2})(?::(\d{2}))?/g)];
 if(period.length===2&&close){const start=period[0],end=period[1],startHour=close==='24'?0:Number(close),endHour=startHour===0?23:startHour-1;
  if(Number(start[4])!==startHour||Number(start[5])!==0||Number(start[6]||0)!==0||Number(end[4])!==endHour||Number(end[5])!==59||end[6]!==undefined&&Number(end[6])!==59){date='';close='';issues.push('対象期間の開始・終了時刻と締め時間が一致しません');}
 }
 if(marked.length>1||ended.length>1||marked.length===1&&ended.length===1&&marked[0]!==ended[0])issues.push('締め表示と期間終了時刻が矛盾しています');
 if(!date)issues.push('対象日を画像で確認してください');if(!close)issues.push('締め時間を画像で確認してください');
 const rank=eOCRRank(rankText),basis=close?(marked.length?'締め表示':'期間終了時刻'):'';
 const labels=[/(?:±\s*0|\+\s*0)\s*([\d,]+(?:\.\d+)?\s*[KM]?)/i,/\+\s*1\s*([\d,]+(?:\.\d+)?\s*[KM]?)/i,/\+\s*2\s*([\d,]+(?:\.\d+)?\s*[KM]?)/i];
 return {date:eDate(date)?date:'',rank,close,ocr:{basis,issues,period:period.map(t=>[t[1],t[2].padStart(2,'0'),t[3].padStart(2,'0')].join('/')+' '+t[4].padStart(2,'0')+':'+t[5]+':'+(t[6]||'00'))},values:labels.map(re=>bt.match(re)?.[1]?.replace(/\s/g,'')||''),source:'端末で確認した画面表示値',precision:'display',...(/集計中/.test(h+rankText+bt)?{pending:true}:{})};
}
export function eCombineOCR(first,next){
 const out={...first,ocr:{basis:first.ocr?.basis||next.ocr?.basis||'',period:next.ocr?.period?.length?next.ocr.period:first.ocr?.period||[],issues:[...(first.ocr?.issues||[]),...(next.ocr?.issues||[])]}};
 for(const key of ['date','close']){if(first[key]&&next[key]&&first[key]!==next[key]){out[key]='';out.ocr.issues.push('再読取で'+(key==='date'?'対象日':'締め時間')+'が一致しません');}else out[key]=first[key]||next[key]||'';}
 if(out.ocr.issues.some(s=>/矛盾|開始・終了/.test(s))){out.close='';out.date='';}
 out.ocr.issues=[...new Set(out.ocr.issues)].filter(s=>!(out.date&&s==='対象日を画像で確認してください')&&!(out.close&&s==='締め時間を画像で確認してください'));
 if(first.pending||next.pending)out.pending=true;return out;
}
export function eBackup(text){
 if(typeof text!=='string'||text.length>2000000)throw Error('ファイルが大きすぎます。');
 let b;try{b=JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw Error('JSONファイルを読み取れません。');}
 if(!b||b.schema!==E_SCHEMA||!Array.isArray(b.records)||b.records.length>E_MAX)throw Error('E帯記録のバックアップを選んでください。');
 return eMerge([],b.records).rows;
}
export function eFilter(rows,f={}){
 if((f.start&&!eDate(f.start))||(f.end&&!eDate(f.end))||(f.start&&f.end&&f.start>f.end))throw Error('検索の開始日・終了日を確認してください。');
 const result=eSort(rows.filter(r=>(!f.rank||eRankLabel(r.rank)===eRankLabel(f.rank))&&(!f.close||r.close===f.close)&&(!f.month||r.date.startsWith(f.month))&&(!f.start||r.date>=f.start)&&(!f.end||r.date<=f.end)&&(!f.approx||r.values.some(v=>eValue(v).approx))));
 return f.order==='old'?result.reverse():result;
}
export function eCoverage(rows,rank,close,end=eYesterday(),days=7){
 if(!/^E(?:[123])?$/.test(rank)||!['13','22','24'].includes(close)||!eDate(end)||end>=eToday()||!Number.isInteger(days)||days<1||days>366)throw Error('記録状況の対象条件を確認してください。');
 const keys=new Set(rows.filter(r=>eRankLabel(r.rank)===eRankLabel(rank)&&r.close===close).map(r=>r.date)),dates=Array.from({length:days},(_,i)=>eShift(end,i-days+1));
 return {rank,close,start:dates[0],end,days,recorded:dates.filter(d=>keys.has(d)).length,missing:dates.filter(d=>!keys.has(d))};
}
export function eCSV(rows){return '\uFEFFdate,rank,close,zero,plus1,plus2,precision\r\n'+eSort(rows).map(r=>{const v=eRow(r);return[v.date,eRankLabel(v.rank),v.close,...v.values,'display'].join(',');}).join('\r\n');}
export function eReadCSV(text){
 if(typeof text!=='string'||text.length>2000000)throw Error('CSVは2MB以下にしてください。');
 const lines=text.replace(/^\uFEFF/,'').trim().split(/\r\n|\r|\n/);if(lines.shift()?.trim()!=='date,rank,close,zero,plus1,plus2,precision')throw Error('この画面から保存したCSVを選んでください。');
 if(lines.length>E_MAX)throw Error('取込は3000件までです。');
 const rows=lines.filter(s=>s.trim()).map((line,i)=>{const a=line.split(',').map(s=>s.trim());if(a.length!==7||a[6]!=='display')throw Error('CSV '+(i+2)+'行目の列・精度を確認してください。');return eRow({date:a[0],rank:a[1],close:a[2],values:a.slice(3,6),precision:a[6],source:'CSV取込（未再照合）'});});return eMerge([],rows).rows;
}

// Compare valid numeric reads; a disagreement must be reviewed, not guessed.
export function eOCRNumber(first,retry=null){
 const read=r=>{try{return eValue(String(r?.text??'').trim());}catch{return null;}},a=read(first),b=retry===null?null:read(retry);
 const low=r=>Number.isFinite(r?.confidence)&&r.confidence<60;
 if(a&&b&&a.n!==b.n)return {value:'',warning:'2回の数値読取が一致しません。画像を確認して入力してください。'};
 const value=a||b;if(!value)return {value:'',warning:'数値を判別できません。画像を確認して入力してください。'};
 return {value:value.text,warning:low(first)||retry!==null&&low(retry)?'OCRの確かさが低いため、画像の数値を確認してください。':!a?'再読取で数値を補完しました。画像と照合してください。':''};
}
