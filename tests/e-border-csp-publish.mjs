// 公開版の E帯ページで画像読み取り（OCR）に必要な script-src が残ること、
// メーター画面（index.html）の script-src が広がらないことを確かめる。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildPages} from '../scripts/build-pages.mjs';
import {sealCalculatorHTML, scriptSources} from '../lib/browser-security.mjs';

const scriptSrc = html => {
  const policy = html.match(/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/i)?.[1] ?? '';
  const matches = [...policy.matchAll(/(?:^|;)\s*script-src\s+([^;]+)/g)];
  assert.equal(matches.length, 1, 'script-src は1つだけ');
  return matches[0][1].trim().split(/\s+/);
};

test('公開版の e-border.html は OCR 用の送信元を残し、index.html は広がらない', async () => {
  const out = await mkdtemp(join(tmpdir(), 'poco-e-border-csp-'));
  try {
    await buildPages({out});
    const eBorder = await readFile(join(out, 'e-border.html'), 'utf8');
    const eSources = scriptSrc(eBorder);
    assert.ok(eSources.includes('https://cdn.jsdelivr.net'), 'e-border: cdn.jsdelivr.net');
    assert.ok(eSources.includes("'wasm-unsafe-eval'"), "e-border: 'wasm-unsafe-eval'");
    assert.ok(!eSources.includes("'unsafe-inline'"), "e-border: 'unsafe-inline' は付けない");
    for (const hash of scriptSources(eBorder).split(' ').filter(Boolean)) assert.ok(eSources.includes(hash), 'e-border hash');

    const index = await readFile(join(out, 'index.html'), 'utf8');
    const iSources = scriptSrc(index);
    assert.ok(!iSources.some(item => item.includes('cdn.jsdelivr.net')), 'index: cdn.jsdelivr.net を含まない');
    assert.ok(!iSources.includes("'wasm-unsafe-eval'"), "index: 'wasm-unsafe-eval' を含まない");
    assert.ok(!iSources.includes("'unsafe-inline'"), "index: 'unsafe-inline' を含まない");
  } finally {
    await rm(out, {recursive: true, force: true});
  }
});

test('sealCalculatorHTML は古いハッシュ・全許可を捨て、個別の送信元だけを残す', () => {
  const html = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'sha256-old=' 'nonce-x' * https: https://cdn.jsdelivr.net 'wasm-unsafe-eval' https://cdn.jsdelivr.net; style-src 'unsafe-inline'"><script>run()</script>`;
  const sealed = sealCalculatorHTML(html);
  const sources = sealed.match(/script-src\s+([^;]+);/)[1].split(' ');
  assert.deepEqual(sources, [scriptSources(html), 'https://cdn.jsdelivr.net', "'wasm-unsafe-eval'"]);
  assert.ok(sealed.includes("style-src 'unsafe-inline'"), 'style-src はそのまま');
  const onlyHashes = `<meta http-equiv="Content-Security-Policy" content="script-src 'sha256-old=';"><script>run()</script>`;
  assert.equal(sealCalculatorHTML(onlyHashes).match(/script-src\s+([^;]+);/)[1], scriptSources(onlyHashes));
});
