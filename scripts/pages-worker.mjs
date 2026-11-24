// 公開版（GitHub Pages）の Service Worker を、サブフォルダー配信（/poco-meter/）向けに書き換える。
// キャッシュ名の「-github」は配布済みの端末のキャッシュと合わせるため変えない。

function replaceOnce(source, from, to) {
  if (source.split(from).length !== 2) throw new Error(`Export source changed: ${from.slice(0, 85)}`);
  return source.replace(from, to);
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
  sw = replaceOnce(sw, 'if (canonicalURL && canonicalURL !== HOME) return false;',
    "if (canonicalURL && ![HOME, new URL('index.html', BASE).href].includes(canonicalURL)) return false;");
  sw = replaceOnce(sw, '<a href="/">もう一度開く</a>', '<a href="./">もう一度開く</a>');
  sw = replaceOnce(sw,
    'if (!event.source.url || new URL(event.source.url).origin !== self.location.origin) return;',
    "if (!event.source.url) return; const clientURL = new URL(event.source.url); if (clientURL.origin !== BASE.origin || ![BASE.pathname, new URL('index.html', BASE).pathname].includes(clientURL.pathname)) return;");
  return sw;
}
