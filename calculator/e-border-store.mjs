import {E_SCHEMA,E_MAX,E_SEEDS,eDate,eCoverage,eYesterday,eKey,eRow,eMerge,eBackup} from './e-border-core.mjs';
export const E_KEY='pococha-e-display-v1',E_DRAFT_KEY=E_KEY+'-drafts',E_RECOVERY_KEY=E_KEY+'-previous';
export function eState(raw){
 if(raw===null)return {records:eMerge([],E_SEEDS).rows,hiddenSeeds:[],trash:[],lastChangedAt:''};
 if(typeof raw!=='string'||raw.length>2000000)throw Error('保存データのサイズを確認してください。');
 let b;try{b=JSON.parse(raw.replace(/^\uFEFF/,''));}catch{throw Error('保存データが壊れている可能性があります。復元用コピーかバックアップを確認してください。');}
 const rows=eBackup(raw),seedKeys=new Set(E_SEEDS.map(eKey)),hidden=b.hiddenSeeds??[],trash=b.trash??[];
 if(!Array.isArray(hidden)||hidden.length>10||hidden.some(k=>typeof k!=='string'||!seedKeys.has(k))||new Set(hidden).size!==hidden.length)throw Error('初期記録の削除情報を確認できません。');
 if(!Array.isArray(trash)||trash.length>100)throw Error('ごみ箱の形式を確認できません。');
 if(new Set(trash.map(t=>t?.row&&eKey(t.row))).size!==trash.length)throw Error('ごみ箱内で同じ条件の記録が重複しています。');
 const cleanTrash=trash.map(t=>{if(!t||typeof t!=='object'||typeof t.removedAt!=='string'||!Number.isFinite(Date.parse(t.removedAt)))throw Error('ごみ箱の日時を確認できません。');return {row:eRow(t.row),removedAt:t.removedAt};});
 const lastChangedAt=typeof b.lastChangedAt==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(b.lastChangedAt)&&Number.isFinite(Date.parse(b.lastChangedAt))&&b.lastChangedAt.length<40?b.lastChangedAt:'';
 return {records:eMerge(E_SEEDS.filter(r=>!hidden.includes(eKey(r))),rows,true).rows,hiddenSeeds:hidden.slice(),trash:cleanTrash,lastChangedAt};
}
export function eEncode(state){
 const encoded=JSON.stringify({schema:E_SCHEMA,formatVersion:2,records:state.records,hiddenSeeds:state.hiddenSeeds,trash:state.trash,lastChangedAt:state.lastChangedAt});
 const clean=eState(encoded);return JSON.stringify({schema:E_SCHEMA,formatVersion:2,...clean});
}
export function eWrite(storage,state,expected,{preserveRecovery=false}={}){
 const current=storage.getItem(E_KEY);if(current!==expected)throw Error('別の画面で記録が変わりました。「最新の保存内容を読み込む」で再確認してください。');
 let previous;try{previous=eState(current);}catch{if(!preserveRecovery)throw Error('現在の保存内容を読み込めないため上書きを停止しました。復旧欄を確認してください。');}
 const content=s=>eEncode({...s,lastChangedAt:''});
 if(previous&&content(previous)===content(state))return {raw:current,state:previous,recoverySaved:true,unchanged:true};
 const raw=eEncode({...state,lastChangedAt:new Date().toISOString()});let recoverySaved=true;
 if(!preserveRecovery){try{const previous=current??eEncode(eState(null));storage.setItem(E_RECOVERY_KEY,previous);if(storage.getItem(E_RECOVERY_KEY)!==previous)recoverySaved=false;}catch{recoverySaved=false;}}
 storage.setItem(E_KEY,raw);
 if(storage.getItem(E_KEY)!==raw)throw Error('保存後の確認に失敗しました。下書きを残しているため、最新内容を読み込んで確認してください。');
 return {raw,state:eState(raw),recoverySaved};
}
export function eRemove(state,key,now=new Date().toISOString()){
 const row=state.records.find(r=>eKey(r)===key);if(!row)throw Error('対象の記録が見つかりません。');
 const hidden=new Set(state.hiddenSeeds);if(E_SEEDS.some(r=>eKey(r)===key))hidden.add(key);
 return {...state,records:state.records.filter(r=>eKey(r)!==key),hiddenSeeds:[...hidden],trash:[{row,removedAt:now},...state.trash.filter(t=>eKey(t.row)!==key)].slice(0,100)};
}
export function eArchive(state,rows,now=new Date().toISOString()){
 let trash=state.trash.slice();for(const r of rows){const row=eRow(r);trash=[{row,removedAt:now},...trash.filter(t=>eKey(t.row)!==eKey(row))];}
 return {...state,trash:trash.slice(0,100)};
}
export function eMergeState(state,incoming,replace=false){
 const result=eMerge(state.records,incoming,replace),current=new Map(state.records.map(r=>[eKey(r),r])),overwritten=[];
 for(const row of result.rows){const old=current.get(eKey(row));if(old&&JSON.stringify(old.values)!==JSON.stringify(row.values))overwritten.push(old);}
 return {...result,state:{...eArchive(state,overwritten),records:result.rows}};
}
export function eRestoreTrash(state,key,replace=false){
 const item=state.trash.find(t=>eKey(t.row)===key);if(!item)throw Error('復元する記録がありません。');
 return eMergeState({...state,trash:state.trash.filter(t=>eKey(t.row)!==key)},[item.row],replace).state;
}
export const E_FILTER_KEY=E_KEY+'-filters';
export function eFilterPrefs(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('検索条件の形式を確認してください。');
 const defaults={rank:'',close:'',month:'',start:'',end:'',order:'new',approx:false},f={};for(const k of Object.keys(defaults))f[k]=value[k]??defaults[k];
 if(!['','E','E1','E2','E3'].includes(f.rank)||!['','13','22','24'].includes(f.close)||!['new','old'].includes(f.order)||typeof f.approx!=='boolean'||typeof f.month!=='string'||(f.month&&!/^20\d{2}-(0[1-9]|1[0-2])$/.test(f.month))||typeof f.start!=='string'||typeof f.end!=='string'||(f.start&&!eDate(f.start))||(f.end&&!eDate(f.end))||(f.start&&f.end&&f.start>f.end))throw Error('検索条件の日付・ランク・締め時間を確認してください。');
 if(f.rank)f.rank='E';return f;
}
export function eDraftEncode(rows){
 if(!Array.isArray(rows)||rows.length>100)throw Error('下書きは100件までです。');
 const drafts=rows.map(r=>{if(!r||(r.pending!==undefined&&typeof r.pending!=='boolean')||!Array.isArray(r.values)||r.values.length!==3)throw Error('下書きの形式を確認してください。');const text=v=>{if(typeof v!=='string'||v.length>40)throw Error('下書きの入力は各項目40文字以下の文字列にしてください。');return v;};return {date:text(r.date),rank:text(r.rank),close:text(r.close),values:r.values.map(text),pending:r.pending===true,...(r.original?{original:eRow(r.original)}:{})};});
 return JSON.stringify({schema:'pococha-e-drafts-v1',drafts});
}
export function eDraftDecode(raw){if(typeof raw!=='string'||raw.length>100000)throw Error('下書きを読み込めません。');let b;try{b=JSON.parse(raw);}catch{throw Error('下書きを読み込めません。');}if(!b||b.schema!=='pococha-e-drafts-v1')throw Error('下書きの形式を確認してください。');return JSON.parse(eDraftEncode(b.drafts)).drafts;}

export function eDraftWrite(storage,rows,expected){
 const current=storage.getItem(E_DRAFT_KEY);if(current!==expected)throw Error('別の画面で下書きが変わりました。この画面の下書きをファイル保存してから、画面を開き直してください。');
 const raw=rows.length?eDraftEncode(rows):null;
 if(raw!==current){if(raw===null)storage.removeItem(E_DRAFT_KEY);else storage.setItem(E_DRAFT_KEY,raw);}
 if(storage.getItem(E_DRAFT_KEY)!==raw)throw Error('下書きの保存後の確認に失敗しました。この画面の下書きをファイル保存してください。');
 return raw;
}

export function eDraftPlan(existing,incoming,occupied=existing.length){
 const old=JSON.parse(eDraftEncode(existing)).drafts,next=JSON.parse(eDraftEncode(incoming)).drafts;
 if(!Number.isInteger(occupied)||occupied<old.length||occupied>100)throw Error('候補数を確認してください。');
 const seen=new Set(old.map(r=>JSON.stringify(r))),rows=[];let duplicates=0;
 for(const row of next){const key=JSON.stringify(row);if(seen.has(key)){duplicates++;continue;}seen.add(key);rows.push(row);}
 if(occupied+rows.length>100)throw Error('候補が多すぎます。先に保存してから取り込んでください。');
 return {rows,duplicates};
}

export function eMissingDrafts(records,pending,rank,close,occupied=pending.length,end=eYesterday()){
 if(!Array.isArray(records)||!Array.isArray(pending)||!Number.isInteger(occupied)||occupied<0||occupied>100)throw Error('候補数を確認してください。');
 const waiting=new Set(pending.map(eKey)),coverage=eCoverage(records,rank,close,end),rows=coverage.missing.filter(date=>!waiting.has(eKey({date,rank,close}))).map(date=>({date,rank,close,values:['','','']}));
 if(occupied+rows.length>100)throw Error('候補の空きが不足しています。先に保存するか、未記録の日付を1日ずつ選んでください。');
 return {rows,queued:coverage.missing.length-rows.length};
}

// Explicit device-local reset: retain every other rank and setting.
export function eEraseAll(storage){
 const key='pococha-meter-calc-v1',keys=[E_KEY,E_DRAFT_KEY,E_RECOVERY_KEY,key,key+'-drafts'],before=new Map(keys.map(k=>[k,storage.getItem(k)])),after=new Map(before);
 const empty={records:[],hiddenSeeds:E_SEEDS.map(eKey),trash:[],lastChangedAt:new Date().toISOString()};
 after.set(E_KEY,eEncode(empty));after.set(E_DRAFT_KEY,null);after.set(E_RECOVERY_KEY,null);
 if(before.get(key)!==null){const main=JSON.parse(before.get(key));if(!main||typeof main!=='object'||Array.isArray(main))throw Error('計算機の保存内容を確認してください。');for(const log of ['log','log13','log24'])for(const day of Object.values(main[log]||{}))for(const rank of Object.keys(day||{}))if(/^E(?:[123])?$/.test(rank))delete day[rank];if(main.rank==='E'&&main.pick!==''){main.target='';main.targetOrigin=null;}after.set(key,JSON.stringify(main));}
 const draftKey=key+'-drafts';if(before.get(draftKey)!==null){const d=JSON.parse(before.get(draftKey));for(const k of Object.keys(d?.drafts||{}))if(/^(13|22|24)\|E(?:[123])?\|/.test(k))delete d.drafts[k];if(/^(13|22|24)\|E(?:[123])?\|/.test(d?.lastKey||''))d.lastKey='';after.set(draftKey,JSON.stringify(d));}
 const put=(k,v)=>v===null?storage.removeItem(k):storage.setItem(k,v);
 try{for(const [k,v]of after){if(storage.getItem(k)!==before.get(k))throw Error('別の画面で変更されました。開き直してください。');put(k,v);if(storage.getItem(k)!==v)throw Error('削除後の保存確認に失敗しました。');}}catch(e){for(const [k,v]of before)try{put(k,v);}catch{}throw e;}
 return eState(after.get(E_KEY));
}
