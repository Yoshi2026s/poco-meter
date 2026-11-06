import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { iconData } from '../calculator/offline-assets.mjs';
const html = readFileSync(new URL('../calculator/index.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x => x[1]).find(x => x.includes("getElementById('contactForm')"));
test('offline shell never intercepts private message APIs or management pages', () => {
  const handlers = {};
  vm.runInNewContext(readFileSync(new URL('../calculator/sw.js', import.meta.url), 'utf8'), { URL, self: { location: { origin: 'https://meter.example' }, addEventListener: (name, fn) => handlers[name] = fn } });
  for (const pathname of ['/api/contact', '/api/contact/attachments/22222222-2222-4222-8222-222222222222', '/api/admin/contact', '/api/admin/contact/attachments/22222222-2222-4222-8222-222222222222', '/admin/messages']) for (const method of ['GET','POST']) {
    let intercepted = false;
    handlers.fetch({ request: { method, url: 'https://meter.example' + pathname, mode: 'navigate' }, respondWith() { intercepted = true; } });
    assert.equal(intercepted, false);
  }
});
function setup({ online = false, userAgentData, fetcher = async () => ({ ok: true }), hash = '', confirm = () => true, images = false } = {}) {
  function element(tag='div') { return { tagName:tag.toUpperCase(), value: '', hidden: true, disabled: false, textContent: '', handlers: {}, children: [], dataset: {}, addEventListener(name, fn) { this.handlers[name] = fn; }, focus() { this.focused = true; }, removeAttribute(name) { delete this[name]; }, appendChild(child) { this.children.push(child); this.firstChild = this.children[0]; }, replaceChildren(...children) { this.children = children; this.firstChild = this.children[0]; },querySelectorAll(tag){return this.children.flatMap(child=>[child,...child.querySelectorAll('*')]).filter(child=>tag==='*'||child.tagName===tag.toUpperCase());} }; }
  const elements = Object.fromEntries(['contactForm','contactMessage','contactSubject','contactStatus','toolContact','contactThread','contactHistory','contactHistoryStatus','contactSend','contactReload','contactNew','contactOlder','contactPrevPage','contactNextPage'].map(id => [id, element()]));
  if(images)for(const id of ['contactImage','contactImagePreview','contactImageThumbnails','contactImageRemove','contactImageStatus'])elements[id]=element();
  elements.contactSubject.value = '不具合の報告';
  const windowEvents = {}, documentEvents = {};
  const navigator = { onLine: online, userAgentData };
  const urls=new Set();class ImageURL extends URL{static createObjectURL(blob){const url=URL.createObjectURL(blob);urls.add(url);return url;}static revokeObjectURL(url){urls.delete(url);URL.revokeObjectURL(url);}}
  const context = { document: { createElement: tag => tag==='canvas'?{getContext:()=>({fillRect(){},drawImage(){}}),toBlob(fn,type){fn(new Blob([Buffer.from(iconData['180'],'base64')],{type}));}}:element(tag), getElementById: id => elements[id], visibilityState: 'visible', addEventListener: (name, fn) => documentEvents[name] = fn }, navigator, location: { protocol: 'https:', hash }, window: { crypto, confirm, addEventListener: (name, fn) => windowEvents[name] = fn }, crypto, fetch: fetcher, AbortController, URLSearchParams, URL:ImageURL, FormData, Blob, Image: class {constructor(){this.naturalWidth=4000;this.naturalHeight=3000;}set src(value){queueMicrotask(()=>this.onload());}}, Intl, setTimeout, clearTimeout };
  vm.runInNewContext(script, context);
  return { elements, navigator, windowEvents, documentEvents, previewURLs:()=>urls.size, submit: () => elements.contactForm.handlers.submit({ preventDefault() {} }) };
}
const threadId = '22222222-2222-4222-8222-222222222222';
const empty = { threads: [], thread: null, messages: [], page: 1, total: 0, hasNext: false, nextBefore: null };
const inbox = { ...empty, threads: [{ id: threadId, subject: '不具合の報告', createdAt: 1, updatedAt: 2, lastAuthor: 'owner' }], thread: { id: threadId, subject: '不具合の報告' }, messages: [{ id: '1', author: 'owner', content: '<img src=x onerror=alert(1)>\n返信', createdAt: 2 }] };
const result = (data, status = 200) => ({ ok: status < 400, status, async json() { return data; } });
const flush = () => new Promise(resolve => setImmediate(resolve));
test('contact replaces Instagram and clipboard with an internal private inbox', () => {
  assert.ok(!html.includes('contactInstagram')); assert.ok(!html.includes('instagram.com/yoshi1012ss'));
  assert.ok(html.includes('専用メッセージ窓口')); assert.ok(html.includes('Cookieの削除')); assert.ok(!script.includes('navigator.clipboard'));
});
test('empty or offline contact preserves text and never submits', async () => {
  let network = 0;
  const s = setup({ fetcher: async () => { network++; } });
  await s.submit(); assert.match(s.elements.contactStatus.textContent, /入力/);
  s.elements.contactMessage.value = '問い合わせ'; await s.submit();
  assert.match(s.elements.contactStatus.textContent, /オフライン/); assert.equal(s.elements.contactMessage.value, '問い合わせ'); assert.equal(network, 0);
});
test('saved messages preserve actual newlines, render replies as text, and clear only the submitted draft', async () => {
  const calls = [];
  const s = setup({ fetcher: async (path, options) => { calls.push({path, options}); return path === '/api/contact' && options.method === 'POST' ? result({ ok: true, threadId }) : result(path.includes('?') ? inbox : empty); } });
  s.navigator.onLine = true; s.elements.contactMessage.value = '行1\n行2'; await s.submit();
  const post = calls.find(call => call.options.method === 'POST'); assert.equal(JSON.parse(post.options.body).content, '行1\n行2');
  assert.equal(post.options.credentials, 'same-origin'); assert.equal(post.options.cache, 'no-store');
  assert.match(s.elements.contactStatus.textContent, /送信しました/); assert.equal(s.elements.contactMessage.value, '');
  assert.equal(s.elements.contactHistory.children[0].children[1].textContent, '<img src=x onerror=alert(1)>\n返信');
});
test('uncertain saves reuse one request ID, preserve edits, and suppress double submit', async () => {
  const bodies = []; let release, saved = false;
  const s = setup({ fetcher: async (path, options) => {
    if (options.method !== 'POST') return result(path.includes('?') ? inbox : empty);
    bodies.push(options.body); if (!saved) return new Promise((_, reject) => { release = () => reject(new Error('Network lost')); });
    return result({ ok: true, threadId });
  } });
  s.navigator.onLine = true; s.elements.contactMessage.value = '前の内容';
  const pending = s.submit(); await flush(); await s.submit(); assert.equal(bodies.length, 1); release(); await pending;
  assert.equal(s.elements.contactMessage.value, '前の内容'); saved = true; await s.submit(); assert.equal(bodies[0], bodies[1]);
});
test('a newer draft is not erased when an older save completes', async () => {
  let release;
  const s = setup({ fetcher: async (path, options) => options.method === 'POST' ? new Promise(resolve => { release = () => resolve(result({ ok: true, threadId })); }) : result(path.includes('?') ? inbox : empty) });
  s.navigator.onLine = true; s.elements.contactMessage.value = '前の内容'; const pending = s.submit(); await flush();
  s.elements.contactMessage.value = '新しい内容'; s.elements.contactMessage.handlers.input(); release(); await pending;
  assert.equal(s.elements.contactMessage.value, '新しい内容');
});
test('denied sessions keep the unsent draft and start a fresh retry identity after bootstrap', async () => {
  const bodies = [];
  const s = setup({ confirm: () => false, fetcher: async (path, options) => {
    if (options.method !== 'POST') return result(empty);
    bodies.push(options.body); return result({ error: 'Cookieを有効にしてください。' }, 401);
  } });
  s.navigator.onLine = true; s.elements.contactMessage.value = 'Cookieが使えない問い合わせ'; await s.submit();
  s.elements.contactThread.value = threadId; s.elements.contactThread.handlers.change(); await s.submit();
  assert.notEqual(JSON.parse(bodies[0]).requestId, JSON.parse(bodies[1]).requestId); assert.equal(s.elements.contactMessage.value, 'Cookieが使えない問い合わせ'); assert.match(s.elements.contactStatus.textContent, /Cookie/);
});
test('revocation hides old history, preserves text and image drafts, and reopens a new session without automatic sending', async () => {
  let revoked = false, reads = 0, posts = 0;
  const s = setup({ online:true, images:true, fetcher:async (path,options) => {
    if(options.method==='POST'){posts++;return result({error:'アクセスが停止されました。'},401);}
    reads++;return result(revoked?empty:inbox);
  }});
  s.elements.toolContact.open=true;s.elements.toolContact.handlers.toggle();await flush();
  s.elements.contactThread.value=threadId;s.elements.contactThread.handlers.change();await flush();
  assert.ok(s.elements.contactHistory.children.length);
  s.elements.contactMessage.value='失効時に残す下書き';
  s.elements.contactImage.files=[new Blob([Buffer.from(iconData['180'],'base64')],{type:'image/png'})];
  await s.elements.contactImage.handlers.change.call(s.elements.contactImage);
  const previews=s.previewURLs();assert.equal(previews,1);
  await s.submit();revoked=true;
  assert.equal(s.elements.contactMessage.value,'失効時に残す下書き');assert.equal(s.previewURLs(),previews);
  assert.equal(s.elements.contactHistory.children.length,0);assert.equal(s.elements.contactThread.value,'');assert.equal(posts,1);
  const before=reads;s.elements.toolContact.open=false;s.elements.toolContact.handlers.toggle();s.elements.toolContact.open=true;s.elements.toolContact.handlers.toggle();await flush();
  assert.equal(reads,before+1);assert.equal(posts,1);assert.equal(s.elements.contactMessage.value,'失効時に残す下書き');assert.equal(s.previewURLs(),previews);
});
test('simultaneous initial opening coalesces the capability cookie request and locks send during selection', async () => {
  let reads = 0, posts = 0, release;
  const s = setup({ fetcher: async (path, options) => {
    if (options.method === 'POST') { posts++; return result({ ok: true, threadId }); }
    reads++; return new Promise(resolve => { release = () => resolve(result(inbox)); });
  } });
  s.navigator.onLine = true; s.elements.toolContact.open = true; s.elements.toolContact.handlers.toggle(); s.elements.toolContact.handlers.toggle();
  s.elements.contactMessage.value = '内容'; await s.submit(); assert.equal(reads, 1); assert.equal(posts, 0); assert.equal(s.elements.contactSend.disabled, true);
  release(); await flush(); assert.equal(s.elements.contactSend.disabled, false);
  s.elements.contactThread.value = threadId; s.elements.contactThread.handlers.change(); assert.equal(s.elements.contactSend.disabled, true); await s.submit(); assert.equal(posts, 0);
  await flush(); release(); await flush(); assert.equal(s.elements.contactThread.value, threadId);
});
test('contact opening never sends a second legacy visit event', async () => {
  const calls = [];
  const s = setup({ online: true, fetcher: async (path, options) => { calls.push({ path, options }); return result(empty); } });
  await flush(); assert.equal(calls.length, 0);
  assert.equal(s.windowEvents.online, undefined); assert.equal(s.documentEvents.visibilitychange, undefined);
  s.elements.toolContact.open = true; s.elements.toolContact.handlers.toggle(); await flush();
  assert.equal(calls.length, 1); assert.equal(calls[0].path, '/api/contact');
  assert.ok(!script.includes('/api/visits'));
});

test('image selection previews, retry keeps identical payload and attachment, successful send clears preview',async()=>{
 const posts=[];let success=false;
 const s=setup({images:true,online:true,fetcher:async(path,options)=>{
  if(path!=='/api/contact'||options.method!=='POST')return result(empty);
  posts.push(options);if(!success)throw new Error('通信失敗');return result({ok:true,threadId});
 }});
 s.elements.contactImage.files=[new Blob([Buffer.from(iconData['180'],'base64')],{type:'image/png'})];
 await s.elements.contactImage.handlers.change.call(s.elements.contactImage);
 assert.equal(s.elements.contactImagePreview.hidden,false);assert.match(s.elements.contactImageStatus.textContent,/準備済み/);
 await s.submit();assert.equal(s.elements.contactImagePreview.hidden,false);assert.ok(posts[0].body instanceof FormData);assert.equal(posts[0].headers,undefined);
 success=true;await s.submit();
 assert.equal(posts[0].body.get('data'),posts[1].body.get('data'));assert.deepEqual(Buffer.from(await posts[0].body.get('image').arrayBuffer()),Buffer.from(await posts[1].body.get('image').arrayBuffer()));
 assert.equal(s.elements.contactImagePreview.hidden,true);assert.equal(s.elements.contactImageThumbnails.children.length,0);assert.equal(s.previewURLs(),0);
});
test('image remove and unsupported format do not submit a leftover attachment',async()=>{
 const s=setup({images:true});
 s.elements.contactImage.files=[new Blob(['bad'],{type:'image/svg+xml'})];await s.elements.contactImage.handlers.change.call(s.elements.contactImage);
 assert.match(s.elements.contactImageStatus.textContent,/JPEG/);assert.equal(s.elements.contactImagePreview.hidden,true);
 s.elements.contactImage.files=[new Blob([Buffer.from(iconData['180'],'base64')],{type:'image/png'})];await s.elements.contactImage.handlers.change.call(s.elements.contactImage);
 s.elements.contactImageRemove.handlers.click();assert.equal(s.elements.contactImagePreview.hidden,true);await s.submit();assert.match(s.elements.contactStatus.textContent,/入力/);
});

test('five-image preview, additive selection, individual removal and retry preserve the entire selection',async()=>{
 const posts=[];let success=false;
 const s=setup({images:true,online:true,fetcher:async(path,options)=>{
  if(path!=='/api/contact'||options.method!=='POST')return result(empty);
  posts.push(options);if(!success)throw new Error('通信失敗');return result({ok:true,threadId});
 }});
 const file=()=>new Blob([Buffer.from(iconData['180'],'base64')],{type:'image/png'});
 s.elements.contactImage.files=Array.from({length:3},file);await s.elements.contactImage.handlers.change.call(s.elements.contactImage);
 s.elements.contactImage.files=Array.from({length:2},file);await s.elements.contactImage.handlers.change.call(s.elements.contactImage);
 assert.equal(s.elements.contactImageThumbnails.children.length,5);assert.equal(s.previewURLs(),5);assert.match(s.elements.contactImageStatus.textContent,/5\/5枚/);
 s.elements.contactImage.files=[file()];await s.elements.contactImage.handlers.change.call(s.elements.contactImage);
 assert.match(s.elements.contactImageStatus.textContent,/5枚まで/);assert.equal(s.elements.contactImageThumbnails.children.length,5);assert.equal(s.previewURLs(),5);
 s.elements.contactImageThumbnails.children[1].children[1].handlers.click();
 assert.equal(s.elements.contactImageThumbnails.children.length,4);assert.equal(s.previewURLs(),4);
 s.elements.contactImage.files=[file()];await s.elements.contactImage.handlers.change.call(s.elements.contactImage);
 await s.submit();assert.equal(posts[0].body.getAll('image').length,5);assert.equal(s.previewURLs(),5);
 success=true;await s.submit();assert.equal(posts[0].body.get('data'),posts[1].body.get('data'));
 const before=posts[0].body.getAll('image'),after=posts[1].body.getAll('image');
 for(let index=0;index<5;index++)assert.deepEqual(Buffer.from(await before[index].arrayBuffer()),Buffer.from(await after[index].arrayBuffer()));
 assert.equal(s.elements.contactImageThumbnails.children.length,0);assert.equal(s.previewURLs(),0);
});
test('invalid added batch retains prior prepared images and clears temporary decode URLs',async()=>{
 const s=setup({images:true});const file=new Blob([Buffer.from(iconData['180'],'base64')],{type:'image/png'});
 s.elements.contactImage.files=[file];await s.elements.contactImage.handlers.change.call(s.elements.contactImage);
 s.elements.contactImage.files=[file,new Blob(['bad'],{type:'image/svg+xml'})];await s.elements.contactImage.handlers.change.call(s.elements.contactImage);
 assert.match(s.elements.contactImageStatus.textContent,/JPEG/);assert.equal(s.elements.contactImageThumbnails.children.length,1);assert.equal(s.previewURLs(),1);
 s.elements.contactImageRemove.handlers.click();assert.equal(s.previewURLs(),0);assert.equal(s.elements.contactImagePreview.hidden,true);
});

test('public navigation keeps one contact panel and removes the combined historical-statistics entry',()=>{
 assert.equal((html.match(/id="toolContact"/g)||[]).length,1);
 assert.equal((html.match(/id="toolContactSummary"/g)||[]).length,1);
 assert.ok(!html.includes('お問い合わせ・過去統計'));
 assert.ok(!html.includes('admin-page-link'));
 assert.ok(!html.includes('窓口を別タブで開く'));
 assert.equal((html.match(/id="pococha-security-management"/g)||[]).length,1);
});
