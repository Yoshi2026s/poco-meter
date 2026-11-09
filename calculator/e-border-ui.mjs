const $=id=>document.getElementById(id);
const PREF_KEY=E_KEY+'-preferences';
let app=eState(null),lastRaw=null,storageBlocked=false,drafts=[],visible=30,busy=false,saving=false,worker=null,runId=0,abortOCR=null,draftTimer=null,copyId=0,draftBlocked=false,lastDraftRaw=null,importId=0,lastReviewed=null;
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
function node(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function button(text,action,cls=''){const b=node('button',text,cls);b.type='button';b.addEventListener('click',action);return b;}
function readStorage(){const raw=localStorage.getItem(E_KEY),state=eState(raw);return {raw,state};}
try{lastRaw=localStorage.getItem(E_KEY);app=eState(lastRaw);}catch(e){storageBlocked=true;status('保存済みデータを読み込めないため上書きを停止しています。'+e.message,true);}
function prefs(){return {rank:$('trackRank').value,close:$('trackClose').value};}
try{const p=JSON.parse(localStorage.getItem(PREF_KEY)||'{}');if(['E','E1','E2','E3'].includes(p.rank))$('trackRank').value='E';if(['13','22','24'].includes(p.close))$('trackClose').value=p.close;}catch{}
function savePrefs(){try{localStorage.setItem(PREF_KEY,JSON.stringify(prefs()));}catch{status('手入力用の条件を端末に保存できません。記録の保存状態も確認してください。',true);}}
function filterPrefs(){return {rank:$('filterRank').value,close:$('filterClose').value,month:$('filterMonth').value,start:$('filterStart').value,end:$('filterEnd').value,order:$('filterOrder').value,approx:$('filterApprox').checked};}
function filtered(){return eFilter(app.records,filterPrefs());}
function saveFilters(){try{localStorage.setItem(E_FILTER_KEY,JSON.stringify(eFilterPrefs(filterPrefs())));}catch(e){status('検索条件を保存できません：'+e.message,true);}}
try{const raw=localStorage.getItem(E_FILTER_KEY);if(raw){const f=eFilterPrefs(JSON.parse(raw));for(const [key,id] of [['rank','filterRank'],['close','filterClose'],['month','filterMonth'],['start','filterStart'],['end','filterEnd'],['order','filterOrder']])$(id).value=f[key];$('filterApprox').checked=f.approx;}}catch{status('保存された検索条件を読み込めないため、全件表示に戻しました。記録は変更していません。',true);}
async function persist(next,{recovery=false}={}){
 if(storageBlocked&&!recovery)throw Error('保存内容を読み込めないため上書きを停止しています。「保存データの復旧」を確認してください。');
 if(saving)throw Error('保存中です。完了してから操作してください。');saving=true;toggleBusy();
 try{
  const write=()=>eWrite(localStorage,next,lastRaw,{preserveRecovery:recovery});
  const result=typeof navigator.locks?.request==='function'?await navigator.locks.request(E_KEY,{mode:'exclusive'},write):write();
  lastRaw=result.raw;app=result.state;storageBlocked=false;
  return result.unchanged?' 保存内容に変更はありません。保存前のコピーは更新していません。':result.recoverySaved?'':' 復元用コピーは作成できませんでした。バックアップを保存してください。';
 }finally{saving=false;toggleBusy();}
}
function toggleBusy(){const locked=busy||saving;for(const id of ['chooseImages','images','manual','fillMissing','nextDraft','chooseRestore','restore','save','discard','reload','recover'])$(id).disabled=locked;$('cancel').hidden=!busy;$('ocrProgress').hidden=!busy;$('review').setAttribute('aria-busy',String(saving));}
function render(){
 const selected=prefs();let coverage;
 try{coverage=eCoverage(app.records,selected.rank,selected.close);}catch(e){status(e.message,true);return;}
 $('coverage').textContent=selected.close+'時締め・直近7日：'+coverage.recorded+'日分を記録';
 const matching=eFilter(app.records,selected),latest=matching[0];$('latest').textContent=(latest?'最新記録：'+latest.date:'この条件の記録はまだありません。')+' ／ '+coverage.start+'〜'+coverage.end;
 $('gaps').replaceChildren();for(const d of coverage.missing)$('gaps').append(button(d.slice(5).replace('-','/')+' 未記録',()=>{if(busy||saving)return status('処理完了後に入力してください。',true);const item=addDraft({date:d,...selected,values:['','','']});item?.box.scrollIntoView({block:'start'});}));
 if(!coverage.missing.length)$('gaps').append(node('span','直近7日分がそろっています。','badge'));
 $('storageSummary').textContent='全記録 '+app.records.length+' / '+E_MAX+'件 ／ '+['13','22','24'].map(c=>c+'時〆 '+app.records.filter(r=>r.close===c).length+'件').join(' ／ ')+(app.lastChangedAt?' · 最終保存 '+new Date(app.lastChangedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',hour12:false}):' · 追加記録は未保存')+(storageBlocked?' · 保存停止中':'');
 let list;try{list=filtered();}catch(e){$('filterSummary').textContent=e.message;$('records').replaceChildren();$('more').hidden=true;$('count').textContent='条件を確認';return;}
 const closes=filterPrefs().close?[filterPrefs().close]:['13','22','24'],shown=closes.reduce((n,c)=>n+Math.min(visible,list.filter(r=>r.close===c).length),0);
 $('count').textContent=list.length+'件';$('filterSummary').textContent=shown+'件を表示中（締め時間ごとに最大'+visible+'件）。コピー・CSVには検索結果の全件を含みます。';
 $('records').replaceChildren();for(const close of closes){
  const rows=list.filter(r=>r.close===close),saved=app.records.filter(r=>r.close===close),group=node('section',undefined,'close-group');group.setAttribute('data-close',close);group.append(node('h3',close+'時〆 · '+rows.length+'件'));
  group.append(node('p','保存済み全 '+saved.length+'件'+(saved.length?' ／ 最新 '+saved.map(r=>r.date).sort().at(-1):''),'small'));
  if(!rows.length)group.append(node('p',saved.length?'この表示条件ではデータ無し。日付などの絞り込みを確認してください。':'データ無し','note'));
  for(const r of rows.slice(0,visible)){
  const box=node('article',undefined,'record');box.append(node('strong',r.date+' · '+eRankLabel(r.rank)+' · '+r.close+'時締め'));
  const values=node('div',undefined,'values');r.values.forEach((v,i)=>{const col=node('span',['±0','＋1','＋2'][i]);col.append(node('b',v));values.append(col);});box.append(values,node('div',r.source+'／画面表示値'+(r.values.some(v=>eValue(v).approx)?'（K・Mは概数）':''),'small'));
  const actions=node('div',undefined,'actions');actions.append(button('編集',()=>{if(busy||saving)return status('処理完了後に編集してください。',true);if(drafts.some(d=>d.original&&eKey(d.original)===eKey(r)))return status('この記録はすでに編集候補にあります。',true);addDraft({...r,source:'端末で確認した画面表示値'},null,{original:r});}),button('コピペ',()=>copyText(recordText([r]))),button('削除',async()=>{if(busy||saving)return status('処理完了後に削除してください。',true);if(!confirm(r.date+' '+eRankLabel(r.rank)+' '+r.close+'時の記録をごみ箱へ移しますか？'))return;try{const warning=await persist(eRemove(app,eKey(r)));render();status('ごみ箱へ移しました。ごみ箱から取り消せます。'+warning);}catch(e){status('削除できません：'+e.message,true);}},'danger'));box.append(actions);group.append(box);
  }$('records').append(group);
 }
 $('more').hidden=closes.every(c=>list.filter(r=>r.close===c).length<=visible);renderTrash();
}
function renderTrash(){
 $('trashCount').textContent='('+app.trash.length+'件)';$('trash').replaceChildren();if(!$('trashPanel').open)return;
 if(!app.trash.length)$('trash').append(node('p','ごみ箱は空です。','small'));
 for(const t of app.trash){const r=t.row,box=node('div',undefined,'record');box.append(node('p',r.date+' '+eRankLabel(r.rank)+' '+r.close+'時 · '+r.values.join(' / ')));box.append(button('この記録を復元',async()=>{if(busy||saving)return status('処理完了後に復元してください。',true);try{const current=app.records.find(x=>eKey(x)===eKey(r));let replace=false;if(current&&JSON.stringify(current.values)!==JSON.stringify(r.values)){replace=confirm('同じ条件の記録が現在あります。現在 '+current.values.join(' / ')+' を、ごみ箱の '+r.values.join(' / ')+' で置き換えますか？');if(!replace)return;}const warning=await persist(eRestoreTrash(app,eKey(r),replace));render();status('記録を復元しました。'+warning);}catch(e){status('復元できません：'+e.message,true);}}));$('trash').append(box);}
}
function syncDraftHeader(){const count=drafts.reduce((n,d)=>n+(d.bulk?d.bulk.length:1),0),checked=drafts.filter(d=>d.checked()).length;$('draftCount').textContent=count+'件';$('draftReviewSummary').textContent='候補 '+drafts.length+'組（記録 '+count+'件）／確認済み '+checked+'組／未確認 '+(drafts.length-checked)+'組／入力不足・エラー '+drafts.filter(d=>d.isValid&&!d.isValid()).length+'組';$('review').hidden=!drafts.length;toggleBusy();}
function draftRows(){return drafts.filter(d=>!d.bulk&&!d.fullState).map(d=>({...d.raw(),...(d.original?{original:d.original}:{})}));}
function flushDrafts(){
 clearTimeout(draftTimer);if(draftBlocked&&!drafts.length)return;
 try{
  if(localStorage.getItem(E_DRAFT_KEY)!==lastDraftRaw)throw Error('別の画面で下書きが変わりました。この画面の下書きをファイル保存してから、画面を開き直してください。');
  if(draftBlocked&&lastDraftRaw!==null){localStorage.setItem(E_DRAFT_KEY+'-unreadable',lastDraftRaw);if(localStorage.getItem(E_DRAFT_KEY+'-unreadable')!==lastDraftRaw)throw Error('元の下書きを保管できません。');}
  const rows=draftRows();lastDraftRaw=eDraftWrite(localStorage,rows,lastDraftRaw);draftBlocked=false;
  $('draftStatus').textContent=rows.length?'入力途中 '+rows.length+'件の下書きを端末に保存しました。画像は再選択が必要です。':drafts.length?'ファイルの取込候補は再読込後に選び直してください。':'';
 }catch(e){$('draftStatus').textContent='下書きを自動保存できません：'+e.message+' 閉じる前に「この画面の下書きをファイル保存」を使ってください。';}
}
function scheduleDrafts(){clearTimeout(draftTimer);draftTimer=setTimeout(flushDrafts,350);}
function removeDraft(item){if(item.url)URL.revokeObjectURL(item.url);drafts=drafts.filter(d=>d!==item);item.box.remove();syncDraftHeader();scheduleDrafts();}
function control(label,value,type='text',options=null){
 const wrap=node('label',label),input=document.createElement(options?'select':'input');if(options){const blank=node('option','選択');blank.value='';input.append(blank);for(const v of options){const op=node('option',v);op.value=v;input.append(op);}}else input.type=type;input.value=value||'';if(type==='date')input.max=eYesterday();wrap.append(input);return {wrap,input};
}
function addDraft(row,image=null,{original=null,restored=false}={}){
 if(!restored&&!image&&!original&&row.date&&row.rank&&row.close){const existing=drafts.find(d=>!d.bulk&&!d.original&&eKey(d.raw())===eKey(row));if(existing){status('この日の入力候補はすでにあります。候補を表示しました。');return existing;}}
 if(drafts.length>=100){if(image)URL.revokeObjectURL(image);status('入力候補は100件までです。保存してから追加してください。',true);return;}
 const item={url:image,original,box:node('article',undefined,'draft')},box=item.box,title=node('strong',original?'記録を編集':'取込候補');box.append(title);
 if(restored)box.append(node('p','下書きを復元しました。対象日・数値を再確認してください。','note small'));
 if(image){const im=node('img');im.src=image;im.alt='対象日・ランク・ボーダーの確認用画像';im.loading='lazy';im.decoding='async';box.append(im);const zoom=button('画像を拡大',()=>{const expanded=zoom.getAttribute('aria-expanded')!=='true';im.style.maxHeight=expanded?'none':'260px';zoom.setAttribute('aria-expanded',String(expanded));zoom.textContent=expanded?'画像を小さくする':'画像を拡大';});zoom.setAttribute('aria-expanded','false');box.append(zoom);}
 if(row.pending)box.append(node('p','集計中の表示を検出しました。この候補は保存できません。確定後の画像を使ってください。','error'));
 const group=node('div',undefined,'grid'),date=control('対象日（終了日）',row.date,'date'),rank=control('ランク',eRankLabel(row.rank),'text',['E']),close=control('締め時間',row.close,'text',['13','22','24']);group.append(date.wrap,rank.wrap,close.wrap);box.append(group);
 const nums=node('div',undefined,'grid'),values=(row.values||['','','']).map((v,i)=>control(['±0','＋1','＋2'][i],v));for(const c of values){c.input.autocomplete='off';c.input.spellcheck=false;c.input.maxLength=40;nums.append(c.wrap);}box.append(nums);
 const scope=node('p','','note small');box.append(scope);const hint=node('p','','small');box.append(hint);const check=node('label',undefined,'confirm'),cb=document.createElement('input');cb.type='checkbox';cb.disabled=!!(row.pending||row.unsupported);check.append(cb,node('span','集計中でないこと・対象日・ランク・締め・3つの値を確認しました'));box.append(check);
 item.isValid=()=>{try{eRow(item.raw());return true;}catch{return false;}};item.setMax=max=>{date.input.max=max;validate();};item.focus=()=>{box.scrollIntoView({block:'start'});if(row.pending){box.tabIndex=-1;box.focus();return;}const first=[date,rank,close,...values].find(c=>c.input.getAttribute('aria-invalid')==='true');(first?.input||cb).focus();};
 item.raw=()=>({date:date.input.value,rank:rank.input.value,close:close.input.value,values:values.map(v=>v.input.value),pending:row.pending===true||row.unsupported===true});item.checked=()=>cb.checked;item.uncheck=()=>{cb.checked=false;};
 function validate(){for(const c of [date,rank,close,...values])c.input.removeAttribute('aria-invalid');const raw=item.raw();scope.textContent='保存する条件：'+(raw.date||'日付未確定')+' ／ '+(raw.close?raw.close+'時〆':'締め未確定')+' ／ '+(raw.rank||'ランク未確定');if(!eDate(raw.date)||raw.date>=eToday())date.input.setAttribute('aria-invalid','true');if(!['E'].includes(raw.rank))rank.input.setAttribute('aria-invalid','true');if(!['13','22','24'].includes(raw.close))close.input.setAttribute('aria-invalid','true');try{const r=eRow(item.raw()),saved=app.records.find(x=>eKey(x)===eKey(r));hint.textContent=original?'編集は「保存」で確定します。':saved?(JSON.stringify(saved.values)===JSON.stringify(r.values)?'同じ記録が保存済みです。重複登録しません。':'保存済み：'+saved.values.join(' / ')+' → 今回：'+r.values.join(' / ')+'。置換する場合は一覧下の置換確認欄を選んでください。'):'新しい記録です。保存前に画像と見比べてください。';}catch(e){hint.textContent=e.message;const parsed=values.map(c=>{try{return eValue(c.input.value);}catch{c.input.setAttribute('aria-invalid','true');return null;}});if(parsed.every(Boolean)&&(parsed[0].n>parsed[1].n||parsed[1].n>parsed[2].n))for(const c of values)c.input.setAttribute('aria-invalid','true');}}
 for(const input of [date.input,rank.input,close.input,...values.map(v=>v.input)]){input.addEventListener('input',()=>{cb.checked=false;validate();syncDraftHeader();scheduleDrafts();});input.addEventListener('change',()=>{cb.checked=false;validate();syncDraftHeader();scheduleDrafts();});}
 cb.addEventListener('change',()=>{if(cb.checked)try{eRow(item.raw());}catch(e){cb.checked=false;hint.textContent=e.message;status(e.message,true);}syncDraftHeader();});
 box.append(button('この候補だけ保存',()=>saveCandidates([item]),'primary'));box.append(button('未確定・エラー項目を確認',()=>item.focus()));box.append(button('この候補を外す',()=>removeDraft(item)));item.read=()=>eRow({...item.raw(),source:original?'端末で確認した画面表示値':row.source});drafts.push(item);$('drafts').append(box);validate();syncDraftHeader();scheduleDrafts();return item;
}
function addBatch(rows,{fullState=null,label='バックアップ取込'}={}){
 if(drafts.length>=100)throw Error('候補が多すぎます。先に保存してください。');const item={bulk:rows,fullState,box:node('article',undefined,'draft')},box=item.box;
 box.append(node('strong',label+' '+rows.length+'件'),node('p',(rows.length?eSort(rows).at(-1).date+'〜'+eSort(rows)[0].date:'記録なし')+'。記録の内容は下の一覧で確認できます。','small'));
 const details=node('details'),summary=node('summary','取込内容を見る');details.append(summary);for(const r of rows)details.append(node('p',r.date+' '+eRankLabel(r.rank)+' '+r.close+'時 · '+r.values.join(' / '),'small'));box.append(details);
 const check=node('label',undefined,'confirm'),cb=document.createElement('input');cb.type='checkbox';check.append(cb,node('span','内容・取得元を確認し、既存の記録へ結合します'));box.append(check);item.checked=()=>cb.checked;item.uncheck=()=>{cb.checked=false;};item.focus=()=>{box.scrollIntoView({block:'start'});cb.focus();};cb.addEventListener('change',syncDraftHeader);
 let full=null;if(fullState){const label=node('label',undefined,'confirm');full=document.createElement('input');full.type='checkbox';label.append(full,node('span','結合せず、このバックアップの状態へ戻す（現在の記録を置き換える）'));box.append(label);full.addEventListener('change',()=>{cb.checked=false;syncDraftHeader();});}
 item.replaceAll=()=>!!full?.checked;item.read=()=>rows.map(r=>eRow({...r,source:label.includes('CSV')?'CSV取込（未再照合）':'バックアップ（未再照合）'}));box.append(button('この取込を外す',()=>removeDraft(item)));drafts.push(item);$('drafts').append(box);syncDraftHeader();scheduleDrafts();
}
$('fillMissing').onclick=()=>{
 if(busy||saving)return;try{const p=prefs(),pending=drafts.flatMap(d=>d.bulk||[d.raw()]),plan=eMissingDrafts(app.records,pending,p.rank,p.close,drafts.length);let first;
 for(const row of plan.rows){const item=addDraft(row);first??=item;}
 flushDrafts();status('未記録日 '+plan.rows.length+'日分の入力欄を追加しました。入力中・取込候補の '+plan.queued+'日分は省略しました。数値は画像を見て入力してください。');first?.focus();
 }catch(e){status('一括追加できません：'+e.message,true);}
};
$('nextDraft').onclick=()=>{if(busy||saving)return;const remaining=drafts.filter(d=>!d.checked()),item=remaining[(remaining.indexOf(lastReviewed)+1)%remaining.length];if(!item)return status('すべての候補が確認済みです。保存する内容を確認してください。');lastReviewed=item;item.focus();status('未確認の候補 '+(remaining.indexOf(item)+1)+' / '+remaining.length+' を表示しています。');};
$('manual').onclick=()=>{const p=prefs();const item=addDraft({date:eYesterday(),...p,values:['','','']});item?.box.scrollIntoView({block:'start',behavior:'auto'});};
async function saveCandidates(selected){
 if(busy||saving)return;const chosen=selected.filter(d=>drafts.includes(d)&&d.checked());if(!chosen.length)return status('保存する候補の確認欄にチェックしてください。未確認の候補は残します。',true);
 try{
  let next,result,full=chosen.filter(d=>d.replaceAll?.());
  if(full.length){if(chosen.length!==1)throw Error('バックアップへの復元は、他の候補と分けて実行してください。');if(!confirm('現在の記録をご指定のバックアップに置き換えます。全記録のバックアップを保存済みですか？'))return;next={...full[0].fullState,records:full[0].fullState.records.map(r=>({...r,source:'バックアップ（未再照合）'}))};result={added:next.records.length,same:0,replaced:0};}
  else{
   next={...app,records:app.records.slice(),hiddenSeeds:app.hiddenSeeds.slice(),trash:app.trash.slice()};
   for(const d of chosen)if(d.original){const old=next.records.find(r=>eKey(r)===eKey(d.original));if(!old||JSON.stringify(old.values)!==JSON.stringify(d.original.values))throw Error('編集中の元記録が変わりました。候補を外し、最新の記録から編集し直してください。');const edited=d.read();if(eKey(edited)!==eKey(old)||JSON.stringify(edited.values)!==JSON.stringify(old.values))next=eRemove(next,eKey(old));}
   result=eMergeState(next,chosen.flatMap(d=>d.read()),$('replace').checked);next=result.state;
  }
  const warning=await persist(next);for(const d of chosen)removeDraft(d);$('replace').checked=false;flushDrafts();render();status('保存を確認しました。追加 '+result.added+'件／同じ記録 '+result.same+'件／置換 '+result.replaced+'件。'+(drafts.length?' 未確認の候補は残っています。':'')+warning);
 }catch(e){status('保存できません：'+e.message,true);$('status').focus();}
}
$('save').onclick=()=>saveCandidates(drafts.filter(d=>d.checked()));
$('discard').onclick=()=>{importId++;if(!drafts.length||!confirm('入力途中の候補をすべて外しますか？保存済みの記録は残ります。'))return;for(const d of drafts.slice())removeDraft(d);flushDrafts();status('候補を外しました。保存済みの記録は変更していません。');};
function reload(){try{const data=readStorage();app=data.state;lastRaw=data.raw;storageBlocked=false;for(const d of drafts)d.uncheck();syncDraftHeader();render();status('最新の保存内容を読み込みました。候補は残し、確認チェックを解除しました。');}catch(e){storageBlocked=true;status('読込できません：'+e.message,true);}}
$('reload').onclick=reload;
window.addEventListener('storage',e=>{if(e.key===E_DRAFT_KEY||e.key===null){$('draftStatus').textContent='別の画面で下書きが変更・削除されました。この画面の下書きをファイル保存してから、画面を開き直してください。';}if(e.key!==E_KEY&&e.key!==null)return;if(!drafts.length&&!busy&&!saving)reload();else status('別の画面で記録が変わりました。候補は残しています。「最新の保存内容を読み込む」で再確認してください。',true);});
for(const id of ['trackRank','trackClose'])$(id).addEventListener('change',()=>{savePrefs();render();});
for(const id of ['filterRank','filterClose','filterMonth','filterStart','filterEnd','filterOrder','filterApprox'])$(id).addEventListener('change',()=>{visible=30;saveFilters();render();});
$('more').onclick=()=>{visible+=30;render();};$('trashPanel').addEventListener('toggle',renderTrash);
for(const days of [7,30])$('recent'+days).onclick=()=>{$('filterMonth').value='';$('filterEnd').value=eYesterday();$('filterStart').value=eShift(eYesterday(),1-days);visible=30;saveFilters();render();};
$('resetFilters').onclick=()=>{for(const id of ['filterRank','filterClose','filterMonth','filterStart','filterEnd'])$(id).value='';$('filterOrder').value='new';$('filterApprox').checked=false;visible=30;saveFilters();render();};
function recordText(rows){return ['対象日\tランク\t締め\t±0\t＋1\t＋2\t精度',...rows.map(r=>[r.date,eRankLabel(r.rank),r.close,...r.values,r.values.some(v=>eValue(v).approx)?'画面表示値（K/Mは概数）':'画面表示値'].join('\t'))].join('\n');}
async function copyText(text){const id=++copyId;try{await navigator.clipboard.writeText(text);if(id===copyId)status('記録をコピペできるようコピーしました。');}catch{if(id!==copyId)return;$('copyText').value=text;$('copyFallback').hidden=false;$('copyText').focus();$('copyText').select();status('コピーできないため手動コピペ欄を表示しました。',true);}}
$('copy').onclick=()=>{try{copyText(recordText(filtered()));}catch(e){status(e.message,true);}};$('closeCopy').onclick=()=>{$('copyFallback').hidden=true;$('copy').focus();};
function download(name,text,type='application/json'){const url=URL.createObjectURL(new Blob([text],{type:type+';charset=utf-8'})),a=node('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
$('export').onclick=()=>{try{if(storageBlocked)throw Error('保存内容を読み込めないため、復旧欄の「現在の保存内容をそのまま保存」を使ってください。');const snapshot=readStorage().state;flushDrafts();download('pococha-E-backup-'+eToday()+'.json',JSON.stringify({...JSON.parse(eEncode(snapshot)),exportedAt:new Date().toISOString()},null,2));status('端末に保存されている最新の全記録のバックアップ保存を開始しました。入力中の下書きは別のファイル保存を使ってください。');}catch(e){status('バックアップできません：'+e.message,true);}};
$('csv').onclick=()=>{try{const rows=filtered();if(!rows.length)throw Error('条件に合う記録がありません。');download('pococha-E-records-'+eToday()+'.csv',eCSV(rows),'text/csv');status(rows.length+'件のCSV保存を開始しました。保存先で確認してください。');}catch(e){status(e.message,true);}};
$('chooseRestore').onclick=()=>$('restore').click();
$('restore').onchange=async e=>{
 const file=e.target.files[0];e.target.value='';if(!file||busy||saving)return;const id=++importId;let importNote='';
 try{
  if(file.size>2000000)throw Error('ファイルは2MB以下にしてください。');const text=await file.text();if(id!==importId)return;if(busy||saving)throw Error('処理完了後にファイルを選び直してください。');
  if(/\.csv$/i.test(file.name)){const rows=eReadCSV(text);if(!rows.length)throw Error('記録がありません。');addBatch(rows,{label:'CSV取込'});}
  else if(JSON.parse(text.replace(/^\uFEFF/,''))?.schema==='pococha-e-drafts-v1'){
   const rows=eDraftDecode(text.replace(/^\uFEFF/,''));if(!rows.length)throw Error('下書きがありません。');const plan=eDraftPlan(draftRows(),rows,drafts.length);importNote=' 同じ内容の下書き '+plan.duplicates+'件を省略しました。';
   for(const r of plan.rows)addDraft(r,null,{original:r.original||null,restored:true});
  }else{const rows=eBackup(text),state=eState(text);addBatch(rows,{fullState:state,label:'JSONバックアップ取込'});}
  status('ファイルを検証しました。候補の内容を確認して保存してください。'+importNote);$('review').scrollIntoView({block:'start'});
 }catch(err){if(id===importId)status('取込できません：'+err.message,true);}
};
$('exportCurrentDrafts').onclick=()=>{try{const rows=draftRows();if(!rows.length)throw Error('入力中の下書きはありません。ファイルの取込候補は元のファイルを使ってください。');download('pococha-E-drafts-'+eToday()+'.json',eDraftEncode(rows));status('この画面の下書きの保存を開始しました。JSON取込から戻せます。画像と確認チェックは含みません。');}catch(e){status('下書きを書き出せません：'+e.message,true);}};
$('downloadRaw').onclick=()=>{try{const raw=localStorage.getItem(E_KEY);if(raw===null)throw Error('追加の保存データはありません。全記録のバックアップを使ってください。');download('pococha-E-raw-'+eToday()+'.json',raw);status('端末の保存内容をそのまま書き出しました。ファイルを確認してください。');}catch(e){status(e.message,true);}};
$('downloadDrafts').onclick=()=>{try{const raw=localStorage.getItem(E_DRAFT_KEY);if(!raw)throw Error('下書きは保存されていません。');download('pococha-E-drafts-'+eToday()+'.json',raw);status('下書きの元データの保存を開始しました。ファイルを確認してください。');}catch(e){status(e.message,true);}};
$('downloadUnreadableDrafts').onclick=()=>{try{const raw=localStorage.getItem(E_DRAFT_KEY+'-unreadable');if(raw===null)throw Error('別保管した下書きはありません。');download('pococha-E-unreadable-drafts-'+eToday()+'.json',raw);status('読み込めなかった下書きの別保管データを書き出しました。');}catch(e){status(e.message,true);}};
$('recover').onclick=async()=>{if(busy||saving)return;try{const raw=localStorage.getItem(E_RECOVERY_KEY);if(!raw)throw Error('復元用コピーがありません。');const next=eState(raw);if(!confirm('保存前のコピー '+next.records.length+'件へ戻します。現在の内容をバックアップ済みですか？'))return;const warning=await persist(next,{recovery:true});render();status('保存前のコピーから復元し、保存を確認しました。'+warning);}catch(e){status('復元できません：'+e.message,true);}};
function networkStatus(){$('networkState').textContent=navigator.onLine===false?'現在オフラインです。手入力・保存・バックアップは利用できます。初回の画像読取には通信が必要です。':'画像の読取用データ取得には通信を使用します。';}
window.addEventListener('online',networkStatus);window.addEventListener('offline',networkStatus);networkStatus();
function terminateWorker(w){try{Promise.resolve(w.terminate()).catch(()=>{});}catch{}}
async function loadOCR(signal){
 if(window.Tesseract)return;
 let script;
 try{await eTimed(new Promise((resolve,reject)=>{script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';script.crossOrigin='anonymous';script.integrity='sha384-r1ru3tcf6FhnCFR4B7pIFG+BhFF9LlFtz/P1y4pblWn3AGs9y3lBx5SKLNf4+rED';script.onload=resolve;script.onerror=()=>reject(Error('読取用プログラムを取得できません。通信を確認するか手入力を使ってください。'));document.head.append(script);}),45000,signal);}catch(e){script?.remove();throw e;}
}
async function openImage(file,signal){
 const url=URL.createObjectURL(file),im=new Image();
 try{await eTimed(new Promise((resolve,reject)=>{im.onload=resolve;im.onerror=()=>reject(Error('画像を開けません。JPEG・PNGで試してください。'));im.src=url;}),15000,signal,'画像を開く処理が長いため中止しました。');
 if(im.width*im.height>12000000)throw Error('画像が大きすぎます。1200万画素以下のスクリーンショットを選んでください。');
 const supported=im.width>=300&&im.height/im.width>=1.8&&im.height/im.width<=2.5;return {im,url,supported};
 }catch(e){im.src='';URL.revokeObjectURL(url);throw e;}
}
function crop(im,x,y,w,h,invert=false){
 const c=document.createElement('canvas');c.width=Math.round(im.width*w*3);c.height=Math.round(im.height*h*3);const ctx=c.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('画像読取に必要な機能を利用できません。手入力してください。');
 ctx.drawImage(im,im.width*x,im.height*y,im.width*w,im.height*h,0,0,c.width,c.height);
 if(invert){const data=ctx.getImageData(0,0,c.width,c.height);for(let i=0;i<data.data.length;i+=4){const n=255-Math.round((data.data[i]+data.data[i+1]+data.data[i+2])/3);data.data[i]=data.data[i+1]=data.data[i+2]=n;}ctx.putImageData(data,0,0);}return c;
}
$('chooseImages').onclick=()=>$('images').click();
$('cancel').onclick=()=>{abortOCR?.abort();status('読取を中止しています。読取途中の内容も候補として残します。');if(worker){terminateWorker(worker);worker=null;}};
$('images').onchange=async e=>{
 const files=[...e.target.files];e.target.value='';if(busy||saving||!files.length)return;
 if(files.length>30||drafts.length+files.length>300)return status('画像は一度に30枚まで、候補は合計100件までです。',true);
 if(files.some(f=>!f.size||f.size>12000000||!(['image/jpeg','image/png','image/webp'].includes(f.type)||(!f.type&&/\.(png|jpe?g|webp)$/i.test(f.name)))))return status('JPEG・PNG・WebPの12MB以下の画像を選んでください。空ファイル・HEIC等は読み取れません。',true);
 if(files.reduce((n,f)=>n+f.size,0)>60000000)return status('画像の合計は60MB以下にしてください。少ない枚数で分けて選べます。',true);
 const id=++runId,controller=new AbortController(),signal=controller.signal;abortOCR=controller;busy=true;toggleBusy();$('ocrProgress').max=files.length*10;$('ocrProgress').value=0;
 let localWorker=null,done=0,failed=0,skipped=0,regions=0;const pending=[],seen=new Set(drafts.map(d=>d.imageHash).filter(Boolean));
 const check=()=>{if(signal.aborted||id!==runId)throw Object.assign(Error('読取を中止しました。'),{name:'AbortError'});};
 const job=async p=>{try{const value=await eTimed(p,45000,signal,'1つの読取処理が長いため中止しました。候補を確認するか少ない枚数で再試行してください。');check();return value;}catch(e){if(e.code==='ETIMEOUT'){controller.abort();if(localWorker)terminateWorker(localWorker);}throw e;}};
 const recognize=async image=>{const r=await job(localWorker.recognize(image));$('ocrProgress').value=++regions;return r;};
 try{
  status('読取の準備中です。初回は言語データを取得します。中止して手入力へ切り替えることもできます。');
  await loadOCR(signal);check();
  const creating=Tesseract.createWorker('jpn',1,{workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',langPath:'https://tessdata.projectnaptha.com/4.0.0_best',cacheMethod:'write'});
  creating.then(w=>{if(signal.aborted||id!==runId)terminateWorker(w);},()=>{});
  localWorker=await eTimed(creating,120000,signal,'読取の準備が長いため中止しました。通信を確認するか手入力を利用してください。');worker=localWorker;check();
  for(let i=0;i<files.length;i++){
   check();status((i+1)+' / '+files.length+'枚の日付・数値を読取中…');let image,entry;
   try{
    let hash='';if(globalThis.crypto?.subtle){const bytes=await eTimed(files[i].arrayBuffer(),15000,signal);hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');check();if(seen.has(hash)){skipped++;continue;}seen.add(hash);}
    image=await openImage(files[i],signal);const row={date:'',rank:'',close:'',values:['','','']};entry={row,url:image.url,imageHash:hash,rankImage:null,warning:'',warnings:[],name:files[i].name||'画像'+(i+1)};pending.push(entry);
    if(!image.supported){entry.warning='画面の縦横比が対象外です。画像を見ながら手入力してください。';failed++;continue;}
    entry.rankImage=crop(image.im,0.40,0.24,0.20,0.06,true);entry.rankBackup=crop(image.im,0.30,0.21,0.40,0.11,false);await job(localWorker.setParameters({tessedit_pageseg_mode:'6',tessedit_char_whitelist:''}));
    const h=await recognize(crop(image.im,0.12,0.10,0.78,0.14,true));Object.assign(entry.row,eParseOCR(h.data.text,'',''));if(Number.isFinite(h.data.confidence)&&h.data.confidence<60)entry.warnings.push('日付・締めのOCRの確かさが低いため画像と照合してください。');
    if(!entry.row.date||!entry.row.close){const full=await recognize(crop(image.im,0.04,0.06,0.92,0.46,true));const parsed=eParseOCR(full.data.text,'','');Object.assign(entry.row,eCombineOCR(entry.row,parsed));}
    await job(localWorker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789.,KM'}));
    for(const [n,x]of [0.28,0.405,0.529].entries()){
     check();status((i+1)+' / '+files.length+'枚：'+['±0','＋1','＋2'][n]+'を読取中…');let first={text:''},retry=null;
     try{first=(await recognize(crop(image.im,x,0.463,0.075,0.016))).data;}catch(err){if(signal.aborted)throw err;failed++;}
     if(!eOCRNumber(first).value||Number.isFinite(first.confidence)&&first.confidence<60){try{retry=(await recognize(crop(image.im,x,0.463,0.075,0.016,true))).data;}catch(err){if(signal.aborted)throw err;failed++;}}
     const result=eOCRNumber(first,retry);entry.row.values[n]=result.value;if(result.warning)entry.warnings.push(['±0','＋1','＋2'][n]+'：'+result.warning);
    }
   }catch(err){if(signal.aborted)throw err;failed++;if(entry)entry.warning='読取できない項目があります。画像を見ながら修正してください。';else{const d=addDraft({date:'',rank:'',close:'',values:['','','']});d?.box.append(node('p','画像を開けませんでした。元の画像を確認して入力してください。','error'));}}
  }
  if(pending.some(p=>p.rankImage)){check();status('ランクを確認しています…');await job(localWorker.reinitialize('eng'));await job(localWorker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'ESABCD0123456'}));}
  for(const entry of pending){check();if(entry.rankImage){try{const r=await recognize(entry.rankImage);entry.row.rank=eOCRRank(r.data.text);if(Number.isFinite(r.data.confidence)&&r.data.confidence<60)entry.warnings.push('ランクのOCRの確かさが低いため画像と照合してください。');if(!entry.row.rank&&entry.rankBackup){await job(localWorker.setParameters({tessedit_pageseg_mode:'6'}));const retry=await recognize(entry.rankBackup);entry.row.rank=eOCRRank(retry.data.text);await job(localWorker.setParameters({tessedit_pageseg_mode:'7'}));}if(entry.row.rank&&entry.row.rank!=='E'){entry.row.unsupported=true;entry.warning='画像のランクは'+entry.row.rank+'です。この画面はE帯専用のため保存できません。';}}catch(err){if(signal.aborted)throw err;failed++;entry.warning='ランクを確認できません。画像を見て選択してください。';}}}
  status('読取が終わりました。候補 '+pending.length+'件／同一画像の省略 '+skipped+'件／読取失敗 '+failed+'件／日付・〆・ランクの未確定 '+pending.filter(p=>!p.row.date||!p.row.close||!p.row.rank).length+'件。画像と見比べて確認し、保存してください。');
 }catch(err){if(!signal.aborted)controller.abort();status(err.name==='AbortError'?'読取を中止しました。読取済み・入力途中の候補は残します。':'画像読取を完了できません：'+err.message+' 手入力で続けられます。',err.name!=='AbortError');}
 finally{
  for(const entry of pending){const item=addDraft(entry.row,entry.url);if(item){item.imageHash=entry.imageHash;item.box.append(node('p','取込画像：'+entry.name,'small'));for(const warning of entry.warnings)item.box.append(node('p',warning,'error'));const missing=[!entry.row.date?'対象日':'',!entry.row.close?'締め時間':'',!entry.row.rank?'ランク':''].filter(Boolean);item.box.append(node('p',missing.length?'自動判別できません：'+missing.join('・')+'。画像を見て入力してください。':'画像からの初回判別：'+entry.row.date+' ／ '+entry.row.close+'時〆 ／ '+eRankLabel(entry.row.rank),'small'));if(entry.row.ocr){const detail=node('details'),summary=node('summary','判別の根拠・注意点');detail.append(summary);if(entry.row.ocr.period.length)detail.append(node('p','対象期間：'+entry.row.ocr.period.join(' → '),'small'));if(entry.row.ocr.basis)detail.append(node('p','〆時間の根拠：'+entry.row.ocr.basis,'small'));for(const warning of [...new Set(entry.row.ocr.issues)])detail.append(node('p',warning,'small'));item.box.append(detail);}if(entry.warning)item.box.append(node('p',entry.warning,'error'));done++;}}
  if(localWorker)terminateWorker(localWorker);if(id===runId){worker=null;abortOCR=null;busy=false;toggleBusy();flushDrafts();}
 }
};
try{const raw=localStorage.getItem(E_DRAFT_KEY);lastDraftRaw=raw;if(raw){const rows=eDraftDecode(raw);for(const r of rows)addDraft(r,null,{original:r.original||null,restored:true});$('draftStatus').textContent=rows.length+'件の下書きを復元しました。画像は再選択し、再確認してください。';}}catch{draftBlocked=true;$('draftStatus').textContent='保存した下書きを読み込めません。元データは残しています。復旧欄から下書きの元データを保存できます。';}
window.addEventListener('pagehide',flushDrafts);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushDrafts();else refreshCalendar(true)});
window.addEventListener('beforeunload',e=>{flushDrafts();if(drafts.length||busy){e.preventDefault();e.returnValue='';}});
let calendarDay=eToday();
function refreshCalendar(force=false){const day=eToday();if(!force&&day===calendarDay)return;calendarDay=day;const max=eYesterday();for(const id of ['filterStart','filterEnd'])$(id).max=max;for(const d of drafts)d.setMax?.(max);render();}
window.addEventListener('focus',()=>refreshCalendar(true));
function calendarTick(){if(document.visibilityState!=='hidden')refreshCalendar();setTimeout(calendarTick,60000);}
setTimeout(calendarTick,60000);refreshCalendar(true);

$('eraseAllE').onclick=()=>{if(busy||saving)return status('処理が終わってから操作してください。',true);if(!confirm('このブラウザのE帯を全削除します。13・22・24時の記録、初期記録、下書き、ごみ箱、復旧用コピーを空にします。D帯〜S帯は残します。削除しますか？'))return;try{eEraseAll(localStorage);location.reload();}catch(e){status('削除できません：'+e.message,true);}};
