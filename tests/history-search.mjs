import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const html=readFileSync(new URL('../calculator/index.html',import.meta.url),'utf8');
class Element{
 constructor(){this.children=[];this.dataset={};this.listeners={};this.value='';this.textContent='';}
 set innerHTML(v){this.children=[];this._html=v;}get innerHTML(){return this._html;}
 appendChild(e){this.children.push(e);}setAttribute(){}addEventListener(n,f){this.listeners[n]=f;}scrollIntoView(){}
 change(value){this.value=value;this.listeners.change.call(this);}
}
const els={};const $=id=>els[id]??=new Element();
const logs={'22':{'2025-01-01':{S2:[1,2,3]},'2026-10-02':{S2:[10,20,30],S6:[100,200,300]},'2026-10-04':{S2:[11,22,33]}},'13':{},'24':{'2026-10-03':{S2:[5,6,7]}}};
const state={target:'123456',current:'789'};const before=JSON.stringify({state,logs});
const ctx={$ ,document:{createElement:()=>new Element()},RANKS:['E','S2','S6'],dataRevision:1,closeKey:()=> '22',logFor:c=>logs[c],validDate:d=>/^\d{4}-\d{2}-\d{2}$/.test(d),validTriple:v=>Array.isArray(v)&&v.length===3,metaFor:()=>({origin:'remote'}),fmt:n=>n.toLocaleString('en-US'),fmtK:n=>n/1000+'K'};
vm.createContext(ctx);vm.runInContext(html.slice(html.indexOf('  var historyLimit='),html.indexOf('  function renderLog()')),ctx);
ctx.renderDailyBorders();assert.equal($('dailyDate').value,'2026-10-04');
$('dailyRank').change('S2');assert.equal($('dailyRows').children.length,1);assert.equal($('dailyRows').children[0].children[1].textContent,'11');
$('dailyExactDate').change('2026-10-03');assert.match($('dailyResult').textContent,/記録はありません/);assert.equal($('dailyDate').value,'2026-10-03');assert.equal($('dailyRows').children[0].children[1].textContent,'—');
$('dailyOlder').onclick();assert.equal($('dailyDate').value,'2026-10-02');
$('dailyNewer').onclick();assert.equal($('dailyDate').value,'2026-10-04');
$('dailyMonth').change('2025-01');assert.equal($('dailyDate').value,'2025-01-01');
$('dailyLatest').onclick();assert.equal($('dailyDate').value,'2026-10-04');
const options=$('dailyRank').children;ctx.dataRevision++;ctx.renderDailyBorders();assert.equal($('dailyRank').children,options,'Unchanged options must not be rebuilt during background refresh');
$('dailyClose').change('24');assert.equal($('dailyDate').value,'2026-10-04','Cutoff comparison preserves date');assert.match($('dailyResult').textContent,/記録はありません/);
$('dailyClose').change('13');assert.match($('dailyResult').textContent,/記録はありません/);assert.equal($('dailyLatest').disabled,true);
$('historyStart').change('2026-10-02');$('historyEnd').change('2026-10-03');assert.match($('historyCount').textContent,/2件/);
$('historyRank').change('S6');assert.match($('historyCount').textContent,/1件/);assert.match($('historyResults').children[0].children[1].textContent,/100/);
$('historyResults').children[0].onclick();assert.equal($('dailyDate').value,'2026-10-02');assert.equal($('dailyClose').value,'22');assert.equal($('dailyRank').value,'S6');
$('historyStart').change('2026-11-01');assert.match($('historyCount').textContent,/開始日/);
$('historyAll').onclick();assert.match($('historyCount').textContent,/4件/);
$('historyOrder').change('old');assert.match($('historyResults').children[0].children[0].textContent,/2025\/01\/01/);
$('historyMonth').onclick();assert.equal($('historyStart').value,'2026-10-01');assert.equal($('historyEnd').value,'2026-10-31');
assert.equal(JSON.stringify({state,logs}),before,'Viewing cannot mutate meter settings or stored records');
console.log('History search: single-change filters, missing dates, navigation, latest, empty cutoff, stable options and read-only state passed');

// 10,000 different conditions checked against the real reviewed archive.
const archive=JSON.parse(readFileSync(new URL('../db/history-2025-2026.json',import.meta.url),'utf8'));
for(const c of ['13','22','24'])logs[c]={};for(const row of archive)logs[row.close][row.date]=row.ranks;
ctx.RANKS=['E',...Object.keys(archive.find(row=>Object.keys(row.ranks).length===18).ranks)];ctx.dataRevision++;
for(let i=0;i<10000;i++){
 const row=archive[(i*17)%archive.length],end=archive[(i*31)%archive.length].date;
 const startDate=row.date<end?row.date:end,endDate=row.date>end?row.date:end;
 const cutoff=['','13','22','24'][i%4],rank=['','E','S2','A3','S6'][i%5];
 $('historyStart').value=startDate;$('historyEnd').value=endDate;$('historyClose').value=cutoff;$('historyRank').value=rank;$('historyOrder').value=i%2?'old':'new';
 const actual=ctx.historyMatches().map(r=>r.date+'|'+r.close);
 const expected=archive.filter(r=>r.date>=startDate&&r.date<=endDate&&(!cutoff||r.close===cutoff)&&(!rank||Array.isArray(r.ranks[rank]))).map(r=>r.date+'|'+r.close);
 assert.deepEqual(Array.from(actual).sort(),expected.sort());
}
$('historyAll').onclick();assert.equal($('historyResults').children.length,30);$('historyMore').onclick();assert.equal($('historyResults').children.length,60);assert.equal($('historyMore').hidden,false);
console.log('10,000 archive filter combinations and 30/60-row pagination passed');

$('historyMonthInput').change('2025-12');assert.equal($('historyStart').value,'2025-12-01');assert.equal($('historyEnd').value,'2025-12-31');
$('historyNextMonth').onclick();assert.equal($('historyMonthInput').value,'2026-01');$('historyPrevMonth').onclick();assert.equal($('historyMonthInput').value,'2025-12');
$('historyMonthInput').change('2024-02');assert.equal($('historyEnd').value,'2024-02-29');
$('historyLatestMonth').onclick();assert.equal($('historyMonthInput').value,'2026-10');
$('historyUnits').change('K');$('historyRank').change('S2');assert.match($('historyResults').children[0].children[1].textContent,/K/);
$('historyResults').children[0].onclick();assert.match($('dailyRows').children[0].children[1].textContent,/K/);assert.match($('historyResults').children[0].children[0].textContent,/閲覧中/);
$('historyUnits').change('pt');assert.doesNotMatch($('dailyRows').children[0].children[1].textContent,/K/);
console.log('Month navigation, year boundaries, leap year, latest month, K/pt and selected-record feedback passed');

$('historyPeriodView').onclick();assert.equal($('dailyControls').hidden,true);assert.equal($('dailyTable').hidden,true);assert.equal($('historySearch').hidden,false);
$('historyRecent7').onclick();assert.equal($('historyEnd').value,'2026-10-05');assert.equal($('historyStart').value,'2026-09-29');assert.match($('historyScope').textContent,/S2/);
$('historyRecent30').onclick();assert.equal($('historyStart').value,'2026-09-06');
const resultCount=$('historyResults').children.length;$('historyResults').children[0].onclick();assert.equal($('dailyTable').hidden,false);assert.equal($('historySearch').hidden,true);
$('historyPeriodView').onclick();assert.equal($('historyStart').value,'2026-09-06');assert.equal($('historyResults').children.length,resultCount,'Returning to search retains filters and results');
const cached=ctx.historyEntries();assert.equal(ctx.historyEntries(),cached);logs['22']['2026-10-06']={S2:[1,2,3]};ctx.dataRevision++;assert.notEqual(ctx.historyEntries(),cached);$('historyRecent7').onclick();assert.equal($('historyEnd').value,'2026-10-06');
console.log('View switching, filter retention, latest-record periods and index invalidation passed');
