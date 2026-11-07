// Builds the GitHub Pages publication (calculator + borders only) into _site/.
// Usage: node scripts/build-pages.mjs [--out=_site]
// Sources are the committed pages in calculator/. Border data is data/borders.json,
// updated by .github/workflows/border-update.yml. No server API is used.
import {readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {manifest, iconData} from '../calculator/offline-assets.mjs';
import {exportWorker} from './prepare-github-meter.mjs';
import {sealCalculatorHTML, scriptSources} from '../lib/browser-security.mjs';
import {validateData} from '../automation/update-borders-json.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
// Tool version shown on the page. Change only when the tool itself changes
// (data updates do not change it).
export const PAGES_VERSION = {version: 'v2026.11.07.9', updatedAt: '2026-11-07T12:19:00+09:00', label: '2026/11/07 12:19:00'};
const SITES_ORIGIN = 'https://poco-meter.freefreelife2000.chatgpt.site';
const COLLECTOR_ORIGIN = 'https://pococha-comment-access.freefreelife2000.chatgpt.site';
const BORDER_FETCH = "fetch('/api/borders',{cache:'no-cache',credentials:'same-origin',signal:controller.signal})";
const BORDER_FETCH_PAGES = "fetch('./data/borders.json',{cache:'no-cache',credentials:'same-origin',signal:controller.signal})";

function replaceOnce(source, from, to) {
  if (source.split(from).length !== 2) throw new Error('Pages build: source changed near ' + String(from).slice(0, 80));
  return source.replace(from, to);
}
function removeOnce(source, pattern, label) {
  const matches = source.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')) || [];
  if (matches.length !== 1) throw new Error('Pages build: expected one ' + label + ', found ' + matches.length);
  return source.replace(pattern, '');
}
function assertClean(html, name) {
  for (const banned of ['freefreelife2000', 'pococha-comment', "fetch('/api/", 'pococha-public-access-tracker']) {
    if (html.includes(banned)) throw new Error('Pages build: ' + name + ' still contains ' + banned);
  }
  const declared = html.match(/script-src\s+([^;"]+);/)?.[1] ?? '';
  for (const hash of scriptSources(html).split(' ').filter(Boolean)) {
    if (!declared.includes(hash)) throw new Error('Pages build: ' + name + ' CSP misses a script hash');
  }
  return html;
}

export function exportCalculator(source, version = PAGES_VERSION) {
  let html = replaceOnce(source, '<!-- sites-host-context -->', '<!-- GitHub Pages publication -->');
  html = removeOnce(html, /\s*<script id="pococha-public-access-tracker">[\s\S]*?<\/script>/, 'access tracker');
  html = removeOnce(html, /\s*<!-- Pococha1012 security management: start -->[\s\S]*?<!-- Pococha1012 security management: end -->/, 'admin link');
  html = replaceOnce(html, `connect-src 'self' ${COLLECTOR_ORIGIN};`, "connect-src 'self';");
  html = replaceOnce(html, 'href="/meter.webmanifest"', 'href="./meter.webmanifest"');
  html = replaceOnce(html, 'href="/meter-icon-180.png"', 'href="./meter-icon-180.png"');
  html = html.replaceAll('href="/border-history"', 'href="./border-history.html"');
  html = replaceOnce(html, 'href="/calculation-methods"', 'href="./calculation-methods.html"');
  html = replaceOnce(html, `href="${SITES_ORIGIN}/e-border.html"`, 'href="./e-border.html"');
  html = replaceOnce(html, BORDER_FETCH, BORDER_FETCH_PAGES);
  // There is no server clock on Pages. The existing fallback shows device time,
  // labelled as device time (never as the official clock).
  html = replaceOnce(html,
    "fetch('/api/pococha-time',{cache:'no-store',credentials:'same-origin',signal:controller.signal})",
    "Promise.reject(new Error('clock unavailable on static hosting'))");
  html = replaceOnce(html,
    "navigator.serviceWorker.register('/meter-sw.js',{scope:'/',updateViaCache:'none'})",
    "navigator.serviceWorker.register('./meter-sw.js',{scope:'./',updateViaCache:'none'})");
  html = replaceOnce(html, '<time class="num" datetime="2026-10-23T23:54:26+09:00">2026/10/23 23:54:26</time>',
    `<time class="num" datetime="${version.updatedAt}">${version.label}</time>`);
  html = replaceOnce(html, '最終更新バージョン：v2026.10.23.3', '最終更新バージョン：' + version.version);
  return assertClean(sealCalculatorHTML(html), 'index.html');
}

const SOURCE_VERSION = 'v2026.10.23.3';
function stampVersion(html, name, version) {
  if (!html.includes(SOURCE_VERSION)) throw new Error('Pages build: ' + name + ' has no source version to replace');
  return html.replaceAll(SOURCE_VERSION, version.version);
}

export function exportHistory(source, version = PAGES_VERSION) {
  const html = stampVersion(replaceOnce(source, BORDER_FETCH, BORDER_FETCH_PAGES), 'border-history.html', version);
  return assertClean(sealCalculatorHTML(html), 'border-history.html');
}

export function exportEBorder(source, version = PAGES_VERSION) {
  return assertClean(sealCalculatorHTML(stampVersion(source, 'e-border.html', version)), 'e-border.html');
}

export async function buildPages({root = ROOT, out = resolve(ROOT, '_site')} = {}) {
  const read = path => readFile(resolve(root, path), 'utf8');
  const [calculator, methods, worker, history, eBorder, borders] = await Promise.all([
    read('calculator/index.html'), read('calculator/calculation-methods.html'), read('calculator/sw.js'),
    read('calculator/border-history.html'), read('calculator/e-border.html'), read('data/borders.json'),
  ]);
  validateData(JSON.parse(borders));
  if ((methods.match(/href="\/"/g) || []).length !== 2) throw new Error('Pages build: expected two help return links');
  const pagesManifest = structuredClone(manifest);
  pagesManifest.id = pagesManifest.start_url = pagesManifest.scope = './';
  pagesManifest.icons.forEach(icon => { icon.src = './' + icon.src.replace(/^\//, ''); });
  const files = {
    'index.html': exportCalculator(calculator),
    'calculation-methods.html': methods.replaceAll('href="/"', 'href="./"'),
    // A new tool version gets a new cache name, so installed copies refresh icons and pages.
    'meter-sw.js': replaceOnce(exportWorker(worker), "-github';", `-github-${PAGES_VERSION.version}';`),
    'meter.webmanifest': JSON.stringify(pagesManifest, null, 2) + '\n',
    'border-history.html': exportHistory(history),
    'e-border.html': exportEBorder(eBorder),
    'data/borders.json': borders,
    '.nojekyll': '',
  };
  for (const size of ['180', '192', '512']) files[`meter-icon-${size}.png`] = Buffer.from(iconData[size], 'base64');
  await rm(out, {recursive: true, force: true});
  await mkdir(resolve(out, 'data'), {recursive: true});
  await Promise.all(Object.entries(files).map(([name, content]) => writeFile(resolve(out, name), content)));
  return {out, files: Object.keys(files).sort(), version: PAGES_VERSION.version};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv.slice(2).find(a => a.startsWith('--out='));
  console.log(JSON.stringify(await buildPages(arg ? {out: resolve(arg.slice(6))} : {}), null, 2));
}
