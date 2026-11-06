import test from 'node:test';
import assert from 'node:assert/strict';
import {pageEngine} from './calculator-harness.mjs';
import {createAudit,parseColor,contrast} from './theme-cascade.mjs';

const KEY='pococha-meter-calc-v1',DRAFT=KEY+'-drafts',DISPLAY='pococha-meter-display-v1';
function make(){
  const data=new Map(),fail=new Set();
  const p=pageEngine(undefined,{navigator:{onLine:false},localStorage:{
    getItem:key=>data.get(key)??null,
    setItem(key,value){if(fail.has(key))throw new Error('Storage test failure');data.set(key,value);}
  }});
  return {p,data,fail,audit:createAudit({root:p.document.documentElement,nodes:p.nodes})};
}
function input(p,id,value){p.element(id).value=value;p.element(id).dispatchEvent(new Event('input'));}
function checkStatus(e,id,kind){
  const n=e.p.element(id);
  assert.ok(n.textContent,'A real handler must write the notification');
  if(id==='inputStatus'){
    assert.equal(n.hidden,false);n.removeAttribute('hidden');
    assert.equal(n.getAttribute('data-status'),kind);
  }else{
    assert.equal(n.classList.contains('err'),kind==='error');
    assert.equal(n.classList.contains('warn'),kind==='warning');
  }
  for(const theme of ['light','dark'])for(const accent of ['standard','blue','pink','green','purple','black']){
    const ctx={theme,accent,weight:'standard',width:390,pointer:'coarse'};
    const c=e.audit.computed(n,ctx),expected={error:'--red',success:'--success',warning:'--amber'}[kind];
    assert.deepEqual(parseColor(c.color),parseColor(c.variables[expected]),id+' reflects its actual result');
    assert.ok(e.audit.textContrast(n,ctx).ratio>=4.5,id+' remains readable');
  }
}

test('Item validation, success, duplicate warning and save failure set distinct readable colors',()=>{
  const e=make(),p=e.p;
  p.element('addItem').click();checkStatus(e,'inputStatus','error');
  p.element('itemName').value='配色確認';p.element('itemVal').value='55';
  p.element('addItem').click();checkStatus(e,'inputStatus','success');
  p.element('itemName').value='配色確認';p.element('itemVal').value='55';
  p.element('addItem').click();checkStatus(e,'inputStatus','warning');
  e.fail.add(KEY);p.element('itemName').value='保存失敗確認';p.element('itemVal').value='111';
  p.element('addItem').click();checkStatus(e,'inputStatus','error');
});

test('Reading a saved record clears the previous validation error color',()=>{
  const e=make();e.p.element('editZero').value='';e.p.element('saveDay').click();
  checkStatus(e,'editorMsg','error');
  e.p.element('loadDay').click();
  assert.match(e.p.element('editorMsg').textContent,/読み込みました/);
  checkStatus(e,'editorMsg','success');
});

test('Draft-only storage failure is shown as an error',()=>{
  const e=make();e.fail.add(DRAFT);input(e.p,'editZero','300K');
  assert.match(e.p.element('editorMsg').textContent,/保存できません/);
  checkStatus(e,'editorMsg','error');
});

test('A saved draft changes from success to error after another tab changes it',()=>{
  const e=make();input(e.p,'editZero','300K');checkStatus(e,'editorMsg','success');
  e.p.dispatchWindow('storage',{key:DRAFT,newValue:'changed'});
  assert.match(e.p.element('editorMsg').textContent,/別の画面/);
  checkStatus(e,'editorMsg','error');
});

test('Too-long draft input is an error even after an earlier successful save',()=>{
  const e=make();input(e.p,'editZero','300K');checkStatus(e,'editorMsg','success');
  input(e.p,'editZero','1'.repeat(257));checkStatus(e,'editorMsg','error');
});

test('Saving a record keeps the storage error color through refresh and timer updates',()=>{
  const e=make();for(const [id,value] of [['editZero','300K'],['editPlus1','600K'],['editPlus2','900K']])e.p.element(id).value=value;
  e.fail.add(KEY);e.p.element('saveDay').click();
  checkStatus(e,'editorMsg','error');
  e.p.tick(1000);e.p.flushTimers(400);checkStatus(e,'editorMsg','error');
});

test('Deleting an absent record uses the warning color instead of a stale success or error',()=>{
  const e=make();e.p.element('editDate').value='2025-01-01';e.p.element('deleteDay').click();
  assert.match(e.p.element('editorMsg').textContent,/記録はありません/);
  checkStatus(e,'editorMsg','warning');
});

test('A valid cross-tab display setting clears an earlier display-save error color',()=>{
  const e=make();e.fail.add(DISPLAY);e.p.element('screenTheme').value='dark';
  e.p.element('screenTheme').dispatchEvent(new Event('change'));
  checkStatus(e,'displaySettingsStatus','error');
  e.p.dispatchWindow('storage',{key:DISPLAY,newValue:JSON.stringify({theme:'light',color:'pink',weight:'bold'})});
  checkStatus(e,'displaySettingsStatus','success');
});

test('CSV import with draft-storage failure marks the warning message as an error',()=>{
  const e=make(),p=e.p,date=p.element('editDate').value;
  input(p,'editZero','300K');e.fail.add(DRAFT);
  p.element('paste').value=date+',S2,300000,600000,900000,22';p.element('importBtn').click();
  assert.match(p.element('importMsg').textContent,/下書きの保存を更新できません/);
  checkStatus(e,'importMsg','error');
});

test('Pressed controls follow reference desktop and mobile paints in both themes',()=>{
  const e=make();
  for(const theme of ['light','dark'])for(const accent of ['standard','blue','pink','green','purple','black'])
    for(const weight of ['thin','standard','bold'])for(const width of [320,390,1280])
      for(const n of [e.p.element('applyManualTarget'),e.p.element('copyRemaining'),e.p.element('displaySettings').children[0],e.p.element('mainMenuToggle')]){
        const ctx={theme,accent,weight,width,pointer:width<700?'coarse':'fine',states:new Map([[n,new Set(['active','hover'])]])};
        const c=e.audit.computed(n,ctx);assert.equal(c.filter,n.tagName==='BUTTON'&&width<=700?'brightness(.88)':'none');
        if(c.filter!=='none'){const scaled=rgba=>rgba.map((v,i)=>i<3?v*.88:v);assert.ok(contrast(scaled(parseColor(c.color)),scaled(e.audit.background(n,ctx)))>=4.5);}
        assert.ok(e.audit.textContrast(n,ctx).ratio>=4.5,'Pressed text remains readable');
      }
});

test('Goal-achieved meter keeps the chosen numeral color and readable mini success color',()=>{
  const e=make();e.p.element('remain').classList.add('done');e.p.element('liveMeter').classList.add('goal-done');e.p.element('miniR').classList.add('done');
  for(const theme of ['light','dark'])for(const accent of ['standard','blue','pink','green','purple','black']){
    const ctx={theme,accent,weight:'thin',width:320,pointer:'coarse'};
    for(const id of ['remain','pct','miniR']){
      const n=e.p.element(id),c=e.audit.computed(n,ctx);
      assert.deepEqual(parseColor(c.color),parseColor(c.variables[id==='remain'?'--remaining-ink':id==='miniR'?'--success':'--number-ink']));
      assert.ok(e.audit.textContrast(n,ctx).ratio>=4.5);
    }
    assert.equal(parseColor(e.audit.computed(e.p.element('mini'),ctx)['background-color'])[3],1,'Mini panel is opaque so scrolling backgrounds cannot alter its text contrast');
  }
});
