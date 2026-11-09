import vm from 'node:vm';import {readFileSync} from 'node:fs';import {webcrypto} from 'node:crypto';
const html=readFileSync(new URL('../calculator/e-border.html',import.meta.url),'utf8'),template=readFileSync(new URL('../calculator/e-border-template.html',import.meta.url),'utf8');
export function eHarness({initial=null,failStore=false,clipboardFail=false,lock=true,now='2026-10-18T00:30:00+09:00',workerMode='normal',extras={}}={}){
 const callbacks=new Map(),docCallbacks=new Map(),timers=new Set(),ids=new Map(),objects=new Map(),copy=[],downloads=[],writes=[],memory=new Map([...(initial?[['pococha-e-display-v1',initial]]:[]),...Object.entries(extras)]);let lastFocus=null,urlId=0;
 class Element{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.listeners=new Map();this.attributes=new Map();this.style={};this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.open=false;this.textContent='';this.classList={toggle:(c,on)=>{const a=new Set((this.className||'').split(/\s+/));on?a.add(c):a.delete(c);this.className=[...a].join(' ');}};}
  append(...items){for(const c of items){if(c&&typeof c==='object'){c.parent=this;this.children.push(c);}else this.children.push(String(c));}if(this.tagName==='SELECT'&&this.children.length===1)this.value=this.children[0].value;}
  get parentElement(){return this.parent??null;}
  after(el){if(!this.parent)return;el.remove();el.parent=this.parent;this.parent.children.splice(this.parent.children.indexOf(this)+1,0,el);}
  replaceChildren(...a){this.children=[];this.append(...a);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
  setAttribute(k,v){this.attributes.set(k,String(v));if(k==='id')ids.set(String(v),this);}
  getAttribute(k){return this.attributes.get(k)??null;}
  removeAttribute(k){this.attributes.delete(k);}
  addEventListener(k,fn){if(!this.listeners.has(k))this.listeners.set(k,[]);this.listeners.get(k).push(fn);}
  async dispatch(k,e={}){const event={target:this,currentTarget:this,preventDefault(){},...e};if(typeof this['on'+k]==='function')await this['on'+k](event);for(const fn of this.listeners.get(k)||[])await fn(event);}
  focus(){lastFocus=this;}
  select(){this.selected=true;}
  scrollIntoView(){}
  click(){if(this.tagName==='A')downloads.push({name:this.download,blob:objects.get(this.href)});else return this.dispatch('click');}
  getContext(){return {drawImage:(im,sx,sy,sw,sh)=>{this.image=im;this.region={sx,sy,sw,sh};},getImageData:()=>({data:new Uint8ClampedArray(this.width*this.height*4)}),putImageData(){}};}
 }
 for(const m of template.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){const el=new Element(m[1]);el.id=m[3];el.hidden=/\bhidden\b/.test(m[2]);el.type=m[2].match(/type="([^"]+)"/)?.[1]||'';ids.set(m[3],el);}
 for(const m of template.matchAll(/<select\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)){const el=ids.get(m[1]);for(const o of m[2].matchAll(/<option(?:\s+value="([^"]*)")?>([^<]*)<\/option>/g)){const op=new Element('option');op.value=o[1]??o[2];op.textContent=o[2];el.append(op);}el.value=el.children[0]?.value||'';}
 const document={body:new Element('body'),head:new Element('head'),visibilityState:'visible',getElementById:id=>{if(!ids.has(id))throw Error('Missing element '+id);return ids.get(id);},createElement:tag=>new Element(tag),addEventListener:(k,fn)=>{if(!docCallbacks.has(k))docCallbacks.set(k,[]);docCallbacks.get(k).push(fn);}};
 document.body.append(ids.get('recordActions'),ids.get('copyFeedback'),ids.get('records'));
 ids.get('recordActions').append(ids.get('copy'));
 const store={fail:failStore,getItem:k=>memory.get(k)??null,setItem(k,v){if(this.fail)throw Error('QuotaExceededError');memory.set(k,String(v));writes.push(k);},removeItem:k=>memory.delete(k)};
 class FixedDate extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return Date.parse(now);}}
 class Image{set src(v){this._src=v;if(!v)return;const f=objects.get(v)||{};this.file=f;this.width=f.width||828;this.height=f.height||1792;queueMicrotask(()=>f.badImage?this.onerror?.():this.onload?.());}get src(){return this._src;}}
 let terminations=0,recognitions=0;
 const fakeWorker={setParameters:async()=>{},reinitialize:async()=>{},terminate:async()=>{terminations++;},recognize:async c=>{recognitions++;if(workerMode==='recognizeHang')return new Promise(()=>{});const f=c.image.file||{},r=c.region;let text='';if(r.sy/ c.image.height<.2)text=f.header||'2026年8月1日 0:00:00 JST\n2026年8月1日 23:59:59 JST\n締め時間24:00:00 JST';else if(r.sy/c.image.height<.3)text=f.rank||'E1';else{const i=r.sx/c.image.width<.35?0:r.sx/c.image.width<.45?1:2;const result=f.valueReads?.[i]?.shift();if(result instanceof Error)throw result;if(result&&typeof result==='object')return {data:result};text=result??(f.values||['250','1.6K','4.8K'])[i];}return {data:{text}};}};
 const context=vm.createContext({document,localStorage:store,navigator:{onLine:true,clipboard:{writeText:async text=>{if(clipboardFail)throw Error('Denied');copy.push(text);}},...(lock?{locks:{request:async(key,options,fn)=>fn()}}:{})},Date:FixedDate,console,Blob,Image,Uint8ClampedArray,Uint8Array,crypto:webcrypto,AbortController,URL:{createObjectURL:x=>{const url='blob:test-'+(++urlId);objects.set(url,x);return url;},revokeObjectURL:url=>objects.delete(url)},confirm:()=>true,setTimeout:(fn,ms)=>{const id=setTimeout(()=>{timers.delete(id);fn();},ms);timers.add(id);return id;},clearTimeout:id=>{clearTimeout(id);timers.delete(id);},queueMicrotask,Tesseract:{createWorker:()=>workerMode==='createHang'?new Promise(()=>{}):Promise.resolve(fakeWorker)}});
 context.window=context;context.addEventListener=(k,fn)=>{if(!callbacks.has(k))callbacks.set(k,[]);callbacks.get(k).push(fn);};
 for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))vm.runInContext(m[1],context,{timeout:5000});
 const all=(el,p)=>el.children.flatMap(c=>c&&typeof c==='object'?[...(p(c)?[c]:[]),...all(c,p)]:[]);
 return {setNow:value=>{now=value;},context,ids,store,memory,writes,copy,downloads,get:id=>ids.get(id),eval:s=>vm.runInContext(s,context),all,inputs:el=>all(el,c=>['INPUT','SELECT'].includes(c.tagName)),buttons:el=>all(el,c=>c.tagName==='BUTTON'),async click(id){await ids.get(id).dispatch('click');},async event(type,e={}){for(const fn of callbacks.get(type)||[])await fn(e);},async documentEvent(type,e={}){for(const fn of docCallbacks.get(type)||[])await fn(e);},focus:()=>lastFocus,stats:()=>({terminations,recognitions,urls:objects.size}),close(){for(const id of timers)clearTimeout(id);timers.clear();}};
}
