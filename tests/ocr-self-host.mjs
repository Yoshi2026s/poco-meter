// E帯の画像読取（tesseract.js）は外部CDNを使わず、同梱したファイルだけを使う。
// 同梱ファイルのバイト列は calculator/ocr/NOTICE.md の SHA-256 と一致すること（改ざん・取り違えの検出）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildPages, OCR_FILES} from '../scripts/build-pages.mjs';

const root = new URL('../', import.meta.url);
const sha = buf => createHash('sha256').update(buf).digest('base64');
const PINNED = {
  'tesseract.min.js': 'EP/3hIQGd1nEMCigKnLXbQuQ6xcwK7I7WKnsVBC8kos=',
  'worker.min.js': 'OGRVmQQyOcDrbbCKZQSpLc3CkiAFNfPpM5zXfERDuEI=',
  'tesseract-core-lstm.wasm.js': 'd1o1328q4QDgJglEPmvVyvzQeYPdYXVFTKSkMqdzBoc=',
  'tesseract-core-simd-lstm.wasm.js': 'nXxD+yBtyfSEdSKLRr81+Ij6nmJZ2i5n1adcdwSfLcc=',
  'jpn.traineddata.gz': 'W3ZCFWiWzNs5rqg9tiON2FyPuhTg3ZKtfbKQmL8Ofd0=',
};

test('O01 同梱ファイルは固定したハッシュと一致し、NOTICE.md の表とも一致する', async () => {
  assert.deepEqual([...OCR_FILES].sort(), Object.keys(PINNED).sort());
  const notice = await readFile(new URL('calculator/ocr/NOTICE.md', root), 'utf8');
  for (const [name, hash] of Object.entries(PINNED)) {
    assert.equal(sha(await readFile(new URL('calculator/ocr/' + name, root))), hash, name);
    assert.ok(notice.includes(`| ${name} |`) && notice.includes(hash), 'NOTICE.md: ' + name);
  }
  // tesseract.min.js は読み込み時の SRI（sha384）でも確かめる。
  const ui = await readFile(new URL('calculator/e-border-ui.mjs', root), 'utf8');
  const sri = ui.match(/script\.integrity='(sha384-[^']+)'/)?.[1];
  assert.equal(sri, 'sha384-' + createHash('sha384').update(await readFile(new URL('calculator/ocr/tesseract.min.js', root))).digest('base64'));
});

test('O02 画面は同じサイトの ./ocr だけを使い、外部の配信元を参照しない', async () => {
  for (const file of ['calculator/e-border-ui.mjs', 'calculator/e-border-template.html', 'calculator/e-border.html', 'scripts/prepare-e-border.mjs']) {
    const text = await readFile(new URL(file, root), 'utf8');
    assert.doesNotMatch(text, /cdn\.jsdelivr\.net|tessdata\.projectnaptha\.com/, file);
  }
  const ui = await readFile(new URL('calculator/e-border-ui.mjs', root), 'utf8');
  assert.match(ui, /script\.src='\.\/ocr\/tesseract\.min\.js'/);
  assert.match(ui, /workerPath:ocrURL\('\.\/ocr\/worker\.min\.js'\),workerBlobURL:false,corePath:ocrURL\('\.\/ocr'\),langPath:ocrURL\('\.\/ocr'\)/);
  assert.match(ui, /function ocrURL\(path\)\{const base=globalThis\.location\?\.href;return base\?new URL\(path,base\)\.href:path;\}/);
});

test('O03 公開物の ocr/ は同梱ファイルとバイト単位で同じ', async () => {
  const out = await mkdtemp(join(tmpdir(), 'poco-ocr-'));
  try {
    const {files} = await buildPages({out});
    for (const name of OCR_FILES) {
      assert.ok(files.includes('ocr/' + name), name);
      assert.equal(sha(await readFile(join(out, 'ocr', name))), PINNED[name], 'published ' + name);
    }
  } finally { await rm(out, {recursive: true, force: true}); }
});
