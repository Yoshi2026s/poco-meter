const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright');

async function checkVisibleItemText(page, width, target) {
  const cards = page.locator('#itemsWindowRow .coin-card');
  const labels = ['必要コイン', '犬・猫', '笹パンダ', '花火', '馬車'];
  assert.deepEqual(await cards.locator('span').allInnerTexts(), labels);

  for (const card of await cards.all()) {
    const label = card.locator('span');
    const quantity = card.locator('b');
    const message = `${width}px, target ${target}, ${await label.innerText()}`;
    assert.ok(await label.isVisible() && await quantity.isVisible(), message);
    const expected = await quantity.getAttribute('data-value');
    assert.match(expected, /[1-9]/, message + ' has a calculated quantity');
    assert.equal((await quantity.innerText()).replace(/\s/g, ''), expected.replace(/\s/g, ''), message + ' renders all digits and units');

    const clippedText = await card.evaluate(card => {
      const cardBounds = card.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const tolerance = 1;
      return [...card.querySelectorAll('span, b')].filter(element => {
        const bounds = element.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(element);
        const fragments = [...range.getClientRects()];
        return !fragments.length || fragments.some(rect =>
          rect.left < Math.max(0, cardBounds.left, bounds.left) - tolerance ||
          rect.right > Math.min(viewportWidth, cardBounds.right, bounds.right) + tolerance ||
          rect.top < Math.max(cardBounds.top, bounds.top) - tolerance ||
          rect.bottom > Math.min(cardBounds.bottom, bounds.bottom) + tolerance
        );
      }).map(element => element.textContent);
    });
    assert.deepEqual(clippedText, [], message + ' text fits inside its card');
  }
}

async function checkOverview(page, width, height, checkViewport) {
  const layout = await page.evaluate(() => {
    const box = selector => document.querySelector(selector).getBoundingClientRect();
    const title = box('#itemsWindowTitle');
    const core = box('.items-core');
    const progress = box('#miniProgress');
    const accuracy = box('#miniClockAccuracy');
    return {
      sameRow: title.right <= core.left && title.top < core.bottom && core.top < title.bottom,
      compact: matchMedia('(max-width:559px), (pointer:coarse) and (min-width:560px) and (max-height:500px)').matches,
      progressOnLeft: progress.right <= accuracy.left && progress.top < accuracy.bottom && accuracy.top < progress.bottom,
      gaugeWidth: box('.main-progress-bar').width,
      progressAboveAccuracy: progress.bottom <= accuracy.top,
      bottom: Math.max(...['.main-hero', '.main-inputs', '#miniGoalMenu', '#itemsWindow'].map(selector => box(selector).bottom)),
      viewportHeight: visualViewport.height,
      scrollY,
    };
  });
  assert.ok(layout.sameRow, `${width}px: the estimate heading and core input share a row`);
  if (layout.compact) assert.ok(layout.progressOnLeft && layout.gaugeWidth >= 48, `${width}px: the gauge is on the left of the clock accuracy`);
  else assert.ok(layout.progressAboveAccuracy, `${width}px: the gauge occupies the countdown's former accuracy row`);
  if (checkViewport) {
    assert.equal(layout.scrollY, 0);
    assert.ok(layout.bottom <= layout.viewportHeight, `${width}×${height}: overview ends at ${layout.bottom}px`);
  }
}

// 2026-11: the simple menu is the main screen; the remaining-items estimate is always shown inside it.
(async()=>{const browser=await chromium.launch({executablePath:process.env.POCOCHA_CHROMIUM||undefined,args:['--no-sandbox']});try{for(const [width,height] of [[320,568],[360,640],[390,844],[700,844],[568,320],[844,390],[1024,850]]){const mobile=width<=700||height<=500;const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce',bypassCSP:true,isMobile:mobile,hasTouch:mobile});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date('2026-10-04T16:13:40Z'));await page.goto('file://'+path.resolve(__dirname,'../calculator/index.html'));
assert.equal(await page.locator('#itemsWindow').isVisible(),true,'items visible at start');assert.equal(await page.locator('#itemsWindowRow .coin-card').count(),5);
await checkOverview(page,width,height,mobile);
if (width <= 359 || (width >= 560 && height <= 350 && mobile)) {
  const arrow = await page.locator('#miniPeriod').evaluate(select => {
    const style = getComputedStyle(select);
    return {padding:parseFloat(style.paddingRight), size:parseFloat(style.backgroundSize), offset:parseFloat(style.getPropertyValue('--select-arrow-right-a'))};
  });
  assert.ok(arrow.size > 0 && arrow.offset + arrow.size < arrow.padding, `${width}px: select arrow fits within the reserved padding`);
}
for(const id of ['#hudToggle','#itemsHudToggle','#closeItemsWindow'])assert.equal(await page.locator(id).count(),0,'retired '+id);
const coreCount = page.locator('#coreCountItems');
for (const value of ['1000', '１０００']) {
  await coreCount.fill(value);
  const size = await coreCount.evaluate(input => {
    const style = getComputedStyle(input);
    const text = document.createElement('span');
    text.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
    text.style.font = style.font;
    text.style.fontVariantNumeric = style.fontVariantNumeric;
    text.style.letterSpacing = style.letterSpacing;
    text.textContent = input.value;
    document.body.append(text);
    const textWidth = text.getBoundingClientRect().width;
    text.remove();
    const contentWidth = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const minHeight = matchMedia('(max-width:700px),(pointer:coarse)').matches ? 48 : 44;
    return {textWidth, contentWidth, height:input.getBoundingClientRect().height, minHeight};
  });
  assert.ok(size.contentWidth >= size.textWidth, `${width}px: all digits of ${value} fit (${JSON.stringify(size)})`);
  assert.ok(size.height >= size.minHeight, `${width}px: core count field is at least ${size.minHeight}px tall`);
  await coreCount.blur();
  assert.equal(await coreCount.inputValue(), '1000');
}
await coreCount.fill('0');
await coreCount.blur();
const textCheckWidth = width === 360 || width === 700;
const extremeTarget = '360287970189639';
const targets = textCheckWidth ? ['500000', '50000000', extremeTarget] : ['500000', extremeTarget];
for(const target of targets){await page.locator('#targetMini').focus();await page.locator('#targetMini').fill(target);await page.locator('#targetMini').blur();await page.locator('#currentMini').focus();await page.locator('#currentMini').fill('0');await page.locator('#currentMini').blur();
const r=await page.evaluate(()=>({cards:[...document.querySelectorAll('#itemsWindowRow .coin-card')].map(e=>({w:e.clientWidth,scroll:e.scrollWidth,b:e.querySelector('b').getAttribute('data-value')})),sources:['coinNeed','dogcatNeed','pandaNeed','hanabiNeed','bashaNeed'].map(id=>document.getElementById(id).textContent),overflow:document.documentElement.scrollWidth>innerWidth}));
assert.ok(r.cards.every(x=>x.scroll<=x.w),JSON.stringify({width,target,...r}));assert.deepEqual(r.cards.map(x=>x.b),r.sources,'items mirror calculator values');assert.equal(r.overflow,false,'no horizontal scroll');
if(textCheckWidth||(width===320&&target==='500000'))await checkVisibleItemText(page,width,target);
if(target==='500000'&&mobile){await page.evaluate(()=>scrollTo(0,0));await checkOverview(page,width,height,true);}}
// Main controls are touchable and use 16px+ text (no iOS zoom on focus).
// 2026-11-13: phone portrait is compacted on request (one screen shows up to the forecast): inputs/selects 32px+, buttons 28px+.
const sizes=await page.evaluate(()=>['targetMini','currentMini','miniPeriod','miniRank','miniBorder','miniMethod','miniBuffer','miniClose','coreCountItems'].map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return {id,h:r.height,font:parseFloat(getComputedStyle(e).fontSize)};}));
for(const s of sizes){assert.ok(s.h>=32,JSON.stringify(s));assert.ok(s.font>=16,JSON.stringify(s));}
const buttons=await page.evaluate(()=>[...document.querySelectorAll('#mini button:not([hidden]), #mini a')].filter(e=>e.offsetParent).map(e=>({id:e.id||e.textContent,h:e.getBoundingClientRect().height})));
for(const b of buttons)assert.ok(b.h>=28,JSON.stringify(b));
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
await page.locator('#targetMini').focus();
await page.locator('#targetMini').fill('500K');
await page.locator('#targetMini').press('Enter');
for (const [points, percent] of [['99500','19.9'],['500K','100']]) {
  await page.locator('#currentMini').focus();
  await page.locator('#currentMini').fill(points);
  await page.locator('#currentMini').press('Enter');
  const gauge = page.getByRole('progressbar', {name:'目標の達成率'});
  assert.equal(await gauge.getAttribute('aria-valuenow'), percent);
  assert.equal(await page.locator('#miniPct').innerText(), percent+'%');
  assert.equal(await page.locator('#miniFill').evaluate(el=>el.style.width), percent+'%');
}
assert.deepEqual(errors,[]);await page.close();console.log('passed',width+'x'+height);} }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
