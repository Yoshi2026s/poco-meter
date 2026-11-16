// Network-free coverage of the optional analytics in the publication only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildPages, exportCalculator, exportHistory, exportEBorder, exportMethods, GOATCOUNTER_CODE} from '../scripts/build-pages.mjs';
import {scriptSources} from '../lib/browser-security.mjs';

const pages = ['index.html', 'border-history.html', 'e-border.html', 'calculation-methods.html'];
const notice = 'アクセス数の集計に GoatCounter を使用しています（Cookie は使わず、個人を特定する情報は保存しません）。';
const origin = 'https://test-code.goatcounter.com';
const sources = Object.fromEntries(await Promise.all(pages.map(async name => [name, await readFile(new URL('../calculator/' + name, import.meta.url), 'utf8')])));
const exporters = {
  'index.html': (html, code) => exportCalculator(html, undefined, {goatcounter: code}),
  'border-history.html': (html, code) => exportHistory(html, undefined, {goatcounter: code}),
  'e-border.html': (html, code) => exportEBorder(html, undefined, {goatcounter: code}),
  'calculation-methods.html': (html, code) => exportMethods(html, {goatcounter: code}),
};
const policy = html => html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
const directives = text => Object.fromEntries(text.split(';').filter(s => s.trim()).map(s => {
  const [name, ...values] = s.trim().split(/\s+/);
  return [name, values];
}));

test('empty code adds no analytics; enabled builds change only the four pages', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pages-stats-'));
  try {
    const off = join(dir, 'off'), on = join(dir, 'on');
    const empty = await buildPages({out: off, goatcounter: ''});
    const enabled = await buildPages({out: on, goatcounter: 'test-code'});
    assert.deepEqual(enabled.files, empty.files);
    for (const name of empty.files) {
      const before = await readFile(join(off, name));
      const after = await readFile(join(on, name));
      if (!pages.includes(name)) {
        assert.deepEqual(after, before, name + ' stays unchanged (including SW and 404)');
        continue;
      }
      const plain = before.toString(), tracked = after.toString();
      assert.doesNotMatch(plain, /goatcounter|gc\.zgo\.at/i, name);
      assert.doesNotMatch(sources[name], /goatcounter|gc\.zgo\.at/i, name + ' source stays clean');
      assert.equal(exporters[name](sources[name], ''), plain);
      assert.equal(exporters[name](sources[name], 'test-code'), tracked);
      assert.equal(exporters[name](sources[name], undefined), exporters[name](sources[name], GOATCOUNTER_CODE));
      const tags = [...tracked.matchAll(/<script\b[^>]*data-goatcounter[^>]*><\/script>/g)];
      assert.equal(tags.length, 1, name);
      const tag = tags[0][0];
      assert.ok(tag.includes(`data-goatcounter="${origin}/count"`));
      assert.match(tag, / async src="https:\/\/gc\.zgo\.at\/count\.v5\.js"/);
      assert.match(tag, /crossorigin="anonymous"/);
      assert.ok(tag.includes('integrity="sha384-atnOLvQb9t+jTSipvd75X2yginT4PjVbqDdlJAmxMm+wYElFmeR6EmLP5bYeoRVQ"'));
      assert.ok(tracked.includes(tag + '\n</body>'));
      assert.doesNotMatch(tag, /data-goatcounter-settings|allow_local|allow_frame/);
      assert.equal(scriptSources(tracked), scriptSources(plain), name + ' inline scripts unchanged');
      const oldPolicy = policy(plain), newPolicy = policy(tracked);
      if (oldPolicy) {
        const expected = directives(oldPolicy);
        expected['script-src'].push('https://gc.zgo.at');
        expected['connect-src'].push(origin);
        expected['img-src'].push(origin);
        assert.deepEqual(directives(newPolicy), expected, name + ' minimal CSP additions');
      } else {
        assert.equal(name, 'calculation-methods.html');
        assert.equal(newPolicy, undefined, 'no new CSP on methods page');
      }
      assert.equal(tracked.split(notice).length - 1, name === 'index.html' ? 1 : 0);
      if (name === 'index.html') assert.match(tracked, /<p id="toolDisclaimerText">[^<]*GoatCounter[^<]*<\/p>/);
      // Full output comparison also protects referrer metadata, storage and URL/hash handling.
      let restored = tracked.replace(tag + '\n', '').replace(notice, '');
      if (oldPolicy) restored = restored.replace(newPolicy, oldPolicy);
      assert.equal(restored, plain, name + ' all other bytes unchanged');
    }
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('invalid codes fail before changing existing build output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pages-stats-invalid-'));
  try {
    await writeFile(join(dir, 'keep.txt'), 'keep');
    for (const code of ['Acode', 'a', 'a'.repeat(51), 'a_b', 'a.b', ' code', 'code ', 'a/b', '<script>', 'ab\n', null, 42, {}]) {
      await assert.rejects(buildPages({out: dir, goatcounter: code}), /invalid GoatCounter/);
      for (const name of pages) assert.throws(() => exporters[name](sources[name], code), /invalid GoatCounter/);
    }
    assert.equal(await readFile(join(dir, 'keep.txt'), 'utf8'), 'keep');
    for (const code of ['ab', 'a'.repeat(50), 'valid-code-12']) {
      assert.ok(exportMethods(sources['calculation-methods.html'], {goatcounter: code}).includes(`https://${code}.goatcounter.com/count`));
    }
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('missing or repeated injection anchors fail instead of silently losing or duplicating analytics', () => {
  for (const name of pages) {
    const run = html => exporters[name](html, 'test-code');
    assert.throws(() => run(sources[name].replace('</body>', '')), /source changed near/);
    assert.throws(() => run(sources[name].replace('</body>', '</body></body>')), /source changed near/);
    assert.throws(() => run(sources[name].replace('</body>', '<script src="https://gc.zgo.at/count.js"></script></body>')), /already contains GoatCounter/);
  }
  assert.throws(() => exportCalculator(sources['index.html'].replace('id="toolDisclaimerText"', 'id="missing"'), undefined, {goatcounter: 'test-code'}), /expected one calculator disclaimer/);
});

test('a future CSP on the methods page is widened without changing other directives', () => {
  const csp = "default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'";
  const source = sources['calculation-methods.html'].replace('<meta charset="utf-8">', `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">`);
  const expected = directives(csp);
  expected['script-src'].push('https://gc.zgo.at');
  expected['connect-src'].push(origin);
  expected['img-src'].push(origin);
  assert.deepEqual(directives(policy(exportMethods(source, {goatcounter: 'test-code'}))), expected);
});
