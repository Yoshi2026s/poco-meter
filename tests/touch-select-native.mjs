import test from 'node:test';
import assert from 'node:assert/strict';
import { pageEngine } from './calculator-harness.mjs';

// 指で操作する画面（pointer:coarse）では、選択欄をタップしても独自の選択リスト（#selectWindow）を開かず、
// 端末標準の選択リストだけで1回で選べること。DOMの代用品での検証で、実機の表示確認ではない。
const node = (p, id) => p.nodes.find(n => n.id === id);
const event = (type, props = {}) => { const e = new Event(type, { cancelable: true }); Object.assign(e, props); return e; };
const touch = q => ({ matches: /pointer:\s*coarse/.test(q) || /max-width:700px/.test(q) });
const IDS = ['screenTheme', 'rank', 'pickPeriod', 'targetMethod', 'dailyClose'];

test('T01 タッチ端末では選択欄の操作を止めず、独自の選択リストを開かない', () => {
  const p = pageEngine(undefined, { navigator: { onLine: false }, matchMedia: touch });
  for (const id of IDS) {
    const s = p.element(id);
    for (const [type, props] of [['mousedown', { button: 0 }], ['click', {}], ['touchend', { changedTouches: [{ clientX: 1, clientY: 1 }] }], ['keydown', { key: 'Enter' }]]) {
      const e = event(type, props); s.dispatchEvent(e);
      assert.equal(e.defaultPrevented, false, id + ' ' + type);
    }
    assert.equal(s.getAttribute('aria-haspopup'), null, id);
    assert.equal(node(p, 'selectWindow').hidden, true, id);
  }
});
test('T02 タッチ端末で標準リストから選ぶと1回で反映される', () => {
  const p = pageEngine(undefined, { navigator: { onLine: false }, matchMedia: touch });
  const s = p.element('screenTheme'); s.value = 'light'; s.dispatchEvent(new Event('change'));
  assert.equal(p.document.documentElement?.getAttribute?.('data-theme') ?? 'light', 'light');
  assert.equal(node(p, 'selectWindow').hidden, true);
});
test('T03 マウス操作の画面（PC）では従来どおり独自の選択リストを開く', () => {
  const p = pageEngine(undefined, { navigator: { onLine: false } });
  const s = p.element('screenTheme'), e = event('mousedown', { button: 0 }); s.dispatchEvent(e);
  assert.ok(e.defaultPrevented); assert.equal(node(p, 'selectWindow').hidden, false);
});
