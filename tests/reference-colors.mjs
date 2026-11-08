import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {pageEngine,html} from './calculator-harness.mjs';
import {createAudit,parseColor} from './theme-cascade.mjs';
const colors=['standard','blue','green','purple','pink','black'];
const page=()=>pageEngine(undefined,{navigator:{onLine:false}});
const p=page(), audit=createAudit({root:p.document.documentElement,nodes:p.nodes});
const ref=createAudit({htmlPath:fileURLToPath(new URL('./fixtures/same-coin-colors.html',import.meta.url)),root:p.document.documentElement,nodes:p.nodes});
const change=(p,id,value)=>{p.element(id).value=value;p.element(id).dispatchEvent(new Event('change'));};
const resolve=(value,vars)=>value.replace(/var\((--[\w-]+)\)/g,(_,name)=>resolve(vars[name],vars));
const resolved=vars=>Object.fromEntries(Object.entries(vars).map(([k,v])=>[k,resolve(v,vars)]));
const same=(a,b)=>assert.deepEqual(parseColor(a),parseColor(b));
for(const theme of ['light','dark'])for(const accent of colors)test(`Reference palette matches: ${theme}/${accent}`,()=>{
 const ctx={theme,accent,weight:'standard',width:390,pointer:'coarse'};
 change(p,'screenTheme',theme);change(p,'screenColor',accent);
 p.document.body.className=theme==='light'?'day-theme':'';p.document.body.setAttribute('data-color-palette',accent);
 const expected=resolved(ref.computed(p.document.body,ctx).variables),actual=resolved(audit.computed(p.document.documentElement,ctx).variables);
 for(const name of ['ink','muted','line','paper','bg','teal','teal-soft','raised','control-border','on-accent','amber','amber-bg','red','error-bg','success','success-bg','input-bg']) same(actual['--'+name],expected['--'+name]);
 for(const select of p.nodes.filter(n=>n.tagName==='SELECT'&&n.parentNode.id!=='quickTargetControls')){
   const hud=select.closest('#mini, #itemsWindow'),list=select.closest('.daily-filters, .history-filters, .history-month-bar, .record-mobile-filters');
   const ink=hud?(accent==='black'?'#f5f5f5':'#edf4fd'):list?'#17283a':expected['--ink'],paper=hud?'#000000':list?'#ffffff':expected['--paper'];
   const c=audit.computed(select,ctx);same(c.color,ink);same(c['background-color'],paper);assert.equal(c['color-scheme'],hud?'dark':list?'light':theme);
   for(const option of new Set([select.children[0],select.children.at(-1)].filter(Boolean))){const o=audit.computed(option,ctx);same(o.color,ink);same(o['background-color'],paper);}
   assert.ok(audit.textContrast(select,ctx).ratio>=4.5,select.id+' remains readable');
 }
 for(const id of ['mini','itemsWindow']){
   assert.equal(p.element(id).getAttribute('data-hud-background-color'),'black');
   assert.equal(p.element(id).getAttribute('data-hud-theme'),'dark');
 }
 const hudBackground=audit.computed(p.element('mini'),ctx)['background-color'];
 const itemsBackground=audit.computed(p.element('itemsWindow'),ctx)['background-color'];
 same(hudBackground,'#000000');
 assert.notDeepEqual(parseColor(itemsBackground),parseColor(hudBackground));
 assert.ok(audit.textContrast(p.element('itemsWindowTitle'),ctx).ratio>=4.5);
 same(audit.computed(p.document.body,ctx)['background-color'],expected['--bg']);
 same(audit.computed(p.element('applyManualTarget'),ctx).color,expected['--on-accent']);
 same(audit.computed(p.element('applyManualTarget'),ctx)['background-color'],expected['--teal']);
});
test('Color menu choices, order and defaults match the reference',()=>{
 const q=page();assert.deepEqual(q.element('screenColor').options.map(o=>o.value),colors);
 assert.deepEqual(q.element('backgroundColor').options.map(o=>o.value),['theme','black','gray','blue','green','purple','pink','red','orange','gold']);
 assert.deepEqual(q.element('screenTheme').options.map(o=>o.value),['dark','light']);
 assert.equal(q.element('screenTheme').value,'dark');assert.equal(q.element('screenColor').value,'standard');assert.equal(q.element('backgroundColor').value,'theme');
});
test('Black background forces dark colors without overwriting the brightness preference or meter inputs',()=>{
 const q=page();const before=q.stored.get('pococha-meter-calc-v1');
 change(q,'screenTheme','light');change(q,'screenColor','green');change(q,'backgroundColor','black');
 assert.equal(q.document.documentElement.getAttribute('data-theme'),'dark');assert.equal(q.element('screenTheme').value,'dark');
 assert.equal(q.element('browserThemeColor').getAttribute('content'),'#000000');assert.equal(q.element('backgroundHelp').hidden,false);
 assert.deepEqual(JSON.parse(q.stored.get('pococha-meter-display-v1')),{color:'green',weight:'bold',theme:'light',background:'black',hudBackground:'black',listColor:'white',numberColor:'blue'});
 const a=createAudit({root:q.document.documentElement,nodes:q.nodes}),ctx={theme:'dark',accent:'green',weight:'standard',width:390,pointer:'coarse'};
 same(a.computed(q.document.body,ctx)['background-color'],'#000');
 change(q,'screenColor','pink');assert.equal(q.element('backgroundColor').value,'black');
 change(q,'backgroundColor','theme');assert.equal(q.element('screenTheme').value,'light');assert.equal(q.element('browserThemeColor').getAttribute('content'),'#fdf1f7');
 change(q,'backgroundColor','black');change(q,'screenTheme','light');assert.equal(q.element('backgroundColor').value,'theme');
 assert.equal(q.stored.get('pococha-meter-calc-v1'),before);
});
test('Background setting persists, exports and imports without changing personal data',()=>{
 const q=page();change(q,'backgroundColor','black');change(q,'screenColor','purple');
 change(q,'saveContent','backup');change(q,'saveMethod','file');q.element('saveExport').click();const backup=JSON.parse(q.element('backupText').value);
 assert.equal(backup.display.background,'black');const r=page();r.element('paste').value=JSON.stringify(backup);r.element('importBtn').click();
 assert.equal(r.element('backgroundColor').value,'black');assert.equal(r.element('screenColor').value,'purple');assert.equal(r.element('browserThemeColor').getAttribute('content'),'#000000');
});
test('Legacy palette choices migrate without dropping the saved brightness or weight',()=>{
 for(const [old,next]of [['lavender','purple'],['white','standard']]){
  const data=JSON.stringify({color:old,theme:'light',weight:'thin'}),m=new Map([['pococha-meter-display-v1',data]]);
  const q=pageEngine(undefined,{navigator:{onLine:false},localStorage:{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)}});
  assert.equal(q.element('screenColor').value,next);assert.equal(q.element('screenTheme').value,'light');assert.equal(q.element('textWeight').value,'thin');assert.equal(m.get('pococha-meter-display-v1'),data);
 }
});
test('Unsupported background import is rejected before changing data',()=>{
 const q=page();const before=q.stored.get('pococha-meter-calc-v1');q.element('paste').value=JSON.stringify({pmcBackup:1,log:{},display:{color:'blue',weight:'standard',theme:'light',background:'unknown'}});q.element('importBtn').click();assert.equal(q.element('importMsg').className,'toast err');assert.equal(q.stored.get('pococha-meter-calc-v1'),before);
});
