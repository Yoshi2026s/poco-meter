import test from 'node:test';
import assert from 'node:assert/strict';
import {engine,pageEngine,plain,html,pointsFromK} from './calculator-harness.mjs';
import {createAudit} from './theme-cascade.mjs';
const KEY='pococha-meter-calc-v1';
const cfg=extra=>({...plain(engine().state),seedVer:3,seedVer13:1,
  snapshotVersion:'2026-10-02-v3',goalDefaultsVersion:2,goalDefaults:{...plain(engine().state.goalDefaults),applyOnLoad:false},
  target:'1001',current:'50',pick:'',bufferPct:0,targetMethod:'mean',
  log:{'2026-09-30':{S1:[100,200,300]},'2026-10-02':{S1:[300,400,500]}},
  log13:{},log24:{},provenance:{},...extra});
const page=extra=>pageEngine(cfg(extra),{navigator:{onLine:false}});
const input=(p,id,value,type='input')=>{p.element(id).value=String(value);p.element(id).dispatchEvent(new Event(type));};
const saved=p=>JSON.parse(p.stored.get(KEY));

test('Requested short captions, header order and single lower menu locations',()=>{
  assert.match(html,/for="coreCountTop">現コア数<\/label>/);
  assert.match(html,/class="core-bonus-caption">コアボ<\/small>/);
  const p=page(),header=p.document.querySelector('.header-main');
  assert.deepEqual(header.children.map(n=>n.id||n.tagName),['H1','toolUsage','calculationMethodsLink','displaySettings','refreshPage','toolUpdatedDate']);
  assert.equal(p.document.querySelectorAll('#toolContact').length,0);
  for(const id of ['toolDisclaimer']){assert.equal(p.document.querySelectorAll('#'+id).length,1);assert.ok(p.element(id).closest('footer .footer-support'));}
  assert.equal(p.document.querySelectorAll('header nav').length,0);
  assert.equal(p.document.querySelector('#quickBackup'),null);
  assert.equal(p.document.querySelector('#clockBox'),null);
  assert.equal(p.document.querySelectorAll('#targetStudio').length,1);
  assert.equal(p.document.querySelectorAll('#recordEditor').length,1);
  assert.equal(p.document.querySelectorAll('#backupTools').length,1);
  for(const id of ['targetStudio','recordEditor','backupTools'])assert.ok(p.element(id).closest('.secondary-menus'));
});

test('The new rate starts at zero and restores saved nonzero values without modifying personal input',()=>{
  const p=page();assert.equal(p.element('quickBufferPct').value,'0');
  const q=page({bufferPct:7.5});assert.equal(q.element('quickBufferPct').value,'7.5');
  input(q,'quickBufferPct','10','change');
  assert.equal(saved(q).bufferPct,10);assert.equal(saved(q).target,'1001');assert.equal(saved(q).current,'50');
  assert.equal(q.element('bufferPct').value,'10');
  const reloaded=pageEngine(saved(q),{navigator:{onLine:false}});
  assert.equal(reloaded.element('quickBufferPct').value,'10');
});

test('Both rate forms immediately recalculate automatic goals, remaining points and required coins',()=>{
  const p=page({pick:0,coreCount:'40'});
  input(p,'coreCountTop','40');
  assert.equal(saved(p).target,'200');
  input(p,'quickBufferPct','10');
  assert.equal(saved(p).target,'220');assert.equal(pointsFromK(p.element('remain').textContent),170n);
  assert.equal(p.element('coinNeed').textContent,'39');
  assert.equal(p.element('bufferPct').value,'10');
  input(p,'bufferPct','2.5');
  assert.equal(saved(p).target,'205');assert.equal(pointsFromK(p.element('remain').textContent),155n);
  assert.equal(p.element('quickBufferPct').value,'2.5');
  input(p,'quickBufferPct','５０','change');
  assert.equal(saved(p).bufferPct,50);assert.equal(saved(p).target,'300');
});

test('Invalid rates retain the last valid target, show one shared error, and recover from either form',()=>{
  const p=page({pick:0});input(p,'quickBufferPct','10');
  for(const bad of ['51','-1','1.23','abc','']){
    input(p,'quickBufferPct',bad);
    assert.equal(saved(p).bufferPct,10);assert.equal(saved(p).target,'220');
    assert.equal(p.element('quickBufferPct').getAttribute('aria-invalid'),'true');
    assert.equal(p.element('bufferPct').getAttribute('aria-invalid'),'true');
    assert.equal(p.element('inputStatus').textContent.split('上乗せ率：').length,2);
  }
  input(p,'bufferPct','12.5');
  assert.equal(saved(p).target,'225');assert.equal(p.element('quickBufferPct').value,'12.5');
  assert.equal(p.element('quickBufferPct').getAttribute('aria-invalid'),'false');
  assert.equal(p.element('inputStatus').hidden,true);
});

test('IME editing is not committed before completion, and applying defaults synchronizes both forms',()=>{
  const p=page({pick:0});
  p.element('quickBufferPct').dispatchEvent(new Event('compositionstart'));
  input(p,'quickBufferPct','１０');assert.equal(saved(p).bufferPct,0);
  p.element('quickBufferPct').dispatchEvent(new Event('compositionend'));
  assert.equal(saved(p).bufferPct,10);assert.equal(saved(p).target,'220');
  p.element('standardGoalDefaults').click();p.element('saveGoalDefaults').click();
  p.element('applyGoalDefaults').click();
  assert.equal(saved(p).bufferPct,0);
  assert.equal(p.element('quickBufferPct').value,'0');assert.equal(p.element('bufferPct').value,'0');
});

test('Header help and footer support keep close controls inside and readable bounded surfaces in both themes',()=>{
  assert.match(html,/footer \.footer-support \.header-help-panel\{[^}]*max-height:none/);
  const p=page(),audit=createAudit({root:p.document.documentElement,nodes:p.nodes});
  for(const width of [280,390,1280])assert.equal(audit.computed(p.document.querySelector('.header-main'),{width,theme:'dark',accent:'standard',weight:'bold',pointer:width<=700?'coarse':'fine'}).display,'grid');
  for(const id of ['toolDisclaimer','toolUsage']){
    const menu=p.element(id),panel=menu.querySelector('.header-help-panel'),summary=menu.children[0];
    const close=panel.querySelector('.menu-close-button');assert.ok(close);
    menu.open=true;menu.setAttribute('open','');close.click();
    assert.equal(menu.open,false);assert.equal(p.document.activeElement,summary);
    for(const width of [280,390,1280])for(const theme of ['dark','light']){
      const ctx={width,theme,accent:'standard',weight:'bold',pointer:width<=700?'coarse':'fine'};
      const c=audit.computed(panel,ctx),paint=audit.textContrast(panel,ctx);
      assert.equal(c.position,id==='toolDisclaimer'?'static':'absolute');assert.equal(c['max-width'],'100%');
      assert.ok(paint.reliable&&paint.ratio>=4.5);
    }
  }
});

test('Opening a header menu closes the other two panels to prevent overlap',()=>{
  const p=page(),ids=['displaySettings','toolDisclaimer','toolUsage'];
  for(const id of [...ids,...ids]){
    const menu=p.element(id);menu.open=true;menu.setAttribute('open','');menu.dispatchEvent(new Event('toggle'));
    for(const other of ids)assert.equal(p.element(other).open,other===id);
  }
});

test('Simple menu is visible in the delivered HTML before initialization',()=>{
  assert.match(html,/<div class="mini show main-screen" id="mini" [^>]*aria-hidden="false">/);
  for(const id of ['miniTargetField','miniCurrentField','miniGoalMenu','miniNow']){
    const tag=html.match(new RegExp('<[^>]+id="'+id+'"[^>]*>'))[0];
    assert.doesNotMatch(tag,/\shidden(?:\s|>)/);
  }
  const p=page();
  assert.ok(p.element('mini').classList.contains('show'));
  assert.equal(p.element('fullMeterMenu').open,false);
  assert.equal(p.element('itemsWindow').hidden,false,'remaining items are always shown in the simple menu');
  assert.ok(p.element('itemsWindow').closest('#mini'),'remaining items live inside the simple menu');
});
