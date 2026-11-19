// 公開物（GitHub Pages に出すファイル一式）の安全性を一括で検査する回帰テスト。
// ネットワーク不要。build-pages で一時フォルダーに公開物を作り、その中身だけを調べる。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, relative, extname} from 'node:path';
import {buildPages} from '../scripts/build-pages.mjs';

const out = await mkdtemp(join(tmpdir(), 'public-safety-'));
test.after(() => rm(out, {recursive: true, force: true}));
await buildPages({out});

const walk = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const files = walk(out).map(path => ({path, name: relative(out, path).split('\\').join('/')}));
const textFiles = files.filter(f => ['.html', '.js', '.json', '.webmanifest'].includes(extname(f.name)));
const read = f => readFileSync(f.path, 'utf8');
const htmlFiles = textFiles.filter(f => f.name.endsWith('.html'));
const pageFiles = htmlFiles.filter(f => f.name !== '404.html');
const byName = name => {
  const f = files.find(x => x.name === name);
  assert.ok(f, name + ' が公開物にありません');
  return read(f);
};
const csp = html => html.match(/<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*content="([^"]+)"/i)?.[1]
  ?? html.match(/<meta\b[^>]*content="([^"]+)"[^>]*http-equiv=["']Content-Security-Policy["']/i)?.[1];
const directive = (policy, name) => policy.split(';').map(s => s.trim().split(/\s+/)).find(([n]) => n === name)?.slice(1) ?? null;

test('公開物が作られ、検査対象のファイルがある', () => {
  for (const name of ['index.html', 'border-history.html', 'e-border.html', '404.html']) {
    assert.ok(files.some(f => f.name === name), name);
  }
  assert.ok(textFiles.some(f => f.name.startsWith('data/') && f.name.endsWith('.json')), 'data/*.json');
});

// 1. 旧Sites・個人情報・ローカル環境の痕跡が公開物に残っていない
const FORBIDDEN = ['chatgpt.site', 'freefreelife2000', 'pococha-comment-library', 'Pococha1012', 'localhost', 'OneDrive', 'C:\\Users', 'C:\\\\Users', '@gmail.com'];
test('1. 公開されるファイルに旧Sites・個人情報・ローカルパスの文字列がない', () => {
  const hits = [];
  for (const f of textFiles) {
    const text = read(f);
    for (const word of FORBIDDEN) {
      let at = text.indexOf(word), count = 0;
      const first = at;
      while (at !== -1) { count++; at = text.indexOf(word, at + word.length); }
      if (count) hits.push(`${f.name}: "${word}" ×${count}（例: …${text.slice(Math.max(0, first - 60), first + word.length + 60).replace(/\s+/g, ' ')}…）`);
    }
  }
  assert.deepEqual(hits, [], hits.join('\n'));
});

// 2. CSP と referrer の meta
test('2. 404 以外のすべての .html に CSP と referrer=no-referrer の meta がある', () => {
  const missing = [];
  for (const f of pageFiles) {
    const html = read(f);
    if (!csp(html)) missing.push(f.name + ': Content-Security-Policy');
    if (!/<meta\s+name=["']referrer["']\s+content=["']no-referrer["']\s*\/?>/i.test(html)) missing.push(f.name + ': referrer');
  }
  assert.deepEqual(missing, [], missing.join('\n'));
});

// 3. 非公式であることの表示
test('3. 404 以外のすべての .html に「非公式」の表示がある', () => {
  const missing = pageFiles.filter(f => !read(f).includes('非公式')).map(f => f.name);
  assert.deepEqual(missing, [], missing.join('\n'));
});

// 4. アクセス解析を読み込むページには告知がある
test('4. gc.zgo.at を読み込む .html には GoatCounter の告知がある', () => {
  const missing = htmlFiles.filter(f => {
    const html = read(f);
    return html.includes('gc.zgo.at') && !/アクセス数の集計に GoatCounter/.test(html.replace(/<script\b[\s\S]*?<\/script>/gi, ''));
  }).map(f => f.name);
  assert.deepEqual(missing, [], missing.join('\n'));
});

// 5. E帯ページは OCR（jsDelivr の WebAssembly）を使えるCSPになっている
test("5. e-border.html の CSP の script-src に https://cdn.jsdelivr.net と 'wasm-unsafe-eval' がある", () => {
  const policy = csp(byName('e-border.html'));
  assert.ok(policy, 'e-border.html に CSP がありません');
  const src = directive(policy, 'script-src');
  assert.ok(src, 'script-src がありません: ' + policy);
  assert.ok(src.includes('https://cdn.jsdelivr.net'), 'https://cdn.jsdelivr.net: ' + src.join(' '));
  assert.ok(src.includes("'wasm-unsafe-eval'"), "'wasm-unsafe-eval': " + src.join(' '));
});

// 6. 別タブで開くリンクは opener を渡さない
test('6. target="_blank" の a 要素はすべて rel に noopener を持つ', () => {
  const bad = [];
  for (const f of textFiles.filter(f => /\.(html|js)$/.test(f.name))) {
    const text = read(f);
    for (const m of text.matchAll(/<a\b[^>]*>/gi)) {
      const tag = m[0];
      if (!/target\s*=\s*\\?["']?_blank/i.test(tag)) continue;
      const rel = tag.match(/rel\s*=\s*\\?["']([^"'\\]*)/i)?.[1] ?? '';
      if (!/\bnoopener\b/i.test(rel)) bad.push(`${f.name}: ${tag.slice(0, 200)}`);
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

// 7. ボーダーの出典表示
test('7. index.html と border-history.html に「ONE CARAT」の出典がある', () => {
  const missing = ['index.html', 'border-history.html'].filter(name => !byName(name).includes('ONE CARAT'));
  assert.deepEqual(missing, [], missing.join('\n'));
});
