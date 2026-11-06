const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'..'),OUT=process.argv[2];
if(!OUT)throw new Error('Pass a scratch output directory');
// Desktop geometry is compared with OUT/before.html. Without one, the committed
// calculator (git HEAD) is the baseline, so only uncommitted edits are compared.
if(!fs.existsSync(path.join(OUT,'before.html'))){fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'before.html'),require('node:child_process').execFileSync('git',['show','HEAD:calculator/index.html'],{cwd:ROOT}));console.log('baseline before.html = git HEAD calculator/index.html');}
const font=process.env.POCOCHA_FONT_CSS||require.resolve('@fontsource/noto-sans-jp/400.css');
const binary=process.env.POCOCHA_CHROMIUM||undefined;
const cases=[320,360,375,390,430,600,700].map(width=>({width,theme:'dark',weight:'bold',scale:1}));
cases.push({width:320,theme:'light',weight:'ultra',scale:1},{width:390,theme:'dark',weight:'ultra',scale:1},{width:320,theme:'dark',weight:'bold',scale:2},{width:390,theme:'light',weight:'bold',scale:2});
const results=[],failures=[];
let browser;
async function fill(p,id,value){await p.locator(id).focus();await p.locator(id).fill(value);}
async function open(width,file,config={}){
 const context=await browser.newContext({viewport:{width,height:844},bypassCSP:true,isMobile:width<=700,hasTouch:width<=700,reducedMotion:'reduce'});
 const p=await context.newPage(),errors=[];p.setDefaultTimeout(5000);p.on('pageerror',e=>errors.push(e.message));
 await p.clock.install({time:new Date('2026-10-04T16:13:40Z')});await p.clock.pauseAt(new Date('2026-10-04T16:13:40Z'));
 if(config.savedState)await p.addInitScript(state=>localStorage.setItem('pococha-meter-calc-v1',JSON.stringify(state)),config.savedState);
 if(config.virtualViewport)await p.addInitScript(()=>{const viewport=new EventTarget();Object.assign(viewport,{height:844,offsetTop:0});Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});});
 await p.goto('file://'+file);
 const css=fs.readFileSync(font,'utf8').replaceAll('url(./files/','url(file://'+path.dirname(font)+'/files/');
 await p.addStyleTag({content:css+'body{font-family:"Noto Sans JP",sans-serif!important}'+(config.scale===2?'html{font-size:32px}':'')});
 await p.evaluate(()=>document.fonts.ready);
 await p.evaluate(c=>{for(const [id,value] of [['screenTheme',c.theme||'dark'],['textWeight',c.weight||'bold']]){const e=document.getElementById(id);e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));}},config);
 // The detailed meter menu is closed by default (see compact-menus); open it as a user would.
 // Other menus are closed behind the simple menu (main screen) by default; open them as a user would.
 await p.evaluate(()=>{if(window.pocochaMainMenus)window.pocochaMainMenus.open();const menu=document.getElementById('fullMeterMenu');if(menu)menu.open=true;});
 if(config.defaultsOnly)return {context,p,errors};
 await fill(p,'#coreCountTop','40');await fill(p,'#target','500K');await p.locator('#applyManualTarget').click();await fill(p,'#currentTop','125K');
 await p.locator('#currentTop').blur();await p.evaluate(()=>window.scrollTo(0,0));await p.waitForTimeout(80);
 return {context,p,errors};
}
async function geometry(p){return p.evaluate(()=>{
 const rect=s=>{const e=document.querySelector(s),r=e.getBoundingClientRect(),c=getComputedStyle(e);return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,font:c.fontSize,line:c.lineHeight,whiteSpace:c.whiteSpace,display:c.display};};
 const selectors=['header.card','.header-main','#today','#todayDate','#todayTime','#remain','.remainbox','.compact-deadline-controls','#deadlineCountdown','#leftLabel','#left','#closeSel','#coreCountTop','#quickTargetControls','#remainingItems','#target','#currentTop','.goal-inputs','.sectionToggle'];
 const boxes=Object.fromEntries(selectors.map(s=>[s,rect(s)]));
 const select=document.querySelector('#closeSel'),c=getComputedStyle(select),canvas=document.createElement('canvas'),measure=canvas.getContext('2d');measure.font=c.font;
 return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,boxes,closeTextNeed:measure.measureText(select.selectedOptions[0].textContent).width+parseFloat(c.paddingLeft)+parseFloat(c.paddingRight)+parseFloat(c.borderLeftWidth)+parseFloat(c.borderRightWidth),coins:[...document.querySelectorAll('#remainingItems .coin-card')].map(e=>({name:rect('#'+e.querySelector('b').id+'').width,label:e.querySelector('span').getBoundingClientRect().height,labelLine:parseFloat(getComputedStyle(e.querySelector('span')).lineHeight),number:e.querySelector('b').getBoundingClientRect().height,numberLine:parseFloat(getComputedStyle(e.querySelector('b')).lineHeight)}))};
});}
async function step(p){await p.waitForTimeout(80);}
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:binary,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 for(const config of cases){let context;try{
  const opened=await open(config.width,path.join(ROOT,'calculator/index.html'),config);context=opened.context;const p=opened.p;
  assert.equal((await p.locator('#remain').innerText()).trim(),'375K');
  assert.equal((await p.locator('#pct').innerText()).trim(),'25%');
  assert.equal(await p.locator('#mini').getAttribute('aria-hidden'),'false','HUD visible at page top');assert.ok(await p.locator('#mini').isVisible());for(const id of ['#miniSub1k','#miniAdd1k','#miniAdd10k','#miniAdd100k','#miniUndoCurrent']){const box=await p.locator(id).boundingBox();assert.ok(box&&box.height>=44,'quick add tap target '+id);}assert.equal(await p.locator('#mainMenuToggle').getAttribute('aria-expanded'),'true');
  assert.equal(await p.locator('#miniR').innerText(),await p.locator('#remain').innerText());
  assert.ok(await p.locator('#miniNow').isVisible(),'HUD current datetime visible');assert.equal(await p.locator('#miniNowDate').innerText(),'2026/10/05（月）');const hudClock=await p.locator('#miniNowTime').innerText();
  const countdown=await p.locator('#miniT').innerText();await p.clock.runFor(1000);assert.notEqual(await p.locator('#miniT').innerText(),countdown,'HUD countdown ticks');assert.equal(await p.locator('#miniT').innerText(),await p.locator('#left').innerText());
  assert.notEqual(await p.locator('#miniNowTime').innerText(),hudClock,'HUD clock ticks');assert.equal(await p.locator('#miniNowTime').innerText(),await p.locator('#todayTime').innerText());assert.equal(await p.locator('#miniNow').getAttribute('datetime'),await p.locator('#today').getAttribute('datetime'));assert.equal(await p.locator('#miniNow').getAttribute('aria-label'),await p.locator('#today').getAttribute('aria-label'));
  const hudStyle=await p.evaluate(()=>{const mini=document.getElementById('mini'),probe=document.createElement('span');mini.appendChild(probe);const color=name=>{probe.style.setProperty('color','var('+name+')','important');return getComputedStyle(probe).color;};const red=color('--red'),green=color('--success');probe.remove();const css=getComputedStyle(document.getElementById('miniT'));return {red,green,countdownColor:css.color,countdownFont:parseFloat(css.fontSize),clockColor:getComputedStyle(document.getElementById('miniNowTime')).color,dateColor:getComputedStyle(document.getElementById('miniNowDate')).color,bg:getComputedStyle(mini).backgroundColor};});
  assert.equal(hudStyle.countdownColor,hudStyle.red,'countdown remains red');assert.ok(hudStyle.countdownFont>=18,'HUD countdown is larger');assert.equal(hudStyle.clockColor,hudStyle.green,'clock remains green');assert.equal(hudStyle.dateColor,hudStyle.green,'date remains green');
  const g=await geometry(p),b=g.boxes;
  assert.ok(g.documentWidth<=g.viewport+1,'page overflows '+JSON.stringify(g));
  assert.equal(b['#todayTime'].whiteSpace,'nowrap');assert.equal(b['#left'].whiteSpace,'nowrap');
  assert.ok(b['#todayTime'].height<=parseFloat(b['#todayTime'].line)*1.1,'clock wraps');
  assert.ok(b['.compact-deadline-controls'].bottom<=Math.min(b['#today'].y,b['#quickTargetControls'].y),'deadline, closing time and core precede clock/settings');
  assert.ok(b['#left'].right<=b['#closeSel'].x&&b['#closeSel'].right<=b['#coreCountTop'].x,'three closing controls are one horizontal row');
  const middle=r=>r.y+r.height/2;assert.ok(Math.abs(middle(b['#left'])-middle(b['#closeSel']))<3&&Math.abs(middle(b['#closeSel'])-middle(b['#coreCountTop']))<1,'closing values align in one row');
  assert.equal(await p.locator('#remainingSummary .remaining-items-head').evaluate(e=>e.firstElementChild.className),'compact-deadline-controls','phone reading order starts with closing controls');
  assert.ok(await p.locator('#currentMini').isVisible(),'HUD current input visible');assert.equal(await p.locator('#currentMini').getAttribute('tabindex'),'0');assert.equal(await p.locator('#currentMini').inputValue(),'125,000');
  assert.ok(await p.locator('#targetMini').isVisible(),'HUD target input visible');assert.equal(await p.locator('#targetMini').getAttribute('tabindex'),'0');assert.equal(await p.locator('#targetMini').inputValue(),'500,000');
  const targetHud=await p.locator('#targetMini').boundingBox(),currentHud=await p.locator('#currentMini').boundingBox();assert.ok(Math.abs(targetHud.y-currentHud.y)<1&&targetHud.x+targetHud.width<=currentHud.x,'HUD inputs share a simple row');
  for(const selector of ['#miniNowDate','#miniNowTime','#miniT'])assert.equal(await p.locator(selector).evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,'HUD text fits '+selector);
  const hud=await p.locator('#mini').boundingBox(),hudInput=await p.locator('#currentMini').boundingBox();assert.ok(hudInput.height>=44,'HUD touch input height');assert.ok(hudInput.x>=hud.x&&hudInput.x+hudInput.width<=hud.x+hud.width,'HUD field stays within viewport');
  assert.ok(b['#quickTargetControls'].x>=b['.remainbox'].right-1,'settings are right of meter');
  const menus=[];for(const id of ['#quickPeriod','#quickRank','#quickBorder','#quickMethod'])menus.push(await p.locator(id).boundingBox());for(let i=1;i<menus.length;i++){assert.ok(Math.abs(menus[i].x-menus[0].x)<1&&menus[i].y>=menus[i-1].y+menus[i-1].height,'menus stack vertically');}
  assert.ok(b['#todayTime'].y>=b['#todayDate'].bottom-1,'clock is below date');assert.ok(b['#left'].x>=b['#leftLabel'].right-1&&b['#left'].x-b['#leftLabel'].right<9,'countdown directly right of label');assert.ok(b['#left'].bottom>b['#leftLabel'].y&&b['#leftLabel'].bottom>b['#left'].y,'countdown stays on same row');
  assert.ok(b['#remainingItems'].y>=b['#currentTop'].bottom-1,'items follow current value');assert.equal(await p.locator('#remainingItems').evaluate(e=>e.previousElementSibling.className),'curbox','items directly follow current input group');
  assert.ok(Math.abs(b['#remainingItems'].width-b['.goal-inputs'].width)<2,'items use full width');
  assert.ok(Math.abs(b['#currentTop'].y-b['#target'].y)<1,'target and current input share one row');assert.ok(b['#currentTop'].x>=b['#target'].right,'input groups do not overlap');
  assert.ok(g.closeTextNeed<=b['#closeSel'].width+1,'closing choice clipped '+g.closeTextNeed+' > '+b['#closeSel'].width);
  for(const id of ['#closeSel','#coreCountTop']){assert.ok(b[id].height>=30,'compact control height '+id);if(config.scale===1)assert.ok(b[id].height<=36,'control is mini '+id);assert.ok(parseFloat(b[id].font)>=16,'input avoids iOS focus zoom '+id);}
  for(const id of ['#target','#currentTop'])assert.ok(b[id].height>=44,'touch height '+id);
  for(const selector of ['#quickPeriod','#quickRank','#quickBorder','#quickMethod','#quickBufferPct']){const rect=await p.locator(selector).boundingBox();if(config.scale===1)assert.ok(rect.height<=36,'goal menu is mini '+selector);}
  if(config.scale===1)for(const row of g.coins){assert.ok(row.label<=row.labelLine*1.1,'item label wraps unnecessarily');assert.ok(row.number<=row.numberLine*1.1,'item count wraps unnecessarily');}
  for(const id of ['-1000','1000','10000','100000'])assert.equal(await p.locator('[data-addtop="'+id+'"]').isVisible(),false,'phone increment controls removed');
  await fill(p,'#currentTop','126K');await p.locator('#currentTop').blur();assert.equal((await p.locator('#remain').innerText()).trim(),'374K');assert.equal((await p.locator('#miniR').innerText()).trim(),'374K');
  assert.equal(await p.locator('#currentMini').inputValue(),'126,000','main edit synchronizes HUD');
  await fill(p,'#currentMini','127K');assert.equal((await p.locator('#remain').innerText()).trim(),'373K');assert.equal(await p.locator('#currentTop').inputValue(),'127,000');assert.equal(await p.locator('#current').inputValue(),'127,000');
  await p.locator('#currentMini').press('Enter');assert.equal(await p.locator('#currentMini').inputValue(),'127,000');
  assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('pococha-meter-calc-v1')).current),'127000','HUD edits save same state');
  await p.locator('#undoCurrent').click();assert.equal((await p.locator('#remain').innerText()).trim(),'374K');assert.equal(await p.locator('#currentMini').inputValue(),'126,000');
  await fill(p,'#currentTop','125K');await p.locator('#currentTop').blur();assert.equal((await p.locator('#remain').innerText()).trim(),'375K');assert.equal((await p.locator('#miniR').innerText()).trim(),'375K');
  await fill(p,'#targetMini','600K');assert.equal((await p.locator('#remain').innerText()).trim(),'475K');assert.equal(await p.locator('#target').inputValue(),'600,000');await p.locator('#targetMini').press('Enter');assert.equal(await p.locator('#targetMini').inputValue(),'600,000');assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('pococha-meter-calc-v1')).target),'600000');assert.equal((await p.locator('#miniR').innerText()).trim(),'475K');await fill(p,'#target','500K');await p.locator('#applyManualTarget').click();
  await p.evaluate(()=>window.scrollTo(0,document.querySelector('#remain').getBoundingClientRect().bottom+scrollY+4));await step(p);
  assert.equal(await p.locator('#mini').getAttribute('aria-hidden'),'false','HUD remains visible while summary is visible');
  await p.evaluate(()=>window.scrollTo(0,document.querySelector('#remainingSummary').getBoundingClientRect().bottom+scrollY+4));await step(p);
  assert.equal(await p.locator('#mini').getAttribute('aria-hidden'),'false','HUD when summary leaves viewport');
  // 2026-11: the simple menu is the main screen in normal flow (not fixed); it scrolls away with the page.
  const mini=await p.locator('#mini').boundingBox();assert.ok(mini.y+mini.height<=0,'main screen scrolls with the page instead of covering the menus');
  await p.locator('#currentTop').focus();await p.clock.runFor(100);await step(p);
  const focused=await p.locator('#currentTop').boundingBox();assert.ok(focused.y>=0&&focused.y+focused.height<=844,'focused input is in view');
  assert.equal(await p.evaluate(()=>{const r=document.getElementById('currentTop').getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.id;}),'currentTop','nothing covers the focused input');
  await p.locator('#currentTop').blur();await p.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await step(p);assert.ok(await p.locator('#closeMainMenus').isVisible(),'return button visible at footer');
  const back=await p.locator('#closeMainMenus').boundingBox();assert.ok(back.height>=44&&back.x+back.width<=config.width,'return button reachable');
  await p.locator('#currentTop').blur();await p.evaluate(()=>window.scrollTo(0,0));await step(p);
  if(config.scale===1&&[320,390,430].includes(config.width)&&config.weight==='bold')await p.screenshot({path:path.join(OUT,'phone-'+config.width+'-'+config.theme+'.png'),fullPage:true,animations:'disabled'});
  await fill(p,'#target','514.421K');await p.locator('#applyManualTarget').click();await fill(p,'#currentTop','100K');await p.locator('#currentTop').blur();assert.equal((await p.locator('#remain').innerText()).trim(),'414.421K');
  assert.equal(await p.locator('#remain').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,'typical long K value fits available space');
  await fill(p,'#target','9007199254740991');await fill(p,'#currentTop','0');await p.locator('#currentTop').blur();
  const long=await geometry(p);assert.ok(long.documentWidth<=long.viewport+1,'large numbers overflow');
  assert.deepEqual(opened.errors,[],'runtime errors');
  results.push({config,status:'passed',geometry:g});console.log('PASS '+JSON.stringify(config));
 }catch(e){failures.push({config,error:e.message});console.log('FAIL '+JSON.stringify(config)+' '+e.message.slice(0,1600));}finally{if(context)await context.close();}}
 for(const width of [768,1280]){let before,after;try{
  before=await open(width,path.join(OUT,'before.html'));after=await open(width,path.join(ROOT,'calculator/index.html'));
  const old=await geometry(before.p),fresh=await geometry(after.p);
  assert.equal(await after.p.locator('#currentMini').isVisible(),true,'simple menu current field shown on desktop');assert.equal(await after.p.locator('#currentMini').getAttribute('tabindex'),'0');assert.equal(await after.p.locator('#targetMini').isVisible(),true);assert.equal(await after.p.locator('#targetMini').getAttribute('tabindex'),'0');assert.equal(await after.p.locator('#miniNow').isVisible(),true,'simple menu datetime shown on desktop');
  for(const [selector,a]of Object.entries(old.boxes))for(const property of ['x','y','width','height','font','line','display'])assert.equal(fresh.boxes[selector][property],a[property],'desktop changed '+selector+' '+property);
  results.push({width,status:'passed',desktopGeometryUnchanged:true});console.log('PASS desktop '+width);
 }catch(e){failures.push({width,error:e.message});console.log('FAIL desktop '+width+' '+e.message);}finally{if(before)await before.context.close();if(after)await after.context.close();}}
 {let opened;try{
  opened=await open(390,path.join(ROOT,'calculator/index.html'),{virtualViewport:true});const p=opened.p;
  // Main screen is in normal flow: a simulated keyboard keeps the focused simple-menu input visible and uncovered.
  await p.evaluate(()=>window.scrollTo(0,0));await p.locator('#currentMini').focus();
  await p.evaluate(()=>{Object.assign(window.visualViewport,{height:470,offsetTop:0});window.visualViewport.dispatchEvent(new Event('resize'));});await p.clock.runFor(200);
  let input=await p.locator('#currentMini').boundingBox();assert.ok(input.y>=0&&input.y+input.height<=470,'simple-menu input stays above simulated keyboard');
  assert.equal(await p.evaluate(()=>{const r=document.getElementById('currentMini').getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.id;}),'currentMini','nothing covers the focused simple-menu input');
  await p.locator('#currentMini').blur();await p.evaluate(()=>{Object.assign(window.visualViewport,{height:844,offsetTop:0});window.visualViewport.dispatchEvent(new Event('resize'));});await p.clock.runFor(100);
  await p.setViewportSize({width:768,height:844});await step(p);assert.equal(await p.locator('#mini').getAttribute('aria-hidden'),'false','simple menu stays visible on desktop');
  assert.equal(await p.locator('#currentMini').isVisible(),true,'main screen field stays visible on desktop');assert.equal(await p.locator('#itemsWindow').isVisible(),true,'items stay visible on desktop');
  await p.setViewportSize({width:390,height:844});await step(p);assert.equal(await p.locator('#itemsWindow').isVisible(),true,'items stay visible on phone');
  assert.deepEqual(opened.errors,[]);results.push({status:'passed',persistentMeterKeyboardSimulation:true});console.log('PASS persistent meter keyboard and resize');
 }catch(e){failures.push({behavior:'persistentMeterKeyboardSimulation',error:e.message});console.log('FAIL persistent meter '+e.message);}finally{if(opened)await opened.context.close();}}
 {let opened;try{
  opened=await open(390,path.join(ROOT,'calculator/index.html'));const p=opened.p;
  await fill(p,'#currentMini','bad');await p.clock.runFor(1000);
  assert.equal(await p.locator('#currentMini').inputValue(),'bad','ticker preserves invalid edit');assert.equal(await p.locator('#currentMini').getAttribute('aria-invalid'),'true');assert.ok(await p.locator('#currentMiniError').isVisible());assert.match(await p.locator('#currentMini').getAttribute('aria-describedby'),/currentMiniError/);assert.equal((await p.locator('#remain').innerText()).trim(),'375K','invalid edit keeps last valid result');
  await p.setViewportSize({width:768,height:844});await step(p);assert.equal(await p.locator('#currentMini').isVisible(),true);assert.equal(await p.locator('#currentMiniError').isVisible(),true);assert.equal(await p.locator('#currentMini').inputValue(),'bad','invalid draft stays in the visible HUD field');assert.equal(await p.locator('#currentMini').getAttribute('aria-invalid'),'true');assert.notEqual(await p.locator('#currentTop').inputValue(),'bad','draft does not overwrite the detailed input');assert.equal((await p.locator('#remain').innerText()).trim(),'375K','desktop keeps last valid result');
  await fill(p,'#currentMini','125K');await p.locator('#currentMini').press('Enter');assert.equal(await p.locator('#inputStatus').isVisible(),false,'desktop can resolve the HUD draft');assert.equal(await p.locator('#currentMiniError').isVisible(),false);await p.setViewportSize({width:390,height:844});await step(p);
  await fill(p,'#currentMini','１２．５万');await p.locator('#currentMini').press('Enter');assert.equal(await p.locator('#currentMini').inputValue(),'125,000');assert.equal(await p.locator('#currentMiniError').isVisible(),false);
  await p.locator('#currentMini').focus();await p.locator('#currentMini').dispatchEvent('compositionstart');
  await p.locator('#currentMini').evaluate(e=>{e.value='あ';e.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,data:'あ'}));});await p.clock.runFor(1000);
  assert.equal(await p.locator('#currentMini').inputValue(),'あ','ticker preserves IME composition');assert.equal((await p.locator('#remain').innerText()).trim(),'375K');
  await p.locator('#currentMini').evaluate(e=>{e.value='１２６０００';e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'１２６０００'}));});await p.locator('#currentMini').press('Enter');assert.equal((await p.locator('#remain').innerText()).trim(),'374K');assert.equal(await p.locator('#currentTop').inputValue(),'126,000');
  await p.locator('#undoCurrent').click();assert.equal(await p.locator('#currentMini').inputValue(),'125,000');
  await p.locator('#resetTop').click();assert.equal(await p.locator('#currentMini').inputValue(),'0');assert.equal((await p.locator('#miniR').innerText()).trim(),'500K');
  await fill(p,'#currentMini','126K');await p.locator('#currentMini').press('Enter');
  assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('pococha-meter-calc-v1')).current),'126000','HUD edit is saved');assert.equal(await p.locator('#currentTop').inputValue(),'126,000');
  // Opening on a phone resets the current value to its default (see storage-recovery-regressions).
  await p.reload();assert.equal(await p.locator('#currentMini').inputValue(),'0','phone opening resets current');assert.equal(await p.locator('#currentTop').inputValue(),'0');
  assert.deepEqual(opened.errors,[]);results.push({status:'passed',hudCurrentValidationCompositionPersistence:true});console.log('PASS HUD current validation, IME, reset and persistence');
 }catch(e){failures.push({behavior:'hudCurrentInput',error:e.message});console.log('FAIL HUD current '+e.message);}finally{if(opened)await opened.context.close();}}
 {let opened;try{
  opened=await open(390,path.join(ROOT,'calculator/index.html'));const p=opened.p;
  await fill(p,'#targetMini','bad');await p.clock.runFor(1000);assert.equal(await p.locator('#targetMini').inputValue(),'bad');assert.equal(await p.locator('#targetMini').getAttribute('aria-invalid'),'true');assert.ok(await p.locator('#targetMiniError').isVisible());assert.equal((await p.locator('#miniR').innerText()).trim(),'375K','bad target keeps committed value');
  await p.setViewportSize({width:768,height:844});await step(p);assert.equal(await p.locator('#targetMini').isVisible(),true);assert.equal(await p.locator('#targetMiniError').isVisible(),true);assert.equal(await p.locator('#targetMini').inputValue(),'bad');assert.equal(await p.locator('#targetMini').getAttribute('aria-invalid'),'true');assert.notEqual(await p.locator('#target').inputValue(),'bad');assert.equal((await p.locator('#miniR').innerText()).trim(),'375K');
  await fill(p,'#targetMini','500K');await p.locator('#targetMini').press('Enter');assert.equal(await p.locator('#inputStatus').isVisible(),false);assert.equal(await p.locator('#targetMiniError').isVisible(),false);await p.setViewportSize({width:390,height:844});await step(p);
  await fill(p,'#targetMini','0');await p.locator('#targetMini').press('Enter');assert.equal(await p.evaluate(()=>document.activeElement.id),'targetMini');assert.equal((await p.locator('#miniR').innerText()).trim(),'375K','zero draft retains target');
  await fill(p,'#targetMini','６０万');await p.locator('#targetMini').press('Enter');assert.equal(await p.locator('#target').inputValue(),'600,000');assert.equal(await p.locator('#targetMini').inputValue(),'600,000');assert.equal((await p.locator('#miniR').innerText()).trim(),'475K');assert.equal(await p.locator('#targetMiniError').isVisible(),false);
  await p.locator('[data-reset="target"]').click();assert.equal(await p.locator('#targetMini').inputValue(),'');assert.equal(await p.locator('#target').inputValue(),'');await p.locator('#undoTarget').click();assert.equal(await p.locator('#targetMini').inputValue(),'600,000');
  await p.locator('#quickBorder').selectOption('0');const auto=await p.locator('#target').inputValue();assert.ok(auto.length>0);assert.equal(await p.locator('#targetMini').inputValue(),auto,'automatic border selection mirrors target');
  await p.locator('#targetMini').focus();await p.locator('#targetMini').dispatchEvent('compositionstart');
  await p.locator('#targetMini').evaluate(e=>{e.value='あ';e.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,data:'あ'}));});
  const before=await p.evaluate(()=>JSON.parse(localStorage.getItem('pococha-meter-calc-v1')).target);
  await p.locator('#quickRank').evaluate(e=>{e.value='S3';e.dispatchEvent(new Event('change',{bubbles:true}));});await p.clock.runFor(1000);assert.equal(await p.locator('#targetMini').inputValue(),'あ','automatic calculation preserves IME draft');assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('pococha-meter-calc-v1')).target),before,'IME blocks automatic overwrite');
  await p.locator('#targetMini').evaluate(e=>{e.value='６０００００';e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'６０００００'}));});await p.locator('#targetMini').press('Enter');assert.equal(await p.locator('#target').inputValue(),'600,000');assert.equal(await p.locator('#targetMini').inputValue(),'600,000');assert.equal(await p.locator('#quickBorder').inputValue(),'');
  await p.locator('#targetMini').focus();await p.locator('#targetMini').dispatchEvent('compositionstart');await p.locator('#targetMini').evaluate(e=>{e.value='あ';e.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,data:'あ'}));});
  await p.setViewportSize({width:768,height:844});await step(p);assert.equal(await p.locator('#targetMini').inputValue(),'あ','unfinished IME draft stays on resize');assert.equal(await p.locator('#targetMini').isVisible(),true);assert.notEqual(await p.locator('#target').inputValue(),'あ','IME draft does not overwrite the detailed input');await p.locator('#targetMini').evaluate(e=>{e.value='６００K';e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'６００K'}));});await p.locator('#targetMini').press('Enter');assert.equal(await p.locator('#targetMiniError').isVisible(),false);await p.setViewportSize({width:390,height:844});await step(p);
  assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('pococha-meter-calc-v1')).target),'600000','HUD target is saved');assert.equal(await p.locator('#targetMini').inputValue(),'600,000');
  // Opening on a phone resets the target to its default; HUD and detailed input stay in sync.
  await p.reload();assert.notEqual(await p.locator('#targetMini').inputValue(),'600,000','phone opening resets target');assert.equal(await p.locator('#targetMini').inputValue(),await p.locator('#target').inputValue());assert.equal(await p.locator('#currentMini').inputValue(),'0');
  assert.equal(await p.evaluate(()=>document.body.classList.contains('menus-open')),false,'other menus closed again after reload');
  await p.locator('#navFullMeter').click();await p.locator('#restoreGoalDefaults').click();assert.equal(await p.locator('#targetMini').inputValue(),await p.locator('#target').inputValue(),'defaults mirror target');
  assert.deepEqual(opened.errors,[]);results.push({status:'passed',hudTargetValidationAutomaticCompositionPersistence:true});console.log('PASS HUD target validation, auto border, IME, reset/default and persistence');
 }catch(e){failures.push({behavior:'hudTargetInput',error:e.message});console.log('FAIL HUD target '+e.message);}finally{if(opened)await opened.context.close();}}
 {let opened;try{
  opened=await open(320,path.join(ROOT,'calculator/index.html'));const p=opened.p;
  await p.clock.setSystemTime(new Date('2026-10-04T14:59:59Z'));await p.clock.runFor(1000);assert.equal(await p.locator('#miniNowDate').innerText(),'2026/10/05（月）','JST date rollover');assert.equal(await p.locator('#miniNowTime').innerText(),'00:00:00');assert.equal(await p.locator('#miniNow').getAttribute('datetime'),'2026-10-05T00:00:00+09:00');
  for(const theme of ['light','dark'])for(const palette of ['standard','blue','pink']){
   await p.evaluate(c=>{for(const [id,value]of [['screenTheme',c.theme],['screenColor',c.palette],['numberColor','black']]){const e=document.getElementById(id);e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));}},{theme,palette});
   const contrast=await p.evaluate(()=>{const channel=c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;};const luminance=color=>{const rgb=color.match(/[0-9.]+/g).slice(0,3).map(Number);return .2126*channel(rgb[0])+.7152*channel(rgb[1])+.0722*channel(rgb[2]);};const mini=document.getElementById('mini'),bg=luminance(getComputedStyle(mini).backgroundColor);return ['miniT','miniNowDate','miniNowTime'].map(id=>{const fg=luminance(getComputedStyle(document.getElementById(id)).color);return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);});});
   for(const value of contrast)assert.ok(value>=4.5,'clock/countdown text contrast '+theme+' '+palette+' '+value);
  }
  assert.deepEqual(opened.errors,[]);results.push({status:'passed',hudClockDateRolloverAndThemeContrast:true});console.log('PASS HUD JST clock rollover and 6 theme contrast combinations');
 }catch(e){failures.push({behavior:'hudClock',error:e.message});console.log('FAIL HUD clock '+e.message);}finally{if(opened)await opened.context.close();}}
 {let opened;try{
  opened=await open(390,path.join(ROOT,'calculator/index.html'),{defaultsOnly:true});const p=opened.p;
  assert.equal(await p.locator('#coreCountTop').inputValue(),'0');assert.equal(await p.locator('#coreBonusTop').innerText(),'100%');
  const base=await p.evaluate(()=>JSON.parse(localStorage.getItem('pococha-meter-calc-v1')));assert.equal(base.goalDefaults.coreCount,'0');
  await p.locator('#openGoalDefaults').click();await p.locator('#standardGoalDefaults').click();assert.equal(await p.locator('#defaultCore').inputValue(),'0');
  await opened.context.close();opened=null;
  for(const core of [undefined,'invalid','0','40','45']){
   const state={...base,coreCount:core,goalDefaults:{...base.goalDefaults,rank:'S3',coreCount:'55',applyOnLoad:false},goalDefaultsVersion:0};
   opened=await open(390,path.join(ROOT,'calculator/index.html'),{defaultsOnly:true,savedState:state});
   assert.equal(await opened.p.locator('#coreCountTop').inputValue(),'0','current core starts at zero regardless of the saved count');
   const saved=await opened.p.evaluate(()=>JSON.parse(localStorage.getItem('pococha-meter-calc-v1')));assert.equal(saved.goalDefaults.coreCount,'55');assert.equal(saved.goalDefaults.rank,'S3');
   await opened.context.close();opened=null;
  }
  opened=await open(390,path.join(ROOT,'calculator/index.html'),{defaultsOnly:true,savedState:{...base,coreCount:'45',goalDefaults:{...base.goalDefaults,coreCount:'55',applyOnLoad:true},goalDefaultsVersion:0}});assert.equal(await opened.p.locator('#coreCountTop').inputValue(),'0');
  results.push({status:'passed',coreDefaultAndSavedPreferences:true});console.log('PASS core defaults and saved preferences');
 }catch(e){failures.push({behavior:'coreDefaults',error:e.message});console.log('FAIL core defaults '+e.message);}finally{if(opened)await opened.context.close();}}
 await browser.close();browser=null;
 fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({passed:results.length,failed:failures.length,method:'Local Chromium phone emulation with QA Japanese font; physical phones and Safari not tested',results,failures},null,2));
 console.log(JSON.stringify({passed:results.length,failed:failures.length}));process.exitCode=failures.length?1:0;
})().catch(async e=>{console.error(e);if(browser)await browser.close();process.exitCode=1;});
