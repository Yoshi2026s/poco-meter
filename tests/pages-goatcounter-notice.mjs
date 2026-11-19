// Every page that loads GoatCounter in the publication also tells visitors about it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {exportCalculator, exportHistory, exportEBorder, exportMethods} from '../scripts/build-pages.mjs';

const notice = 'アクセス数の集計に GoatCounter を使用しています';
const exporters = {
  'index.html': (html, code) => exportCalculator(html, undefined, {goatcounter: code}),
  'border-history.html': (html, code) => exportHistory(html, undefined, {goatcounter: code}),
  'e-border.html': (html, code) => exportEBorder(html, undefined, {goatcounter: code}),
  'calculation-methods.html': (html, code) => exportMethods(html, {goatcounter: code}),
};
const count = (text, part) => text.split(part).length - 1;

for (const [name, exporter] of Object.entries(exporters)) {
  test(name + ': GoatCounter notice appears once when tracked, never when disabled', async () => {
    const source = await readFile(new URL('../calculator/' + name, import.meta.url), 'utf8');
    const tracked = exporter(source, 'test-code');
    const plain = exporter(source, '');
    assert.equal(count(tracked, notice), 1, name + ' notice once');
    assert.equal(count(tracked, 'GoatCounter'), 1, name + ' visible GoatCounter mention once');
    assert.equal(count(plain, notice), 0, name + ' no notice without analytics');
    if (name === 'index.html') {
      assert.match(tracked, /<p id="toolDisclaimerText">[^<]*GoatCounter[^<]*<\/p>/);
    } else {
      // Bottom of the page, directly inside the creator footer, ahead of the logo.
      assert.match(tracked, /<div class="tool-creator-footer"[^>]*><p class="goatcounter-notice"[^>]*>アクセス数の集計に GoatCounter[^<]*<\/p><span class="tool-creator-logo"/);
    }
  });
}
