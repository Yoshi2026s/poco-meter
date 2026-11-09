import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
// Compose the production template, core, data and UI without writing the generated
// page while another task builds it. Generated CSP is checked independently.
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const byDay=new Map();for(const row of ['db/history-2025-2026.json','db/history-2026-10-02-03.json','db/seed.json'].flatMap(path=>JSON.parse(read(path)))){const key=row.date+'|'+row.close,old=byDay.get(key);byDay.set(key,{...row,ranks:{...old?.ranks,...row.ranks}});}
const seed=[...byDay.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.close.localeCompare(b.close));
const template=read('calculator/history-page-template.html'),core=read('calculator/history-core.mjs'),ui=read('calculator/history-ui.mjs'),version=read('calculator/index.html').match(/最終更新バージョン：(v[\d.]+)/)?.[1];
assert.ok(version,'The source page must carry its release version');
const html=template.replace('__VERSION__',version).replace('__CORE__',core.replace(/\bexport /g,'')+'\n'+['calculator/e-border-core.mjs','calculator/e-border-store.mjs'].map(p=>read(p).replace(/^import .*;\n/gm,'').replace(/\bexport /g,'')).join('\n')).replace('__DATA__',JSON.stringify(seed).replaceAll('<','\\u003c')).replace('__UI__',ui.replace('__BORDER_API__','/api/borders').replace('__API_CREDENTIALS__','same-origin'));
const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
function setup({preferences,hash='',theme,clipboard,online=false,fetcher,calculatorState,eStateRaw}={}){const handlers={},nodes=new Map(),timers=new Map(),writes=[],copied=[],requests=[];let serial=0,clock=0;
 const cls=()=>{const set=new Set();return {toggle(k,v){if(v??!set.has(k))set.add(k);else set.delete(k);},contains:k=>set.has(k)};};let active;
 function node(tag='div',id=''){const attrs=new Map(),events={};return {tagName:tag.toUpperCase(),id,value:'',textContent:'',hidden:false,disabled:false,open:false,children:[],classList:cls(),style:{},get options(){return this.children.filter(c=>c.tagName==='OPTION');},appendChild(child){child.parentElement=this;this.children.push(child);return child;},replaceChildren(...items){this.children=[];for(const item of items)this.appendChild(item);},setAttribute(k,v){attrs.set(k,String(v));},removeAttribute(k){attrs.delete(k);},getAttribute:k=>attrs.get(k),addEventListener(k,fn){(events[k]??=[]).push(fn);},dispatch(type,extra={}){for(const fn of events[type]||[])fn({type,target:this,currentTarget:this,preventDefault(){},...extra});},focus(){active=this;},blur(){if(active===this)active=undefined;this.blurred=true;},select(){this.selected=true;},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},scrollIntoView(){this.scrolled=true;}};}
 for(const m of html.matchAll(/<([a-z][a-z0-9-]*)[^>]*id="([^"]+)"[^>]*>/g)){const n=node(m[1],m[2]);for(const flag of ['hidden','disabled','open'])n[flag]=new RegExp('\\s'+flag+'(?:\\s|=|>)').test(m[0]);for(const a of m[0].matchAll(/([\w-]+)="([^"]*)"/g)){n.setAttribute(a[1],a[2]);if(a[1]==='value')n.value=a[2];}nodes.set(m[2],n);}
 for(const m of html.matchAll(/<select[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)){const n=nodes.get(m[1]);for(const v of m[2].matchAll(/<option value="([^"]*)">([^<]*)/g)){const o=node('option');o.value=v[1];o.textContent=v[2];n.appendChild(o);}n.value=[...m[2].matchAll(/<option value="([^"]*)"([^>]*)>/g)].find(o=>o[2].includes('selected'))?.[1]??n.options[0]?.value??'';}
 const key='pococha-meter-calc-v1',raw=typeof calculatorState==='string'?calculatorState:JSON.stringify(calculatorState??{target:'999999',current:'123456',rank:'S2',deadline:'22:00',log:{'2026-10-03':{S2:[1,2,3]}},provenance:{22:{'2026-10-03':{S2:{origin:'manual',source:''}}}}}),stored=new Map([[key,raw]]);
 if(eStateRaw!==undefined)stored.set('pococha-e-display-v1',eStateRaw);
 if(preferences)stored.set('pococha-meter-history-v1',JSON.stringify(preferences));if(theme)stored.set('pococha-meter-history-theme-v1',theme);
 const document={get activeElement(){return active;},getElementById:id=>nodes.get(id),createElement:tag=>node(tag),createTextNode:text=>({textContent:text}),body:{classList:cls()}};
 const clipboardAPI=clipboard===false?undefined:clipboard??{async writeText(text){copied.push(text);}};
 const ctx=vm.createContext({document,URL,URLSearchParams,TextDecoder,location:{href:'https://example.test/border-history',hash},navigator:{onLine:online,clipboard:clipboardAPI},window:{isSecureContext:false,addEventListener(k,fn){(handlers[k]??=[]).push(fn);}},localStorage:{getItem:k=>stored.get(k)??null,setItem(k,v){writes.push(k);stored.set(k,v);}},fetch(url,options={}){const request={url,...options};requests.push(request);return fetcher?fetcher(url,options,requests):Promise.reject(Error('No test fetcher configured'));},setTimeout(fn,ms=0){const id=++serial;timers.set(id,{fn,due:clock+Math.max(0,Number(ms)||0)});return id;},clearTimeout:id=>timers.delete(id),AbortController,console});
 const advance=ms=>{const end=clock+ms;for(let count=0;count<1000;count++){const next=[...timers].filter(([,timer])=>timer.due<=end).sort((a,b)=>a[1].due-b[1].due||a[0]-b[0])[0];if(!next)break;const [id,timer]=next;clock=timer.due;timers.delete(id);timer.fn();}clock=end;};
 vm.runInContext(script,ctx,{timeout:5000});return {nodes,stored,raw,key,writes,copied,requests,get active(){return active;},input(id,value,type='change'){nodes.get(id).value=value;nodes.get(id).dispatch(type);},click:id=>nodes.get(id).dispatch('click'),toggle(id,open){nodes.get(id).open=open;nodes.get(id).dispatch('toggle');},emitWindow(type,event={}){if(type==='online')ctx.navigator.onLine=true;if(type==='offline')ctx.navigator.onLine=false;for(const fn of handlers[type]||[])fn({type,...event});},advance,flush(){advance(180);},async settle(){for(let i=0;i<16;i++)await Promise.resolve();},ctx};
}
test('Source-composed page initializes saved preferences, renders at most 20 cards and never writes calculator values',()=>{
 const p=setup();assert.equal(p.nodes.get('rank').value,'S2');assert.equal(p.nodes.get('close').value,'22');assert.ok(p.nodes.get('results').children.length<=20);assert.match(p.nodes.get('networkStatus').textContent,/オフライン/);assert.equal(p.stored.get(p.key),p.raw);assert.ok(!p.writes.includes(p.key));
 p.click('recent7');p.input('rank','S1');p.input('close','13');p.toggle('calendarPanel',true);p.click('prevMonth');p.click('nextMonth');p.click('clearFilters');p.click('nextPage');assert.ok(p.nodes.get('results').children.length<=20);assert.equal(p.stored.get(p.key),p.raw);
});
test('History defaults to S2 without saved filters or a valid calculator rank',()=>{
 for(const calculatorState of ['null','broken','{"rank":"invalid"}']){
  const p=setup({calculatorState});assert.equal(p.nodes.get('rank').value,'S2');assert.equal(p.nodes.get('close').value,'22');
 }
 assert.equal(setup({calculatorState:{rank:'S1'}}).nodes.get('rank').value,'S1');
 assert.equal(setup({preferences:{rank:'A2'}}).nodes.get('rank').value,'A2');
});
test('Japanese date and rank search, no hits, table mode and invalid range use the real event handlers',()=>{
 const p=setup();p.click('clearFilters');p.input('query','2026/10/3 S2 22時');assert.equal(p.nodes.get('results').children.length,1);assert.equal(p.nodes.get('results').children[0].children[1].children[0].children[1].textContent,'1');
 p.input('units','K');assert.equal(p.nodes.get('results').children[0].children[1].children[0].children[1].textContent,'0K');
 p.input('view','table');assert.equal(p.nodes.get('results').hidden,true);assert.equal(p.nodes.get('tableResults').hidden,false);assert.ok(p.nodes.get('tableResults').children.length===1);
 p.input('query','存在しない条件');assert.equal(p.nodes.get('emptyState').hidden,false);p.click('emptyClear');p.input('start','2026-10-05');p.input('end','2026-10-01');assert.equal(p.nodes.get('searchError').hidden,false);assert.equal(p.nodes.get('start').getAttribute('aria-invalid'),'true');assert.equal(p.stored.get(p.key),p.raw);
});
test('IME search waits for composition to finish and copying a link includes filters rather than input values',async()=>{
 const p=setup();p.click('clearFilters');const before=p.nodes.get('results').children.length;p.nodes.get('query').dispatch('compositionstart');p.input('query','2026/10/3 S2 22時','input');p.flush();assert.equal(p.nodes.get('results').children.length,before);p.nodes.get('query').dispatch('compositionend');assert.equal(p.nodes.get('results').children.length,1);
 p.click('copySearch');await Promise.resolve();assert.equal(p.copied.length,1);assert.ok(p.copied[0].includes('#'));assert.ok(!p.copied[0].includes('123456'));assert.ok(!p.copied[0].includes('999999'));assert.equal(p.stored.get(p.key),p.raw);
});

test('Search submit dismisses the keyboard, focuses the results and opens date correction for an invalid range',()=>{
 const p=setup();p.nodes.get('query').focus();p.nodes.get('historyForm').dispatch('submit');assert.equal(p.active,p.nodes.get('resultHeading'));assert.equal(p.nodes.get('query').blurred,true);assert.equal(p.nodes.get('resultHeading').scrolled,true);
 p.input('start','2026-10-05');p.input('end','2026-10-01');p.nodes.get('historyForm').dispatch('submit');assert.equal(p.nodes.get('advanced').open,true);assert.equal(p.active,p.nodes.get('start'));assert.equal(p.stored.get(p.key),p.raw);
 p.nodes.get('query').dispatch('compositionstart');p.nodes.get('query').focus();p.nodes.get('historyForm').dispatch('submit');assert.equal(p.active,p.nodes.get('query'));p.nodes.get('query').dispatch('compositionend');
});
test('Both pagers, direct page jumps and every selectable page size render the same bounded records',()=>{
 const p=setup();assert.equal(p.nodes.get('pageSize').value,'20');p.click('clearFilters');
 for(const size of ['10','20','30','50']){p.input('pageSize',size);assert.equal(p.nodes.get('results').children.length,Number(size));assert.match(p.nodes.get('visibleRange').textContent,new RegExp('1〜'+size+'件'));p.click('nextPageTop');assert.equal(p.nodes.get('pageInfo').textContent,p.nodes.get('pageInfoTop').textContent);assert.match(p.nodes.get('pageInfo').textContent,/^2 /);assert.equal(p.active,p.nodes.get('resultHeading'));p.click('prevPage');assert.match(p.nodes.get('pageInfoTop').textContent,/^1 /);assert.equal(p.nodes.get('prevPageTop').disabled,true);}
 p.input('pageJump','999999','input');p.nodes.get('pageJumpForm').dispatch('submit');assert.equal(p.nodes.get('pageJump').value,p.nodes.get('pageJump').max);assert.equal(p.nodes.get('nextPage').disabled,true);assert.equal(p.nodes.get('nextPageTop').disabled,true);
 p.input('pageJump','2','input');p.nodes.get('pageJumpForm').dispatch('submit');assert.match(p.nodes.get('pageInfo').textContent,/^2 /);p.input('pageJump','1.5','input');p.nodes.get('pageJumpForm').dispatch('submit');assert.equal(p.nodes.get('pageJump').value,'2');assert.equal(p.active,p.nodes.get('pageJump'));
 p.input('query','存在しない条件');assert.equal(p.nodes.get('goPage').disabled,true);assert.equal(p.nodes.get('pageJump').disabled,true);assert.equal(p.nodes.get('prevPageTop').disabled,true);assert.equal(p.nodes.get('nextPageTop').disabled,true);
});
test('Removing one condition preserves others; keyword clearing and mobile navigation are independent',()=>{
 const p=setup();p.input('origin','personal');p.input('query','S2');const remove=p.nodes.get('scope').children.find(n=>n.getAttribute('aria-label')==='S2の条件を解除');remove.dispatch('click');assert.equal(p.nodes.get('rank').value,'');assert.equal(p.nodes.get('origin').value,'personal');assert.equal(p.nodes.get('close').value,'22');assert.equal(p.nodes.get('query').value,'S2');
 p.click('clearQuery');assert.equal(p.nodes.get('query').value,'');assert.equal(p.nodes.get('clearQuery').disabled,true);assert.equal(p.active,p.nodes.get('query'));p.click('editConditions');assert.equal(p.active,p.nodes.get('filterHeading'));p.click('showResults');assert.equal(p.active,p.nodes.get('resultHeading'));
 const period=p.nodes.get('scope').children.find(n=>n.getAttribute('aria-label')?.includes('〜'));period.dispatch('click');assert.equal(p.nodes.get('start').value,'');assert.equal(p.nodes.get('end').value,'');assert.equal(p.nodes.get('month').value,'2026-10');assert.equal(p.nodes.get('origin').value,'personal');assert.equal(p.stored.get(p.key),p.raw);
});
test('Saved or linked dates choose a calendar display month without changing the searched date range',()=>{
 const p=setup({preferences:{start:'2024-02-01',end:'2024-02-29',rank:'S2',close:'22',pageSize:'20'}});assert.equal(p.nodes.get('month').value,'2024-02');assert.equal(p.nodes.get('pageSize').value,'20');p.toggle('calendarPanel',true);p.click('prevMonth');assert.equal(p.nodes.get('month').value,'2024-01');assert.equal(p.nodes.get('start').value,'2024-02-01');assert.equal(p.nodes.get('end').value,'2024-02-29');p.click('nextMonth');assert.equal(p.nodes.get('month').value,'2024-02');assert.equal(p.nodes.get('end').value,'2024-02-29');
 const linked=setup({hash:'#start=2025-12-25&end=2026-01-03&rank=S2&close=22&pageSize=50'});assert.equal(linked.nodes.get('month').value,'2026-01');linked.toggle('calendarPanel',true);linked.click('nextMonth');assert.equal(linked.nodes.get('month').value,'2026-02');assert.equal(linked.nodes.get('start').value,'2025-12-25');assert.equal(linked.nodes.get('end').value,'2026-01-03');
});
test('History theme persists independently; table K values retain the exact point value for assistive readers',()=>{
 const p=setup({theme:'light'});assert.equal(p.ctx.document.body.classList.contains('light'),true);p.click('themeButton');assert.equal(p.stored.get('pococha-meter-history-theme-v1'),'dark');assert.ok(!p.writes.includes('pococha-meter-display-v1'));assert.equal(p.stored.get(p.key),p.raw);
 p.click('clearFilters');p.input('query','2026/10/3 S2 22時');p.input('units','K');p.input('view','table');const row=p.nodes.get('tableResults').children[0].children[2].children[0];assert.equal(row.children[3].textContent,'0K');assert.equal(row.children[3].getAttribute('aria-label'),'1ポイント');
});

const calendarButtons=p=>p.nodes.get('calendarDays').children.filter(n=>n.tagName==='BUTTON');
const calendarDay=(p,date)=>calendarButtons(p).find(n=>n.getAttribute('data-calendar-date')===date);
const calendarMarks=p=>Object.fromEntries(calendarButtons(p).map(n=>[n.getAttribute('data-calendar-date'),n.getAttribute('data-has-record')]));
function calculatorUnchanged(p){assert.equal(p.stored.get(p.key),p.raw);assert.ok(!p.writes.includes(p.key));}

test('Calendar lays out the real leap month and browsing commits dates only through a day or month selection',()=>{
 const p=setup({preferences:{start:'2024-02-01',end:'2024-02-29',rank:'S2',close:'22'}}),cells=p.nodes.get('calendarDays').children,days=calendarButtons(p);
 p.toggle('calendarPanel',true);
 assert.equal(p.nodes.get('calendarLabel').textContent,'2024年2月');assert.equal(days.length,29);
 assert.equal(days[0].getAttribute('data-calendar-date'),'2024-02-01');assert.equal(days.at(-1).getAttribute('data-calendar-date'),'2024-02-29');assert.equal(new Set(days.map(n=>n.getAttribute('data-calendar-date'))).size,29);
 assert.equal(cells.indexOf(days[0]),4);for(const blank of cells.slice(0,4)){assert.equal(blank.tagName,'SPAN');assert.equal(blank.getAttribute('aria-hidden'),'true');}
 for(const day of days){assert.equal(day.type,'button');assert.equal(day.getAttribute('data-has-record'),'false');assert.match(day.getAttribute('aria-label'),/記録なし/);}
 calendarDay(p,'2024-02-29').dispatch('click');assert.equal(p.nodes.get('start').value,'2024-02-29');assert.equal(p.nodes.get('end').value,'2024-02-29');assert.equal(p.nodes.get('emptyState').hidden,false);
 p.click('prevMonth');assert.equal(p.nodes.get('month').value,'2024-01');assert.equal(p.nodes.get('start').value,'2024-02-29');assert.equal(p.nodes.get('end').value,'2024-02-29');assert.equal(calendarButtons(p).length,31);
 p.click('nextMonth');assert.equal(p.nodes.get('start').value,'2024-02-29');assert.equal(p.nodes.get('end').value,'2024-02-29');p.click('monthAll');assert.equal(p.nodes.get('start').value,'2024-02-01');assert.equal(p.nodes.get('end').value,'2024-02-29');calculatorUnchanged(p);
});

test('Calendar day tap clears a pending keyword, selects only that day and moves to exact results',()=>{
 const p=setup();p.toggle('calendarPanel',true);p.input('month','2026-10');p.input('query','存在しない条件','input');p.nodes.get('query').focus();
 calendarDay(p,'2026-10-03').dispatch('click');p.flush();
 assert.equal(p.nodes.get('start').value,'2026-10-03');assert.equal(p.nodes.get('end').value,'2026-10-03');assert.equal(p.nodes.get('query').value,'');assert.equal(p.nodes.get('month').value,'2026-10');
 const selected=calendarButtons(p).filter(n=>n.getAttribute('aria-pressed')==='true');assert.equal(selected.length,1);assert.equal(selected[0].getAttribute('data-calendar-date'),'2026-10-03');assert.equal(selected[0].classList.contains('in-range'),false);
 assert.match(p.nodes.get('calendarStatus').textContent,/2026\/10\/03.*選択/);assert.equal(p.active,p.nodes.get('resultHeading'));assert.equal(p.nodes.get('resultHeading').scrolled,true);assert.equal(p.nodes.get('query').blurred,true);
 const result=p.nodes.get('results').children;assert.equal(result.length,1);assert.equal(result[0].children[0].children[0].textContent,'2026/10/03');assert.equal(result[0].children[1].children[0].children[1].textContent,'1');
 p.click('monthAll');assert.equal(p.nodes.get('start').value,'2026-10-01');assert.equal(p.nodes.get('end').value,'2026-10-31');assert.equal(calendarButtons(p).filter(n=>n.getAttribute('aria-pressed')==='true').length,0);assert.ok(calendarButtons(p).every(n=>n.classList.contains('in-range')));assert.equal(p.active,p.nodes.get('resultHeading'));calculatorUnchanged(p);
});

test('Calendar record markers ignore keyword/date limits but follow rank, close and record origin',()=>{
 const p=setup();p.toggle('calendarPanel',true);p.input('month','2026-10');const before=calendarMarks(p);assert.equal(before['2026-10-03'],'true');
 p.input('query','存在しない条件');assert.equal(p.nodes.get('emptyState').hidden,false);assert.deepEqual(calendarMarks(p),before);
 p.input('start','2026-10-04');p.input('end','2026-10-05');assert.deepEqual(calendarMarks(p),before);
 p.input('origin','personal');assert.equal(calendarDay(p,'2026-10-03').getAttribute('data-has-record'),'true');assert.equal(calendarDay(p,'2026-10-02').getAttribute('data-has-record'),'false');
 p.input('rank','S1');assert.equal(calendarDay(p,'2026-10-03').getAttribute('data-has-record'),'false');p.input('rank','S2');p.input('close','13');assert.equal(calendarDay(p,'2026-10-03').getAttribute('data-has-record'),'false');
 p.input('origin','published');assert.equal(calendarDay(p,'2026-10-03').getAttribute('data-has-record'),'true');p.input('close','22');assert.equal(calendarDay(p,'2026-10-03').getAttribute('data-has-record'),'false');
 calculatorUnchanged(p);
});

test('Saved preferences and copied filter hash restore the same single calendar selection',async()=>{
 const p=setup();p.toggle('calendarPanel',true);p.input('month','2026-10');calendarDay(p,'2026-10-03').dispatch('click');
 const prefs=JSON.parse(p.stored.get('pococha-meter-history-v1')),reloaded=setup({preferences:prefs});assert.equal(reloaded.nodes.get('month').value,'2026-10');assert.equal(calendarDay(reloaded,'2026-10-03').getAttribute('aria-pressed'),'true');
 p.click('copySearch');await Promise.resolve();const url=new URL(p.copied[0]),linked=setup({hash:url.hash});
 assert.equal(new URLSearchParams(url.hash.slice(1)).get('start'),'2026-10-03');assert.equal(new URLSearchParams(url.hash.slice(1)).get('end'),'2026-10-03');assert.equal(linked.nodes.get('start').value,'2026-10-03');assert.equal(linked.nodes.get('end').value,'2026-10-03');assert.equal(calendarDay(linked,'2026-10-03').getAttribute('aria-pressed'),'true');
 assert.ok(!url.href.includes('123456'));assert.ok(!url.href.includes('999999'));for(const page of [p,reloaded,linked])calculatorUnchanged(page);
});

test('Calendar range markers restore from preferences and distinguish a range from a single selection',()=>{
 const p=setup({preferences:{start:'2026-10-02',end:'2026-10-04',rank:'S2',close:'22'}});
 p.toggle('calendarPanel',true);
 assert.equal(p.nodes.get('month').value,'2026-10');assert.equal(calendarButtons(p).filter(n=>n.getAttribute('aria-pressed')==='true').length,0);
 for(const date of ['2026-10-02','2026-10-03','2026-10-04'])assert.equal(calendarDay(p,date).classList.contains('in-range'),true);
 for(const date of ['2026-10-01','2026-10-05'])assert.equal(calendarDay(p,date).classList.contains('in-range'),false);
 assert.match(p.nodes.get('calendarStatus').textContent,/2026-10-02.*2026-10-04/);calendarDay(p,'2026-10-03').dispatch('click');assert.equal(calendarDay(p,'2026-10-02').classList.contains('in-range'),false);assert.equal(calendarDay(p,'2026-10-03').getAttribute('aria-pressed'),'true');calculatorUnchanged(p);
});

test('Calendar rerender preserves focus on the newly rendered button for the same date',()=>{
 const p=setup();p.toggle('calendarPanel',true);p.input('month','2026-10');const old=calendarDay(p,'2026-10-03');old.focus();p.input('units','K');const current=calendarDay(p,'2026-10-03');
 assert.notEqual(current,old);assert.equal(p.active,current);assert.equal(p.active.getAttribute('data-calendar-date'),'2026-10-03');
 p.input('query','存在しない条件');assert.equal(p.active,calendarDay(p,'2026-10-03'));assert.equal(p.nodes.get('emptyState').hidden,false);calculatorUnchanged(p);
});

const singleCardPrefs={start:'2026-10-03',end:'2026-10-03',rank:'S2',close:'22',units:'pt'};
function cardCopy(p,index=0){const card=p.nodes.get('results').children[index],controls=card.children.at(-1),[button,status,fallback]=controls.children,[textarea,close]=fallback.children;assert.equal(controls.className,'record-copy');return {card,button,status,fallback,textarea,close};}
async function settleCopy(){await Promise.resolve();await Promise.resolve();}
function assertManualCardSelection(p,copy){assert.equal(copy.fallback.hidden,false);assert.equal(copy.textarea.readOnly,true);assert.equal(p.active,copy.textarea);assert.equal(copy.textarea.selectionStart,0);assert.equal(copy.textarea.selectionEnd,copy.textarea.value.length);assert.equal(copy.status.textContent,'自動コピーできません。文章を長押ししてコピーしてください。');assert.equal(copy.button.disabled,false);}

test('Each card copies only its own date, rank, cutoff, three values and safe source with individual feedback',async()=>{
 const p=setup({preferences:{...singleCardPrefs,rank:''}}),first=cardCopy(p,0),second=cardCopy(p,1);
 assert.equal(first.button.textContent,'カードをコピー');assert.equal(first.status.getAttribute('role'),'status');assert.equal(first.fallback.hidden,true);
 for(const [i,copy] of [[0,first],[1,second]]){
  const [date,rank,close]=copy.card.children[0].children.map(n=>n.textContent);assert.equal(copy.button.getAttribute('aria-label'),'2026-10-03 '+rank+' 22時締めのカードをコピー');copy.button.dispatch('click');await settleCopy();
  const text=p.copied[i];assert.ok(text.includes(date+' '+rank+' '+close));for(const metric of copy.card.children[1].children)assert.ok(text.includes(metric.children[0].textContent+'：'+metric.children[1].textContent+' pt'));
  const source=copy.card.children[2].children.find(n=>n.tagName==='A');assert.ok(source);assert.ok(text.includes('出典：'+source.href));assert.equal(copy.status.textContent,'カードをコピーしました。');assert.equal(copy.button.disabled,false);assert.equal(copy.fallback.hidden,true);
  assert.ok(!text.includes('123456'));assert.ok(!text.includes('999999'));if(i===0)assert.equal(second.status.textContent,'');
 }
 assert.notEqual(p.copied[0],p.copied[1]);calculatorUnchanged(p);
});

test('Copied units match the rendered card snapshot and K values never acquire a duplicate K suffix',async()=>{
 const p=setup({preferences:singleCardPrefs}),pointCard=cardCopy(p);p.nodes.get('units').value='K';pointCard.button.dispatch('click');await settleCopy();
 assert.match(p.copied[0],/±0：1 pt\n\+1：2 pt\n\+2：3 pt/);
 p.input('units','K');const kiloCard=cardCopy(p);kiloCard.button.dispatch('click');await settleCopy();
 assert.match(p.copied[1],/±0：0K\n\+1：0K\n\+2：0K/);assert.doesNotMatch(p.copied[1],/KK\b|K\s+K|K pt/);assert.equal(kiloCard.status.textContent,'カードをコピーしました。');calculatorUnchanged(p);
});

for(const [label,clipboard] of [['permission rejection',{async writeText(){throw Error('NotAllowedError');}}],['unsupported clipboard',false]])test('Card '+label+' offers the whole copy text and closes back to its own copy button',async()=>{
 const p=setup({preferences:singleCardPrefs,clipboard}),copy=cardCopy(p);copy.button.dispatch('click');await settleCopy();assertManualCardSelection(p,copy);
 assert.equal(copy.textarea.selected,true);assert.match(copy.textarea.value,/2026\/10\/03 S2 22時〆/);assert.match(copy.textarea.value,/±0：1 pt\n\+1：2 pt\n\+2：3 pt/);assert.ok(!copy.textarea.value.includes('123456'));assert.ok(!copy.textarea.value.includes('999999'));
 copy.close.dispatch('click');assert.equal(copy.fallback.hidden,true);assert.equal(copy.status.textContent,'');assert.equal(p.active,copy.button);calculatorUnchanged(p);
});

test('Manual card text and its full selection survive an equivalent rerender and clear when that card disappears',async()=>{
 const p=setup({preferences:singleCardPrefs,clipboard:false}),old=cardCopy(p);old.button.dispatch('click');await settleCopy();const text=old.textarea.value;assertManualCardSelection(p,old);
 p.input('units','pt');const current=cardCopy(p);assert.notEqual(current.textarea,old.textarea);assert.equal(current.textarea.value,text);assertManualCardSelection(p,current);
 p.input('rank','S1');assert.equal(cardCopy(p).fallback.hidden,true);p.input('rank','S2');assert.equal(cardCopy(p).fallback.hidden,true);calculatorUnchanged(p);
});

test('Pending card copy blocks repeat taps and routes success feedback to the equivalent rerendered card',async()=>{
 let resolve;const calls=[],pending=new Promise(done=>{resolve=done;}),p=setup({preferences:singleCardPrefs,clipboard:{writeText(text){calls.push(text);return pending;}}}),old=cardCopy(p);
 old.button.dispatch('click');assert.equal(old.button.disabled,true);old.button.dispatch('click');assert.equal(calls.length,1);
 p.input('units','pt');const current=cardCopy(p);assert.notEqual(current.button,old.button);assert.equal(current.button.disabled,true);current.button.dispatch('click');assert.equal(calls.length,1);
 resolve();await settleCopy();assert.equal(current.button.disabled,false);assert.equal(current.status.textContent,'カードをコピーしました。');assert.equal(current.fallback.hidden,true);assert.match(calls[0],/±0：1 pt/);calculatorUnchanged(p);
});

test('Pending clipboard rejection after rerender opens and selects the currently displayed card fallback',async()=>{
 let reject;const calls=[],pending=new Promise((_,fail)=>{reject=fail;}),p=setup({preferences:singleCardPrefs,clipboard:{writeText(text){calls.push(text);return pending;}}}),old=cardCopy(p);
 old.button.dispatch('click');p.input('units','pt');const current=cardCopy(p);assert.equal(current.button.disabled,true);reject(Error('NotAllowedError'));await settleCopy();
 assertManualCardSelection(p,current);assert.equal(current.textarea.selected,true);assert.equal(current.textarea.value,calls[0]);assert.notEqual(p.active,old.textarea);current.close.dispatch('click');assert.equal(p.active,current.button);calculatorUnchanged(p);
});

function deferredClipboard(){const requests=[];return {requests,clipboard:{writeText(text){return new Promise((resolve,reject)=>requests.push({text,resolve,reject}));}}};}

test('An old pt copy rejection cannot close or steal focus from a newer K manual-copy fallback',async()=>{
 const pending=deferredClipboard(),p=setup({preferences:singleCardPrefs,clipboard:pending.clipboard}),pointCard=cardCopy(p);pointCard.button.dispatch('click');
 p.input('units','K');const kiloCard=cardCopy(p);kiloCard.button.dispatch('click');assert.equal(pending.requests.length,2);assert.match(pending.requests[0].text,/±0：1 pt/);assert.match(pending.requests[1].text,/±0：0K/);
 pending.requests[1].reject(Error('NotAllowedError'));await settleCopy();assertManualCardSelection(p,kiloCard);const value=kiloCard.textarea.value;
 pending.requests[0].reject(Error('OldNotAllowedError'));await settleCopy();assertManualCardSelection(p,kiloCard);assert.equal(kiloCard.textarea.value,value);assert.equal(p.active,kiloCard.textarea);calculatorUnchanged(p);
});

for(const latestFirst of [false,true])test('Two same-unit card rejections keep the latest requested card active ('+(latestFirst?'latest settles first':'oldest settles first')+')',async()=>{
 const pending=deferredClipboard(),p=setup({preferences:{...singleCardPrefs,rank:''},clipboard:pending.clipboard}),first=cardCopy(p,0),latest=cardCopy(p,1);first.button.dispatch('click');latest.button.dispatch('click');assert.equal(pending.requests.length,2);assert.notEqual(pending.requests[0].text,pending.requests[1].text);
 const order=latestFirst?[1,0]:[0,1];for(const index of order){pending.requests[index].reject(Error('NotAllowedError'));await settleCopy();if(index===1||latestFirst){assertManualCardSelection(p,latest);assert.equal(first.fallback.hidden,true);}else {assert.equal(first.fallback.hidden,true);assert.equal(latest.fallback.hidden,true);assert.equal(latest.button.disabled,true);}}
 assertManualCardSelection(p,latest);assert.equal(latest.textarea.value,pending.requests[1].text);assert.equal(first.fallback.hidden,true);calculatorUnchanged(p);
});

test('Successful card-copy feedback survives an equivalent units rerender',async()=>{
 const p=setup({preferences:singleCardPrefs}),old=cardCopy(p);old.button.dispatch('click');await settleCopy();assert.equal(old.status.textContent,'カードをコピーしました。');
 p.input('units','pt');const current=cardCopy(p);assert.notEqual(current.status,old.status);assert.equal(current.status.textContent,'カードをコピーしました。');assert.equal(current.fallback.hidden,true);assert.equal(current.button.disabled,false);assert.equal(p.copied.length,1);calculatorUnchanged(p);
});

test('Mobile search actions precede closed calendars and saved 30-row preferences remain respected',()=>{
 const p=setup();assert.equal(p.nodes.get('calendarPanel').open,false);assert.equal(p.nodes.get('advanced').open,false);assert.equal(p.nodes.get('pageJumpPanel').open,false);
 assert.ok(html.indexOf('id="searchButton"')<html.indexOf('id="calendarPanel"'));assert.ok(html.indexOf('id="targetSummary"')<html.indexOf('id="calendarPanel"'));
 const before=JSON.stringify(JSON.parse(p.stored.get('pococha-meter-history-v1'))),cards=p.nodes.get('results').children;
 p.toggle('calendarPanel',true);p.toggle('calendarPanel',false);assert.equal(p.stored.get('pococha-meter-history-v1'),before);assert.equal(p.nodes.get('results').children,cards);
 const saved=setup({preferences:{rank:'S2',close:'22',pageSize:'30'}});assert.equal(saved.nodes.get('pageSize').value,'30');saved.click('clearFilters');assert.equal(saved.nodes.get('results').children.length,30);
 calculatorUnchanged(p);calculatorUnchanged(saved);
});

test('Target summaries, linked filters and collapsed pagers describe the current results',()=>{
 const p=setup({preferences:singleCardPrefs});assert.match(p.nodes.get('targetSummary').textContent,/S2.*22時.*pt/);assert.match(p.nodes.get('recordDateLabel').textContent,/2026\/10\/03/);
 for(const id of ['pagerTop','pagerBottom','pageJumpPanel'])assert.equal(p.nodes.get(id).hidden,true);
 p.input('rank','S1');p.input('close','13');p.input('units','K');assert.match(p.nodes.get('targetSummary').textContent,/S1.*13時.*K/);assert.match(p.nodes.get('resultHeading').textContent,/S1.*13時/);
 p.ctx.location.hash='#start=2026-10-03&end=2026-10-03&rank=S2&close=22&units=pt&pageSize=30';p.emitWindow('hashchange');assert.match(p.nodes.get('targetSummary').textContent,/S2.*22時.*pt/);assert.equal(p.nodes.get('pageSize').value,'30');
 p.click('clearFilters');for(const id of ['pagerTop','pagerBottom','pageJumpPanel'])assert.equal(p.nodes.get(id).hidden,false);assert.match(p.nodes.get('targetSummary').textContent,/全ランク.*すべての締め/);calculatorUnchanged(p);
});

const navigationState={target:'999999',current:'123456',rank:'S2',deadline:'22:00',log:{'2026-10-01':{S2:[0,0,0]},'2026-10-03':{S2:[1,2,3]},'2026-10-07':{S2:[7,8,9]},'2026-10-09':{S1:[9,10,11]}},log13:{'2026-10-10':{S2:[10,11,12]}}};
const navigationPreferences={...singleCardPrefs,origin:'personal'};
const assertDate=(p,date)=>{assert.equal(p.nodes.get('start').value,date);assert.equal(p.nodes.get('end').value,date);assert.equal(p.active,p.nodes.get('resultHeading'));};

test('Previous and next recorded dates skip gaps and remain inside the selected rank, cutoff and origin',()=>{
 const p=setup({calculatorState:navigationState,preferences:navigationPreferences});assert.equal(p.nodes.get('prevRecord').disabled,false);assert.equal(p.nodes.get('nextRecord').disabled,false);
 p.click('nextRecord');assertDate(p,'2026-10-07');assert.equal(p.nodes.get('nextRecord').disabled,true);assert.equal(p.nodes.get('results').children.length,1);
 p.click('prevRecord');assertDate(p,'2026-10-03');p.click('prevRecord');assertDate(p,'2026-10-01');assert.equal(p.nodes.get('prevRecord').disabled,true);assert.equal(p.nodes.get('emptyState').hidden,true);assert.equal(p.nodes.get('results').children[0].children[1].children[0].children[1].textContent,'0');
 p.input('query','not a matching date');p.click('latestRecord');assertDate(p,'2026-10-07');assert.equal(p.nodes.get('query').value,'');assert.equal(p.nodes.get('origin').value,'personal');
 p.input('rank','S1');p.click('latestRecord');assertDate(p,'2026-10-09');p.input('rank','S2');p.input('close','13');p.click('latestRecord');assertDate(p,'2026-10-10');calculatorUnchanged(p);
});

test('Latest ranges and empty-result recovery retain personal scope and never expand a truly empty target',()=>{
 const p=setup({calculatorState:navigationState,preferences:navigationPreferences});p.input('start','2024-02-01');p.input('end','2024-02-29');p.input('query','no matching keyword');assert.equal(p.nodes.get('emptyState').hidden,false);
 p.click('emptyLatest');assertDate(p,'2026-10-07');assert.equal(p.nodes.get('query').value,'');assert.equal(p.nodes.get('rank').value,'S2');assert.equal(p.nodes.get('close').value,'22');assert.equal(p.nodes.get('origin').value,'personal');
 p.click('recent7');assert.equal(p.nodes.get('start').value,'2026-10-01');assert.equal(p.nodes.get('end').value,'2026-10-07');p.click('recent30');assert.equal(p.nodes.get('start').value,'2026-09-08');assert.equal(p.nodes.get('end').value,'2026-10-07');
 p.input('rank','S6');assert.equal(p.nodes.get('emptyState').hidden,false);for(const id of ['prevRecord','nextRecord','latestRecord','emptyLatest'])assert.equal(p.nodes.get(id).disabled,true);
 const before=JSON.stringify(JSON.parse(p.stored.get('pococha-meter-history-v1')));p.click('emptyLatest');assert.equal(p.stored.get('pococha-meter-history-v1'),before);assert.equal(p.nodes.get('rank').value,'S6');assert.equal(p.nodes.get('origin').value,'personal');
 p.click('emptyEdit');assert.equal(p.nodes.get('advanced').open,true);assert.equal(p.active,p.nodes.get('query'));assert.equal(p.nodes.get('query').scrolled,true);calculatorUnchanged(p);
});

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const publicPayload=()=>({serverDate:'2026-10-17',records:[{date:'2026-10-03',close:'22',sourceURL:'https://one-carat.com/campus/archives/12345',ranks:{S2:[100,200,300]}},{date:'2026-10-15',close:'22',sourceURL:'https://one-carat.com/campus/archives/12346',ranks:{S2:[170,180,190]}}]});
const publicResponse=(payload=publicPayload(),status=200)=>new Response(typeof payload==='string'?payload:JSON.stringify(payload),{status,headers:{'Content-Type':'application/json'}});
const cardsSnapshot=p=>JSON.stringify(p.nodes.get('results').children.map(card=>({heading:card.children[0].children.map(n=>n.textContent),values:card.children[1].children.map(n=>n.children[1].textContent)})));

test('Public refresh coalesces retry taps and online events while preserving current filters and manual values',async()=>{
 const pending=deferred(),p=setup({online:true,preferences:singleCardPrefs,fetcher:()=>pending.promise});assert.equal(p.requests.length,1);assert.equal(p.nodes.get('retryPublic').disabled,true);assert.equal(p.nodes.get('retryPublic').getAttribute('aria-busy'),'true');
 p.click('retryPublic');p.emitWindow('online');p.emitWindow('online');assert.equal(p.requests.length,1);assert.equal(p.requests[0].url,'/api/borders');assert.equal(p.requests[0].cache,'no-cache');assert.equal(p.requests[0].credentials,'same-origin');assert.ok(p.requests[0].signal instanceof AbortSignal);
 p.input('units','K');pending.resolve(publicResponse());await p.settle();assert.equal(p.nodes.get('retryPublic').disabled,false);assert.match(p.nodes.get('networkStatus').textContent,/確認しました/);assert.equal(p.nodes.get('units').value,'K');assert.equal(p.nodes.get('start').value,'2026-10-03');assert.equal(p.nodes.get('results').children[0].children[1].children[0].children[1].textContent,'0K');
 p.input('start','2026-10-15');p.input('end','2026-10-15');assert.equal(p.nodes.get('results').children[0].children[1].children[0].children[1].textContent,'0K');p.advance(12000);assert.equal(p.requests[0].signal.aborted,false);calculatorUnchanged(p);
});

for(const [label,response] of [['HTTP failure',()=>publicResponse('',503)],['invalid JSON',()=>publicResponse('{broken')],['untrusted source',()=>publicResponse({...publicPayload(),records:[{...publicPayload().records[0],sourceURL:'https://evil.example/border'}]})],['unfinished current day',()=>publicResponse({...publicPayload(),records:[{...publicPayload().records[0],date:'2026-10-17'}]})]])test('Public '+label+' preserves the existing display and enables an explicit successful retry',async()=>{
 let attempts=0;const p=setup({online:true,preferences:singleCardPrefs,fetcher:async()=>++attempts===1?response():publicResponse()}),before=cardsSnapshot(p);await p.settle();assert.equal(cardsSnapshot(p),before);assert.match(p.nodes.get('networkStatus').textContent,/確認できません/);assert.equal(p.nodes.get('retryPublic').disabled,false);
 p.click('retryPublic');await p.settle();assert.equal(p.requests.length,2);assert.match(p.nodes.get('networkStatus').textContent,/確認しました/);assert.equal(cardsSnapshot(p),before);calculatorUnchanged(p);
});

test('A stalled public fetch times out at twelve seconds, unlocks retry and cannot later replace the newer response',async()=>{
 const old=deferred();let attempts=0;const p=setup({online:true,preferences:{...singleCardPrefs,start:'2026-10-15',end:'2026-10-15'},fetcher:()=>++attempts===1?old.promise:Promise.resolve(publicResponse())}),before=cardsSnapshot(p);
 p.advance(11999);await p.settle();assert.equal(p.requests[0].signal.aborted,false);assert.equal(p.nodes.get('retryPublic').disabled,true);p.advance(1);await p.settle();assert.equal(p.requests[0].signal.aborted,true);assert.equal(p.nodes.get('retryPublic').disabled,false);assert.equal(cardsSnapshot(p),before);
 p.click('retryPublic');await p.settle();const fresh=cardsSnapshot(p);assert.equal(p.nodes.get('results').children[0].children[1].children[0].children[1].textContent,'170');
 old.resolve(publicResponse({...publicPayload(),records:[{...publicPayload().records[1],ranks:{S2:[900,901,902]}}]}));await p.settle();assert.equal(cardsSnapshot(p),fresh);assert.match(p.nodes.get('networkStatus').textContent,/確認しました/);calculatorUnchanged(p);
});

test('Offline retries stay local and an offline transition cancels pending updates without discarding saved results',async()=>{
 const pending=deferred();let attempts=0;const p=setup({preferences:singleCardPrefs,fetcher:()=>++attempts===1?pending.promise:Promise.resolve(publicResponse())}),before=cardsSnapshot(p);
 p.click('retryPublic');assert.equal(p.requests.length,0);assert.match(p.nodes.get('networkStatus').textContent,/オフライン/);p.emitWindow('online');assert.equal(p.requests.length,1);p.emitWindow('offline');assert.equal(p.requests[0].signal.aborted,true);assert.equal(p.nodes.get('retryPublic').disabled,false);
 pending.resolve(publicResponse());await p.settle();assert.equal(cardsSnapshot(p),before);assert.match(p.nodes.get('networkStatus').textContent,/オフライン/);p.click('retryPublic');assert.equal(p.requests.length,1);
 p.emitWindow('online');await p.settle();assert.equal(p.requests.length,2);assert.match(p.nodes.get('networkStatus').textContent,/確認しました/);assert.equal(cardsSnapshot(p),before);calculatorUnchanged(p);
});

test('Search-link copying coalesces pending taps and omits page queries and calculator values',async()=>{
 const pending=deferredClipboard(),p=setup({preferences:singleCardPrefs,clipboard:pending.clipboard});p.ctx.location.href='https://example.test/border-history?private=not-for-sharing#old';p.click('copySearch');p.click('copySearch');assert.equal(pending.requests.length,1);assert.equal(p.nodes.get('copySearch').disabled,true);
 const url=new URL(pending.requests[0].text);assert.equal(url.search,'');assert.equal(new URLSearchParams(url.hash.slice(1)).get('rank'),'S2');assert.ok(!url.href.includes('123456'));assert.ok(!url.href.includes('999999'));
 pending.requests[0].resolve();await p.settle();assert.equal(p.nodes.get('copySearch').disabled,false);assert.match(p.nodes.get('copySearchStatus').textContent,/コピーしました/);assert.equal(p.nodes.get('copyFallback').hidden,true);calculatorUnchanged(p);
});

for(const latestFirst of [false,true])test('Changed search filters invalidate older clipboard rejection without stealing the newer fallback ('+(latestFirst?'newest first':'oldest first')+')',async()=>{
 const pending=deferredClipboard(),p=setup({preferences:singleCardPrefs,clipboard:pending.clipboard});p.click('copySearch');p.input('rank','S1');assert.equal(p.nodes.get('copySearch').disabled,false);assert.equal(p.nodes.get('copySearchStatus').textContent,'');p.click('copySearch');assert.equal(pending.requests.length,2);
 const order=latestFirst?[1,0]:[0,1];for(const index of order){pending.requests[index].reject(Error('NotAllowedError'));await p.settle();if(index===1||latestFirst){assert.equal(p.nodes.get('copyFallback').hidden,false);assert.equal(p.nodes.get('copyFallback').value,pending.requests[1].text);assert.equal(p.active,p.nodes.get('copyFallback'));}else{assert.equal(p.nodes.get('copyFallback').hidden,true);assert.equal(p.nodes.get('copySearch').disabled,true);}}
 assert.equal(p.nodes.get('copyFallback').selectionStart,0);assert.equal(p.nodes.get('copyFallback').selectionEnd,pending.requests[1].text.length);assert.equal(p.nodes.get('closeCopySearch').hidden,false);p.click('closeCopySearch');assert.equal(p.nodes.get('copyFallback').hidden,true);assert.equal(p.nodes.get('copySearchStatus').textContent,'');assert.equal(p.active,p.nodes.get('copySearch'));assert.equal(p.nodes.get('advanced').open,true);calculatorUnchanged(p);
});

test('Old copy success, late failure after navigation, and a changed manual fallback cannot overwrite the current search',async()=>{
 const pending=deferredClipboard(),p=setup({preferences:singleCardPrefs,clipboard:pending.clipboard});p.click('copySearch');p.input('rank','S1');p.click('copySearch');pending.requests[1].reject(Error('New failure'));await p.settle();const fallback=p.nodes.get('copyFallback').value;pending.requests[0].resolve();await p.settle();assert.equal(p.nodes.get('copyFallback').hidden,false);assert.equal(p.nodes.get('copyFallback').value,fallback);assert.equal(p.active,p.nodes.get('copyFallback'));
 p.input('rank','S2');assert.equal(p.nodes.get('copyFallback').hidden,true);assert.equal(p.nodes.get('closeCopySearch').hidden,true);assert.equal(p.nodes.get('copySearchStatus').textContent,'');p.click('copySearch');p.nodes.get('query').focus();p.emitWindow('pagehide');p.emitWindow('pageshow',{persisted:true});assert.equal(p.nodes.get('copySearchStatus').textContent,'');assert.equal(p.nodes.get('copySearch').disabled,false);assert.equal(p.nodes.get('copySearch').getAttribute('aria-busy'),'false');pending.requests[2].reject(Error('Late failure'));await p.settle();assert.equal(p.nodes.get('copyFallback').hidden,true);assert.equal(p.active,p.nodes.get('query'));assert.equal(p.nodes.get('copySearchStatus').textContent,'');calculatorUnchanged(p);
});

for(const transition of ['rank round trip','page round trip','pagehide'])for(const outcome of ['success','failure'])test('Pending card '+outcome+' cannot revive notifications or focus after '+transition,async()=>{
 const pending=deferredClipboard(),p=setup({preferences:singleCardPrefs,clipboard:pending.clipboard});if(transition==='page round trip'){p.click('clearFilters');p.input('pageSize','10');}
 const old=cardCopy(p);old.button.dispatch('click');assert.equal(pending.requests.length,1);
 if(transition==='rank round trip'){p.input('rank','S1');p.input('rank','S2');}
 else if(transition==='page round trip'){p.click('nextPage');p.click('prevPage');}
 else p.emitWindow('pagehide');
 const current=cardCopy(p);assert.equal(current.textarea.value,old.textarea.value);p.nodes.get('query').focus();
 if(outcome==='success')pending.requests[0].resolve();else pending.requests[0].reject(Error('Old clipboard failure'));await p.settle();
 assert.equal(current.status.textContent,'');assert.equal(current.fallback.hidden,true);assert.equal(p.active,p.nodes.get('query'));assert.equal(current.button.disabled,false);calculatorUnchanged(p);
});

for(const outcome of ['success','failure'])test('Page restoration permits a new same-card copy while old '+outcome+' cannot unlock its replacement operation',async()=>{
 const pending=deferredClipboard(),p=setup({preferences:singleCardPrefs,clipboard:pending.clipboard}),old=cardCopy(p);old.button.dispatch('click');assert.equal(old.button.disabled,true);assert.equal(pending.requests.length,1);
 p.emitWindow('pagehide');assert.equal(old.button.disabled,false);p.emitWindow('pageshow',{persisted:true});p.input('units','pt');const restored=cardCopy(p);assert.notEqual(restored.button,old.button);assert.equal(restored.button.disabled,false);assert.equal(restored.textarea.value,old.textarea.value);
 restored.button.dispatch('click');assert.equal(pending.requests.length,2);assert.equal(restored.button.disabled,true);assert.equal(pending.requests[1].text,pending.requests[0].text);p.nodes.get('query').focus();
 if(outcome==='success')pending.requests[0].resolve();else pending.requests[0].reject(Error('Copy from previous page lifetime failed'));await p.settle();
 assert.equal(restored.button.disabled,true);assert.equal(restored.status.textContent,'');assert.equal(restored.fallback.hidden,true);assert.equal(p.active,p.nodes.get('query'));restored.button.dispatch('click');assert.equal(pending.requests.length,2);
 p.input('units','pt');const current=cardCopy(p);assert.equal(current.button.disabled,true);current.button.dispatch('click');assert.equal(pending.requests.length,2);
 pending.requests[1].resolve();await p.settle();assert.equal(current.button.disabled,false);assert.equal(current.status.textContent,'カードをコピーしました。');assert.equal(current.fallback.hidden,true);assert.equal(p.active,p.nodes.get('query'));calculatorUnchanged(p);
});

test('Clearing the date period opens the latest personal-record month instead of the newer public archive month',()=>{
 assert.ok(seed.some(row=>row.date.startsWith('2026-10')),'The fixture includes a newer public archive month');
 const calculatorState={target:'999999',current:'123456',rank:'S2',deadline:'22:00',log:{'2025-01-15':{S2:[1,2,3]}}};
 const p=setup({calculatorState,preferences:{...navigationPreferences,start:'2026-10-01',end:'2026-10-31'}});assert.equal(p.nodes.get('calendarLabel').textContent,'2026年10月');assert.equal(p.nodes.get('emptyState').hidden,false);
 const period=p.nodes.get('scope').children.find(n=>n.getAttribute('aria-label')?.includes('〜'));assert.ok(period);period.dispatch('click');assert.equal(p.nodes.get('start').value,'');assert.equal(p.nodes.get('end').value,'');assert.equal(p.nodes.get('month').value,'2025-01');assert.equal(p.nodes.get('origin').value,'personal');
 p.toggle('calendarPanel',true);assert.equal(p.nodes.get('calendarLabel').textContent,'2025年1月');assert.equal(calendarDay(p,'2025-01-15').getAttribute('data-has-record'),'true');assert.equal(calendarDay(p,'2025-01-14').getAttribute('data-has-record'),'false');assert.equal(p.nodes.get('results').children.length,1);calculatorUnchanged(p);
});

test('Only an initial visit chooses the latest month; explicit all-period preferences and copied links remain all-period',()=>{
 const initial=setup();assert.match(initial.nodes.get('start').value,/^20\d{2}-\d{2}-01$/);assert.ok(initial.nodes.get('end').value);initial.click('clearFilters');
 const preferences=JSON.parse(initial.stored.get('pococha-meter-history-v1')),expectedCount=initial.nodes.get('resultCount').textContent;
 assert.equal(preferences.start,'');assert.equal(preferences.end,'');assert.equal(preferences.query,'');
 const saved=setup({preferences}),linked=setup({hash:'#'+new URLSearchParams(preferences).toString()});
 for(const p of [saved,linked]){for(const id of ['start','end','query'])assert.equal(p.nodes.get(id).value,'');assert.equal(p.nodes.get('resultCount').textContent,expectedCount);const restored=JSON.parse(p.stored.get('pococha-meter-history-v1'));assert.equal(restored.start,'');assert.equal(restored.end,'');calculatorUnchanged(p);}
 calculatorUnchanged(initial);
});

const cardIdentity=card=>card.children[0].children.map(node=>node.textContent).join('|');
function goPage(p,page){p.input('pageJump',String(page),'input');p.nodes.get('pageJumpForm').dispatch('submit');}

test('Result-side units and view controls preserve the current page and the same displayed records',()=>{
 const resultTools=html.slice(html.indexOf('class="result-tools"'),html.indexOf('id="pagerTop"'));for(const id of ['units','view','pageSize'])assert.ok(resultTools.includes('id="'+id+'"'));
 const p=setup();p.click('clearFilters');goPage(p,3);const identities=p.nodes.get('results').children.map(cardIdentity),page=p.nodes.get('pageInfo').textContent,range=p.nodes.get('visibleRange').textContent,count=p.nodes.get('resultCount').textContent;
 p.input('units','K');assert.equal(p.nodes.get('pageInfo').textContent,page);assert.equal(p.nodes.get('visibleRange').textContent,range);assert.deepEqual(p.nodes.get('results').children.map(cardIdentity),identities);assert.match(p.nodes.get('results').children[0].children[1].children[0].children[1].textContent,/K$/);
 p.input('view','table');assert.equal(p.nodes.get('pageInfo').textContent,page);assert.equal(p.nodes.get('visibleRange').textContent,range);const tableRows=p.nodes.get('tableResults').children[0].children[2].children;assert.equal(tableRows.length,20);assert.equal(tableRows[0].children.slice(0,3).map(cell=>cell.textContent).join('|'),identities[0].replace('〆',''));
 p.input('view','cards');p.input('units','pt');assert.equal(p.nodes.get('pageInfo').textContent,page);assert.deepEqual(p.nodes.get('results').children.map(cardIdentity),identities);assert.equal(p.nodes.get('resultCount').textContent,count);calculatorUnchanged(p);
});

test('Page-size changes keep the old first record visible instead of restarting at the first result',()=>{
 const p=setup();p.click('clearFilters');goPage(p,3);assert.match(p.nodes.get('visibleRange').textContent,/^41〜60件/);const first=cardIdentity(p.nodes.get('results').children[0]);
 p.input('pageSize','10');assert.match(p.nodes.get('pageInfo').textContent,/^5 /);assert.match(p.nodes.get('visibleRange').textContent,/^41〜50件/);assert.equal(cardIdentity(p.nodes.get('results').children[0]),first);
 p.input('pageSize','50');assert.match(p.nodes.get('pageInfo').textContent,/^1 /);assert.equal(p.nodes.get('results').children.length,50);assert.ok(p.nodes.get('results').children.map(cardIdentity).includes(first));
 p.input('pageSize','20');goPage(p,3);p.input('pageSize','30');assert.match(p.nodes.get('pageInfo').textContent,/^2 /);assert.match(p.nodes.get('visibleRange').textContent,/^31〜60件/);assert.ok(p.nodes.get('results').children.map(cardIdentity).includes(first));calculatorUnchanged(p);
});

test('Browsing calendar months preserves the query, selected range, page and saved search until a date is selected',()=>{
 const p=setup({preferences:{start:'2026-01-01',end:'2026-10-03',rank:'S2',close:'22',query:'S2',pageSize:'20'}});goPage(p,3);p.toggle('calendarPanel',true);
 const before={start:p.nodes.get('start').value,end:p.nodes.get('end').value,query:p.nodes.get('query').value,page:p.nodes.get('pageInfo').textContent,cards:cardsSnapshot(p),saved:p.stored.get('pococha-meter-history-v1'),writes:p.writes.length};
 const unchanged=()=>{for(const key of ['start','end','query'])assert.equal(p.nodes.get(key).value,before[key]);assert.equal(p.nodes.get('pageInfo').textContent,before.page);assert.equal(cardsSnapshot(p),before.cards);assert.equal(p.stored.get('pococha-meter-history-v1'),before.saved);assert.equal(p.writes.length,before.writes);};
 p.click('prevMonth');assert.equal(p.nodes.get('month').value,'2026-09');unchanged();p.click('nextMonth');assert.equal(p.nodes.get('month').value,'2026-10');unchanged();p.input('month','2024-02');assert.equal(p.nodes.get('calendarLabel').textContent,'2024年2月');unchanged();
 calendarDay(p,'2024-02-29').dispatch('click');assert.equal(p.nodes.get('start').value,'2024-02-29');assert.equal(p.nodes.get('end').value,'2024-02-29');assert.equal(p.nodes.get('query').value,'');assert.match(p.nodes.get('pageInfo').textContent,/^1 /);assert.equal(p.active,p.nodes.get('resultHeading'));calculatorUnchanged(p);
});

test('A completed public refresh does not search or save an IME draft until composition ends',async()=>{
 const pending=deferred(),p=setup({online:true,preferences:{...singleCardPrefs,start:'2026-10-01',end:'2026-10-16',query:''},fetcher:()=>pending.promise}),before=cardsSnapshot(p),saved=p.stored.get('pococha-meter-history-v1'),writes=p.writes.length;
 p.nodes.get('query').dispatch('compositionstart');p.input('query','2026/10/15','input');p.advance(180);pending.resolve(publicResponse());await p.settle();
 assert.equal(cardsSnapshot(p),before);assert.equal(p.stored.get('pococha-meter-history-v1'),saved);assert.equal(p.writes.length,writes);assert.equal(p.nodes.get('query').value,'2026/10/15');
 p.nodes.get('query').dispatch('compositionend');assert.equal(p.nodes.get('results').children.length,1);assert.equal(p.nodes.get('results').children[0].children[0].children[0].textContent,'2026/10/15');assert.equal(p.nodes.get('results').children[0].children[1].children[0].children[1].textContent,'170');assert.equal(JSON.parse(p.stored.get('pococha-meter-history-v1')).query,'2026/10/15');calculatorUnchanged(p);
});

test('A storage refresh during IME preserves the displayed results and applies new records only after composition ends',()=>{
 const p=setup({calculatorState:navigationState,preferences:{...navigationPreferences,start:'',end:'',query:''}}),before=cardsSnapshot(p),saved=p.stored.get('pococha-meter-history-v1'),writes=p.writes.length;
 p.nodes.get('query').dispatch('compositionstart');p.input('query','2026/10/11','input');const updated=JSON.stringify({...navigationState,log:{...navigationState.log,'2026-10-11':{S2:[11,12,13]}}});p.stored.set(p.key,updated);p.emitWindow('storage',{key:p.key});
 assert.equal(cardsSnapshot(p),before);assert.equal(p.stored.get('pococha-meter-history-v1'),saved);assert.equal(p.writes.length,writes);p.nodes.get('query').dispatch('compositionend');assert.equal(p.nodes.get('results').children.length,1);assert.equal(p.nodes.get('results').children[0].children[0].children[0].textContent,'2026/10/11');assert.equal(p.nodes.get('results').children[0].children[1].children[0].children[1].textContent,'11');assert.equal(p.stored.get(p.key),updated);assert.ok(!p.writes.includes(p.key));
});

test('Page restoration clears an interrupted IME state and stale debounce so ordinary typing can search again',()=>{
 const p=setup();p.click('clearFilters');p.nodes.get('query').dispatch('compositionstart');p.input('query','途中の入力','input');p.emitWindow('pagehide');p.emitWindow('pageshow',{persisted:true});p.input('query','2026/10/3 S2 22時','input');p.advance(179);assert.notEqual(p.nodes.get('results').children.length,1);p.advance(1);assert.equal(p.nodes.get('results').children.length,1);assert.equal(p.nodes.get('results').children[0].children[0].children[0].textContent,'2026/10/03');assert.equal(JSON.parse(p.stored.get('pococha-meter-history-v1')).query,'2026/10/3 S2 22時');
 p.input('query','stale pending input','input');const before=cardsSnapshot(p),saved=p.stored.get('pococha-meter-history-v1');p.emitWindow('pagehide');p.advance(180);assert.equal(cardsSnapshot(p),before);assert.equal(p.stored.get('pococha-meter-history-v1'),saved);calculatorUnchanged(p);
});

test('Restoring history from back-forward cache reloads local records without resetting filters',()=>{
 const p=setup();p.click('clearFilters');p.input('rank','S2');p.input('origin','personal');
 p.emitWindow('pagehide');
 const state=JSON.parse(p.stored.get(p.key));state.log['2026-10-04']={S2:[10,20,30]};p.stored.set(p.key,JSON.stringify(state));
 p.emitWindow('pageshow',{persisted:false});assert.equal(p.nodes.get('results').children.length,1);
 p.emitWindow('pageshow',{persisted:true});assert.equal(p.nodes.get('results').children.length,2);
 assert.equal(p.nodes.get('origin').value,'personal');assert.equal(p.stored.get(p.key),JSON.stringify(state));assert.ok(!p.writes.includes(p.key));
});

test('Temporary storage read failures preserve already loaded personal history and show a warning',()=>{
 const p=setup();p.click('clearFilters');p.input('rank','S2');p.input('origin','personal');
 const original=p.ctx.localStorage.getItem;p.ctx.localStorage.getItem=k=>{if(k===p.key)throw Error('denied');return original(k);};
 p.emitWindow('storage',{key:p.key});assert.equal(p.nodes.get('results').children.length,1);
 assert.match(p.nodes.get('preferenceStatus').textContent,/端末の記録を読み直せません/);assert.equal(p.stored.get(p.key),p.raw);assert.ok(!p.writes.includes(p.key));
 p.ctx.localStorage.getItem=original;p.emitWindow('storage',{key:p.key});assert.doesNotMatch(p.nodes.get('preferenceStatus').textContent,/読み直せません/);
});
for(const invalid of ['{broken','[]','null','"not a state"'])test('Malformed local history keeps the last readable snapshot: '+invalid,()=>{
 const p=setup();p.click('clearFilters');p.input('rank','S2');p.input('origin','personal');p.stored.set(p.key,invalid);p.emitWindow('storage',{key:p.key});
 assert.equal(p.nodes.get('results').children.length,1);assert.match(p.nodes.get('preferenceStatus').textContent,/端末の記録を読み直せません/);assert.equal(p.stored.get(p.key),invalid);assert.ok(!p.writes.includes(p.key));
 p.stored.delete(p.key);p.emitWindow('storage',{key:p.key});assert.equal(p.nodes.get('results').children.length,0);assert.doesNotMatch(p.nodes.get('preferenceStatus').textContent,/読み直せません/);
});
test('Storage read and preference write failures are both visible',()=>{
 const p=setup();p.ctx.localStorage.getItem=()=>{throw Error('denied');};p.ctx.localStorage.setItem=()=>{throw Error('quota');};p.emitWindow('storage',{key:null});
 assert.match(p.nodes.get('preferenceStatus').textContent,/端末の記録を読み直せません/);assert.match(p.nodes.get('preferenceStatus').textContent,/検索条件を保存できません/);
});

test('Monthly meter calendar renders exact daily triples, rank and cutoff controls without calculator writes',()=>{
 const p=setup();p.toggle('meterCalendarPanel',true);assert.equal(p.nodes.get('meterCalendarRank').value,'S2');assert.equal(p.nodes.get('meterCalendarClose').value,'22');
 p.input('meterCalendarMonth','2026-10');assert.equal(p.nodes.get('meterCalendarResults').children.length,1);
 const section=p.nodes.get('meterCalendarResults').children[0],grid=section.children[1].children[0],day=grid.children.find(n=>n.getAttribute('aria-label')==='2026-10-03 S2');
 assert.ok(day);assert.deepEqual(day.children[1].children[1].children.filter(n=>n.tagName==='DD').map(n=>n.textContent),['1','2','3']);
 p.input('units','K');const kday=p.nodes.get('meterCalendarResults').children[0].children[1].children[0].children.find(n=>n.getAttribute('aria-label')==='2026-10-03 S2');assert.equal(kday.children[1].children[1].children[1].textContent,'0K');
 p.input('meterCalendarClose','');const all=p.nodes.get('meterCalendarResults').children[0].children[1].children[0].children.find(n=>n.getAttribute('aria-label')==='2026-10-03 S2');assert.equal(all.children.length,4);
 p.click('meterCalendarPrev');assert.equal(p.nodes.get('meterCalendarMonth').value,'2026-09');p.click('meterCalendarNext');assert.equal(p.nodes.get('meterCalendarMonth').value,'2026-10');calculatorUnchanged(p);
});
test('E calendar loads E-band records with original K display precision and no storage mutations',()=>{
 const p=setup();p.toggle('meterCalendarPanel',true);p.input('meterCalendarRank','E');p.input('meterCalendarClose','24');p.input('meterCalendarMonth','2026-10');
 const grid=p.nodes.get('meterCalendarResults').children[0].children[1].children[0],day=grid.children.find(n=>n.getAttribute('aria-label')==='2026-10-05 E');
 assert.deepEqual(day.children[1].children[1].children.filter(n=>n.tagName==='DD').map(n=>n.textContent),['235','1.6K','5.1K']);assert.equal(p.writes.includes('pococha-e-display-v1'),false);calculatorUnchanged(p);
 p.input('meterCalendarMonth','2000-01');assert.equal(p.nodes.get('meterCalendarPrev').disabled,true);p.input('meterCalendarMonth','2099-12');assert.equal(p.nodes.get('meterCalendarNext').disabled,true);
});
const e22raw=values=>JSON.stringify({schema:'pococha-e-display-v1',records:values?[{date:'2026-10-17',rank:'E',close:'22',values,source:'端末で確認した画面表示値',precision:'display'}]:[],hiddenSeeds:[]});
const e22prefs={rank:'E',close:'22',origin:'personal',view:'cards',start:'',end:'',order:'new',units:'pt',pageSize:'20'};
test('Saved E22 images appear in normal history cards, date navigation, and copy with original display precision',async()=>{const raw=e22raw(['100','1.6K','3K']),p=setup({preferences:e22prefs,eStateRaw:raw});assert.equal(p.nodes.get('results').children.length,1);const c=p.nodes.get('results').children[0];assert.equal(c.children[1].children[1].children[1].textContent,'1.6K');p.click('latestRecord');assert.equal(p.nodes.get('start').value,'2026-10-17');cardCopy(p).button.dispatch('click');await p.settle();assert.match(p.copied.at(-1),/1\.6K（画面表示値・概数）/);assert.equal(p.stored.get('pococha-e-display-v1'),raw);calculatorUnchanged(p);});
test('E22 storage updates refresh normal history and deleting the record removes it',()=>{const p=setup({preferences:e22prefs,eStateRaw:e22raw(['100','1.6K','3K'])});p.stored.set('pococha-e-display-v1',e22raw(['100','2.5K','3K']));p.emitWindow('storage',{key:'pococha-e-display-v1'});assert.equal(p.nodes.get('results').children[0].children[1].children[1].children[1].textContent,'2.5K');p.stored.set('pococha-e-display-v1',e22raw(null));p.emitWindow('storage',{key:'pococha-e-display-v1'});assert.equal(p.nodes.get('results').children.length,0);calculatorUnchanged(p);});
test('E image values retain K precision in table and belong to personal records only',()=>{const p=setup({preferences:{...e22prefs,view:'table',units:'K'},eStateRaw:e22raw(['100','1.6K','3K'])});const table=p.nodes.get('tableResults').children[0];assert.equal(table.children[2].children[0].children[4].textContent,'1.6K');p.input('origin','published');assert.equal(p.nodes.get('tableResults').children.length,0);});
