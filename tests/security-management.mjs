// 画面の元ファイル（calculator/index.html）に旧Sites向けのコードが残っていないことを確かめる。
// 旧Sitesのアクセス集計・管理ページリンク・E帯リンク・CSPの許可先は削除済み（公開は GitHub Pages）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scriptSources } from '../lib/browser-security.mjs';
import { exportCalculator } from '../scripts/build-pages.mjs';
const source=await readFile(new URL('../calculator/index.html',import.meta.url),'utf8');

test('source has no old Sites hosts, access tracker or management link',()=>{
 for(const banned of ['chatgpt.site','freefreelife2000','pococha-comment','pococha-public-access-tracker','collectorOrigin','/api/visits','pococha-security-management','Pococha1012 security management'])
  assert.ok(!source.includes(banned),'source still contains '+banned);
});

test('E-border portal link points to the page next to the calculator',()=>{
 const link=source.match(/<a href="([^"]+)" class="manual-link" id="eBorderPortalLink"/);
 assert.ok(link);assert.equal(link[1],'./e-border.html');
});

test('source CSP allows only same-origin connections and lists exactly the inline script hashes',()=>{
 const policy=source.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
 assert.equal(policy.match(/(?:^|;)\s*connect-src\s+([^;]+)/)[1].trim(),"'self'");
 const declared=policy.match(/script-src\s+([^;]+)/)[1].trim();
 assert.equal(declared,scriptSources(source));
 assert.ok(!/script-src[^;]*unsafe-inline/.test(policy));assert.doesNotMatch(policy,/\*/);
});

test('Pages build still refuses old Sites hosts in the calculator',()=>{
 assert.ok(!exportCalculator(source).includes('chatgpt.site'));
 const marker='<!-- GitHub Pages publication -->';
 assert.throws(()=>exportCalculator(source.replace('<!-- sites-host-context -->','<!-- sites-host-context --><a href="https://x.freefreelife2000.chatgpt.site/">x</a>')),/still contains freefreelife2000/);
 assert.ok(exportCalculator(source).includes(marker));
});
