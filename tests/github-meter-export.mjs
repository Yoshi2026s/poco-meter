import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { prepareGithubMeter, exportHTML, exportHistoryHTML, exportWorker, FILE_NAMES, SITE_URL } from '../scripts/prepare-github-meter.mjs';
import { COLLECTOR_ORIGIN } from '../scripts/security-tools.mjs';

const source = await readFile(new URL('../calculator/index.html', import.meta.url), 'utf8');
const release = await prepareGithubMeter();
assert.deepEqual(release, await prepareGithubMeter(), 'Export is deterministic');
assert.deepEqual(release.files.map(file => file.path), FILE_NAMES.map(name => 'poco-meter/' + name));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
for (const file of release.files) assert.equal(digest(Buffer.from(file.content, 'base64')), file.sha256);
assert.equal(release.release_hash, digest(release.files.map(file => `${file.path}\n${file.sha256}\n`).join('')));
const html = Buffer.from(release.files[0].content, 'base64').toString();
const scriptBlocks = value => [...value.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const calculatorScript = value => scriptBlocks(value).find(script => script.includes("var KEY='pococha-meter-calc-v1'"));
const expectedCalculator = calculatorScript(source)
  .replace("fetch('/api/borders',{cache:'no-cache',credentials:'same-origin',signal:controller.signal})",
    `fetch('${SITE_URL}/api/borders',{cache:'no-cache',credentials:'omit',signal:controller.signal})`)
  .replace("fetch('/api/pococha-time',{cache:'no-store',credentials:'same-origin',signal:controller.signal})",
    `fetch('${SITE_URL}/api/pococha-time',{cache:'no-store',credentials:'omit',signal:controller.signal})`)
  .replace("navigator.serviceWorker.register('/meter-sw.js',{scope:'/',updateViaCache:'none'})",
    "navigator.serviceWorker.register('./meter-sw.js',{scope:'./',updateViaCache:'none'})");
assert.equal(calculatorScript(html), expectedCalculator, 'Calculation, input storage and HUD code remain identical');
assert.ok(html.includes(`fetch('${SITE_URL}/api/pococha-time',{cache:'no-store',credentials:'omit',signal:controller.signal})`),
  'The static clock reader targets Sites without private session credentials');
assert.equal(html.match(/<style\b[^>]*>[\s\S]*?<\/style>/g)?.join(''), source.match(/<style\b[^>]*>[\s\S]*?<\/style>/g)?.join(''), 'Layout CSS remains identical');
assert.equal(scriptBlocks(html).length, scriptBlocks(source).length);
assert.ok(!html.includes('id="toolContact"'), 'Retired contact panel is not reintroduced by export');
assert.ok(!html.includes("fetch('/api/"));
assert.ok(!html.includes('利用状況の把握のため、'));
assert.ok(!html.includes('<meta name="pococha-sites-origin"'));
assert.ok(!/OAI-Sites-Authorization|X-Border-Writer-Signature|Bearer\s+[A-Za-z0-9_-]{12}/.test(JSON.stringify(release)));
assert.throws(() => exportHTML(source.replace(`connect-src 'self' ${COLLECTOR_ORIGIN};`, 'connect-src *;')), /Export source changed/);
const historySource = await readFile(new URL('../calculator/border-history.html', import.meta.url), 'utf8');
const historyHTML = Buffer.from(release.files.find(file => file.path === 'poco-meter/border-history.html').content, 'base64').toString();
assert.equal(historyHTML, exportHistoryHTML(historySource));
assert.ok(historyHTML.includes(`fetch('${SITE_URL}/api/borders',{cache:'no-cache',credentials:'omit',signal:controller.signal})`));
assert.ok(!historyHTML.includes("fetch('/api/"));
assert.throws(() => exportHistoryHTML(historySource.replace("fetch('/api/borders'", "fetch('/api/changed'")), /Export source changed/);
assert.throws(() => exportHistoryHTML(historySource.replace("connect-src 'self';", 'connect-src *;')), /Export source changed/);
const manifest = JSON.parse(Buffer.from(release.files[3].content, 'base64'));
for (const key of ['id', 'scope', 'start_url']) assert.equal(manifest[key], './');
assert.ok(manifest.icons.every(icon => icon.src.startsWith('./')));

const workerSource = await readFile(new URL('../calculator/sw.js', import.meta.url), 'utf8');
const worker = exportWorker(workerSource);
for (const basePath of ['/poco-meter/', '/nested/poco-meter/']) {
  const listeners = {}, removed = [];
  const scope = 'https://pococha2026.github.io' + basePath;
  const shell = new Response('<meta name="pococha-app" content="meter-offline-v1">', { headers: { 'Content-Type': 'text/html' } });
  const context = vm.createContext({ URL, Response, Headers, AbortController, setTimeout, clearTimeout,
    self: { registration: { scope }, location: { origin: new URL(scope).origin },
      addEventListener: (name, handler) => { listeners[name] = handler; }, clients: { claim: async () => {} } },
    caches: { open: async () => ({ match: async () => shell.clone() }),
      keys: async () => ['pococha-meter-shell-' + encodeURIComponent(basePath) + '-old', 'pococha-challenge-shell-v1', 'pococha-meter-shell-' + encodeURIComponent('/other/') + '-old'],
      delete: async key => { removed.push(key); } },
  });
  vm.runInContext(worker, context);
  for (const suffix of ['', 'index.html']) assert.equal(context.shellRequest({ url: scope + suffix, method: 'GET', mode: 'navigate' }), true);
  for (const suffix of ['?x=1', 'admin', '../poco-challenge/']) assert.equal(context.shellRequest({ url: new URL(suffix, scope).href, method: 'GET', mode: 'navigate' }), false);
  assert.equal(context.shellRequest({ url: scope, method: 'POST', mode: 'navigate' }), false);
  let pending;
  listeners.activate({ waitUntil: promise => { pending = promise; } });
  await pending;
  assert.deepEqual(removed, ['pococha-meter-shell-' + encodeURIComponent(basePath) + '-old'], 'Other apps retain offline caches');
  for (const path of ['/poco-challenge/', '/admin', '/other/']) {
    let accepted = false;
    listeners.message({ source: { url: 'https://pococha2026.github.io' + path }, data: { type: 'POCOCHA_OFFLINE_STATUS', id: 1 }, waitUntil: () => { accepted = true; } });
    assert.equal(accepted, false, 'Other apps cannot control the meter worker');
  }
  const assets = vm.runInContext('ASSETS', context);
  assert.ok(assets.every(path => path.startsWith(basePath)));
}
console.log(JSON.stringify({ status: 'passed', files: release.files.length, release_hash: release.release_hash,
  checks: ['deterministic export', 'content hashes', 'calculator/CSS preservation', 'public-only export', 'credential-free clock reader', 'relative PWA paths', 'scoped offline caches', 'restricted worker messages'] }));
