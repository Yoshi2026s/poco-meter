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
export const PAGES_VERSION = {version: 'v2026.11.11.1', updatedAt: '2026-11-11T14:16:00+09:00', label: '2026/11/11 14:16:00'};
const SITES_ORIGIN = 'https://poco-meter.freefreelife2000.chatgpt.site';
const COLLECTOR_ORIGIN = 'https://pococha-comment-access.freefreelife2000.chatgpt.site';
const BORDER_FETCH = "fetch('/api/borders',{cache:'no-cache',credentials:'same-origin',signal:controller.signal})";
const BORDER_FETCH_PAGES = "fetch('./data/borders.json',{cache:'no-cache',credentials:'same-origin',signal:controller.signal})";

// Public address of the publication. Used for the share preview and the not-found page.
export const PUBLIC_URL = 'https://yoshi2026s.github.io/poco-meter/';
const escapeAttr = text => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
// The three sub pages get the same icon, theme colour and a description as the calculator.
const PAGE_DESCRIPTIONS = {
  'border-history.html': 'Pocochaの過去のランクボーダーを、日付・ランク・締め時間で検索できます。',
  'e-border.html': 'E帯のボーダーを画像の取り込みや手入力で記録し、目標の計算に使えます。',
  'calculation-methods.html': '目標値の算出方法（平均値・中央値・上位25％の境界値・最大値・最小値）と、上乗せ・切り上げの順序を説明します。',
};
export function withPageHead(html, name) {
  for (const present of ['name="description"', 'name="theme-color"', 'rel="icon"', 'rel="apple-touch-icon"']) {
    if (html.includes(present)) throw new Error('Pages build: ' + name + ' already declares ' + present);
  }
  return replaceOnce(html, '<meta charset="utf-8">', '<meta charset="utf-8">' +
    `<meta name="description" content="${escapeAttr(PAGE_DESCRIPTIONS[name])}">` +
    '<meta name="theme-color" content="#1E78D6">' +
    '<link rel="icon" type="image/png" sizes="192x192" href="./meter-icon-192.png">' +
    '<link rel="apple-touch-icon" href="./meter-icon-180.png">');
}
// Link previews (LINE, X and others) read these from the calculator page.
function sharePreview(html) {
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
  const description = html.match(/<meta name="description" content="([^"]+)">/)?.[0];
  if (!title || !description) throw new Error('Pages build: index.html has no title or description');
  const content = description.match(/content="([^"]+)"/)[1];
  return replaceOnce(html, description, [description,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="ポコメーター番長">',
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${content}">`,
    `<meta property="og:url" content="${PUBLIC_URL}">`,
    `<meta property="og:image" content="${PUBLIC_URL}meter-icon-512.png">`,
    '<meta name="twitter:card" content="summary">'].join('\n'));
}
// GitHub Pages serves this for unknown addresses under the publication.
export function notFoundPage() {
  const home = new URL(PUBLIC_URL).pathname;
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#1E78D6">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'">
<link rel="icon" type="image/png" sizes="192x192" href="${home}meter-icon-192.png">
<title>ページが見つかりません｜ポコメーター番長</title>
<style>
:root{color-scheme:dark;--bg:#080e19;--panel:#121d2c;--text:#f3f7ff;--sub:#c1cddd;--line:#43546c;--accent:#a1d8ff}
@media(prefers-color-scheme:light){:root{color-scheme:light;--bg:#f4f7fc;--panel:#fff;--text:#1b293d;--sub:#4d607a;--line:#b4c4d8;--accent:#12649a}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;line-height:1.7}
main{width:min(520px,100%);padding:24px 20px;border:1px solid var(--line);border-left:4px solid #2986ff;border-radius:12px;background:var(--panel)}
h1{margin:0 0 8px;font-size:1.3rem;line-height:1.5}
p{margin:8px 0;color:var(--sub)}
nav{display:grid;gap:10px;margin-top:18px}
a{display:flex;align-items:center;justify-content:center;min-height:48px;padding:8px 14px;border:1px solid var(--line);border-radius:8px;color:var(--accent);font-weight:700;text-decoration:none}
a:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
a.primary{background:#1E78D6;border-color:#1E78D6;color:#fff}
</style>
</head>
<body>
<main>
<h1>ページが見つかりません</h1>
<p>アドレスが変わったか、入力に誤りがある可能性があります。下のリンクから開き直してください。</p>
<nav aria-label="ポコメーター番長のページ">
<a class="primary" href="${home}">メーター計算を開く</a>
<a href="${home}border-history.html">過去のボーダー表</a>
<a href="${home}e-border.html">E帯のボーダー記録</a>
<a href="${home}calculation-methods.html">目標値の算出方法</a>
</nav>
</main>
</body>
</html>
`;
}

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
  return assertClean(sealCalculatorHTML(sharePreview(html)), 'index.html');
}

const SOURCE_VERSION = 'v2026.10.23.3';
function stampVersion(html, name, version) {
  if (!html.includes(SOURCE_VERSION)) throw new Error('Pages build: ' + name + ' has no source version to replace');
  return html.replaceAll(SOURCE_VERSION, version.version);
}

export function exportHistory(source, version = PAGES_VERSION) {
  const html = withPageHead(stampVersion(replaceOnce(source, BORDER_FETCH, BORDER_FETCH_PAGES), 'border-history.html', version), 'border-history.html');
  return assertClean(sealCalculatorHTML(html), 'border-history.html');
}

export function exportEBorder(source, version = PAGES_VERSION) {
  return assertClean(sealCalculatorHTML(withPageHead(stampVersion(source, 'e-border.html', version), 'e-border.html')), 'e-border.html');
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
    'calculation-methods.html': withPageHead(methods.replaceAll('href="/"', 'href="./"'), 'calculation-methods.html'),
    // A new tool version gets a new cache name, so installed copies refresh icons and pages.
    'meter-sw.js': replaceOnce(
      replaceOnce(exportWorker(worker), 'const FRESH_LAUNCH = false;', 'const FRESH_LAUNCH = true;'),
      "-github';", `-github-${PAGES_VERSION.version}';`),
    'meter.webmanifest': JSON.stringify(pagesManifest, null, 2) + '\n',
    'border-history.html': exportHistory(history),
    'e-border.html': exportEBorder(eBorder),
    'data/borders.json': borders,
    '404.html': notFoundPage(),
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
