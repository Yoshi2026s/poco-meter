import test from 'node:test';
import assert from 'node:assert/strict';
import {pageEngine,engine,plain} from './calculator-harness.mjs';

const HUD_KEY='pococha-meter-hud-v1',KEY='pococha-meter-calc-v1';
const settings=()=>({...plain(engine().state),target:'500000',current:'123456',deadline:'22:00',pick:'',seedVer:3,seedVer13:1});
function stored(entries={}){
  const values=new Map([[KEY,JSON.stringify(settings())],...Object.entries(entries)]),writes=[];
  const localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{writes.push({key,value});values.set(key,value);}};
  return {values,writes,localStorage};
}
const page=m=>pageEngine(undefined,{navigator:{onLine:false},localStorage:m.localStorage});
function external(p,m,newValue,storageArea=m.localStorage){
  if(newValue===null)m.values.delete(HUD_KEY);else m.values.set(HUD_KEY,newValue);
  p.dispatchWindow('storage',{key:HUD_KEY,newValue,storageArea});
}

test('A second tab turning HUD OFF collapses this HUD without writing preferences back',()=>{
  const m=stored(),p=page(m);m.writes.length=0;external(p,m,'off');
  assert.equal(p.element('hudVisibility').value,'off');assert.equal(p.element('hudToggle').getAttribute('aria-checked'),'false');assert.equal(p.element('mini').classList.contains('hud-collapsed'),true);
  assert.equal(p.element('targetMini').tabIndex,-1);assert.equal(p.element('currentMini').tabIndex,-1);assert.deepEqual(m.writes.filter(row=>row.key===HUD_KEY),[]);
});

for(const value of ['on',null])test('A second tab HUD '+String(value)+' restores the fixed HUD and its inputs',()=>{
  const m=stored({[HUD_KEY]:'off'}),p=page(m);m.writes.length=0;external(p,m,value);
  assert.equal(p.element('hudVisibility').value,'on');assert.equal(p.element('mini').classList.contains('hud-collapsed'),false);assert.equal(p.element('targetMini').tabIndex,0);assert.equal(p.element('currentMini').tabIndex,0);
  assert.deepEqual(m.writes.filter(row=>row.key===HUD_KEY),[]);
});

test('Invalid HUD storage values and a different storage area cannot change this tab',()=>{
  const m=stored({[HUD_KEY]:'off'}),p=page(m);p.element('hudToggle').click();m.writes.length=0;
  for(const value of ['false','', 'ON','{"enabled":true}']){external(p,m,value);assert.equal(p.element('hudVisibility').value,'off');}
  external(p,m,'on',{getItem(){return null;}});assert.equal(p.element('hudVisibility').value,'off');assert.deepEqual(m.writes.filter(row=>row.key===HUD_KEY),[]);
});

test('Local HUD toggles persist the preference while restart uses the requested ON startup',()=>{
  const m=stored(),p=page(m);p.element('hudToggle').click();assert.equal(m.values.get(HUD_KEY),'off');
  const fresh=page(m);assert.equal(fresh.element('hudVisibility').value,'on');assert.equal(m.values.get(HUD_KEY),'off');fresh.element('hudToggle').click();assert.equal(m.values.get(HUD_KEY),'off');fresh.element('hudToggle').click();assert.equal(m.values.get(HUD_KEY),'on');
});
