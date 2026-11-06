const $=id=>document.getElementById(id),$status=id=>document.getElementById(id)||document.createElement('span'),MAIN_KEY='pococha-meter-calc-v1',PREF_KEY='pococha-meter-history-v1',THEME_KEY='pococha-meter-history-theme-v1';
const filterIDs=['query','rank','close','start','end','units','order','origin','view','pageSize'];
const cardCopyNodes=new Map(),pendingCardCopies=new Map(),copiedCardTexts=new Set();
let localReadFailed=false,meterCalendarMonthValue='',meterCalendarInitialized=false,eCalendarRows=[],eCalendarReadFailed=false;
let page=1,liveRows=[],seedRows=normalizeHistoryRows(SEED_HISTORY),localRows=[],index=createHistoryIndex(seedRows),allMatches=[],inputTimer=0,composing=false,manualCardCopy=null,latestCardCopyRequest=0,searchCopyRequest=0,searchCopyPending=false,lastFilterSignature='',publicRequest=null,cardCopyEpoch=0,lastCardCopyScope='',displayMonth='',renderedPageSize=20;
for(const rank of HISTORY_RANKS){const option=document.createElement('option');option.value=rank;option.textContent=rank;$('rank').appendChild(option);}
function filters(){return Object.fromEntries(filterIDs.map(id=>[id,$(id).value]));}
function localRead(){try{const raw=localStorage.getItem(MAIN_KEY);if(raw!==null&&(typeof raw!=='string'||raw.length>8*1024*1024||!isObject(JSON.parse(raw))))throw Error('Invalid local history');localRows=localHistoryRows(raw);localReadFailed=false;}catch{localReadFailed=true;}}
function rebuild(){localRead();try{eCalendarRows=eState(localStorage.getItem(E_KEY)).records.map(row=>({...row,rank:'E',values:row.values.map(v=>eValue(v).n),displayValues:row.values.slice(),origin:'e-display',sourceNote:row.source,source:'',checkedAt:''}));eCalendarReadFailed=false;}catch{eCalendarReadFailed=true;}
 const rows=mergeHistoryRows(seedRows,localRows,liveRows),seen=new Set(rows.map(r=>[r.date,r.close,r.rank,JSON.stringify(r.values)].join('|')));for(const row of eCalendarRows){const key=[row.date,row.close,row.rank,JSON.stringify(row.values)].join('|');if(!seen.has(key)){rows.push(row);seen.add(key);}}index=createHistoryIndex(rows);
}
function loadPreferences(){let value,restored=false;displayMonth='';try{value=JSON.parse(localStorage.getItem(PREF_KEY)||'null');}catch{}
 const hash=new URLSearchParams(location.hash.slice(1));if([...hash].length)value=Object.fromEntries(hash);
 if(isObject(value)){for(const id of filterIDs){const v=value[id];if(typeof v==='string'&&v.length<=100){if(['query','start','end'].includes(id)||[...$(id).options].some(o=>o.value===v)){$(id).value=v;restored=true;}}}}
 if(!restored){try{const s=JSON.parse(localStorage.getItem(MAIN_KEY)||'null');if(HISTORY_RANKS.includes(s?.rank))$('rank').value=s.rank;else $('rank').value='S2';const c=s?.deadline==='00:00'?'24':s?.deadline?.slice(0,2);$('close').value=HISTORY_CLOSES.includes(c)?c:'22';}catch{$('rank').value='S2';$('close').value='22';}}
 let theme='dark';try{theme=localStorage.getItem(THEME_KEY)||JSON.parse(localStorage.getItem('pococha-meter-display-v1')||'null')?.theme||'dark';}catch{}document.body.classList.toggle('light',theme==='light');syncTheme();return restored;
}
function syncTheme(){$('themeButton').textContent=document.body.classList.contains('light')?'暗い表示':'明るい表示';}
function savePreferences(){let message='この端末に検索条件を保存しました。';try{localStorage.setItem(PREF_KEY,JSON.stringify(filters()));}catch{message='検索条件を保存できません。検索は利用できます。';}$status('preferenceStatus').textContent=(localReadFailed||eCalendarReadFailed?'端末の記録を読み直せません。読み込み済みの記録と保存資料を表示しています。端末の記録は変更していません。 ':'')+message;}
function browseMonth(month){const range=historyMonthRange(month);if(!range)return;displayMonth=range.month;renderCalendar(filters());renderRecordNavigation(filters());}
function setRange(range){if(!range)return;composing=false;clearTimeout(inputTimer);displayMonth=range.end.slice(0,7);$('start').value=range.start;$('end').value=range.end;$('query').value='';render(true);}
function latestMonth(){const date=latestHistoryDate(index,filters());if(date)setRange(historyMonthRange(date.slice(0,7)));else render(true);}
function node(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
function calendarMonth(){const f=filters(),latest=latestHistoryDate(index,f);return displayMonth||(validHistoryDate(f.end)?f.end.slice(0,7):'')||(validHistoryDate(f.start)?f.start.slice(0,7):'')||latest?.slice(0,7)||new Date(Date.now()+9*60*60*1000).toISOString().slice(0,7);}
function renderCalendar(f){
 const calendar=historyCalendarMonth(calendarMonth());if(!calendar)return;displayMonth=calendar.month;$('month').value=calendar.month;
 const focusDate=document.activeElement?.getAttribute?.('data-calendar-date'),days=new Map(),buttons=new Map();
 for(const row of filterHistory(index,{...f,query:'',start:calendar.start,end:calendar.end}).rows)days.set(row.date,(days.get(row.date)||0)+1);
 $('calendarLabel').textContent=Number(calendar.month.slice(0,4))+'年'+Number(calendar.month.slice(5,7))+'月';
 $('calendarDays').replaceChildren();
 calendar.cells.forEach((date,i)=>{if(!date){const blank=node('span',undefined,'calendar-blank');blank.setAttribute('aria-hidden','true');$('calendarDays').appendChild(blank);return;}
  const count=days.get(date)||0,selected=f.start===date&&f.end===date,inRange=(!f.start||date>=f.start)&&(!f.end||date<=f.end)&&!!(f.start||f.end),button=node('button',undefined,'calendar-day');
  button.type='button';button.setAttribute('data-calendar-date',date);button.setAttribute('data-has-record',String(count>0));button.setAttribute('aria-pressed',String(selected));button.classList.toggle('in-range',inRange&&!selected);
  button.setAttribute('aria-label',Number(date.slice(0,4))+'年'+Number(date.slice(5,7))+'月'+Number(date.slice(8))+'日 '+['日','月','火','水','木','金','土'][i%7]+'曜日、'+(count?'記録'+count+'件':'記録なし'));
  button.appendChild(node('span',String(Number(date.slice(8)))));const mark=node('span',count?'●':'','calendar-mark');mark.setAttribute('aria-hidden','true');button.appendChild(mark);
  button.addEventListener('click',()=>{setRange({start:date,end:date});moveTo('resultHeading');});buttons.set(date,button);$('calendarDays').appendChild(button);
 });
 $status('calendarStatus').textContent=f.start&&f.start===f.end&&validHistoryDate(f.start)?f.start.replaceAll('-','/')+'を選択中':f.start||f.end?'検索期間：'+(f.start||'最初の記録')+'〜'+(f.end||'最新の記録'):'日付を押すと、その日の記録を表示します。';
 $('prevMonth').disabled=!historyMonthRange(calendar.month,-1);$('nextMonth').disabled=!historyMonthRange(calendar.month,1);
 if(focusDate&&buttons.has(focusDate))buttons.get(focusDate).focus({preventScroll:true});
}
function sourceText(row){return historyOriginLabel(row.origin)+(row.sourceNote?' · '+row.sourceNote:'')+(row.checkedAt?' · 確認 '+row.checkedAt.replace('T',' ').slice(0,19):' · 確認日時なし');}
function sourceNode(row){const el=node('details',undefined,'source');el.appendChild(node('summary',historyOriginLabel(row.origin)+'・出典情報'));el.appendChild(node('div',sourceText(row)));if(row.source){el.appendChild(document.createTextNode(' · '));const link=node('a','出典');link.href=row.source;link.target='_blank';link.rel='noopener noreferrer';link.setAttribute('aria-label',row.date+' '+row.rank+' '+row.close+'時締めの出典');el.appendChild(link);}return el;}
function cardCopyControls(row){
 const text=historyCardText(row,$('units').value),label=row.date+' '+row.rank+' '+row.close+'時締め',controls=node('div',undefined,'record-copy'),button=node('button','カードをコピー'),status=node('p','','record-copy-status'),fallback=node('div',undefined,'record-copy-fallback'),textarea=node('textarea'),close=node('button','閉じる');
 button.type=close.type='button';button.setAttribute('aria-label',label+'のカードをコピー');status.setAttribute('role','status');
 fallback.hidden=true;textarea.readOnly=true;textarea.rows=8;textarea.value=text;textarea.setAttribute('aria-label',label+'のコピー用文章');close.setAttribute('aria-label',label+'のコピー用文章を閉じる');
 fallback.appendChild(textarea);fallback.appendChild(close);controls.appendChild(button);controls.appendChild(status);controls.appendChild(fallback);
 const message='自動コピーできません。文章を長押ししてコピーしてください。',state={text,fallback,textarea,button,status};
 cardCopyNodes.set(text,state);button.disabled=pendingCardCopies.has(text);
 if(copiedCardTexts.has(text))status.textContent='カードをコピーしました。';
 if(manualCardCopy?.text===text){fallback.hidden=false;status.textContent=message;manualCardCopy=state;}
 button.addEventListener('click',async()=>{if(button.disabled||pendingCardCopies.has(text))return;const request=++latestCardCopyRequest,epoch=cardCopyEpoch,operation={request,epoch};pendingCardCopies.set(text,operation);copiedCardTexts.delete(text);button.disabled=true;status.textContent='';try{
  if(typeof navigator.clipboard?.writeText!=='function')throw Error('Clipboard unavailable');
  await navigator.clipboard.writeText(text);if(epoch!==cardCopyEpoch)return;copiedCardTexts.add(text);if(copiedCardTexts.size>100)copiedCardTexts.delete(copiedCardTexts.values().next().value);const current=cardCopyNodes.get(text)||state;current.fallback.hidden=true;current.status.textContent='カードをコピーしました。';if(manualCardCopy?.text===text)manualCardCopy=null;
 }catch{
  const current=epoch===cardCopyEpoch?cardCopyNodes.get(text):null;if(current&&request===latestCardCopyRequest){
   if(manualCardCopy&&manualCardCopy.text!==text){manualCardCopy.fallback.hidden=true;manualCardCopy.status.textContent='';}
   current.fallback.hidden=false;current.status.textContent=message;manualCardCopy=current;current.textarea.focus({preventScroll:true});current.textarea.select();current.textarea.setSelectionRange?.(0,text.length);current.textarea.scrollIntoView({block:'nearest',behavior:'auto'});
  }else if(current)current.status.textContent='自動コピーできません。もう一度押してコピーしてください。';
 }finally{if(pendingCardCopies.get(text)===operation){pendingCardCopies.delete(text);button.disabled=false;const current=cardCopyNodes.get(text);if(current)current.button.disabled=false;}}});
 close.addEventListener('click',()=>{fallback.hidden=true;status.textContent='';if(manualCardCopy?.text===text)manualCardCopy=null;button.focus({preventScroll:true});});
 return controls;
}
function card(row){const article=node('article',undefined,'record'),heading=node('div',undefined,'record-head');const time=node('time',row.date.replaceAll('-','/'));time.dateTime=row.date;heading.appendChild(time);heading.appendChild(node('span',row.rank,'rank'));heading.appendChild(node('span',row.close+'時〆'));article.appendChild(heading);const nums=node('dl',undefined,'numbers');row.values.forEach((value,i)=>{const item=node('div',undefined,'metric');item.appendChild(node('dt',['±0','+1','+2'][i]));const dd=node('dd',historyRowNumber(row,i,$('units').value));dd.title=row.displayValues?'画面表示値（概数）':value.toLocaleString('ja-JP')+' pt';dd.setAttribute('aria-label',['プラスマイナス0','プラス1','プラス2'][i]+' '+(row.displayValues?row.displayValues[i]+'（画面表示値・概数）':value+'ポイント'));item.appendChild(dd);nums.appendChild(item);});article.appendChild(nums);article.appendChild(sourceNode(row));article.appendChild(cardCopyControls(row));return article;}
function render(reset=false){if(composing)return {rows:allMatches,error:''};if(reset)page=1;const f=filters(),result=filterHistory(index,f);allMatches=result.rows;const size=Number(f.pageSize)||20,slice=historyPage(allMatches,page,size);page=slice.page;const copyScope=JSON.stringify([f,page]);if(copyScope!==lastCardCopyScope){lastCardCopyScope=copyScope;cardCopyEpoch++;}renderedPageSize=size;renderCalendar(f);renderMeterCalendar();$('clearQuery').disabled=!f.query;syncSearchCopy();renderRecordNavigation(f);
 $status('searchError').hidden=!result.error;$status('searchError').textContent=result.error;for(const id of ['start','end'])$(id).setAttribute('aria-invalid',String(!!result.error));
 $('scope').replaceChildren();const chips=[['rank',f.rank||'全ランク',!!f.rank],['close',f.close?f.close+'時〆':'全締め時間',!!f.close],['period',(f.start||'最初の記録')+'〜'+(f.end||'最新の記録'),!!(f.start||f.end)],['query',f.query?'検索：'+f.query:'',!!f.query],['origin',f.origin==='personal'?'端末の記録':f.origin==='published'?'掲載・取得記録':'',!!f.origin]];for(const [key,text,removable] of chips){if(!text)continue;const chip=node(removable?'button':'span',text+(removable?' ×':''),'filter-chip');if(removable){chip.type='button';chip.setAttribute('aria-label',text+'の条件を解除');chip.addEventListener('click',()=>{for(const id of key==='period'?['start','end']:[key])$(id).value='';if(key==='period')displayMonth='';render(true);moveTo('resultHeading');});}$('scope').appendChild(chip);}
 const days=new Set(allMatches.map(row=>row.date+'|'+row.close));$status('resultCount').textContent=result.error?'条件を修正してください。':allMatches.length.toLocaleString('ja-JP')+'件（'+days.size.toLocaleString('ja-JP')+'日・締め時間の記録）';
 const manualBefore=manualCardCopy,manualFocus=manualBefore&&document.activeElement===manualBefore.textarea,selectionStart=manualBefore?.textarea.selectionStart,selectionEnd=manualBefore?.textarea.selectionEnd;
 $('emptyState').hidden=!!result.error||allMatches.length!==0;$('results').hidden=f.view==='table';$('tableResults').hidden=f.view!=='table';cardCopyNodes.clear();$('results').replaceChildren();$('tableResults').replaceChildren();
 if(f.view==='table'&&slice.rows.length){const table=node('table'),caption=node('caption','検索条件に合うボーダー記録（'+(f.units==='K'?'K':'pt')+'）');table.appendChild(caption);const head=node('thead'),tr=node('tr');for(const text of ['日付','ランク','締め','±0','+1','+2','記録・出典']){const th=node('th',text);th.scope='col';tr.appendChild(th);}head.appendChild(tr);table.appendChild(head);const body=node('tbody');for(const row of slice.rows){const tr=node('tr');for(const [i,text] of [row.date.replaceAll('-','/'),row.rank,row.close+'時',...row.values.map((v,i)=>historyRowNumber(row,i,f.units))].entries()){const td=node('td',text);if(i>=3){td.title=row.displayValues?'画面表示値（概数）':row.values[i-3].toLocaleString('ja-JP')+' pt';td.setAttribute('aria-label',row.displayValues?row.displayValues[i-3]+'（画面表示値・概数）':row.values[i-3]+'ポイント');}tr.appendChild(td);}const td=node('td');td.appendChild(sourceNode(row));tr.appendChild(td);body.appendChild(tr);}table.appendChild(body);$('tableResults').appendChild(table);}
 else for(const row of slice.rows)$('results').appendChild(card(row));
 if(manualBefore&&manualCardCopy===manualBefore)manualCardCopy=null;
 if(manualFocus&&manualCardCopy?.text===manualBefore.text){manualCardCopy.textarea.focus({preventScroll:true});manualCardCopy.textarea.setSelectionRange?.(selectionStart??0,selectionEnd??manualBefore.text.length);}
 for(const suffix of ['', 'Top']){$status('pageInfo'+suffix).textContent=slice.page+' / '+slice.pages+'ページ';$('prevPage'+suffix).disabled=slice.page<=1;$('nextPage'+suffix).disabled=slice.page>=slice.pages;$('prevPage'+suffix).textContent='前の'+size+'件';$('nextPage'+suffix).textContent='次の'+size+'件';}
 $status('visibleRange').textContent=allMatches.length?((page-1)*size+1).toLocaleString('ja-JP')+'〜'+Math.min(page*size,allMatches.length).toLocaleString('ja-JP')+'件を表示（全'+allMatches.length.toLocaleString('ja-JP')+'件）':'表示する記録はありません。';
 $('pageJumpPanel').hidden=slice.pages<=1;for(const id of ['pagerTop','pagerBottom'])$(id).hidden=slice.pages<=1;$('pageJump').value=String(page);$('pageJump').max=String(slice.pages);$status('pageJumpLimit').textContent='1〜'+slice.pages+'ページ';$('pageJump').disabled=$('goPage').disabled=!allMatches.length;savePreferences();return result;

}
function renderRecordNavigation(f){
 const navigation=historyRecordNavigation(index,f),target=(f.rank||'全ランク')+' · '+(f.close?f.close+'時〆':'すべての締め時間'),period=f.start&&f.start===f.end?f.start.replaceAll('-','/'):f.start||f.end?(f.start||'最初の記録')+'〜'+(f.end||'最新の記録'):'すべての日付';
 $status('targetSummary').textContent=target+' / '+(f.units==='K'?'K表示':'pt表示');$('resultHeading').textContent=target+'の検索結果';
 $status('calendarSummary').textContent=$('calendarLabel').textContent+(f.start&&f.start===f.end?' / '+f.start.replaceAll('-','/')+' 選択中':'');
 $status('recordDateLabel').textContent=navigation.count?period+' · 記録のある日へ移動':'このランク・締め時間・記録の種類に記録がありません。';
 $('prevRecord').disabled=!navigation.previous;$('nextRecord').disabled=!navigation.next;$('latestRecord').disabled=$('emptyLatest').disabled=!navigation.latest;
 for(const [id,date,label] of [['prevRecord',navigation.previous,'前の記録日'],['nextRecord',navigation.next,'次の記録日']])$(id).setAttribute('aria-label',label+(date?' '+date.replaceAll('-','/'):'（記録なし）'));
 $('showResults').textContent=allMatches.length?'結果 '+allMatches.length.toLocaleString('ja-JP')+'件へ ↓':'検索結果へ ↓';
}
function selectRecordDay(direction){const navigation=historyRecordNavigation(index,filters()),date=direction<0?navigation.previous:direction>0?navigation.next:navigation.latest;if(!date)return;setRange({start:date,end:date});moveTo('resultHeading');}
function syncSearchCopy(){const signature=JSON.stringify(filters());if(signature===lastFilterSignature)return;lastFilterSignature=signature;searchCopyRequest++;searchCopyPending=false;$('copySearch').disabled=false;$('copySearch').removeAttribute?.('aria-busy');$('copyFallback').hidden=$('closeCopySearch').hidden=true;$status('copySearchStatus').textContent='';}
function moveTo(id){document.activeElement?.blur?.();$(id).focus({preventScroll:true});$(id).scrollIntoView({block:'start',behavior:'auto'});}
$('historyForm').addEventListener('submit',event=>{event.preventDefault();if(composing||event.isComposing)return;clearTimeout(inputTimer);const result=render(true);if(result.error){$('advanced').open=true;moveTo('start');}else moveTo('resultHeading');});
$('clearQuery').addEventListener('click',()=>{$('query').value='';clearTimeout(inputTimer);composing=false;render(true);$('query').focus();});
$('editConditions').addEventListener('click',()=>moveTo('filterHeading'));$('showResults').addEventListener('click',()=>moveTo('resultHeading'));
$('pageJumpForm').addEventListener('submit',event=>{event.preventDefault();const requested=Number($('pageJump').value);if(!Number.isInteger(requested)||requested<1){$('pageJump').value=String(page);$('pageJump').focus();return;}page=requested;render();moveTo('resultHeading');});
for(const id of filterIDs)$(id).addEventListener('change',()=>{if(['units','view'].includes(id)){render();return;}if(id==='pageSize'){const first=(page-1)*renderedPageSize,size=Number($('pageSize').value)||20;page=Math.floor(first/size)+1;render();return;}if(['start','end'].includes(id))displayMonth='';render(true);});
$('query').addEventListener('compositionstart',()=>{composing=true;clearTimeout(inputTimer);});$('query').addEventListener('compositionend',()=>{composing=false;render(true);});$('query').addEventListener('input',()=>{if(composing)return;clearTimeout(inputTimer);inputTimer=setTimeout(()=>render(true),180);});
$('month').addEventListener('change',()=>browseMonth($('month').value));for(const [id,delta] of [['prevMonth',-1],['nextMonth',1]])$(id).addEventListener('click',()=>{const range=historyMonthRange(calendarMonth(),delta);if(range)browseMonth(range.month);});
for(const [id,direction] of [['prevRecord',-1],['nextRecord',1],['latestRecord',0],['emptyLatest',0]])$(id).addEventListener('click',()=>selectRecordDay(direction));
$('emptyEdit').addEventListener('click',()=>{$('advanced').open=true;moveTo('query');});
$('monthAll').addEventListener('click',()=>{setRange(historyMonthRange(calendarMonth()));moveTo('resultHeading');});
for(const [id,days] of [['recent7',7],['recent30',30]])$(id).addEventListener('click',()=>{setRange(recentHistoryRange(index,filters(),days));moveTo('resultHeading');});$('latestMonth').addEventListener('click',()=>{latestMonth();moveTo('resultHeading');});
function clearFilters(){composing=false;clearTimeout(inputTimer);displayMonth='';for(const id of ['query','rank','close','start','end','origin'])$(id).value='';$('month').value='';render(true);}for(const id of ['clearFilters','emptyClear'])$(id).addEventListener('click',clearFilters);
for(const [id,delta] of [['prevPage',-1],['nextPage',1],['prevPageTop',-1],['nextPageTop',1]])$(id).addEventListener('click',()=>{page+=delta;render();moveTo('resultHeading');});
$('themeButton').addEventListener('click',()=>{document.body.classList.toggle('light');syncTheme();try{localStorage.setItem(THEME_KEY,document.body.classList.contains('light')?'light':'dark');}catch{$status('preferenceStatus').textContent='表示の明るさを保存できません。現在の表示は利用できます。';}});
$('copySearch').addEventListener('click',async()=>{
 if(searchCopyPending)return;const signature=JSON.stringify(filters()),request=++searchCopyRequest,url=new URL(location.href);url.search='';url.hash=new URLSearchParams(filters()).toString();searchCopyPending=true;$('copySearch').disabled=true;$('copySearch').setAttribute('aria-busy','true');$status('copySearchStatus').textContent='リンクをコピーしています…';
 const current=()=>request===searchCopyRequest&&signature===JSON.stringify(filters());
 try{if(typeof navigator.clipboard?.writeText!=='function')throw Error('Clipboard unavailable');await navigator.clipboard.writeText(url.href);if(!current())return;$('copyFallback').hidden=$('closeCopySearch').hidden=true;$status('copySearchStatus').textContent='検索条件のリンクをコピーしました。';}
 catch{if(!current())return;$('copyFallback').value=url.href;$('copyFallback').hidden=$('closeCopySearch').hidden=false;$('copyFallback').focus({preventScroll:true});$('copyFallback').select();$('copyFallback').setSelectionRange?.(0,url.href.length);$('copyFallback').scrollIntoView({block:'nearest',behavior:'auto'});$status('copySearchStatus').textContent='自動コピーできません。表示されたリンクを長押ししてコピーしてください。';}
 finally{if(request===searchCopyRequest){searchCopyPending=false;$('copySearch').disabled=false;$('copySearch').setAttribute('aria-busy','false');}}
});
$('closeCopySearch').addEventListener('click',()=>{searchCopyRequest++;searchCopyPending=false;$('copySearch').disabled=false;$('copySearch').setAttribute('aria-busy','false');$('copyFallback').hidden=$('closeCopySearch').hidden=true;$status('copySearchStatus').textContent='';$('advanced').open=true;$('copySearch').focus({preventScroll:true});});
window.addEventListener('storage',event=>{if(event.key===MAIN_KEY||event.key===E_KEY||event.key===null){rebuild();render();}});
window.addEventListener('hashchange',()=>{loadPreferences();render(true);});
rebuild();const restoredPreferences=loadPreferences();if(!restoredPreferences)latestMonth();else render();
function showNetworkIdle(message){$('networkStatus').textContent=message;$('retryPublic').disabled=false;$('retryPublic').textContent='公開データを再確認';$('retryPublic').setAttribute('aria-busy','false');}
function stopPublic(message){const request=publicRequest;if(request){publicRequest=null;request.controller.abort();request.cancel();}showNetworkIdle(message);}
async function refreshPublic(){
 if(navigator.onLine===false){showNetworkIdle('オフライン：保存資料と、この端末にある記録を表示しています。接続後に再確認できます。');return;}
 if(publicRequest)return;
 const controller=new AbortController(),request={controller,cancel:()=>{}},deadline=new Promise((_,reject)=>{request.cancel=()=>reject(Error('cancelled'));});publicRequest=request;
 const timer=setTimeout(()=>{controller.abort();request.cancel();},12000);
 $('retryPublic').disabled=true;$('retryPublic').textContent='確認中…';$('retryPublic').setAttribute('aria-busy','true');$('networkStatus').textContent='保存済みの記録を表示中。公開データを確認しています。';
 try{
  const text=await Promise.race([(async()=>{const response=await fetch('__BORDER_API__',{cache:'no-cache',credentials:'__API_CREDENTIALS__',signal:controller.signal});if(!response.ok)throw Error('unavailable');return readHistoryResponse(response,controller.signal);})(),deadline]);
  if(publicRequest!==request||controller.signal.aborted)return;if(text.length>8*1024*1024)throw Error('too large');const data=JSON.parse(text);
  if(!isObject(data)||!validHistoryDate(data.serverDate)||!Array.isArray(data.records)||data.records.length>5000||data.records.some(row=>!isObject(row)||!validHistoryDate(row.date)||row.date>=data.serverDate||!HISTORY_CLOSES.includes(String(row.close))||!historySource(row.sourceURL)||!isObject(row.ranks)||Object.keys(row.ranks).some(rank=>rank==='E'||!HISTORY_RANKS.includes(rank)||!validHistoryTriple(row.ranks[rank]))))throw Error('invalid data');
  liveRows=normalizeHistoryRows(data.records,'remote');rebuild();render();showNetworkIdle('公開データを確認しました。掲載・取得・端末保存の記録を区別して表示しています。');
 }catch{if(publicRequest===request)showNetworkIdle(navigator.onLine===false?'オフライン：保存済みの記録を表示しています。接続後に再確認できます。':'公開データを確認できませんでした。保存済みの記録は閲覧できます。「公開データを再確認」で再試行できます。');}
 finally{clearTimeout(timer);if(publicRequest===request){publicRequest=null;$('retryPublic').disabled=false;$('retryPublic').setAttribute('aria-busy','false');}}
}
$('retryPublic').addEventListener('click',refreshPublic);refreshPublic();window.addEventListener('online',refreshPublic);
window.addEventListener('offline',()=>stopPublic('オフライン：保存済みの記録を表示しています。接続後に再確認できます。'));
window.addEventListener('pagehide',()=>{composing=false;clearTimeout(inputTimer);inputTimer=0;searchCopyRequest++;if(searchCopyPending)$status('copySearchStatus').textContent='';searchCopyPending=false;$('copySearch').disabled=false;$('copySearch').setAttribute('aria-busy','false');latestCardCopyRequest++;cardCopyEpoch++;pendingCardCopies.clear();for(const state of cardCopyNodes.values())state.button.disabled=false;stopPublic('保存済みの記録を表示しています。必要に応じて公開データを再確認できます。');});
if('serviceWorker' in navigator&&window.isSecureContext)navigator.serviceWorker.register('./meter-sw.js',{scope:'./',updateViaCache:'none'}).catch(()=>{});
// A restored page can miss storage events while it is frozen in the back-forward cache.
window.addEventListener('pageshow',event=>{if(!event.persisted)return;rebuild();render();refreshPublic();});

function renderMeterCalendar(){
 if(!$('meterCalendarPanel').open)return;
 if(!meterCalendarInitialized){$('meterCalendarRank').value=$('rank').value;$('meterCalendarClose').value=$('close').value;meterCalendarInitialized=true;}
 if(!meterCalendarMonthValue)meterCalendarMonthValue=calendarMonth();
 const model=historyMeterCalendar(index,{...filters(),rank:$('meterCalendarRank').value,close:$('meterCalendarClose').value},meterCalendarMonthValue);$('meterCalendarResults').replaceChildren();
 if(!model){$status('meterCalendarStatus').textContent='月・ランク・締め時間を確認してください。';return;}
 $('meterCalendarMonth').value=model.month;$('meterCalendarPrev').disabled=!historyMonthRange(model.month,-1);$('meterCalendarNext').disabled=!historyMonthRange(model.month,1);
 $status('meterCalendarStatus').textContent=model.month.replace('-','年')+'月 · '+($('meterCalendarRank').value||'全ランク')+' · '+($('meterCalendarClose').value?$('meterCalendarClose').value+'時〆':'すべての締め時間')+' · '+model.count.toLocaleString('ja-JP')+'件'+(eCalendarReadFailed?' · E帯の保存記録を読み直せません。読み込み済みの内容を表示しています。':'');
 for(const group of model.ranks){
  const section=node('section',undefined,'meter-calendar-rank'),heading=node('h3',group.rank+' · '+group.count+'件'),scroll=node('div',undefined,'meter-calendar-scroll'),grid=node('div',undefined,'meter-calendar-grid');
  scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label',model.month+' '+group.rank+'のメーター結果カレンダー。左右にスクロールできます');
  for(const label of ['日','月','火','水','木','金','土'])grid.appendChild(node('div',label,'meter-weekday'));
  for(const cell of group.cells){
   if(!cell){const blank=node('div',undefined,'meter-blank');blank.setAttribute('aria-hidden','true');grid.appendChild(blank);continue;}
   const day=node('article',undefined,'meter-day'),time=node('time',String(Number(cell.date.slice(8)))+'日');time.dateTime=cell.date;day.setAttribute('aria-label',cell.date+' '+group.rank);day.appendChild(time);
   for(const {close,row,conflict} of cell.records){const block=node('div',undefined,'meter-day-record');block.appendChild(node('p',close+'時〆'));if(conflict)block.appendChild(node('p','同じ日の保存値が複数あります','notice'));
    if(!row)block.appendChild(node('p','記録なし','sub'));
    else{const nums=node('dl');row.values.forEach((value,i)=>{nums.appendChild(node('dt',['±0','＋1','＋2'][i]));const display=row.displayValues?row.displayValues[i]:historyRowNumber(row,i,$('units').value),dd=node('dd',display);dd.title=row.displayValues?'画面表示値（概数）':value.toLocaleString('ja-JP')+' pt';dd.setAttribute('aria-label',['プラスマイナス0','プラス1','プラス2'][i]+' '+(row.displayValues?display+'（画面表示値）':value+'ポイント'));nums.appendChild(dd);});block.appendChild(nums);if(row.displayValues){block.appendChild(node('p','画面表示値（概数）','sub'));block.appendChild(node('p',row.sourceNote,'source'));}else block.appendChild(sourceNode(row));}
    day.appendChild(block);
   }grid.appendChild(day);
  }scroll.appendChild(grid);section.appendChild(heading);section.appendChild(scroll);$('meterCalendarResults').appendChild(section);
 }
}
$('meterCalendarPanel').addEventListener('toggle',renderMeterCalendar);
$('meterCalendarMonth').addEventListener('change',()=>{const range=historyMonthRange($('meterCalendarMonth').value);if(range){meterCalendarMonthValue=range.month;renderMeterCalendar();}else{$('meterCalendarMonth').value=meterCalendarMonthValue;$status('meterCalendarStatus').textContent='2000年1月から2099年12月の月を選んでください。';}});
for(const [id,delta] of [['meterCalendarPrev',-1],['meterCalendarNext',1]])$(id).addEventListener('click',()=>{const range=historyMonthRange(meterCalendarMonthValue,delta);if(range){meterCalendarMonthValue=range.month;renderMeterCalendar();}});

for(const rank of METER_CALENDAR_RANKS){const option=node('option',rank);option.value=rank;$('meterCalendarRank').appendChild(option);}
for(const id of ['meterCalendarRank','meterCalendarClose'])$(id).addEventListener('change',renderMeterCalendar);
