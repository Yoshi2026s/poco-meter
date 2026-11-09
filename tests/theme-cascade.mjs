// Supporting static stylesheet audit. This is not a browser or layout engine.
// It computes the shipped author CSS cascade, rejects unsupported selectors,
// and exposes paint/contrast checks independently of the calculator formulas.
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const checkout=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
const require=createRequire(checkout+'/package.json');
const {parse}=createRequire(require.resolve('vite/package.json'))('postcss');
const {transform}=createRequire(require.resolve('vite/package.json'))('lightningcss');

const relevant=/^(?:--|color$|background(?:$|-)|border(?:$|-)|outline(?:$|-)|caret-color$|accent-color$|opacity$|filter$|fill$|stroke$|box-shadow$|text-shadow$|display$|visibility$|font-weight$|font-size$|line-height$|white-space$|overflow-wrap$|word-break$|width$|max-width$|min-width$|position$|height$|content$|pointer-events$|color-scheme$)/;
const inherited=new Set(['color','caret-color','fill','stroke','font-weight','font-size','line-height','white-space','overflow-wrap','word-break','visibility','color-scheme']);
const defaults={color:'#000', 'background-color':'transparent','background-image':'none','background-size':'auto','background-position':'0% 0%','background-repeat':'repeat','border-top-color':'currentColor','border-right-color':'currentColor','border-bottom-color':'currentColor','border-left-color':'currentColor','outline-color':'currentColor','caret-color':'auto','accent-color':'auto',opacity:'1',filter:'none',fill:'#000',stroke:'none','box-shadow':'none','text-shadow':'none',display:'block',visibility:'visible','font-weight':'400','font-size':'1rem','line-height':'normal','white-space':'normal','overflow-wrap':'normal','word-break':'normal',width:'auto','max-width':'none','min-width':'auto',position:'static',height:'auto',content:'normal','pointer-events':'auto','color-scheme':'normal'};
const supportedPseudo=new Set(['root','where','is','not','has','nth-child','nth-of-type','first-child','last-child','first-of-type','last-of-type','empty','disabled','enabled','hover','active','focus','focus-visible','focus-within','checked','invalid','valid','placeholder-shown']);
const supportedElements=new Set(['before','after','placeholder','selection','marker','file-selector-button','backdrop']);
const selectorCache=new Map();
function parsedSelectors(text){
  if(selectorCache.has(text))return selectorCache.get(text);
  let result;
  transform({filename:'audit-selector.css',code:Buffer.from(text+'{color:inherit}'),visitor:{Rule(rule){if(rule.type==='style')result=rule.value.selectors;}}});
  if(!result)throw new Error('Selector parser produced no style: '+text);
  const validate=selector=>{for(const item of selector){
    if(!['type','id','class','attribute','universal','combinator','pseudo-class','pseudo-element'].includes(item.type))throw new Error('Unsupported selector '+item.type+': '+text);
    if(item.type==='combinator'&&!['descendant','child','next-sibling','later-sibling'].includes(item.value))throw new Error('Unsupported combinator '+item.value);
    if(item.type==='pseudo-class'&&!supportedPseudo.has(item.kind))throw new Error('Unsupported pseudo-class '+item.kind+': '+text);
    if(item.type==='pseudo-element'&&!supportedElements.has(item.kind)&&!(item.kind==='custom'&&item.name==='-webkit-calendar-picker-indicator'))throw new Error('Unsupported pseudo-element '+item.kind+': '+text);
    for(const sub of item.selectors??[])validate(sub);
    for(const sub of item.of??[])validate(sub);
  }};
  result.forEach(validate);selectorCache.set(text,result);return result;
}
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const compare=(a,b)=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]-b[i];return 0;};
export function specificity(selector){return selector.reduce((score,item)=>{
  if(item.type==='id')return add(score,[1,0,0]);
  if(['class','attribute'].includes(item.type))return add(score,[0,1,0]);
  if(['type','pseudo-element'].includes(item.type))return add(score,[0,0,1]);
  if(item.type==='pseudo-class'){
    if(item.kind==='where')return score;
    if(['is','not','has'].includes(item.kind))return add(score,(item.selectors??[]).map(specificity).sort(compare).at(-1)??[0,0,0]);
    return add(add(score,[0,1,0]),item.of?.map(specificity).sort(compare).at(-1)??[0,0,0]);
  }return score;
},[0,0,0]);}
function splitTop(value,separator=','){
  const parts=[];let depth=0,start=0,quote='';
  for(let i=0;i<value.length;i++){const c=value[i];if(quote){if(c===quote&&value[i-1]!=='\\')quote='';continue;}if(c==='"'||c==="'"){quote=c;continue;}if(c==='(')depth++;if(c===')')depth--;if(c===separator&&depth===0){parts.push(value.slice(start,i).trim());start=i+1;}}
  parts.push(value.slice(start).trim());return parts;
}
function resolveVariables(value,variables,trail=[]){
  let out=String(value),index;
  while((index=out.indexOf('var('))>=0){let depth=1,end=index+4;for(;end<out.length&&depth;end++){if(out[end]==='(')depth++;if(out[end]===')')depth--;}
    if(depth)throw new Error('Unclosed CSS var: '+value);
    const body=out.slice(index+4,end-1),[name,...fallback]=splitTop(body);
    if(trail.includes(name))throw new Error('Cyclic custom property: '+trail.concat(name).join(' -> '));
    const replacement=Object.hasOwn(variables,name)?resolveVariables(variables[name],variables,trail.concat(name)):fallback.length?resolveVariables(fallback.join(','),variables,trail):null;
    if(replacement===null)throw new Error('Undefined CSS variable '+name+' in '+value);
    out=out.slice(0,index)+replacement+out.slice(end);
  }return out.trim();
}
const cssColors=/#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:transparent|currentColor|white|black|red|green|blue|gray|grey)\b/gi;
export function colorsIn(value){return [...String(value).matchAll(cssColors)].map(m=>m[0]);}
function colorPart(value,fallback='currentColor'){const colors=String(value).match(/var\([^)]*\)|#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:transparent|currentColor|white|black|red|green|blue|gray|grey)\b/gi)??[];return colors.at(-1)??fallback;}
function expand(prop,value){
  if(prop==='background'){
    // The shipped background shorthands omit sizing, repeat and position.
    // They reset those longhands too; preserving an earlier arrow size here
    // would hide full-control gradients and tiled arrows in the real CSS.
    // Color can only be in the final layer, outside a gradient stop.
    const final=splitTop(value).at(-1),tokens=final.match(/(?:#[\da-f]+|(?:rgba?|hsla?)\([^)]*\)|transparent|currentColor|white|black)\s*$/i);
    const color=tokens?.[0]?.trim()??'transparent';
    const image=/gradient\(/.test(value)?splitTop(value).map(v=>v.replace(/\s+(#[\da-f]+|rgba?\([^)]*\)|transparent|white|black)\s*$/i,'')).join(','):'none';
    if(/url\(/.test(value))throw new Error('Image URL background requires actual image paint audit: '+value);
    return [['background-color','__background_color__'+value],['background-image','__background_image__'+value],['background-size','auto'],['background-position','0% 0%'],['background-repeat','repeat']];
  }
  if(/^border(?:-(top|right|bottom|left))?$/.test(prop)){
    const side=prop.slice(7),sides=side?[side]:['top','right','bottom','left'];return sides.flatMap(s=>[['border-'+s+'-color',colorPart(value)],['border-'+s+'-style',/\b(none|solid|dashed|dotted|double)\b/.exec(value)?.[0]??'none'],['border-'+s+'-width',/\b(?:\d*\.)?\d+(?:px|rem|em)?\b/.exec(value)?.[0]??'medium']]);
  }
  if(prop==='border-color'){
    // The actual source uses single-value shorthand; explicitly reject an
    // unseen multi-value form instead of assigning the wrong side colors.
    const tokens=value.match(/var\([^)]*\)|#[\da-f]+|rgba?\([^)]*\)|currentColor|transparent|white|black/gi)??[];
    if(!tokens.length||tokens.join(' ')!==value.trim())throw new Error('Unsupported border-color shorthand: '+value);
    if(tokens.length>4)throw new Error('Unsupported border-color: '+value);
    const [a,b=a,c=a,d=b]=tokens;return [['border-top-color',a],['border-right-color',b],['border-bottom-color',c],['border-left-color',d]];
  }
  if(prop==='border-style'){const [a,b=a,c=a,d=b]=value.trim().split(/\s+/);return [['border-top-style',a],['border-right-style',b],['border-bottom-style',c],['border-left-style',d]];}
  if(prop==='outline')return [['outline-color',colorPart(value)],['outline-style',/\b(none|solid|dashed|dotted|double)\b/.exec(value)?.[0]??'none'],['outline-width',/\b(?:\d*\.)?\d+(?:px|rem|em)?\b/.exec(value)?.[0]??'medium']];
  return [[prop,value]];
}
function mediaMatches(params,ctx){return splitTop(params).some(branch=>branch.split(/\s+and\s+/i).every(part=>{
  part=part.trim();if(part==='screen'||part==='all')return true;if(part==='print')return false;
  let m=part.match(/^\((min|max)-width:\s*(\d+)px\)$/);if(m)return m[1]==='min'?ctx.width>=+m[2]:ctx.width<=+m[2];
  m=part.match(/^\(max-height:\s*(\d+)px\)$/);if(m)return (ctx.height??844)<=+m[1];
  m=part.match(/^\(prefers-color-scheme:\s*(dark|light)\)$/);if(m)return ctx.systemTheme===m[1];
  m=part.match(/^\(prefers-reduced-motion:\s*(reduce|no-preference)\)$/);if(m)return !!ctx.reducedMotion===(m[1]==='reduce');
  m=part.match(/^\(pointer:\s*(coarse|fine)\)$/);if(m)return ctx.pointer===m[1];
  m=part.match(/^\(forced-colors:\s*(active|none)\)$/);if(m)return !!ctx.forcedColors===(m[1]==='active');
  throw new Error('Unsupported media query: '+params);
}));}

export function createAudit({htmlPath=checkout+'/calculator/index.html',root,nodes=[]}={}){
  if(!root)throw new Error('createAudit requires HTML root node');
  const html=fs.readFileSync(htmlPath,'utf8'),rules=[];let order=0;
  for(const match of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g))parse(match[1]).walkRules(rule=>{
    const declarations=rule.nodes.filter(n=>n.type==='decl'&&relevant.test(n.prop));if(!declarations.length)return;
    const ancestors=[];for(let p=rule.parent;p&&p.type!=='root';p=p.parent)if(p.type==='atrule')ancestors.push([p.name,p.params]);
    if(ancestors.some(([name])=>name==='keyframes'||name==='-webkit-keyframes'))return;
    if(ancestors.some(([name])=>name!=='media'))throw new Error('Unsupported relevant CSS at-rule '+JSON.stringify(ancestors));
    const selectors=parsedSelectors(rule.selector);rules.push({selectorText:rule.selector,selectors,specs:selectors.map(specificity),declarations,expandedDeclarations:declarations.map(d=>({values:expand(d.prop,d.value),important:!!d.important})),media:ancestors.map(a=>a[1]),order:order++});
  });
  // Only immutable, direct positive constraints in the rightmost compound
  // narrow the candidate rules. The complete matcher still checks current
  // attributes, classes, ancestors and state; no DOM matches are cached.
  const buckets=new Map(),unconstrained=new Set();
  for(const rule of rules)for(const selector of rule.selectors){
    const compound=selector.slice(selector.findLastIndex(item=>item.type==='combinator')+1);
    const anchor=compound.find(item=>item.type==='id')??compound.find(item=>item.type==='class')??compound.find(item=>item.type==='type');
    if(!anchor){unconstrained.add(rule);continue;}
    const key=anchor.type+':'+(anchor.type==='type'?anchor.name.toLowerCase():anchor.name);
    if(!buckets.has(key))buckets.set(key,new Set());buckets.get(key).add(rule);
  }
  function candidateRules(element){
    const candidates=new Set(unconstrained),keys=['id:'+element.id,'type:'+element.tagName?.toLowerCase(),...(element.className??'').split(/\s+/).map(name=>'class:'+name)];
    for(const key of keys)for(const rule of buckets.get(key)??[])candidates.add(rule);
    return candidates;
  }
  const attr=(node,name,ctx)=>node===root&&name==='data-theme'?ctx.theme:node===root&&name==='data-screen-color'?ctx.accent:node===root&&name==='data-text-weight'?ctx.weight:name==='id'?node.id:name==='class'?node.className:node.getAttribute?.(name);
  const children=node=>node?.children??[];
  const descendants=node=>children(node).flatMap(c=>[c,...descendants(c)]);
  const state=(node,key,ctx)=>{
    const states=ctx.states?.get?.(node)??ctx.states?.[node.id]??(ctx.element===node?ctx.state:[])??[];
    return states instanceof Set?states.has(key):Array.isArray(states)?states.includes(key):!!states[key];
  };
  function partMatches(node,item,ctx,pseudo){
    if(item.type==='type')return node.tagName?.toLowerCase()===item.name.toLowerCase();
    if(item.type==='id')return node.id===item.name;
    if(item.type==='class')return (node.className??'').split(/\s+/).includes(item.name);
    if(item.type==='universal')return true;
    if(item.type==='attribute'){
      let value=attr(node,item.name,ctx);if(value===undefined||value===null)return false;if(!item.operation)return true;
      let expected=item.operation.value;if(item.operation.caseSensitivity==='ascii-case-insensitive'){value=value.toLowerCase();expected=expected.toLowerCase();}
      switch(item.operation.operator){case'equal':return value===expected;case'includes':return value.split(/\s+/).includes(expected);case'dash-match':return value===expected||value.startsWith(expected+'-');case'prefix':return value.startsWith(expected);case'suffix':return value.endsWith(expected);case'substring':return value.includes(expected);default:throw new Error('Unsupported attribute operation '+JSON.stringify(item));}
    }
    if(item.type==='pseudo-element')return pseudo===(item.kind==='custom'?item.name:item.kind);
    if(item.type==='pseudo-class'){
      const siblings=children(node.parentNode),same=siblings.filter(n=>n.tagName===node.tagName),index=siblings.indexOf(node)+1,indexType=same.indexOf(node)+1;
      switch(item.kind){
        case'root':return node===root;
        case'where':case'is':return item.selectors.some(s=>matches(node,s,ctx,''));
        case'not':return !item.selectors.some(s=>matches(node,s,ctx,''));
        case'has':return item.selectors.some(s=>descendants(node).some(c=>matches(c,s,ctx,'',node)));
        case'first-child':return index===1;case'last-child':return index===siblings.length;
        case'first-of-type':return indexType===1;case'last-of-type':return indexType===same.length;
        case'nth-child':case'nth-of-type':{const n=item.kind==='nth-of-type'?indexType:item.of?siblings.filter(c=>item.of.some(s=>matches(c,s,ctx,''))).indexOf(node)+1:index;return n>0&&(item.a===0?n===item.b:(n-item.b)/item.a>=0&&Number.isInteger((n-item.b)/item.a));}
        case'empty':return children(node).length===0&&!node.textContent&&!node.innerHTML;
        case'disabled':return !!node.disabled||node.hasAttribute?.('disabled')||state(node,'disabled',ctx);
        case'enabled':return ['BUTTON','INPUT','SELECT','TEXTAREA','OPTION'].includes(node.tagName)&&!partMatches(node,{type:'pseudo-class',kind:'disabled'},ctx,pseudo);
        case'checked':return !!node.checked||node.hasAttribute?.('checked')||state(node,'checked',ctx);
        case'invalid':return !!node.validationMessage||state(node,'invalid',ctx);
        case'valid':return ['INPUT','SELECT','TEXTAREA'].includes(node.tagName)&&!partMatches(node,{type:'pseudo-class',kind:'invalid'},ctx,pseudo);
        case'placeholder-shown':return !node.value&&!!node.getAttribute?.('placeholder');
        case'focus-within':return state(node,'focus',ctx)||descendants(node).some(c=>state(c,'focus',ctx));
        default:return state(node,item.kind,ctx);
      }
    }throw new Error('Unhandled selector node '+JSON.stringify(item));
  }
  function matches(node,selector,ctx,pseudo='',relativeRoot=null){
    if(!node)return false;
    const pseudoTokens=selector.filter(i=>i.type==='pseudo-element');if(pseudoTokens.length?(pseudo!==(pseudoTokens.at(-1).kind==='custom'?pseudoTokens.at(-1).name:pseudoTokens.at(-1).kind)):pseudo!=='')return false;
    function recurse(current,end){
      let start=end;while(start>=0&&selector[start].type!=='combinator')start--;
      if(!selector.slice(start+1,end+1).every(item=>partMatches(current,item,ctx,pseudo)))return false;
      if(start<0)return relativeRoot?current!==relativeRoot:true;
      const combinator=selector[start].value;
      if(start===0){if(!relativeRoot)throw new Error('Unanchored relative selector');return combinator==='child'?current.parentNode===relativeRoot:combinator==='descendant'?descendants(relativeRoot).includes(current):false;}
      if(combinator==='child')return current.parentNode?recurse(current.parentNode,start-1):false;
      if(combinator==='descendant'){for(let p=current.parentNode;p;p=p.parentNode)if(recurse(p,start-1))return true;return false;}
      const siblings=children(current.parentNode),index=siblings.indexOf(current);if(combinator==='next-sibling')return index>0&&recurse(siblings[index-1],start-1);
      if(combinator==='later-sibling')return siblings.slice(0,index).some(n=>recurse(n,start-1));
      throw new Error('Unsupported combinator '+combinator);
    }return recurse(node,selector.length-1);
  }
  const contextCache=new WeakMap();
  function computed(node,input={},pseudo=''){
    let cache=contextCache.get(input);if(!cache){
      const ctx={theme:'light',accent:'standard',weight:'standard',width:1280,systemTheme:'light',pointer:'fine',...input},mediaMemo=new Map();
      const active=params=>{if(!mediaMemo.has(params))mediaMemo.set(params,mediaMatches(params,ctx));return mediaMemo.get(params);};
      cache={ctx,memo:new Map(),activeRules:new Set(rules.filter(rule=>rule.media.every(active)))};contextCache.set(input,cache);
    }
    const {ctx,memo,activeRules}=cache;
    function run(element,targetPseudo=''){
      const key=element;if(memo.get(key)?.has(targetPseudo))return memo.get(key).get(targetPseudo);
      const parent=targetPseudo?run(element):element.parentNode?run(element.parentNode):null;
      const variables={...(parent?.variables??{})},winning=new Map();
      function offer(prop,value,important,spec,order,selector){const previous=winning.get(prop),candidate={value,important,spec,order,selector};if(!previous||+important>+previous.important||important===previous.important&&(compare(spec,previous.spec)>0||compare(spec,previous.spec)===0&&order>=previous.order))winning.set(prop,candidate);}
      for(const rule of candidateRules(element)){if(!activeRules.has(rule))continue;const matched=rule.selectors.flatMap((s,i)=>matches(element,s,ctx,targetPseudo)?[rule.specs[i]]:[]);if(!matched.length)continue;const spec=[0,...matched.sort(compare).at(-1)];for(let di=0;di<rule.expandedDeclarations.length;di++){const d=rule.expandedDeclarations[di];for(const [prop,value]of d.values)offer(prop,value,d.important,spec,rule.order*100+di,rule.selectorText);}}
      if(!targetPseudo){
        if(element.tagName&&['SVG','PATH','TEXT','CIRCLE','RECT','LINE','POLYLINE','POLYGON'].includes(element.tagName))for(const p of ['fill','stroke','opacity','color']){const v=element.getAttribute?.(p);if(v!==null&&v!==undefined)offer(p,v,false,[0,0,0,0],-1,'SVG presentation attribute');}
        const inline=element.getAttribute?.('style')??'';if(inline)parse('x{'+inline+'}').walkDecls(d=>{if(relevant.test(d.prop))for(const[p,v]of expand(d.prop,d.value))offer(p,v,!!d.important,[1,0,0,0],Number.MAX_SAFE_INTEGER,'style attribute');});
        for(const[p,v]of Object.entries(element.style??{})){if(typeof v!=='string'&&typeof v!=='number')continue;const prop=p.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());if(relevant.test(prop))for(const[k,val]of expand(prop,String(v)))offer(k,val,false,[1,0,0,0],Number.MAX_SAFE_INTEGER,'runtime element.style');}
      }
      for(const[p,c]of winning)if(p.startsWith('--'))variables[p]=c.value;
      const result={variables,winning:Object.fromEntries(winning),pseudo:targetPseudo,element};
      for(const p of new Set([...Object.keys(defaults),...winning.keys()])){
        if(p.startsWith('--'))continue;const c=winning.get(p);let value=c?resolveVariables(c.value,variables):inherited.has(p)&&parent?parent[p]:defaults[p];
        if(value?.startsWith('__background_color__')||value?.startsWith('__background_image__')){const raw=value.slice(value.indexOf('__',2)+2),isColor=value.startsWith('__background_color__');const final=splitTop(raw).at(-1),tail=final.match(/(?:#[\da-f]+|(?:rgba?|hsla?)\([^)]*\)|transparent|currentColor|white|black)\s*$/i);value=isColor?tail?.[0]?.trim()??'transparent':/gradient\(/.test(raw)?raw:'none';}
        if(value==='inherit'||value==='unset'&&inherited.has(p))value=parent?.[p]??defaults[p];if(value==='initial'||value==='unset')value=defaults[p];
        if(value!==undefined)result[p]=value;
      }
      if(result.color==='currentColor')result.color=parent?.color??'#000';
      for(const[p,v]of Object.entries(result))if(typeof v==='string'&&p!=='color')result[p]=v.replace(/currentColor/g,result.color);
      if(result['caret-color']==='auto')result['caret-color']=result.color;
      if(!memo.has(key))memo.set(key,new Map());memo.get(key).set(targetPseudo,result);return result;
    }return run(node,pseudo);
  }
  function background(node,ctx={},pseudo=''){
    const c=computed(node,ctx,pseudo),parent=pseudo?background(node,ctx):node.parentNode?background(node.parentNode,ctx):[255,255,255,1];
    return composite(parseColor(c['background-color']),parent);
  }
  function textContrast(node,ctx={},pseudo=''){
    const c=computed(node,ctx,pseudo),back=background(node,ctx,pseudo),fore=composite(parseColor(c.color),back),paints=[];let covered=false;
    for(let p=node;p;p=p.parentNode){
      const pc=p===node?c:computed(p,ctx),image=covered?'none':pc['background-image'];
      // Shipped selects paint two 5/6 px triangular arrows at the right edge;
      // they do not sit behind text, unlike full-size decorative gradients.
      const arrow=p.tagName==='SELECT'&&image.startsWith('linear-gradient(45deg,transparent 50%')&&image.includes('linear-gradient(135deg,')&&/^[56]px [56]px$/.test(pc['background-size']??'')&&pc['background-repeat']==='no-repeat';
      if(image!=='none'||+pc.opacity!==1||pc.filter!=='none')paints.push({element:p,image,decorativeArrow:arrow,opacity:pc.opacity,filter:pc.filter,colors:colorsIn(image)});
      if(+parseColor(pc['background-color'])[3]===1)covered=true;
    }
    return {ratio:contrast(fore,back),foreground:fore,background:back,computed:c,gradient:paints.some(p=>p.image!=='none'&&!p.decorativeArrow),reliable:paints.every(p=>(p.image==='none'||p.decorativeArrow)&&+p.opacity===1&&p.filter==='none'),paints};
  }
  return {computed,background,textContrast,clearCache:ctx=>contextCache.delete(ctx),rules,nodes,selectors:parsedSelectors,matches:(node,selector,ctx={})=>parsedSelectors(selector).some(s=>matches(node,s,{theme:'light',accent:'standard',weight:'standard',width:1280,systemTheme:'light',pointer:'fine',...ctx}))};
}
export function parseColor(value){
  value=String(value).trim().toLowerCase();const named={transparent:[0,0,0,0],white:[255,255,255,1],black:[0,0,0,1],red:[255,0,0,1],green:[0,128,0,1],blue:[0,0,255,1],gray:[128,128,128,1],grey:[128,128,128,1]};if(named[value])return named[value];
  if(/^#[\da-f]{3,8}$/.test(value)){let h=value.slice(1);if(h.length===3||h.length===4)h=[...h].map(c=>c+c).join('');if(h.length!==6&&h.length!==8)throw new Error('Unsupported hex color '+value);return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)).concat(h.length===8?parseInt(h.slice(6,8),16)/255:1);}
  let m=value.match(/^rgba?\((.*)\)$/);if(m){const parts=m[1].split(/[\s,\/]+/).filter(Boolean);if(parts.length<3||parts.length>4)throw new Error('Unsupported RGB '+value);return parts.slice(0,3).map(p=>p.endsWith('%')?parseFloat(p)*2.55:parseFloat(p)).concat(parts[3]===undefined?1:parts[3].endsWith('%')?parseFloat(parts[3])/100:parseFloat(parts[3]));}
  m=value.match(/^hsla?\((.*)\)$/);if(m){const p=m[1].split(/[\s,\/]+/).filter(Boolean),h=((parseFloat(p[0])%360)+360)%360/360,s=parseFloat(p[1])/100,l=parseFloat(p[2])/100;const hue=(a,b,t)=>{if(t<0)t++;if(t>1)t--;return t<1/6?a+(b-a)*6*t:t<.5?b:t<2/3?a+(b-a)*(2/3-t)*6:a;};const q=l<.5?l*(1+s):l+s-l*s,base=2*l-q;return (s?[h+1/3,h,h-1/3].map(t=>hue(base,q,t)*255):[l*255,l*255,l*255]).concat(p[3]===undefined?1:parseFloat(p[3]));}
  throw new Error('Unsupported/unresolved color '+value);
}
export function composite(foreground,background){const a=foreground[3]+background[3]*(1-foreground[3]);return [0,1,2].map(i=>a?(foreground[i]*foreground[3]+background[i]*background[3]*(1-foreground[3]))/a:0).concat(a);}
export function luminance(color){return color.slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);}
export function contrast(a,b){const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
