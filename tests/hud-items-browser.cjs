const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright');
// 2026-11: the simple menu is the main screen; the remaining-items estimate is always shown inside it.
(async()=>{const browser=await chromium.launch({executablePath:process.env.POCOCHA_CHROMIUM||undefined,args:['--no-sandbox']});try{for(const [width,height] of [[320,568],[390,844],[844,390],[1024,850]]){const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce',bypassCSP:true,isMobile:width<700,hasTouch:width<700});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('file://'+path.resolve(__dirname,'../calculator/index.html'));
assert.equal(await page.locator('#itemsWindow').isVisible(),true,'items visible at start');assert.equal(await page.locator('#itemsWindowRow .coin-card').count(),5);
for(const id of ['#hudToggle','#itemsHudToggle','#closeItemsWindow'])assert.equal(await page.locator(id).count(),0,'retired '+id);
for(const target of ['500000','360287970189639']){await page.locator('#targetMini').focus();await page.locator('#targetMini').fill(target);await page.locator('#targetMini').blur();await page.locator('#currentMini').focus();await page.locator('#currentMini').fill('0');await page.locator('#currentMini').blur();
const r=await page.evaluate(()=>({cards:[...document.querySelectorAll('#itemsWindowRow .coin-card')].map(e=>({w:e.clientWidth,scroll:e.scrollWidth,b:e.querySelector('b').getAttribute('data-value')})),sources:['coinNeed','dogcatNeed','pandaNeed','hanabiNeed','bashaNeed'].map(id=>document.getElementById(id).textContent),overflow:document.documentElement.scrollWidth>innerWidth}));
assert.ok(r.cards.every(x=>x.scroll<=x.w),JSON.stringify({width,target,...r}));assert.deepEqual(r.cards.map(x=>x.b),r.sources,'items mirror calculator values');assert.equal(r.overflow,false,'no horizontal scroll');}
// Main controls are touchable and use 16px+ text (no iOS zoom on focus).
const sizes=await page.evaluate(()=>['targetMini','currentMini','miniPeriod','miniRank','miniBorder','miniMethod','miniBuffer','miniClose','coreCountItems'].map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return {id,h:r.height,font:parseFloat(getComputedStyle(e).fontSize)};}));
for(const s of sizes){assert.ok(s.h>=44,JSON.stringify(s));assert.ok(s.font>=16,JSON.stringify(s));}
const buttons=await page.evaluate(()=>[...document.querySelectorAll('#mini button:not([hidden]), #mini a')].filter(e=>e.offsetParent).map(e=>({id:e.id||e.textContent,h:e.getBoundingClientRect().height})));
for(const b of buttons)assert.ok(b.h>=44,JSON.stringify(b));
// Integrated menus: auxiliary menus are inside the simple menu, the duplicated detailed meter is hidden.
assert.equal(await page.locator('#fullMeterMenu').isVisible(),false,'detailed meter hidden');assert.equal(await page.locator('header.card').isVisible(),true);
assert.equal(await page.evaluate(()=>{const a=document.getElementById('mini').getBoundingClientRect(),b=document.getElementById('mainSubMenus').getBoundingClientRect();return Math.abs(a.x-b.x)<1&&Math.abs(a.width-b.width)<1&&b.y>=a.bottom&&b.y-a.bottom<=16;}),true,'auxiliary menus continue directly below the simple menu');assert.equal(await page.locator('#menusToolbar').isVisible(),true);
for(const id of ['#pickPeriod','#pickRank','#pickBorder','#targetMethod','#bufferPct'])assert.equal(await page.locator(id).isVisible(),false,'duplicate hidden '+id);
await page.locator('#openMiniTargetDetails').click();assert.equal(await page.locator('#roundUnit').isVisible(),true,'goal details open inside the simple menu');
await page.locator('#displaySettings > summary').click();assert.equal(await page.locator('.display-settings-panel').isVisible(),true);await page.keyboard.press('Escape');assert.equal(await page.locator('.display-settings-panel').isVisible(),false);
// Quick add and undo on the main screen.
await page.locator('#currentMini').fill('100K');await page.locator('#currentMini').blur();await page.locator('#miniAdd10k').click();assert.equal(await page.locator('#currentMini').inputValue(),'110,000');
await page.locator('#miniUndoCurrent').click();assert.equal(await page.locator('#currentMini').inputValue(),'100,000');
assert.match(await page.locator('#miniPct').innerText(),/^\d+%$/);
assert.deepEqual(errors,[]);await page.close();console.log('passed',width+'x'+height);} }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
