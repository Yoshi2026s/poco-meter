import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { exportHTML } from '../scripts/prepare-github-meter.mjs';
import { buildTracker, COLLECTOR_ORIGIN, ADMIN_ORIGIN, TRACKER_ID } from '../scripts/security-tools.mjs';
import { scriptSources } from '../lib/browser-security.mjs';
const source=await readFile(new URL('../calculator/index.html',import.meta.url),'utf8');
const github=exportHTML(source);
for(const [label,html] of [['Sites',source],['GitHub',github]]) {
 test(`${label} uses one shared collector and a protected management destination`,()=>{
  const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  const tracker=scripts.filter(match=>match[0].startsWith(`<script id="${TRACKER_ID}">`));
  assert.equal(tracker.length,1);assert.equal(tracker[0][1],buildTracker('meter'));
  assert.match(html,new RegExp('href="'+ADMIN_ORIGIN.replaceAll('.','\\.')+'/admin/tools/meter"'));
  assert.equal((html.match(/id="pococha-security-management"/g)||[]).length,1);
  assert.ok(!html.includes("fetch('/api/visits'"));
  const policy=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  for(const hash of scriptSources(html).split(' '))assert.ok(policy.includes(hash));
  const connect=policy.match(/(?:^|;)\s*connect-src\s+([^;]+)/)[1].split(/\s+/);
  assert.ok(connect.includes(COLLECTOR_ORIGIN));assert.ok(!connect.includes('*'));
  assert.ok(!/script-src[^;]*unsafe-inline/.test(policy));
 });
}
test('contact access remains local and private while the shared tracker sends no calculation or contact state',async()=>{
 const contact=[...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match=>match[1]).find(code=>code.includes("getElementById('contactForm')"));
 assert.ok(contact.includes("contactRequest('/api/contact',options)"));assert.ok(!contact.includes('/api/visits'));
 assert.ok(!github.includes("getElementById('contactForm')"));
 let events={},calls=[];
 const window={addEventListener:(name,fn)=>{events[name]=fn;}};window.top=window.self=window;
 const ctx={window,location:{origin:'https://pococha2026.github.io',pathname:'/poco-meter/',search:'?private=secret',hash:'#private'},navigator:{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1'},document:{visibilityState:'visible',addEventListener:(name,fn)=>{events[name]=fn;}},crypto,fetch:async(...args)=>{calls.push(args);return {ok:true};},setTimeout,clearTimeout,URL,Uint8Array};
 Object.defineProperty(ctx,'localStorage',{get(){throw Error('Storage must not be read');}});
 vm.runInNewContext(buildTracker('meter'),ctx);await new Promise(resolve=>setImmediate(resolve));await events.pageshow();await events.visibilitychange();
 assert.equal(calls.length,1);assert.equal(calls[0][0],COLLECTOR_ORIGIN+'/api/visits');
 const body=JSON.parse(calls[0][1].body);assert.equal(body.toolId,'meter');assert.equal(body.page,'https://pococha2026.github.io/poco-meter/');
 assert.deepEqual(Object.keys(body),['toolId','eventId','page','meta']);assert.equal(calls[0][1].credentials,'omit');
 assert.ok(!calls[0][1].body.includes('private'));assert.ok(!calls[0][1].body.includes('pococha-meter-calc-v1'));
});
