import test from 'node:test';
import assert from 'node:assert/strict';
import {pageEngine,html} from './calculator-harness.mjs';

const DISPLAY='pococha-meter-display-v1',KEY='pococha-meter-calc-v1';
const memory=(values={})=>{const map=new Map(Object.entries(values));return {map,getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};};
const page=(m=memory(),extra={})=>pageEngine(undefined,{navigator:{onLine:false},localStorage:m,...extra});
const change=(p,id,value)=>{p.element(id).value=value;p.element(id).dispatchEvent(new Event('change'));};
function backup(p){change(p,'saveContent','backup');change(p,'saveMethod','file');p.element('saveExport').click();return JSON.parse(p.element('backupText').value);}
function restore(p,data){p.element('paste').value=JSON.stringify(data);p.element('importBtn').click();}

for(const theme of ['light','dark'])for(const weight of ['ultra','bold','standard','thin'])test(theme+' / '+weight+' applies, saves, reloads and restores without changing meter inputs',()=>{
  const m=memory(),p=page(m),before=m.map.get(KEY);
  change(p,'screenColor','pink');change(p,'textWeight',weight);change(p,'screenTheme',theme);
  const expected={color:'pink',weight,theme,background:'theme',hudBackground:'black',listColor:'white',numberColor:'blue'};
  assert.deepEqual(JSON.parse(m.map.get(DISPLAY)),expected);
  assert.equal(p.document.documentElement.getAttribute('data-theme'),theme);
  assert.equal(p.document.documentElement.getAttribute('data-text-weight'),weight);
  assert.equal(p.element('browserThemeColor').getAttribute('content'),theme==='dark'?'#1c111b':'#fdf1f7');
  assert.equal(m.map.get(KEY),before);
  const q=page(m);assert.equal(q.element('screenTheme').value,theme);assert.equal(q.element('textWeight').value,weight);
  const data=backup(q);assert.deepEqual(data.display,expected);
  const destination=page();restore(destination,data);
  assert.deepEqual(backup(destination).display,expected);
  assert.equal(destination.element('screenTheme').value,theme);
});

test('old heavy setting migrates to the selectable bold option without writing during startup',()=>{
  const raw=JSON.stringify({color:'green',weight:'heavy'}),m=memory({[DISPLAY]:raw}),p=page(m);
  assert.equal(p.element('textWeight').value,'bold');assert.equal(p.element('screenTheme').value,'light');
  assert.equal(m.map.get(DISPLAY),raw);
  assert.deepEqual(backup(p).display,{color:'green',weight:'bold',theme:'light',background:'theme',hudBackground:'black',listColor:'white',numberColor:'blue'});
  assert.deepEqual(p.element('textWeight').options.map(o=>o.value),['ultra','bold','standard','thin']);
});
test('legacy display backup migrates heavy and missing theme',()=>{
  const p=page();restore(p,{pmcBackup:1,log:{},display:{color:'blue',weight:'heavy'}});
  assert.deepEqual(backup(p).display,{color:'blue',weight:'bold',theme:'light',background:'theme',hudBackground:'black',listColor:'white',numberColor:'blue'});
});
test('backup without display keeps current dark theme and thin font',()=>{
  const p=page();change(p,'screenTheme','dark');change(p,'textWeight','thin');
  restore(p,{pmcBackup:1,log:{}});
  assert.equal(p.element('screenTheme').value,'dark');assert.equal(p.element('textWeight').value,'thin');
});
for(const theme of ['unknown',null,42])test('invalid explicit theme '+JSON.stringify(theme)+' rejects the complete backup before writes',()=>{
  const m=memory(),p=page(m);change(p,'screenTheme','dark');const records=m.map.get(KEY),display=m.map.get(DISPLAY);
  restore(p,{pmcBackup:1,log:{'2026-09-01':{S2:[1,2,3]}},display:{color:'blue',weight:'bold',theme}});
  assert.equal(p.element('importMsg').className,'toast err');assert.equal(m.map.get(KEY),records);assert.equal(m.map.get(DISPLAY),display);
});
test('cross-tab theme changes apply without echoing a write and deletion resets the display',()=>{
  const m=memory(),p=page(m),raw=JSON.stringify({color:'green',weight:'thin',theme:'dark'});
  m.map.set(DISPLAY,raw);p.dispatchWindow('storage',{key:DISPLAY,newValue:raw,storageArea:m});
  assert.equal(p.element('screenTheme').value,'dark');assert.equal(p.element('textWeight').value,'thin');assert.equal(m.map.get(DISPLAY),raw);
  m.map.delete(DISPLAY);p.dispatchWindow('storage',{key:DISPLAY,newValue:null,storageArea:m});
  assert.equal(p.element('screenTheme').value,'dark');assert.equal(p.element('textWeight').value,'bold');assert.equal(m.map.has(DISPLAY),false);
});
test('failed display save applies the chosen theme but reports the persistence failure',()=>{
  const m=memory(),p=page(m,{localStorage:{getItem:m.getItem,setItem:(k,v)=>{if(k===DISPLAY)throw Error('quota');m.setItem(k,v);}}});
  change(p,'screenTheme','dark');assert.equal(p.document.documentElement.getAttribute('data-theme'),'dark');
  assert.equal(p.element('displaySettingsStatus').className,'toast err');assert.match(p.element('displaySettingsStatus').textContent,/保存できません/);
});
test('restore button saves dark default, bold weight and standard accent',()=>{
  const m=memory(),p=page(m);change(p,'screenTheme','dark');change(p,'textWeight','thin');change(p,'screenColor','pink');
  p.element('restoreDisplaySettings').click();assert.deepEqual(JSON.parse(m.map.get(DISPLAY)),{color:'standard',weight:'bold',theme:'dark',background:'theme',hudBackground:'black',listColor:'white',numberColor:'blue'});
});
test('unrecognized menu values restore the previous valid selections',()=>{
  const p=page();change(p,'screenTheme','dark');change(p,'textWeight','thin');
  change(p,'screenTheme','bad');change(p,'textWeight','heavy');
  assert.equal(p.element('screenTheme').value,'dark');assert.equal(p.element('textWeight').value,'thin');
});
test('Display settings retain all four requested weights and the compact panel layout',()=>{
  assert.deepEqual(page().element('textWeight').options.map(o=>o.value),['ultra','bold','standard','thin']);
  assert.match(html,/\.display-settings-panel\{position:absolute;left:0;top:calc\(100% \+ 6px\);z-index:60;width:20rem;max-width:100%/);
});
