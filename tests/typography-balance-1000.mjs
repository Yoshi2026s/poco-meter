import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pageEngine} from './calculator-harness.mjs';
import {createAudit} from './theme-cascade.mjs';

// Author-CSS/DOM-double audit: 25 real surfaces × 5 widths × 2 themes ×
// 4 font weights = 1,000 distinct conditions. No browser text shaping or
// physical-device rendering is performed. Rem conversion also checks 200%
// root text size; wrapping/width assertions are source contracts, not pixels.
const p=pageEngine(undefined,{navigator:{onLine:false}});
p.element('deadlineCountdown').classList.remove('urgent');
const q=s=>p.document.querySelector(s);
const items=Array.from(p.document.querySelectorAll('#remainingSummary .coin-card'));
assert.equal(items.length,5);
const surfaces=[
  ['title',q('h1')],['remaining label',q('.remain-label')],
  ['remaining goal',p.element('remain')],['exact remaining',p.element('remainExact')],
  ['progress',p.element('pct')],['year',p.element('todayYear')],
  ['date',p.element('todayDate')],['time',p.element('todayTime')],
  ['deadline label',p.element('leftLabel')],['countdown',p.element('left')],
  ['core bonus',p.element('coreBonusTop')],['core caption',q('.core-bonus-caption')],
  ['goal menu heading',p.element('quickTargetHeading')],
  ['item heading',p.element('remainingItemsHeading')],
  ...items.map((n,i)=>['item name '+i,n.querySelector('span')]),
  ...items.map((n,i)=>['item quantity '+i,n.querySelector('b')]),
  ['deadline control',p.element('closeSel')]
];
assert.equal(surfaces.length,25);
surfaces.forEach(([name,node])=>assert.ok(node,name));
const audit=createAudit({root:p.document.documentElement,nodes:p.nodes});
function pixels(value,width,root){
  const match=String(value).match(/^([\d.]+)(rem|px|vw)$/);
  if(match)return Number(match[1])*(match[2]==='rem'?root:match[2]==='vw'?width/100:1);
  const clamp=String(value).match(/^clamp\(([^,]+),([^,]+),([^,]+)\)$/);
  assert.ok(clamp,'Known shipped font-size syntax: '+value);
  const [,lo,preferred,hi]=clamp.map((x,i)=>i?pixels(x.trim(),width,root):x);
  return Math.max(lo,Math.min(preferred,hi));
}

test('T01 1,000 font-role, contrast, weight, width and wrapping conditions',()=>{
  const signatures=new Set();
  for(const width of [280,320,390,700,1280])for(const theme of ['light','dark'])
  for(const [weight,expectedWeight] of [['thin','300'],['standard','400'],['bold','700'],['ultra','900']]){
    const ctx={width,theme,weight,accent:'standard',pointer:width<=700?'coarse':'fine'};
    for(const [name,node] of surfaces){
      const signature=JSON.stringify({name,width,theme,weight});
      assert.ok(!signatures.has(signature));signatures.add(signature);
      const c=audit.computed(node,ctx),paint=audit.textContrast(node,ctx);
      const message=signature;
      assert.ok(pixels(c['font-size'],width,16)>=12,message+' minimum readable role size');
      assert.ok(pixels(c['font-size'],width,32)>=pixels(c['font-size'],width,16),message+' root text enlargement');
      assert.ok(Number(c['line-height'])>=1.2,message+' line spacing');
      assert.equal(c['font-weight'],expectedWeight,message+' requested weight');
      assert.equal(c.opacity,'1',message+' opaque text');
      assert.ok(paint.reliable&&paint.ratio>=4.5,message+' contrast '+paint.ratio);
      if(name.startsWith('item name')||name.startsWith('item quantity')){
        const expected=name.startsWith('item name')?(width<=360?13:14):(width<=700?16:17);
        assert.equal(pixels(c['font-size'],width,16),expected,message+' larger item text');
        assert.equal(c['overflow-wrap'],'anywhere',message);
        assert.equal(c['white-space'],'normal',message);
        assert.equal(c['min-width'],'0',message);
        assert.ok(['100%','10ch'].includes(c['max-width']),message+' bounded item width');
      }
      if(name==='deadline control')assert.equal(pixels(c['font-size'],width,16),16,message+' control text');
      if(name==='remaining goal'){
        assert.equal(c.width,'max-content',message+' goal includes suffix');
        assert.equal(c['max-width'],'100%',message+' bounded goal');
        for(const pseudo of ['before','after']){
          const line=audit.computed(node,ctx,pseudo);
          assert.equal(line.width,'100%',message+' '+pseudo+' full goal underline');
          assert.equal(line['max-width'],'100%',message);
          assert.equal(line.position,'absolute',message);
          assert.equal(line['pointer-events'],'none',message);
        }
      }
    }
  }
  assert.equal(signatures.size,1000);
  console.log(JSON.stringify({typographyConditions:signatures.size,signatureSHA256:createHash('sha256').update([...signatures].join('\n')).digest('hex'),method:'author CSS and DOM double; no rendered geometry'}));
});

test('T02 long goal values retain full-width line, wrapping and accessible static fallbacks',()=>{
  const remain=p.element('remain');
  for(const size of ['standard','compact','long']){
    remain.setAttribute('data-size',size);
    for(const width of [280,390,1280]){
      const ctx={width,theme:'dark',weight:'bold',accent:'standard',pointer:width<=700?'coarse':'fine'};
      assert.equal(audit.computed(remain,ctx)['overflow-wrap'],'anywhere');
      assert.equal(audit.computed(remain,ctx).width,'max-content');
      assert.equal(audit.computed(remain,ctx,'after').width,'100%');
    }
  }
  const css=audit.rules.map(r=>r.selectorText+'{'+r.declarations.map(d=>d.prop+':'+d.value).join(';')+'}').join('\n');
  assert.ok(css.includes('background-position:50% 50%'),'Reduced-motion effect keeps a static centered line');
  assert.ok(css.includes('--remaining-ink:CanvasText'),'Forced-color text follows system ink');
});

test('T03 selection-window rows retain 16 px while closed controls remain compact',()=>{
  p.element('screenTheme').dispatchEvent(new Event('click'));
  const window=p.nodes.find(n=>n.id==='selectWindow');
  assert.ok(window);
  const rows=window.querySelectorAll('button');
  assert.ok(rows.length>=3);
  for(const theme of ['light','dark'])for(const width of [280,1280]){
    const ctx={width,theme,weight:'bold',accent:'standard',pointer:width===280?'coarse':'fine'};
    for(const row of rows)assert.equal(pixels(audit.computed(row,ctx)['font-size'],width,16),16);
  }
});
