import test from 'node:test';
import assert from 'node:assert/strict';
import {pageEngine,html} from './calculator-harness.mjs';
import {createAudit,parseColor,contrast} from './theme-cascade.mjs';
const KEY='pococha-meter-calc-v1',DISPLAY='pococha-meter-display-v1';
const NATIVE_LIST_IDS=['quickPeriod','quickRank','quickBorder','quickMethod','closeSel'];
const change=(p,id,value)=>{p.element(id).value=value;p.element(id).dispatchEvent(new Event('change'));};
const node=(p,id)=>p.nodes.find(n=>n.id===id);
const event=(type,props={})=>{const e=new Event(type,{cancelable:true});Object.assign(e,props);return e;};
const setup=()=>{const data=new Map(),p=pageEngine(undefined,{navigator:{onLine:false},localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}});return {p,data};};
const open=(p,id)=>{const s=p.element(id),e=event('mousedown',{button:0});s.dispatchEvent(e);assert.ok(e.defaultPrevented);assert.equal(s.getAttribute('aria-expanded'),'true');return node(p,'selectWindowList');};
const dismiss=p=>node(p,'selectWindow').dispatchEvent(event('keydown',{key:'Escape'}));

test('New default is bold; ultra is selectable and the three color menus each offer ten colors',()=>{
 const {p}=setup();assert.equal(p.element('textWeight').value,'bold');
 for(const id of ['backgroundColor','listColor','numberColor'])assert.equal(p.element(id).options.length,10,id);
 assert.equal(p.element('displayPreset').options.length,9);
 assert.equal(p.element('displayPreset').value,'default');
 change(p,'textWeight','ultra');const audit=createAudit({root:p.document.documentElement,nodes:p.nodes});
 assert.equal(audit.computed(p.document.body,{theme:'dark',accent:'standard',weight:'ultra',width:390})['font-weight'],'900');
});
test('All thirty individual color selections save and reload without changing personal meter data',()=>{
 const {p,data}=setup(),before=JSON.parse(data.get(KEY));
 for(const id of ['backgroundColor','listColor','numberColor'])for(const option of p.element(id).options){
  const unchanged=data.get(KEY);change(p,id,option.value);assert.equal(p.element(id).value,option.value);assert.equal(data.get(KEY),unchanged);
  const q=pageEngine(undefined,{navigator:{onLine:false},localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}});
  assert.equal(q.element(id).value,option.value);const reloaded=JSON.parse(data.get(KEY));
  for(const field of ['target','current','deadline','coreCount','rank','period','log','items','presets'])assert.deepEqual(reloaded[field],before[field],field);
 }
});
test('Recommended presets include light/night blues and pink while preserving chosen font weight',()=>{
 const {p,data}=setup(),before=data.get(KEY);change(p,'textWeight','ultra');
 const expected={clear:['light','theme','white','blue'],blue:['light','blue','blue','blue'],blueNight:['dark','blue','blue','cyan'],pink:['light','pink','pink','pink'],green:['light','green','green','green'],purple:['dark','purple','purple','purple'],mono:['dark','black','black','black']};
 for(const [name,[theme,background,listColor,numberColor]]of Object.entries(expected)){
  change(p,'displayPreset',name);const saved=JSON.parse(data.get(DISPLAY));
  assert.deepEqual([saved.theme,saved.background,saved.listColor,saved.numberColor,saved.weight],[theme,background,listColor,numberColor,'ultra']);
  assert.equal(p.element('displayPreset').value,name);assert.equal(data.get(KEY),before);
 }
});
test('Selecting default restores every built-in display preference and reloads without touching meter data',()=>{
 const {p,data}=setup(),before=data.get(KEY);
 change(p,'displayPreset','pink');change(p,'textWeight','ultra');change(p,'displayPreset','default');
 assert.deepEqual(JSON.parse(data.get(DISPLAY)),{color:'standard',weight:'bold',theme:'dark',background:'theme',hudBackground:'black',listColor:'white',numberColor:'blue'});
 assert.equal(data.get(KEY),before);assert.equal(p.element('displayPreset').value,'default');
 const q=pageEngine(undefined,{navigator:{onLine:false},localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}});
 assert.equal(q.element('displayPreset').value,'default');assert.equal(q.element('textWeight').value,'bold');
});
test('Every details menu and section has its own close button; display close stays inside its scroll panel',()=>{
 const {p}=setup(),menus=p.document.querySelectorAll('details'),sections=p.document.querySelectorAll('section.card');
 assert.equal(menus.length,[...html.matchAll(/<details\b/g)].length);assert.equal(sections.length,5);
 for(const menu of menus){
  const host=menu.id==='displaySettings'?menu.querySelector('.display-settings-panel'):menu.querySelector('.header-help-panel')||menu;
  const row=host.children.find(n=>n.className==='menu-close-actions');assert.ok(row,menu.id||menu.className);
  assert.equal(row.children.length,1);assert.equal(row.children[0].getAttribute('type'),'button');assert.equal(row.children[0].textContent,'閉じる');assert.equal(row.children[0].getAttribute('aria-label'),'このメニューを閉じる');
 }
 for(const section of sections)assert.equal(section.querySelector('.section-body').children[0].className,'menu-close-actions');
 assert.match(html,/\.display-settings-panel>\.menu-close-actions\{position:sticky;top:0/);
 assert.match(html,/@media print\{\.menu-close-actions,\.pace-details>\.menu-close-actions\{display:none!important\}\}/);
});
test('Details close buttons restore focus and preserve display settings and entered data',()=>{
 const {p,data}=setup();change(p,'displayPreset','pink');const personal=data.get(KEY),display=data.get(DISPLAY);
 for(const menu of p.document.querySelectorAll('details')){
  const summary=menu.children.find(n=>n.tagName==='SUMMARY'),host=menu.id==='displaySettings'?menu.querySelector('.display-settings-panel'):menu.querySelector('.header-help-panel')||menu;
  menu.open=true;menu.setAttribute('open','');host.children.find(n=>n.className==='menu-close-actions').children[0].click();
  assert.equal(menu.open,false);assert.equal(menu.hasAttribute('open'),false);assert.equal(p.document.activeElement,summary);
  assert.equal(data.get(KEY),personal);assert.equal(data.get(DISPLAY),display);
 }
});
test('Section close buttons persist the collapsed state and return focus without changing calculation inputs',()=>{
 const {p,data}=setup();let persistedKeys=0;
 for(const section of p.document.querySelectorAll('section.card')){
  const body=section.querySelector('.section-body'),toggle=section.querySelector('.sectionToggle');
  toggle.dispatchEvent(new Event('click'));assert.equal(body.hidden,false);
  const before=JSON.parse(data.get(KEY));body.children[0].children[0].click();
  assert.equal(body.hidden,true);assert.ok(section.classList.contains('collapsed'));assert.equal(toggle.getAttribute('aria-expanded'),'false');assert.equal(p.document.activeElement,toggle);
  const saved=JSON.parse(data.get(KEY));
  // Static heading text is not parsed by this DOM double; explicitly keyed
  // sections exercise persistence, while every section exercises close/focus.
  if(section.dataset.sectionKey){assert.equal(saved.collapsed[section.dataset.sectionKey],true);persistedKeys++;}
  for(const field of ['target','current','deadline','coreCount','rank','period','log','items','goalDefaults'])assert.deepEqual(saved[field],before[field]);
 }
 assert.equal(persistedKeys,3);
});
test('Closing a nested menu leaves its parent menu and section open',()=>{
 const {p}=setup(),backup=p.element('backupTools'),offline=p.element('offlineTools'),section=backup.closest('section.card');
 section.querySelector('.sectionToggle').dispatchEvent(new Event('click'));backup.open=true;offline.open=true;offline.setAttribute('open','');
 offline.children.find(n=>n.className==='menu-close-actions').children[0].click();
 assert.equal(offline.open,false);assert.equal(backup.open,true);assert.equal(section.classList.contains('collapsed'),false);
 assert.equal(section.querySelector('.section-body').hidden,false);
});
test('New close buttons remain readable in every theme and accent palette',()=>{
 const {p}=setup(),audit=createAudit({root:p.document.documentElement,nodes:p.nodes}),buttons=p.nodes.filter(n=>n.className==='menu-close-button');
 assert.equal(buttons.length,p.document.querySelectorAll('details').length+p.document.querySelectorAll('section.card').length);
 for(const menu of p.document.querySelectorAll('details')){menu.open=true;menu.setAttribute('open','');}
 for(const section of p.document.querySelectorAll('section.card'))section.querySelector('.sectionToggle').dispatchEvent(new Event('click'));
 for(const theme of ['dark','light'])for(const accent of p.element('screenColor').options.map(o=>o.value))for(const button of buttons){
  const paint=audit.textContrast(button,{theme,accent,weight:'bold',width:390,pointer:'coarse'});assert.ok(paint.ratio>=4.5,theme+'/'+accent+'/'+button.getAttribute('aria-label'));
 }
});
test('New display preferences round trip through JSON backup',()=>{
 const {p}=setup();change(p,'textWeight','ultra');change(p,'listColor','black');change(p,'numberColor','gold');change(p,'backgroundColor','green');
 change(p,'saveContent','backup');change(p,'saveMethod','file');p.element('saveExport').click();const backup=JSON.parse(p.element('backupText').value);
 const {p:q,data}=setup();q.element('paste').value=JSON.stringify(backup);q.element('importBtn').click();
 assert.deepEqual(JSON.parse(data.get(DISPLAY)),backup.display);
});
test('Changing brightness keeps an independently selected background color',()=>{
 const {p}=setup();change(p,'backgroundColor','red');change(p,'screenTheme','light');
 assert.equal(p.element('backgroundColor').value,'red');assert.equal(p.element('browserThemeColor').getAttribute('content'),'#fff0f3');
 change(p,'screenTheme','dark');assert.equal(p.element('backgroundColor').value,'red');assert.equal(p.element('browserThemeColor').getAttribute('content'),'#210f16');
});
test('Invalid imported custom colors reject the whole backup without overwriting either store',()=>{
 for(const field of ['background','listColor','numberColor']){
  const {p,data}=setup();change(p,'numberColor','gold');const records=data.get(KEY),display=data.get(DISPLAY);
  p.element('paste').value=JSON.stringify({pmcBackup:1,log:{'2026-10-01':{S2:[1,2,3]}},display:{...JSON.parse(display),[field]:'unknown'}});p.element('importBtn').click();
  assert.equal(p.element('importMsg').className,'toast err');assert.equal(data.get(KEY),records);assert.equal(data.get(DISPLAY),display);
 }
});
test('Shared popup keeps native option values and dispatches the real input then change handlers',()=>{
 const {p}=setup(),select=p.element('screenTheme'),events=[];
 select.addEventListener('input',()=>events.push('input'));select.addEventListener('change',()=>events.push('change'));
 const list=open(p,'screenTheme');assert.deepEqual(list.children.map(n=>n.getAttribute('data-value')),select.options.map(n=>n.value));
 list.children.find(n=>n.getAttribute('data-value')==='light').click();
 assert.deepEqual(events,['input','change']);assert.equal(select.value,'light');assert.equal(p.document.documentElement.getAttribute('data-theme'),'light');assert.equal(select.getAttribute('aria-expanded'),'false');assert.equal(p.document.activeElement,select);
 assert.equal(p.element('coreCount').getAttribute('aria-haspopup'),null,'Hidden 1001-option core select is untouched');
});
test('Other visible selection menus keep the color-controlled window and close button',()=>{
 const {p}=setup();for(const s of p.nodes.filter(n=>n.tagName==='SELECT'&&!NATIVE_LIST_IDS.includes(n.id)&&!n.closest('#dailyViewer')&&!n.closest('#miniGoalMenu')&&!n.hasAttribute('hidden')&&n.getAttribute('aria-hidden')!=='true'&&!n.disabled)){
  const list=open(p,s.id),close=node(p,'selectWindow').children[0].children[1];assert.equal(list.children.length,s.options.length,s.id);
  assert.equal(close.hidden,false,s.id);
  assert.equal(close.hasAttribute('hidden'),close.hidden);dismiss(p);assert.equal(p.document.activeElement,s);
 }
});
test('Goal-setting and closing-time lists leave mouse, touch and keyboard selection to the browser',()=>{
 const {p,data}=setup(),dialog=node(p,'selectWindow'),before=data.get(KEY),display=data.get(DISPLAY),wrap=p.document.querySelector('.wrap');
 for(const id of NATIVE_LIST_IDS){
  const s=p.element(id),value=s.value;
  for(const attr of ['aria-haspopup','aria-controls','aria-expanded'])assert.equal(s.getAttribute(attr),null,id+' '+attr);
  for(const e of [event('mousedown',{button:0}),event('click'),event('keydown',{key:'ArrowDown'}),event('touchstart',{touches:[{clientX:20,clientY:20}]}),event('touchend',{changedTouches:[{clientX:22,clientY:22}]})]){
   s.dispatchEvent(e);assert.equal(e.defaultPrevented,false,id+' '+e.type);assert.equal(dialog.hidden,true);assert.equal(wrap.inert,undefined);
  }
  assert.equal(s.value,value);assert.equal(data.get(KEY),before);assert.equal(data.get(DISPLAY),display);
 }
});
test('Other lists with no enabled choices keep the close button available',()=>{
 const {p}=setup(),s=p.element('screenTheme'),dialog=node(p,'selectWindow'),close=dialog.children[0].children[1];s.options.forEach(o=>o.disabled=true);
 open(p,'screenTheme');assert.equal(p.document.activeElement,close);assert.equal(close.hidden,false);
 dialog.dispatchEvent(event('keydown',{key:'Tab'}));assert.equal(p.document.activeElement,close);
 dismiss(p);assert.equal(dialog.hidden,true);assert.equal(p.document.activeElement,s);
});
test('Remaining goal digits stay yellow in both themes while other number choices still apply',()=>{
 const {p}=setup(),audit=createAudit({root:p.document.documentElement,nodes:p.nodes});change(p,'numberColor','pink');
 for(const [theme,expected]of [['dark','#ffe45c'],['light','#7a5c00']]){
  const ctx={theme,accent:'pink',weight:'bold',width:390,pointer:'coarse'},paint=audit.textContrast(p.element('remain'),ctx);
  assert.deepEqual(parseColor(paint.computed.color),parseColor(expected));assert.ok(paint.ratio>=4.5);
  const other=audit.computed(p.element('pct'),ctx);assert.deepEqual(parseColor(other.color),parseColor(other.variables['--number-ink']));
 }
 assert.match(html,/forced-colors:active.*--remaining-ink:CanvasText/);
});
test('Keyboard selection, Escape cancellation, Tab trapping and focus return work',()=>{
 const {p}=setup(),s=p.element('screenTheme');s.dispatchEvent(event('keydown',{key:'Enter'}));const dialog=node(p,'selectWindow'),list=node(p,'selectWindowList');
 dialog.dispatchEvent(event('keydown',{key:'End'}));assert.equal(p.document.activeElement,list.children.at(-1));
 dialog.dispatchEvent(event('keydown',{key:'Enter'}));assert.equal(s.value,'light');
 open(p,'screenTheme');dialog.dispatchEvent(event('keydown',{key:'Tab'}));assert.equal(p.document.activeElement,dialog.children[0].children[1]);
 dialog.dispatchEvent(event('keydown',{key:'Tab'}));assert.equal(p.document.activeElement,list.children.find(n=>n.tabIndex===0));
 dialog.dispatchEvent(event('keydown',{key:'Escape'}));assert.equal(s.value,'light');assert.equal(s.getAttribute('aria-expanded'),'false');assert.equal(p.document.activeElement,s);assert.equal(dialog.hidden,true);
});
test('A disabled source does not open and disabled options cannot be selected',()=>{
 const {p}=setup(),s=p.element('screenTheme');s.disabled=true;s.dispatchEvent(event('mousedown',{button:0}));assert.equal(node(p,'selectWindow').hidden,true);
 s.disabled=false;s.options[1].disabled=true;const list=open(p,'screenTheme');list.children[1].click();assert.equal(s.value,'dark');dismiss(p);
});
test('Fallback window covers other menus, prevents background input and preserves pre-existing inert state',()=>{
 const {p}=setup(),wrap=p.document.querySelector('.wrap'),mini=p.element('mini');wrap.inert=true;
 open(p,'screenTheme');assert.equal(wrap.inert,true);assert.equal(mini.inert,true);assert.equal(node(p,'selectWindow').getAttribute('role'),'dialog');
 const backdrop=p.nodes.find(n=>n.className==='select-window-backdrop');assert.equal(backdrop.hidden,false);backdrop.click();
 assert.equal(wrap.inert,true);assert.equal(mini.inert,false);assert.equal(backdrop.hidden,true);
});
test('Touch taps open once, while a scroll gesture leaves the selection unchanged',()=>{
 const {p}=setup(),s=p.element('pickRank');s.dispatchEvent(event('touchstart',{touches:[{clientX:20,clientY:20}]}));
 s.dispatchEvent(event('touchend',{changedTouches:[{clientX:20,clientY:90}]}));assert.equal(node(p,'selectWindow').hidden,true);
 s.dispatchEvent(event('touchstart',{touches:[{clientX:20,clientY:20}]}));const tap=event('touchend',{changedTouches:[{clientX:22,clientY:22}]});s.dispatchEvent(tap);assert.ok(tap.defaultPrevented);
 const list=node(p,'selectWindowList'),first=list.children[0];s.dispatchEvent(event('click'));assert.equal(list.children[0],first);dismiss(p);
});
test('All ten window colors retain readable normal, selected, disabled and focused rows in both page themes',()=>{
 const {p}=setup(),s=p.element('screenTheme'),dialog=node(p,'selectWindow');s.options[1].disabled=true;const list=open(p,'screenTheme');dialog.removeAttribute('hidden');
 const audit=createAudit({root:p.document.documentElement,nodes:p.nodes});
 const papers={white:['#fff','#fff'],black:['#111','#111'],gray:['#f1f5f9','#1e293b'],blue:['#edf6fc','#12243a'],green:['#edf7f1','#14291e'],purple:['#f5f0fc','#231c36'],pink:['#fdf1f7','#2c1c2a'],red:['#fff0f3','#351d27'],orange:['#fff4e8','#352617'],gold:['#fff2d6','#332a16']};
 for(const color of p.element('listColor').options.map(o=>o.value))for(const theme of ['light','dark']){
  change(p,'listColor',color);for(const row of list.children)for(const state of [[],['hover'],['focus','focus-visible']]){
   const ctx={theme,accent:'standard',weight:'ultra',width:390,pointer:'coarse',states:new Map([[row,new Set(state)]])};
   const paint=audit.textContrast(row,ctx);assert.ok(paint.ratio>=4.5,color+' '+theme+' '+row.textContent);assert.ok(paint.reliable);
   assert.deepEqual(parseColor(audit.computed(dialog,ctx)['background-color']),parseColor(papers[color][theme==='dark'?1:0]));
   const c=paint.computed;assert.ok(contrast(parseColor(c['border-top-color']),audit.background(row,ctx))>=3);
   if(state.includes('focus-visible'))assert.ok(contrast(parseColor(c['outline-color']),audit.background(row,ctx))>=3);
  }
 }
 dismiss(p);
});
test('Ten numeral colors remain readable with every background, theme and accent palette',()=>{
 const {p}=setup(),audit=createAudit({root:p.document.documentElement,nodes:p.nodes});
 for(const number of p.element('numberColor').options.map(o=>o.value))for(const background of p.element('backgroundColor').options.map(o=>o.value)){
  change(p,'numberColor',number);change(p,'backgroundColor',background);
  for(const theme of background==='black'?['dark']:['light','dark'])for(const accent of p.element('screenColor').options.map(o=>o.value)){
   const ctx={theme,accent,weight:'bold',width:390,pointer:'coarse'};
   for(const id of ['remain','pct','target','currentTop','coreCountTop','coinNeed','dogcatNeed']){
    const paint=audit.textContrast(p.element(id),ctx);assert.ok(paint.ratio>=4.5,[number,background,theme,accent,id].join('/'));
    assert.deepEqual(parseColor(paint.computed.color),parseColor(paint.computed.variables[id==='remain'?'--remaining-ink':'--number-ink']),id==='remain'?'Remaining goal keeps yellow':id+' reflects selected numeral hue');
   }
  }
 }
});
test('Remaining K uses a bounded light underline without moving or fading its digits',()=>{
 assert.match(html,/\.remain\{position:relative;width:max-content;max-width:100%;min-width:0;font-weight:var\(--display-weight\)!important;text-shadow:none!important;box-shadow:none!important;animation:none\}/);
 assert.match(html,/\.remain::after\{content:"";position:absolute;left:0;bottom:0;width:100%;max-width:100%;height:2px;border-radius:2px;pointer-events:none\}/);
 assert.match(html,/\.remain::before\{background:currentColor;opacity:\.24\}/);
 assert.match(html,/\.remain::after\{background-image:linear-gradient\(90deg,transparent,currentColor,transparent\);background-size:45% 100%;background-repeat:no-repeat;background-position:0% 50%;animation:remaining-sweep/);
 assert.match(html,/@keyframes remaining-sweep\{from\{background-position:0% 50%\}to\{background-position:100% 50%\}\}/);
 assert.match(html,/@media \(prefers-reduced-motion:reduce\).*\.remain::after\{animation:none;background-position:50% 50%\}/);
 assert.match(html,/forced-colors:active.*\.remain::before\{background:CanvasText;opacity:1\}.*\.remain::after\{display:none;animation:none\}/);
 assert.doesNotMatch(html,/remaining-emphasis/);
 assert.match(html,/summary,\.sectionToggle,\.navlinks a,\.manual-link,\.border-target-link\)\{box-shadow:inset 0 -2px 0 var\(--teal\)!important/);
});

test('Page and HUD backgrounds remain independent, persist and restore together',()=>{
 const {p,data}=setup();change(p,'screenTheme','light');change(p,'hudBackgroundColor','black');
 assert.equal(p.document.documentElement.getAttribute('data-theme'),'light');
 assert.equal(p.element('browserThemeColor').getAttribute('content'),'#eef3f8');
 const hudPaint=JSON.stringify(p.element('mini').style),itemsPaint=JSON.stringify(p.element('itemsWindow').style);
 for(const option of p.element('backgroundColor').options){
  change(p,'backgroundColor',option.value);
  assert.equal(p.element('hudBackgroundColor').value,'black');
  assert.equal(JSON.stringify(p.element('mini').style),hudPaint);
  assert.equal(JSON.stringify(p.element('itemsWindow').style),itemsPaint);
 }
 const pagePaint=p.element('browserThemeColor').getAttribute('content');
 for(const option of p.element('hudBackgroundColor').options){change(p,'hudBackgroundColor',option.value);assert.equal(p.element('backgroundColor').value,'gold');assert.equal(p.element('browserThemeColor').getAttribute('content'),pagePaint);}
 change(p,'hudBackgroundColor','purple');
 const q=pageEngine(undefined,{navigator:{onLine:false},localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}});
 assert.equal(q.element('backgroundColor').value,'gold');assert.equal(q.element('hudBackgroundColor').value,'purple');
 change(q,'saveContent','backup');change(q,'saveMethod','file');q.element('saveExport').click();const backup=JSON.parse(q.element('backupText').value);
 const {p:r}=setup();r.element('paste').value=JSON.stringify(backup);r.element('importBtn').click();
 assert.equal(r.element('backgroundColor').value,'gold');assert.equal(r.element('hudBackgroundColor').value,'purple');
 r.element('restoreDisplaySettings').click();assert.equal(r.element('hudBackgroundColor').value,'black');assert.equal(r.element('backgroundColor').value,'theme');
});
test('HUD setting validates backups and follows cross-tab changes without echoing writes',()=>{
 const {p,data}=setup();change(p,'hudBackgroundColor','pink');const records=data.get(KEY),display=data.get(DISPLAY);
 p.element('paste').value=JSON.stringify({pmcBackup:1,log:{},display:{...JSON.parse(display),hudBackground:'unknown'}});p.element('importBtn').click();
 assert.equal(p.element('importMsg').className,'toast err');assert.equal(data.get(KEY),records);assert.equal(data.get(DISPLAY),display);
 const incoming=JSON.stringify({...JSON.parse(display),background:'green',hudBackground:'black'});data.set(DISPLAY,incoming);
 p.dispatchWindow('storage',{key:DISPLAY,newValue:incoming});assert.equal(p.element('backgroundColor').value,'green');assert.equal(p.element('hudBackgroundColor').value,'black');assert.equal(data.get(DISPLAY),incoming);
 change(p,'hudBackgroundColor','bad');assert.equal(p.element('hudBackgroundColor').value,'black');assert.equal(data.get(DISPLAY),incoming);
});
test('All HUD backgrounds keep normal, invalid and disabled controls readable in mixed themes',()=>{
 const {p}=setup(),audit=createAudit({root:p.document.documentElement,nodes:p.nodes});p.element('itemsWindow').hidden=false;
 const ids=['miniL','miniT','miniNowTime','copyRemaining','targetMini','currentMini','miniBuffer','miniPeriod','coreCountItems'];
 for(const theme of ['light','dark'])for(const hud of p.element('hudBackgroundColor').options.map(o=>o.value))for(const number of p.element('numberColor').options.map(o=>o.value)){
  change(p,'screenTheme',theme);change(p,'hudBackgroundColor',hud);change(p,'numberColor',number);
  const ctx={theme,accent:'standard',weight:'bold',width:390,pointer:'coarse'};
  for(const id of ids){const n=p.element(id);assert.ok(audit.textContrast(n,ctx).ratio>=4.5,theme+'/'+hud+'/'+number+'/'+id);}
  for(const id of ['targetMini','currentMini','miniBuffer','coreCountItems']){
   const n=p.element(id);n.setAttribute('aria-invalid','true');
   assert.ok(audit.textContrast(n,{...ctx}).ratio>=4.5,'Invalid '+theme+'/'+hud+'/'+id);n.removeAttribute('aria-invalid');
   n.setAttribute('disabled','');assert.ok(audit.textContrast(n,{...ctx}).ratio>=4.5,'Disabled '+theme+'/'+hud+'/'+id);n.removeAttribute('disabled');
  }
 }
});
