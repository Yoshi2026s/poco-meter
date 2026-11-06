import test from 'node:test';
import assert from 'node:assert/strict';
import {pageEngine} from './calculator-harness.mjs';
import {createAudit,parseColor,composite,contrast,colorsIn} from './theme-cascade.mjs';

// 50 distinct shipped surfaces/states × two themes. Each case also covers
// all six accent colors, three requested font weights and both screen widths.
// This audits CSS paints/cascade, not physical devices or native picker pixels.
const p=pageEngine(undefined,{navigator:{onLine:false}}),q=s=>p.document.querySelector(s);
p.element('deadlineCountdown').classList.remove('urgent');
const add=(parent,tag,attrs={})=>{const n=p.document.createElement(tag);for(const [k,v]of Object.entries(attrs)){n.setAttribute(k,v);if(k==='class')n.className=v;if(k==='id')n.id=v;}parent.appendChild(n);return n;};
function materialize(parent,markup){
  const stack=[parent];
  for(const m of markup.matchAll(/<(\/)?([a-z][\w-]*)([^>]*)>/gi)){
    if(m[1]){stack.pop();continue;}
    const attrs=Object.fromEntries([...m[3].matchAll(/([\w-]+)="([^"]*)"/g)].map(a=>[a[1],a[2]]));
    const node=add(stack.at(-1),m[2],attrs);
    if(!/\/\s*$/.test(m[3])&&!['input','br','hr','img'].includes(m[2].toLowerCase()))stack.push(node);
  }
}
materialize(p.element('recentChart'),p.element('recentChart').innerHTML);
const table=q('.analysis-table-wrap'),tbody=table.querySelector('tbody');
materialize(tbody,(tbody.innerHTML.match(/<tr\b[\s\S]*?<\/tr>/g)??[]).slice(0,3).join(''));
assert.ok(tbody.children.length>=3,'Use actual rendered table rows');
const svg=p.element('recentChart').querySelector('svg');
assert.ok(svg,'Use the SVG emitted by the shipped renderChart function');
const primary=p.element('applyManualTarget');primary.disabled=false;
const disabledPrimary=add(primary.parentNode,'button',{class:'main',disabled:''});disabledPrimary.disabled=true;disabledPrimary.style.opacity='.4';
const success=p.element('displaySettingsStatus');success.className='toast';success.textContent='保存しました';
const error=p.element('bkMsg');error.className='toast err';error.textContent='保存できません';
const inputStatus=p.element('inputStatus');inputStatus.removeAttribute('hidden');inputStatus.hidden=false;
const invalid=add(p.element('target').parentNode,'input',{'aria-invalid':'true',class:'big num'});
const armed=add(p.element('logList'),'button',{class:'x','data-armed':'1'});armed.style.color='var(--warn)';
const off=p.element('offlineStatus');
const method=p.element('compareMean').parentNode;method.classList.add('active');method.disabled=false;
const disabledMethod=p.element('compareMin').parentNode;disabledMethod.disabled=true;disabledMethod.style.opacity='.4';
const legacy=p.element('coverageStrip').children.find(n=>n.classList.contains('legacy'))??add(p.element('coverageStrip'),'button',{class:'day-dot legacy'});
const selected=p.element('coverageStrip').children.find(n=>n.classList.contains('filled'));
assert.ok(selected);selected.setAttribute('aria-current','true');selected.disabled=false;
const empty=add(p.element('recentChart'),'div',{class:'chart-empty'});
const toggle=q('.sectionToggle'),display=p.element('displaySettings');
const audit=createAudit({root:p.document.documentElement,nodes:p.nodes});
const state=(node,...names)=>new Map([[node,new Set(names)]]);
const cases=[];
const register=(name,node,{pseudo='',states,kind='text',minimum=4.5,semantic,opaque=false}={})=>{
  assert.ok(node,name+' exists');cases.push({name,node,pseudo,states,kind,minimum,semantic,opaque});
};
register('page text',p.document.body);
register('main title',q('h1'));
register('logo update date',q('.ylogo-update time'));
register('page footer',q('footer'));
register('current date',p.element('todayDate'),{semantic:theme=>theme==='dark'?'#b3f0cc':'#145737'});
register('current time',p.element('todayTime'),{semantic:theme=>theme==='dark'?'#b3f0cc':'#145737'});
register('deadline countdown',p.element('left'),{semantic:theme=>theme==='dark'?'#ffbec8':'#9d2034'});
register('urgent countdown',p.element('left'),{states:state(p.element('deadlineCountdown'),'unused'),kind:'urgent'});
register('deadline label',q('.meter-deadline label'),{semantic:theme=>theme==='dark'?'#edf4fd':'#17283a'});
register('deadline select text',p.element('closeSel'),{semantic:theme=>theme==='dark'?'#edf4fd':'#17283a'});
register('deadline select focus',p.element('closeSel'),{states:state(p.element('closeSel'),'focus','focus-visible'),kind:'focus',minimum:3});
register('manual target input',p.element('target'));
register('current value input',p.element('currentTop'));
register('core count input',p.element('coreCountTop'));
register('input placeholder',p.element('target'),{pseudo:'placeholder'});
register('input caret',p.element('target'),{states:state(p.element('target'),'focus'),kind:'caret',minimum:3});
register('invalid input text',invalid);
register('invalid input boundary',invalid,{kind:'border',minimum:3});
register('primary action',primary);
register('primary action hover',primary,{states:state(primary,'hover')});
register('disabled primary action',disabledPrimary,{opaque:true});
register('primary action focus',primary,{states:state(primary,'focus','focus-visible'),kind:'focus',minimum:3});
register('display settings opener',display.children[0]);
register('display settings label',q('label[for="screenTheme"]'));
register('display settings selector',p.element('screenTheme'));
register('display settings help',display.querySelector('.hint'));
register('usage instructions',q('.tool-usage-content p'));
register('offline status',off);
register('success notification',success);
register('error notification',error);
register('input error message',inputStatus,{kind:'inputError'});
register('armed delete button',armed,{kind:'armed'});
register('auxiliary section opener',toggle);
register('auxiliary section arrow',toggle,{pseudo:'after'});
register('chart axis labels',svg.children.find(n=>n.tagName==='TEXT'&&!n.className),{kind:'fill'});
register('chart candidate label',svg.querySelector('.chart-candidate-label'),{kind:'fill'});
register('chart data line',svg.children.find(n=>n.tagName==='POLYLINE'),{kind:'stroke',minimum:3});
register('chart candidate line',svg.children.find(n=>n.tagName==='LINE'&&n.hasAttribute('stroke-dasharray')),{kind:'stroke',minimum:3});
register('chart axis line',svg.children.find(n=>n.tagName==='LINE'&&!n.hasAttribute('stroke-dasharray')),{kind:'stroke',minimum:3});
register('empty chart text',empty);
register('daily table header',table.querySelector('th'));
register('daily table odd row',tbody.children[0].children[0]);
register('daily table even row',tbody.children[1].children[0]);
register('daily table hovered row',tbody.children[2].children[0],{states:state(tbody.children[2],'hover')});
register('daily table caption',p.element('analysisCaption'));
register('daily table focus',table,{states:state(table,'focus-visible'),kind:'focus',minimum:3});
register('selected calculation method',p.element('compareMean'));
register('disabled calculation method',p.element('compareMin'),{opaque:true});
register('legacy reference day',legacy,{kind:'legacy'});
register('selected day focus',selected,{states:state(selected,'focus','focus-visible'),kind:'focus',minimum:3});
assert.equal(cases.length,50);

function computedRatio(item,ctx){
  const {node,pseudo}=item,c=audit.computed(node,ctx,pseudo);
  const resolve=value=>value.replace(/var\((--[\w-]+)\)/g,(_,key)=>resolve(c.variables[key]));
  c.variables=Object.fromEntries(Object.entries(c.variables).map(([k,v])=>[k,resolve(v)]));
  if(item.semantic){const role=item.name==='deadline label'?'--muted':item.name==='deadline select text'?'--ink':item.name.startsWith('current')?'--success-ink':'--error-ink';assert.deepEqual(parseColor(c.color),parseColor(c.variables[role]));}
  if(item.opaque){assert.equal(c.opacity,'1');assert.equal(audit.computed(node.parentNode,ctx).opacity,'1');}
  if(item.kind==='inputError'||item.kind==='armed')assert.deepEqual(parseColor(c.color),parseColor(ctx.theme==='dark'?'#ffbec8':'#9d2034'));
  if(item.kind==='legacy')assert.deepEqual(parseColor(c.color),parseColor(c.variables['--warning-ink']));
  if(['INPUT','SELECT'].includes(node.tagName)&&!pseudo){
    const back=audit.background(node,ctx),line=parseColor(c['border-top-color']);
    assert.ok(contrast(line,back)>=3,'Input/select boundary must remain distinct from its fill');
  }
  if(item.name==='deadline select text')for(const option of node.children){
    const optionPaint=audit.computed(option,ctx);
    assert.deepEqual(parseColor(optionPaint.color),parseColor(c.color),'Popup uses reference ink');
    assert.deepEqual(parseColor(optionPaint['background-color']),parseColor(c['background-color']),'Popup uses reference paper');
  }
  if(['fill','stroke','caret','border','focus'].includes(item.kind)){
    const property={fill:'fill',stroke:'stroke',caret:'caret-color',border:'border-top-color',focus:'outline-color'}[item.kind];
    let back=audit.background(node,ctx,pseudo);
    if(item.kind==='focus'){
      // The black closing selector deliberately sits on a light island.
      back=node.id==='closeSel'?audit.background(node,ctx):audit.background(node.parentNode,ctx);
      assert.notEqual(c['outline-style'],'none');
    }
    return contrast(composite(parseColor(c[property]),back),back);
  }
  const result=audit.textContrast(node,ctx,pseudo);
  let ratio=result.ratio;
  for(const paint of result.paints){
    assert.equal(paint.opacity,'1','Text must not fade with disabled control opacity');
    assert.equal(paint.filter,'none','A filter needs a separate painted contrast audit');
    if(paint.decorativeArrow)continue;
    // Page background gradients contain simple color stops; checking every
    // stop plus the solid base gives a conservative source-color bound.
    assert.ok(paint.element===p.document.body,'Only page gradients remain under tested text');
    const base=audit.background(paint.element,ctx);
    for(const color of colorsIn(paint.image)){
      const bg=composite(parseColor(color),base);
      ratio=Math.min(ratio,contrast(composite(parseColor(c.color),bg),bg));
    }
  }
  return ratio;
}
// A requested thorough run uses 50 surfaces/states × 20 distinct display
// profiles = 1,000 individually named checks. The default regression suite
// retains all 3,600 combinations from the original 100 test groups.
const matrix1000=process.env.POCOCHA_COLOR_AUDIT_PROFILE==='1000';
const profiles=[];
for(const theme of ['light','dark']){
  for(const accent of ['standard','blue','pink','green','purple','black'])
    profiles.push({theme,accent,weight:'standard',width:390,pointer:'coarse'});
  for(const [accent,weight,width] of [['standard','thin',320],['pink','bold',375],['green','thin',768],['purple','bold',1280]])
    profiles.push({theme,accent,weight,width,pointer:width<700?'coarse':'fine'});
}
assert.equal(profiles.length,20);
let checks=0;
function verify(item,ctx){
  const key=[ctx.theme,ctx.accent,ctx.weight,ctx.width,item.name].join('|'),node=item.node;
  if(item.kind==='urgent'){
    const old=p.element('deadlineCountdown').className;
    p.element('deadlineCountdown').classList.add('urgent');audit.clearCache(ctx);
    try{
      const c=audit.computed(node,ctx);
      const resolve=value=>value.replace(/var\((--[\w-]+)\)/g,(_,key)=>resolve(c.variables[key]));
      c.variables['--error-ink']=resolve(c.variables['--error-ink']);
      assert.deepEqual(parseColor(c.color),parseColor(c.variables['--error-ink']));
      assert.ok(contrast(parseColor(c.color),audit.background(node,ctx))>=4.5,item.name+' '+key);
    }finally{p.element('deadlineCountdown').className=old;audit.clearCache(ctx);}
  }else{
    const ratio=computedRatio(item,ctx);
    assert.ok(ratio>=item.minimum,item.name+' '+key+' contrast '+ratio.toFixed(3)+' < '+item.minimum);
  }
  assert.equal(audit.computed(node,ctx)['font-weight'],{bold:'700',standard:'400',thin:'300'}[ctx.weight]);checks++;
}
if(matrix1000){
  for(const profile of profiles)for(const item of cases){
    const ctx={...profile,states:item.states};
    test([ctx.theme,ctx.accent,ctx.weight,ctx.width,item.name].join(' / '),()=>verify(item,ctx));
  }
}else{
  for(const theme of ['light','dark'])for(const item of cases)test(theme+' / '+item.name,()=>{
    for(const accent of ['standard','blue','pink','green','purple','black'])for(const weight of ['bold','standard','thin'])for(const width of [390,1280])
      verify(item,{theme,accent,weight,width,pointer:width===390?'coarse':'fine',states:item.states});
  });
}
test.after(()=>assert.equal(checks,matrix1000?1000:3600,'All named source-color checks complete'));
