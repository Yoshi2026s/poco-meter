// Network-free check: every public page of the Pages build carries its own share preview (OGP),
// and the not-found page carries none.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildPages, withPageHead, PUBLIC_URL} from '../scripts/build-pages.mjs';

const PAGES = {
  'index.html': PUBLIC_URL,
  'border-history.html': PUBLIC_URL + 'border-history.html',
  'e-border.html': PUBLIC_URL + 'e-border.html',
  'calculation-methods.html': PUBLIC_URL + 'calculation-methods.html',
};
const count = (text, pattern) => (text.match(pattern) || []).length;
const attr = (text, re) => text.match(re)?.[1];

test('each public page has one set of OGP tags pointing at its own address', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'poco-ogp-'));
  try {
    await buildPages({out: dir});
    for (const [name, url] of Object.entries(PAGES)) {
      const page = await readFile(join(dir, name), 'utf8');
      for (const property of ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:url', 'og:image']) {
        assert.equal(count(page, new RegExp(`<meta property="${property}" content="[^"]+">`, 'g')), 1, name + ' ' + property);
      }
      assert.equal(count(page, /<meta name="twitter:card" content="summary">/g), 1, name + ' twitter:card');
      assert.equal(attr(page, /<meta property="og:url" content="([^"]+)">/), url, name + ' og:url');
      assert.equal(attr(page, /<meta property="og:image" content="([^"]+)">/), PUBLIC_URL + 'meter-icon-512.png', name + ' og:image');
      assert.equal(attr(page, /<meta property="og:title" content="([^"]+)">/), attr(page, /<title>([^<]+)<\/title>/), name + ' og:title');
      assert.equal(attr(page, /<meta property="og:description" content="([^"]+)">/), attr(page, /<meta name="description" content="([^"]+)">/), name + ' og:description');
    }
    const missing = await readFile(join(dir, '404.html'), 'utf8');
    assert.doesNotMatch(missing, /og:|twitter:card/);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('the page head refuses a source that already declares OGP tags', () => {
  const source = '<!doctype html><html><head><meta charset="utf-8"><meta property="og:title" content="x"><title>x｜ポコメーター番長</title></head></html>';
  assert.throws(() => withPageHead(source, 'e-border.html'), /already declares og: tags/);
});
