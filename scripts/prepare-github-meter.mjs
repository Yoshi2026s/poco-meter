import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { manifest, iconData } from '../calculator/offline-assets.mjs';
import {prepareEBorder} from './prepare-e-border.mjs';
import {prepareHistoryPage} from './prepare-history-page.mjs';
import {sealCalculatorHTML} from '../lib/browser-security.mjs';
import {COLLECTOR_ORIGIN} from './security-tools.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const SITE_URL = 'https://poco-meter.freefreelife2000.chatgpt.site';
export const REPOSITORY = 'pococha2026/pococha2026.github.io';
export const FILE_NAMES = ['index.html', 'calculation-methods.html', 'meter-sw.js',
  'meter.webmanifest', 'meter-icon-180.png', 'meter-icon-192.png', 'meter-icon-512.png', 'border-history.html'];

function replaceOnce(source, from, to) {
  if (source.split(from).length !== 2) throw new Error(`Export source changed: ${from.slice(0, 85)}`);
  return source.replace(from, to);
}

export function exportHTML(source) {
  let html = replaceOnce(source, '<!-- sites-host-context -->', '<!-- GitHub static publication: administration remains on Sites. -->');
  html = replaceOnce(html, `connect-src 'self' ${COLLECTOR_ORIGIN};`, `connect-src 'self' ${COLLECTOR_ORIGIN} ${SITE_URL};`);
  html = replaceOnce(html, 'href="/meter.webmanifest"', 'href="./meter.webmanifest"');
  html = replaceOnce(html, 'href="/meter-icon-180.png"', 'href="./meter-icon-180.png"');
  html = html.replaceAll('href="/border-history"', 'href="./border-history.html"');
  html = replaceOnce(html, 'href="/calculation-methods"', 'href="./calculation-methods.html"');
  html = replaceOnce(html,
    "fetch('/api/borders',{cache:'no-cache',credentials:'same-origin',signal:controller.signal})",
    `fetch('${SITE_URL}/api/borders',{cache:'no-cache',credentials:'omit',signal:controller.signal})`);
  html = replaceOnce(html,
    "fetch('/api/pococha-time',{cache:'no-store',credentials:'same-origin',signal:controller.signal})",
    `fetch('${SITE_URL}/api/pococha-time',{cache:'no-store',credentials:'omit',signal:controller.signal})`);
  html = replaceOnce(html,
    "navigator.serviceWorker.register('/meter-sw.js',{scope:'/',updateViaCache:'none'})",
    "navigator.serviceWorker.register('./meter-sw.js',{scope:'./',updateViaCache:'none'})");
  // Public Pages has no private contact session. The shared access collector
  // remains in its own script on both publications. Keep the
  // existing contact entry, pointing to the authenticated-capable Sites form.
  if (/id="toolContact"|id="contactForm"/.test(html))throw new Error('Individual contact panel must be removed');
  if (/<meta\b[^>]*name="pococha-sites-origin"/i.test(html) || /fetch\(['"]\/api\//.test(html)) {
    throw new Error('Static export contains a Sites context or local API writer');
  }
  return sealCalculatorHTML(html);
}

export function exportWorker(source) {
  let sw = replaceOnce(source, "const CACHE_PREFIX = 'pococha-meter-shell-';",
    "const BASE = new URL(self.registration.scope);\nconst CACHE_PREFIX = 'pococha-meter-shell-' + encodeURIComponent(BASE.pathname) + '-';");
  let versions = 0;
  sw = sw.replace(/const CACHE_NAME = CACHE_PREFIX \+ '(v\d+)';/, (_, version) => {
    versions++; return `const CACHE_NAME = CACHE_PREFIX + '${version}-github';`;
  });
  if (versions !== 1) throw new Error('Expected one worker cache version');
  sw = replaceOnce(sw, "const HOME = new URL('/', self.location.origin).href;", 'const HOME = BASE.href;');
  sw = replaceOnce(sw, "const HISTORY_PATH = '/border-history';", "const HISTORY_PATH = new URL('border-history.html', BASE).pathname;");
  sw = replaceOnce(sw, "const METHOD_PATH = '/calculation-methods';", "const METHOD_PATH = new URL('calculation-methods.html', BASE).pathname;");
  sw = replaceOnce(sw,
    "const ASSETS = ['/meter.webmanifest', '/meter-icon-192.png', '/meter-icon-512.png', '/meter-icon-180.png', METHOD_PATH, HISTORY_PATH];",
    "const ASSETS = ['meter.webmanifest', 'meter-icon-192.png', 'meter-icon-512.png', 'meter-icon-180.png'].map(path => new URL(path, BASE).pathname).concat(METHOD_PATH, HISTORY_PATH);");
  sw = replaceOnce(sw, "url.pathname === '/' && !url.search && request.mode === 'navigate';",
    "[BASE.pathname, new URL('index.html', BASE).pathname].includes(url.pathname) && !url.search && request.mode === 'navigate';");
  sw = replaceOnce(sw, 'if (response.url && response.url !== HOME) return false;',
    "if (response.url && ![HOME, new URL('index.html', BASE).href].includes(response.url)) return false;");
  sw = replaceOnce(sw, '<a href="/">もう一度開く</a>', '<a href="./">もう一度開く</a>');
  sw = replaceOnce(sw,
    'if (!event.source.url || new URL(event.source.url).origin !== self.location.origin) return;',
    "if (!event.source.url) return; const clientURL = new URL(event.source.url); if (clientURL.origin !== BASE.origin || ![BASE.pathname, new URL('index.html', BASE).pathname].includes(clientURL.pathname)) return;");
  return sw;
}

export function exportHistoryHTML(source) {
  let html = replaceOnce(source, "connect-src 'self';", `connect-src 'self' ${SITE_URL};`);
  html = replaceOnce(html,
    "fetch('/api/borders',{cache:'no-cache',credentials:'same-origin',signal:controller.signal})",
    `fetch('${SITE_URL}/api/borders',{cache:'no-cache',credentials:'omit',signal:controller.signal})`);
  if (/fetch\(['"]\/api\//.test(html)) throw new Error('Static history export contains a local API request');
  return sealCalculatorHTML(html);
}

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function prepareGithubMeter(root = ROOT) {
  await prepareHistoryPage();
  await prepareEBorder();
  const [html, methods, worker, history] = await Promise.all([
    readFile(resolve(root, 'calculator/index.html'), 'utf8'),
    readFile(resolve(root, 'calculator/calculation-methods.html'), 'utf8'),
    readFile(resolve(root, 'calculator/sw.js'), 'utf8'),
    readFile(resolve(root, 'calculator/border-history.html'), 'utf8'),
  ]);
  if ((methods.match(/href="\/"/g) || []).length !== 2) throw new Error('Expected two help return links');
  const githubManifest = structuredClone(manifest);
  githubManifest.id = githubManifest.start_url = githubManifest.scope = './';
  githubManifest.icons.forEach(icon => { icon.src = './' + icon.src.replace(/^\//, ''); });
  const content = [
    Buffer.from(exportHTML(html)), Buffer.from(methods.replaceAll('href="/"', 'href="./"')),
    Buffer.from(exportWorker(worker)), Buffer.from(JSON.stringify(githubManifest, null, 2) + '\n'),
    ...['180', '192', '512'].map(size => Buffer.from(iconData[size], 'base64')),
    Buffer.from(exportHistoryHTML(history)),
  ];
  const files = FILE_NAMES.map((name, i) => ({ path: 'poco-meter/' + name, encoding: 'base64',
    content: content[i].toString('base64'), sha256: hash(content[i]) }));
  const release = { schema: 'pococha-meter-github-v1', repository: REPOSITORY,
    directory: 'poco-meter', site_url: SITE_URL,
    release_hash: hash(files.map(file => `${file.path}\n${file.sha256}\n`).join('')), files };
  const output = resolve(root, 'github-sync/generated/poco-meter');
  await mkdir(output, { recursive: true });
  await Promise.all(FILE_NAMES.map((name, i) => writeFile(resolve(output, name), content[i])));
  const generated = resolve(root, 'github-sync/release.generated.json');
  await mkdir(dirname(generated), { recursive: true });
  await writeFile(generated, JSON.stringify(release) + '\n');
  return release;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await prepareGithubMeter();
  console.log(JSON.stringify({ repository: result.repository, release_hash: result.release_hash,
    files: result.files.map(({ path, sha256 }) => ({ path, sha256 })) }));
}
