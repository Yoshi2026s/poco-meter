import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pageEngine,html} from './calculator-harness.mjs';
import {createAudit,parseColor} from './theme-cascade-cached.mjs';
import {createAudit as originalAudit} from './theme-cascade.mjs';

// Source and author-CSS/DOM-double checks only. No browser rendering, layout,
// native mobile picker pixels, or physical iPhone/Android testing is claimed.
// Each display condition checks a real multi-surface screen snapshot. All
// variable dimensions influence one of its measured surfaces: body background,
// picker paper/rows, numeric ink, font weight, width-dependent item font, or
// actual invalid field/error state. Effective snapshots are also deduplicated.
const KEY='pococha-meter-calc-v1';
const sourcePath=new URL('../calculator/index.html',import.meta.url);
const resultPath=new URL('../docs/mobile-usability-10000-result.json',import.meta.url);
const sourceSHA=createHash('sha256').update(html).digest('hex');
const now=Date.now();
const regressions=[],signatures=new Set(),effectiveSignatures=new Set(),conditions=[];
let cacheVerificationConditions=0;
const weights={thin:'300',standard:'400',bold:'700',ultra:'900'};
const nativeIds=['quickPeriod','quickRank','quickBorder','quickMethod','closeSel'];
const colors={background:['theme','black','gray','blue','green','purple','pink','red','orange','gold'],
 list:['white','black','gray','blue','green','purple','pink','red','orange','gold'],
 number:['black','gray','blue','green','purple','pink','red','orange','gold','cyan']};
const page=()=>pageEngine(undefined,{navigator:{onLine:false}});
function event(type,props={}){const e=new Event(type,{cancelable:true});Object.assign(e,props);return e;}
function input(p,id,value,type='input'){const el=p.element(id);el.value=String(value);el.dispatchEvent(event(type));return el;}
function saved(p){return JSON.parse(p.stored.get(KEY));}
function check(name,run){run();regressions.push(name);}

check('All 37 native option previews survive timer sync and commit once on blur',()=>{
 let count=0;
 for(const id of nativeIds){
  const p=page(),el=p.element(id),original=el.value,personal=p.stored.get(KEY);
  for(const option of el.options){
   const personalBefore=p.stored.get(KEY);el.focus();el.value=option.value;p.tick(1000);
   assert.equal(el.value,option.value,id+' focused preview');
   assert.equal(p.document.activeElement,el);
   assert.equal(p.stored.get(KEY),personalBefore,id+' preview does not save');
   el.blur();if(id==='closeSel'&&option.value==='custom'){count++;continue;}assert.equal(el.value,option.value,id+' blur keeps the chosen value');
   const field={quickPeriod:'period',quickRank:'rank',quickBorder:'pick',quickMethod:'targetMethod',closeSel:'deadline'}[id];
   assert.equal(String(saved(p)[field]),String(option.value),id+' blur commits to shared state');
   count++;
  }
 }
 assert.equal(count,37);
});
check('All committed native options reach their real change handlers and survive blur/tick',()=>{
 let count=0;
 for(const id of nativeIds){
  const choices=page().element(id).options.map(n=>n.value);
  for(const value of choices){
   const p=page(),el=p.element(id);el.focus();input(p,id,value,'change');
   el.blur();p.tick(1000);
   const s=saved(p),field={quickPeriod:'period',quickRank:'rank',quickBorder:'pick',quickMethod:'targetMethod',closeSel:'deadline'}[id];
   if(id==='closeSel'&&value==='custom'){
    assert.equal(p.document.activeElement,p.element('deadline'));assert.equal(el.value,'custom');
   }else{
    assert.equal(String(s[field]),value,id+' committed state');assert.equal(el.value,value,id+' committed display');
    if(id==='quickBorder'&&value==='')assert.equal(p.document.activeElement,p.element('target'));
   }
   count++;
  }
 }
 assert.equal(count,37);
});
check('Core local validation preserves the previous valid value, invalid Enter retains focus, correction clears error',()=>{
 const p=page();input(p,'coreCountTop','40');
 const el=p.element('coreCountTop'),err=p.element('coreInputError');
 for(const value of ['1001','-1','1.5','abc','']){
  el.focus();input(p,'coreCountTop',value);assert.equal(saved(p).coreCount,'40');
  assert.equal(el.getAttribute('aria-invalid'),'true');assert.equal(err.hidden,false);assert.match(err.textContent,/0〜1000/);
  el.dispatchEvent(event('keydown',{key:'Enter'}));assert.equal(p.document.activeElement,el);
 }
 input(p,'coreCountTop','０');assert.equal(saved(p).coreCount,'0');assert.equal(err.hidden,true);assert.equal(err.textContent,'');
 assert.ok(el.getAttribute('aria-describedby').split(/\s+/).includes('coreInputError'));
 input(p,'coreCountTop','1000');assert.equal(saved(p).coreCount,'1000');
});
check('Both buffer fields mirror invalid state, retain last valid value, show/clear local error, and valid Enter dismisses',()=>{
 const p=page();input(p,'quickBufferPct','6.5');
 const el=p.element('quickBufferPct'),err=p.element('quickBufferError');
 for(const value of ['51','-1','1.55','abc','']){
  el.focus();input(p,'quickBufferPct',value);
  assert.equal(saved(p).bufferPct,6.5);assert.equal(p.element('bufferPct').value,value);
  assert.equal(p.element('bufferPct').getAttribute('aria-invalid'),'true');
  assert.equal(el.getAttribute('aria-invalid'),'true');assert.equal(err.hidden,false);assert.match(err.textContent,/0〜50/);
  el.dispatchEvent(event('keydown',{key:'Enter'}));assert.equal(p.document.activeElement,el);
 }
 input(p,'bufferPct','2');assert.equal(el.value,'2');assert.equal(err.hidden,true);assert.equal(err.textContent,'');
 assert.equal(el.getAttribute('aria-invalid'),'false');assert.equal(saved(p).bufferPct,2);
 assert.ok(el.getAttribute('aria-describedby').split(/\s+/).includes('quickBufferError'));
 el.focus();input(p,'quickBufferPct','50');el.dispatchEvent(event('keydown',{key:'Enter'}));
 assert.equal(saved(p).bufferPct,50);assert.equal(p.document.activeElement,null);
});
check('Local described-by references resolve and error nodes stay under their respective form groups',()=>{
 const p=page();
 for(const [id,error,group] of [['coreCountTop','coreInputError','.meter-core'],['quickBufferPct','quickBufferError','.quick-buffer']]){
  const el=p.element(id),err=p.element(error);input(p,id,id==='coreCountTop'?'40':'0');
  for(const ref of el.getAttribute('aria-describedby').split(/\s+/))assert.ok(p.document.getElementById(ref),ref);
  assert.equal(err.closest(group),el.closest(group));assert.equal(err.hidden,true);
 }
});
check('Record Enter moves next/next/done without saving and all three independent IME guards prevent advancement',()=>{
 const p=page(),ids=['editZero','editPlus1','editPlus2'];
 for(let i=0;i<3;i++){
  const el=p.element(ids[i]);assert.equal(el.getAttribute('enterkeyhint'),i<2?'next':'done');
  const personal=p.stored.get(KEY);
  for(const props of [{isComposing:true},{keyCode:229}]){
   el.focus();const e=event('keydown',{key:'Enter',...props});el.dispatchEvent(e);
   assert.equal(p.document.activeElement,el);assert.equal(e.defaultPrevented,false);
  }
  el.dispatchEvent(event('compositionstart'));const e=event('keydown',{key:'Enter'});el.dispatchEvent(e);
  assert.equal(p.document.activeElement,el);assert.equal(e.defaultPrevented,false);
  el.dispatchEvent(event('compositionend'));
  const done=event('keydown',{key:'Enter'});el.dispatchEvent(done);assert.equal(done.defaultPrevented,true);
  assert.equal(p.document.activeElement,i<2?p.element(ids[i+1]):null);
  assert.equal(p.stored.get(KEY),personal,'Enter must not commit records');
 }
});
check('Record next actions preserve raw drafts and Enter never creates a saved border triple',()=>{
 const p=page(),before=p.stored.get(KEY);
 input(p,'editZero','３００K');input(p,'editPlus1','600K');input(p,'editPlus2','900K');
 for(const id of ['editZero','editPlus1','editPlus2']){const el=p.element(id);el.focus();el.dispatchEvent(event('keydown',{key:'Enter'}));}
 assert.equal(p.element('editZero').value,'３００K');assert.equal(p.element('editPlus1').value,'600K');
 assert.equal(p.stored.get(KEY),before);assert.ok([...p.stored.values()].some(v=>v.includes('３００K')&&v.includes('900K')));
});

const fixtures={};
for(const mode of ['normal','focus','invalid']){
 const p=page();input(p,'target','100001');input(p,'currentTop','500');input(p,'coreCountTop','40');input(p,'quickBufferPct','0');
 if(mode==='invalid'){input(p,'coreCountTop','1001');input(p,'quickBufferPct','51');}
 // The existing DOM double tracks .hidden but does not implement the native
 // reflected boolean attribute. Mirror that for the shipped [hidden] CSS.
 for(const id of ['coreInputError','quickBufferError']){const n=p.element(id);if(n.hidden)n.setAttribute('hidden','');else n.removeAttribute('hidden');}
 p.element('screenTheme').dispatchEvent(event('mousedown',{button:0}));
 const audit=createAudit({root:p.document.documentElement,nodes:p.nodes});
 const list=p.nodes.find(n=>n.id==='selectWindowList'),dialog=p.nodes.find(n=>n.id==='selectWindow');
 const item=p.document.querySelector('#remainingSummary .coin-card span');
 const selected=list.children.find(n=>n.getAttribute('aria-selected')==='true'),unselected=list.children.find(n=>n.getAttribute('aria-selected')!=='true');
 assert.ok(selected&&unselected);
 fixtures[mode]={p,audit,stock:originalAudit({root:p.document.documentElement,nodes:p.nodes}),dialog,selected,unselected,item};
}
const expectedBg={light:{theme:'#f5f8fd',gray:'#f1f5f9',blue:'#edf6fc',green:'#edf7f1',purple:'#f5f0fc',pink:'#fdf1f7',red:'#fff0f3',orange:'#fff4e8',gold:'#fff2d6'},
 dark:{theme:'#06111f',black:'#000000',gray:'#101820',blue:'#091422',green:'#0b1813',purple:'#151121',pink:'#1c111b',red:'#210f16',orange:'#21140c',gold:'#20190a'}};
const props=['color','background-color','background-image','font-size','font-weight','line-height','border-top-color','outline-color','box-shadow','width','max-width','min-width','white-space','overflow-wrap','display'];
function rgbaEqual(actual,expected,message){assert.deepEqual(parseColor(actual),parseColor(expected),message);}
function verifyDisplay(config){
 const {p,audit,stock,dialog,selected,unselected,item}=fixtures[config.mode];
 const root=p.document.documentElement;
 root.setAttribute('data-background-color',config.background);root.setAttribute('data-list-color',config.list);root.setAttribute('data-number-color',config.number);
 const focused=config.mode==='focus'?new Map(['coreCountTop','quickBufferPct','closeSel','quickRank'].map(id=>[p.element(id),new Set(['focus','focus-visible'])])):undefined;
 const ctx={theme:config.theme,accent:'standard',weight:config.weight,width:config.width,pointer:'coarse',states:focused};
 const surfaces=[['body',p.document.body],['title',p.document.querySelector('h1')],['item-name',item],
  ['goal-heading',p.element('quickTargetHeading')],['remaining',p.element('remain')],['exact',p.element('remainExact')],
  ...['coinNeed','dogcatNeed','pandaNeed','hanabiNeed','bashaNeed','coreBonusTop'].map(id=>[id,p.element(id)]),
  ['core',p.element('coreCountTop')],['buffer',p.element('quickBufferPct')],['core-error',p.element('coreInputError')],['buffer-error',p.element('quickBufferError')],
  ['close',p.element('closeSel')],['rank',p.element('quickRank')],['dialog',dialog],['selected-row',selected],['unselected-row',unselected]];
 const computed=surfaces.map(([name,n])=>[name,n,audit.computed(n,ctx)]),byName=Object.fromEntries(computed.map(([name,,c])=>[name,c]));
 if(conditions.length<60||conditions.length%1000===0){
  for(const [name,n,c] of computed){const expected=stock.computed(n,ctx);for(const [prop,value] of Object.entries(expected)){if(typeof value==='string')assert.equal(c[prop],value,name+' cached '+prop);else if(prop==='variables')assert.deepEqual(c.variables,value,name+' cached variables');}}
  cacheVerificationConditions++;
 }
 const body=byName.body;
 // Theme base backgrounds come from reference tokens; independently named
 // colors and black are checked against their documented palette constants.
 if(config.background!=='theme')rgbaEqual(body['background-color'],expectedBg[config.theme][config.background],'body background');
 rgbaEqual(body['background-color'],body.variables['--bg'],'body uses background preference');
 assert.equal(byName['item-name']['font-size'],'.875rem','record names remain readable at all widths');
 for(const [name,n,c] of computed){
  assert.equal(c['font-weight'],weights[config.weight],name+' requested weight');
  if((name==='core-error'||name==='buffer-error')&&config.mode!=='invalid'){assert.equal(c.display,'none');continue;}
  const paint=audit.textContrast(n,ctx);
  assert.ok(paint.reliable&&paint.ratio>=4.5,name+' readable contrast '+paint.ratio);
  if(['core','buffer','close','rank','selected-row','unselected-row'].includes(name))assert.ok(['1rem','16px'].includes(c['font-size']),name+' mobile 16px input/picker text');
  if(['core','buffer'].includes(name)){
   assert.equal(n.getAttribute('aria-invalid'),config.mode==='invalid'?'true':'false');
   rgbaEqual(c.color,c.variables[config.mode==='invalid'?'--ink':'--number-ink'],name+' paired valid/error field ink');
  }
  if(name==='core-error'||name==='buffer-error'){
   assert.equal(c.display,'block');assert.equal(c['overflow-wrap'],'anywhere');rgbaEqual(c.color,c.variables['--red'],name+' semantic error color');
  }
  if(['coinNeed','dogcatNeed','pandaNeed','hanabiNeed','bashaNeed','coreBonusTop','exact'].includes(name))rgbaEqual(c.color,c.variables['--number-ink'],name+' independent numeral color');
  if(name==='remaining'){
   rgbaEqual(c.color,config.theme==='dark'?'#ffe45c':'#7a5c00','remaining keeps readable yellow');
   assert.equal(c.width,'max-content');assert.equal(c['max-width'],'100%');assert.equal(c['overflow-wrap'],'anywhere');
   for(const pseudo of ['before','after']){const line=audit.computed(n,ctx,pseudo);assert.equal(line.width,'100%');assert.equal(line['pointer-events'],'none');}
  }
  if(name==='close'||name==='rank'){
   assert.match(c['background-size'],/^[56]px [56]px$/);assert.equal(c['background-repeat'],'no-repeat');
   assert.equal(n.getAttribute('aria-haspopup'),null,'Direct native selection remains direct');
  }
  if(name==='dialog')rgbaEqual(c['background-color'],c.variables['--list-paper'],'dialog uses list preference');
  if(name==='selected-row'){rgbaEqual(c.color,c.variables['--list-ink'],'selected row paired ink');rgbaEqual(c['background-color'],c.variables['--list-selected'],'selected row paired background');}
  if(name==='unselected-row'){rgbaEqual(c.color,c.variables['--list-ink'],'row paired ink');rgbaEqual(c['background-color'],c.variables['--list-paper'],'row paired background');}
 }
 // Only actual effective output participates in the duplicate check, with no
 // input width/theme/color labels added to disguise identical CSS outcomes.
 const effective=JSON.stringify(computed.map(([name,,c])=>[name,...props.map(prop=>c[prop])]));
 return {effective,minimumContrast:Math.min(...computed.filter(([name])=>!name.endsWith('-error')||config.mode==='invalid').map(([,n])=>audit.textContrast(n,ctx).ratio))};
}

const candidates=[];
for(const theme of ['light','dark'])for(const background of colors.background){
 if(theme==='light'&&background==='black')continue; // UI forces dark for black.
 for(const list of colors.list)for(const number of colors.number)for(const weight of Object.keys(weights))for(const width of [320,390]){
  const index=candidates.length;
  candidates.push({theme,background,list,number,weight,width,mode:['normal','focus','invalid'][index%3]});
 }
}
assert.equal(candidates.length,15200);
// Deterministic shuffle makes the first 10,000 a broad stratified sample rather
// than truncating entire palettes at a nested-loop boundary.
let rng=0x9e3779b9;
for(let i=candidates.length-1;i>0;i--){rng=(Math.imul(rng,1664525)+1013904223)>>>0;const j=rng%(i+1);[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
let duplicates=0,minContrast=Infinity;
for(const config of candidates){
 const signature=JSON.stringify(config);assert.ok(!signatures.has(signature),'Duplicate input condition');
 const result=verifyDisplay(config);
 if(effectiveSignatures.has(result.effective)){duplicates++;continue;}
 effectiveSignatures.add(result.effective);signatures.add(signature);conditions.push(config);minContrast=Math.min(minContrast,result.minimumContrast);
 if(conditions.length%1000===0)console.log('DISPLAY_PROGRESS '+conditions.length);
 if(conditions.length===10000)break;
}
assert.equal(conditions.length,10000,'Only genuinely different effective display conditions may count');
const sourceAfter=createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
assert.equal(sourceAfter,sourceSHA,'App source must remain unchanged throughout verification');
const histogram={};for(const key of ['theme','background','list','number','weight','width','mode']){histogram[key]={};for(const c of conditions)histogram[key][c[key]]=(histogram[key][c[key]]??0)+1;}
const report={matrix:'mobile-usability-10000',status:'passed',distinctDisplayConditions:conditions.length,
 regressionBatches:regressions.length,regressions,candidateConditions:candidates.length,effectiveDuplicatesSkipped:duplicates,cacheVerificationConditions,
 inputSignatureDuplicates:0,sourceSHA256:sourceSHA,
 conditionSignatureSHA256:createHash('sha256').update([...signatures].join('\n')).digest('hex'),
 effectiveSnapshotSHA256:createHash('sha256').update([...effectiveSignatures].join('\n')).digest('hex'),
 minimumContrast:minContrast,histogram,elapsedMs:Date.now()-now,
 methodology:'Real shipped JavaScript handlers plus author CSS cascade on DOM doubles; effective multi-surface snapshots deduplicated; fixed-DOM selector-match cache compared with original CSS audit',
 limitation:'No physical iPhone/Android, native picker pixels, browser rendering, font shaping, keyboard viewport or geometry verification; no claim of 10,000 changes/fixes'};
fs.writeFileSync(resultPath,JSON.stringify(report,null,2)+'\n');
console.log('MOBILE_USABILITY_RESULT '+JSON.stringify(report));
