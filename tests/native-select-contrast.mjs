import test from 'node:test';
import assert from 'node:assert/strict';
import {pageEngine} from './calculator-harness.mjs';
import {createAudit,parseColor,contrast,colorsIn} from './theme-cascade.mjs';
// Source audit of independent page, HUD and list palettes plus the compact goal
// menu light fallback. Native OS pixels are not modeled.
const p=pageEngine(undefined,{navigator:{onLine:false}}),selects=p.nodes.filter(n=>n.tagName==='SELECT');
assert.ok(selects.length>=25);assert.ok(p.element('coreCount').children.length>=1000);
const audit=createAudit({root:p.document.documentElement,nodes:p.nodes});
const contexts=[];
for(const theme of ['light','dark'])for(const accent of ['standard','blue','green','purple','pink','black'])for(const weight of ['thin','standard','bold'])for(const width of [390,1280])contexts.push({theme,accent,weight,width,pointer:width===390?'coarse':'fine'});
const same=(a,b)=>assert.deepEqual(parseColor(a),parseColor(b));
function readable(n,ctx){const c=audit.computed(n,ctx);assert.ok(audit.textContrast(n,ctx).ratio>=4.5,n.id||n.tagName);assert.equal(c.opacity,'1');return c;}
const quick=n=>n.id==='quickTargetControls'||n.parentNode?.id==='quickTargetControls'||n.parentNode?.parentNode?.id==='quickTargetControls';
const list=n=>!!n.closest('.daily-filters, .history-filters, .history-month-bar, .record-mobile-filters');
const token=(n,name)=>'--'+(quick(n)?'goal-menu-':list(n)?'list-':'')+name;
const scheme=(n,ctx,c)=>n.closest('#mini, #itemsWindow')?'dark':list(n)?c.variables['--list-scheme']:ctx.theme;
function row(n,ctx){const c=readable(n,ctx);if(quick(n)){for(const prop of ['color','background-color','background-image','color-scheme','opacity','filter'])assert.equal(c.winning[prop],undefined,'Compact goal rows leave paired native paints unforced');assert.equal(c['color-scheme'],'only light');return;}same(c.color,c.variables[token(n,'ink')]);same(c['background-color'],c.variables[token(n,'paper')]);assert.equal(c['color-scheme'],scheme(n,ctx,c));}
test('Selectors retain paired page, HUD, list and compact goal palettes',()=>{
 for(const ctx of contexts)for(const s of selects){const c=readable(s,ctx);same(c.color,c.variables[token(s,'ink')]);if(s.closest('#miniGoalMenu'))assert.notDeepEqual(parseColor(c['background-color']),parseColor(c.variables[token(s,'paper')]));else same(c['background-color'],c.variables[token(s,'paper')]);assert.equal(c['color-scheme'],quick(s)?'only light':scheme(s,ctx,c));assert.ok(contrast(parseColor(c['border-top-color']),audit.background(s,ctx))>=3);for(const color of colorsIn(c['background-image']))if(parseColor(color)[3])assert.ok(contrast(parseColor(color),audit.background(s,ctx))>=3);for(const o of new Set([s.children[0],s.children.at(-1),s.children.find(n=>n.value===s.value)].filter(Boolean)))row(o,ctx);}
});
test('All generated options retain their intended author or native color pairing',()=>{for(const theme of ['light','dark']){const ctx={theme,accent:'standard',weight:'standard',width:390,pointer:'coarse'};for(const s of selects)for(const o of s.children)row(o,ctx);}});
test('Selector focus uses the reference accent or local list outline and remains visible',()=>{for(const base of contexts)for(const s of selects){const ctx={...base,states:new Map([[s,new Set(['focus','focus-visible'])]])},c=readable(s,ctx);same(c['outline-color'],c.variables[quick(s)?'--goal-menu-focus':list(s)?'--list-ink':'--teal']);assert.ok(contrast(parseColor(c['outline-color']),audit.background(s,ctx))>=3);}});
test('Disabled controls use their local or reference muted text and raised surface',()=>{for(const base of contexts)for(const s of selects){const ctx={...base,states:new Map([[s,new Set(['disabled'])]])},c=readable(s,ctx);same(c.color,c.variables[token(s,'muted')]);const expected=quick(s)?c.variables['--goal-menu-disabled']:list(s)?c.variables['--list-selected']:c.variables['--raised']==='var(--bg)'?c.variables['--bg']:c.variables['--raised'];same(c['background-color'],expected);assert.equal(c['border-top-style'],'dashed');}});
test('Invalid controls use paired local or reference text and error surface',()=>{for(const s of selects){s.setAttribute('aria-invalid','true');for(const ctx of contexts){audit.clearCache(ctx);const c=readable(s,ctx);same(c.color,c.variables[token(s,'ink')]);same(c['background-color'],c.variables[token(s,'error-bg')]);same(c['border-top-color'],c.variables[quick(s)?'--goal-menu-error':list(s)?'--list-error':'--red']);}s.removeAttribute('aria-invalid');for(const ctx of contexts)audit.clearCache(ctx);}});
test('Closing selector follows the same palette as every other picker',()=>{for(const ctx of contexts){const c=readable(p.element('closeSel'),ctx);same(c.color,c.variables['--ink']);for(const o of p.element('closeSel').children)row(o,ctx);}});
test('Selected and highlighted rows retain their intended author or native color pairing',()=>{for(const base of contexts){const option=selects[0].children[0];for(const name of ['checked','hover','active','focus','disabled'])row(option,{...base,states:new Map([[option,new Set([name])]])});}});

test('Focused invalid goal selectors retain the light focus halo and readable error text',()=>{
 for(const select of selects.filter(quick)){
  select.setAttribute('aria-invalid','true');
  for(const base of contexts){
   const ctx={...base,states:new Map([[select,new Set(['focus','focus-visible'])]])},c=readable(select,ctx);
   same(c.color,c.variables['--goal-menu-ink']);same(c['background-color'],c.variables['--goal-menu-error-bg']);
   const shadowColors=colorsIn(c['box-shadow']);assert.equal(shadowColors.length,2);
   same(shadowColors[0],c.variables['--goal-menu-error']);same(shadowColors[1],c.variables['--goal-menu-paper']);
   assert.ok(contrast(parseColor(c['outline-color']),parseColor(shadowColors[1]))>=3);
  }
  select.removeAttribute('aria-invalid');
 }
});

test('All selector arrows stay small, at the right edge and unrepeated after background resets',()=>{
 for(const base of contexts)for(const select of selects){
  for(const state of ['normal','focus','disabled','invalid','invalid-focus']){
   if(state.startsWith('invalid'))select.setAttribute('aria-invalid','true');
   const states=state.includes('focus')?['focus','focus-visible']:state==='disabled'?['disabled']:[];
   const ctx={...base,states:new Map([[select,new Set(states)]])},c=readable(select,ctx);
   const compact=select.className.split(/\s+/).some(name=>['sm','closesel'].includes(name));
   assert.equal(c['background-size'],compact?'5px 5px':'6px 6px',select.id+' / '+state);
   assert.equal(c['background-repeat'],'no-repeat',select.id+' / '+state);
   const offsets=select.id==='closeSel'&&base.width===390?[6,1]:compact?[13,8]:[17,11];
   assert.equal(c['background-position'],`calc(100% - ${offsets[0]}px) 52%,calc(100% - ${offsets[1]}px) 52%`,select.id+' / '+state);
   assert.ok(c['background-image'].startsWith('linear-gradient(45deg,transparent 50%'),select.id+' retains arrow image');
   assert.ok(audit.textContrast(select,ctx).reliable,select.id+' has no arrow image behind its text');
   select.removeAttribute('aria-invalid');
  }
 }
});

test('All ten list palettes retain readable local focus, disabled and error states in both page themes',()=>{
 const palettes=p.element('listColor').options.map(option=>option.value);
 assert.equal(palettes.length,10);
 const controls=['dailyClose','historyClose','historyMonthInput'].map(id=>{const control=p.element(id);assert.ok(control,id+' exists');return control;});
 for(const palette of palettes)for(const theme of ['light','dark']){
  for(const [id,value]of [['screenTheme',theme],['listColor',palette]]){p.element(id).value=value;p.element(id).dispatchEvent(new Event('change'));}
  assert.equal(p.document.documentElement.getAttribute('data-list-color'),palette);
  const expectedScheme=palette==='black'||theme==='dark'&&palette!=='white'?'dark':'light';
  for(const control of controls)for(const state of ['normal','focus-visible','disabled','invalid']){
   if(state==='invalid')control.setAttribute('aria-invalid','true');else control.removeAttribute('aria-invalid');
   const states=state==='focus-visible'?['focus','focus-visible']:state==='disabled'?['disabled']:[];
   const ctx={theme,accent:'standard',weight:'standard',width:390,pointer:'coarse',states:new Map([[control,new Set(states)]])};
   const c=readable(control,ctx),background=audit.background(control,ctx);
   assert.equal(c['color-scheme'],expectedScheme,control.id+' / '+palette+' / '+state);
   same(c.color,c.variables[state==='disabled'?'--list-muted':'--list-ink']);
   same(c['background-color'],c.variables[state==='disabled'?'--list-selected':state==='invalid'?'--list-error-bg':'--list-paper']);
   if(state==='focus-visible'){same(c['outline-color'],c.variables['--list-ink']);assert.ok(contrast(parseColor(c['outline-color']),background)>=3,control.id+' local focus');}
   if(state==='disabled')assert.equal(c['border-top-style'],'dashed');
   if(state==='invalid'){same(c['border-top-color'],c.variables['--list-error']);assert.ok(contrast(parseColor(c['border-top-color']),background)>=3,control.id+' local error border');}
   if(control.tagName==='SELECT')for(const color of colorsIn(c['background-image']))if(parseColor(color)[3])assert.ok(contrast(parseColor(color),background)>=3,control.id+' local arrow');
   control.removeAttribute('aria-invalid');audit.clearCache(ctx);
  }
 }
});
