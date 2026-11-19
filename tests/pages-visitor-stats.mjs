// Network-free coverage of the optional analytics in the publication only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {buildPages, exportCalculator, exportHistory, exportEBorder, exportMethods, GOATCOUNTER_CODE, GOATCOUNTER_FOOTER} from '../scripts/build-pages.mjs';
import {scriptSources} from '../lib/browser-security.mjs';

const pages = ['index.html', 'border-history.html', 'e-border.html', 'calculation-methods.html'];
const notice = 'アクセス数の集計に GoatCounter を使用しています（Cookie は使わず、個人を特定する情報は保存しません）。日別の重複を避けるため、この集計用には日付だけをこのブラウザーに保存します。';
const origin = 'https://test-code.goatcounter.com';
const helperName = 'goatcounter-site-visit.js';
const helper = await readFile(new URL('../scripts/' + helperName, import.meta.url), 'utf8');
const helperIntegrity = 'sha384-' + createHash('sha384').update(helper).digest('base64');
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

test('empty code adds no analytics; enabled builds add only the four page tags and helper', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pages-stats-'));
  try {
    const off = join(dir, 'off'), on = join(dir, 'on');
    const empty = await buildPages({out: off, goatcounter: ''});
    const enabled = await buildPages({out: on, goatcounter: 'test-code'});
    assert.deepEqual(enabled.files, [...empty.files, helperName].sort());
    assert.equal(await readFile(join(on, helperName), 'utf8'), helper);
    await assert.rejects(readFile(join(off, helperName)), {code: 'ENOENT'});
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
      const helperTag = `<script defer src="./${helperName}" integrity="${helperIntegrity}"></script>`;
      assert.equal(tracked.split(helperTag).length - 1, 1, name + ' helper exactly once');
      assert.ok(tracked.includes(tag + '\n' + helperTag + '\n</body>'));
      assert.doesNotMatch(tag, /data-goatcounter-settings|allow_local|allow_frame/);
      assert.equal(scriptSources(tracked), scriptSources(plain), name + ' inline scripts unchanged');
      const oldPolicy = policy(plain), newPolicy = policy(tracked);
      if (oldPolicy) {
        const expected = directives(oldPolicy);
        if (!expected['script-src'].includes("'self'")) expected['script-src'].push("'self'");
        expected['script-src'].push('https://gc.zgo.at');
        expected['connect-src'].push(origin);
        expected['img-src'].push(origin);
        assert.deepEqual(directives(newPolicy), expected, name + ' minimal CSP additions');
      } else {
        assert.fail(name + ' must carry its own CSP');
      }
      // 計測している全ページに同じ告知を1回だけ出す（index は免責の中、他は制作者ロゴの直前）。
      assert.equal(tracked.split(notice).length - 1, 1, name + ' analytics notice once');
      if (name === 'index.html') assert.match(tracked, /<p id="toolDisclaimerText">[^<]*GoatCounter[^<]*<\/p>/);
      // Full output comparison also protects referrer metadata, storage and URL/hash handling.
      let restored = tracked.replace(tag + '\n' + helperTag + '\n', '');
      restored = name === 'index.html' ? restored.replace(notice, '').replace('<br>' + GOATCOUNTER_FOOTER, '') : restored.replace(/<p class="goatcounter-notice"[^>]*>[^<]*<\/p>/, '');
      if (name === 'index.html') assert.equal(tracked.split(GOATCOUNTER_FOOTER).length - 1, 1, 'index footer analytics line once');
      if (oldPolicy) restored = restored.replace(newPolicy, oldPolicy);
      assert.equal(restored, plain, name + ' all other bytes unchanged');
    }
  } finally { await rm(dir, {recursive: true, force: true}); }
});

const dailyKey = 'poco-meter-daily-visit-v1';
function browserState() {
  return {now: Date.parse('2026-11-16T15:01:00Z'), storage: new Map(), calls: [], tail: Promise.resolve()};
}
function runtime(options = {}, shared = browserState()) {
  const settings = {loaded: true, visible: true, queued: true, ...options};
  const tracker = Object.assign(new EventTarget(), {dataset: {}});
  const document = Object.assign(new EventTarget(), {
    visibilityState: settings.visible ? 'visible' : 'hidden', prerendering: !!settings.prerender,
    querySelector: () => settings.missingTag ? null : tracker,
  });
  const counter = {
    filter: () => settings.filtered || false,
    url: data => {
      if (settings.failure) throw new Error('counter unavailable');
      return 'https://test-code.goatcounter.com/count?' + new URLSearchParams({p: data.path, t: data.title, e: data.event});
    },
  };
  const window = Object.assign(new EventTarget(), {goatcounter: settings.loaded ? counter : undefined});
  const navigator = {
    onLine: !settings.offline,
    locks: settings.noLocks ? undefined : {request: (name, fn) => {
      assert.equal(name, dailyKey);
      const task = shared.tail.then(() => {
        if (settings.lockFailure) throw new Error('locks unavailable');
        return fn();
      });
      shared.tail = task.catch(() => {});
      return task;
    }},
    sendBeacon: settings.noBeacon ? undefined : url => {
      if (settings.beaconThrows) throw new Error('queue rejected');
      if (settings.queued) shared.calls.push(new URL(url));
      return settings.queued;
    },
  };
  const storage = {
    getItem: key => { if (settings.readFailure) throw new Error('storage denied'); return shared.storage.get(key) ?? null; },
    setItem: (key, value) => {
      if (settings.writeFailure) throw new Error('storage full');
      if (!settings.silentWriteFailure) shared.storage.set(key, value);
    },
    removeItem: key => shared.storage.delete(key),
  };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [shared.now])); }
    static now() { return shared.now; }
  }
  const timers = new Map(); let serial = 0;
  const context = vm.createContext({document, window, navigator, localStorage: storage, URL, Date: Clock,
    setTimeout: (fn, delay) => { timers.set(++serial, {fn, delay}); return serial; },
    clearTimeout: id => timers.delete(id),
  });
  const run = () => vm.runInContext(helper, context);
  const load = () => { window.goatcounter = counter; tracker.dispatchEvent(new Event('load')); };
  const show = () => { document.visibilityState = 'visible'; document.dispatchEvent(new Event('visibilitychange')); };
  const settle = async () => { await shared.tail; await Promise.resolve(); };
  const fireTimer = () => { const [id, timer] = [...timers][0]; timers.delete(id); timer.fn(); };
  return {shared, settings, timers, document, window, navigator, run, load, show, settle, fireTimer};
}

test('four pages and reloads send only one daily event; normal page tracking stays unchanged', async () => {
  const shared = browserState();
  shared.storage.set('pococha-meter-calc-v1', 'existing user data');
  for (const name of pages) {
    const rt = runtime({}, shared);
    rt.run(); rt.run(); rt.load(); rt.show(); await rt.settle();
    assert.equal(shared.calls.length, 1, name);
    const html = exporters[name](sources[name], 'test-code');
    assert.doesNotMatch(html.match(/<script\b[^>]*data-goatcounter[^>]*>/)[0], /no_onload|no_session|allow_local/);
  }
  assert.deepEqual(Object.fromEntries(shared.calls[0].searchParams), {
    p: 'site-visitor-daily', t: 'サイト全体の訪問者数（1日・日本時間）', e: 'true', ns: 'true',
  });
  assert.deepEqual([...shared.storage], [['pococha-meter-calc-v1', 'existing user data'], [dailyKey, '2026-11-17']]);
  assert.doesNotMatch(helper, /document\.cookie|randomUUID|sessionStorage/);
});

test('concurrent tabs and a return after more than eight hours still count once that day', async () => {
  const shared = browserState();
  const tabs = Array.from({length: 32}, () => runtime({}, shared));
  tabs.forEach(rt => rt.run()); await tabs[31].settle();
  assert.equal(shared.calls.length, 1);
  shared.now += 23 * 3600000;
  const reopened = runtime({}, shared);
  reopened.run(); await reopened.settle();
  assert.equal(shared.calls.length, 1);
  assert.equal(shared.storage.get(dailyKey), '2026-11-17');
});

test('Japanese midnight counts a new day even within eight hours and on an already-open page', async () => {
  const rt = runtime();
  rt.shared.now = Date.parse('2026-11-17T14:59:59.950Z');
  rt.run(); await rt.settle();
  assert.equal(rt.shared.storage.get(dailyKey), '2026-11-17');
  assert.equal([...rt.timers.values()][0].delay, 100);
  rt.shared.now += 200;
  rt.fireTimer(); await rt.settle();
  assert.equal(rt.shared.storage.get(dailyKey), '2026-11-18');
  assert.equal(rt.shared.calls.length, 2);
  assert.ok(rt.shared.calls.every(url => url.searchParams.get('ns') === 'true'));
  rt.show(); await rt.settle();
  assert.equal(rt.shared.calls.length, 2);
  assert.equal(rt.timers.size, 1);
  // A backward clock correction must not re-count the previous day.
  rt.shared.now -= 3600000; rt.show(); await rt.settle();
  assert.equal(rt.shared.calls.length, 2);
});

test('CDN order, hidden tabs and prerender wait for readiness and visibility', async () => {
  for (const loadFirst of [false, true]) {
    const rt = runtime({loaded: false, visible: false});
    rt.run(); await rt.settle();
    assert.equal(rt.timers.size, 0, 'no CDN polling');
    if (loadFirst) rt.load(); else rt.show();
    await rt.settle(); assert.equal(rt.shared.calls.length, 0);
    if (loadFirst) rt.show(); else rt.load();
    await rt.settle(); assert.equal(rt.shared.calls.length, 1);
  }
  const rt = runtime({prerender: true});
  rt.run(); rt.show(); await rt.settle();
  assert.equal(rt.shared.calls.length, 0);
  rt.document.prerendering = false;
  rt.document.dispatchEvent(new Event('prerenderingchange')); await rt.settle();
  assert.equal(rt.shared.calls.length, 1);
});

test('hidden midnight, offline recovery and back-forward cache count only when visible and online', async () => {
  const rt = runtime({offline: true});
  rt.run(); await rt.settle();
  assert.equal(rt.shared.storage.has(dailyKey), false);
  rt.navigator.onLine = true; rt.window.dispatchEvent(new Event('online')); await rt.settle();
  assert.equal(rt.shared.calls.length, 1);
  rt.document.visibilityState = 'hidden'; rt.shared.now += 86400000;
  rt.fireTimer(); await rt.settle();
  assert.equal(rt.shared.calls.length, 1);
  rt.show(); await rt.settle(); assert.equal(rt.shared.calls.length, 2);
  rt.window.dispatchEvent(new Event('pagehide')); assert.equal(rt.timers.size, 0);
  rt.shared.now += 86400000;
  rt.window.dispatchEvent(new Event('pageshow')); await rt.settle();
  assert.equal(rt.shared.calls.length, 3);
});

test('self exclusion, unavailable APIs and storage failures do not send or claim a daily visit', async () => {
  for (const settings of [{loaded: false}, {missingTag: true}, {failure: true}, {filtered: 'disabled with #toggle-goatcounter'},
    {filtered: 'localhost'}, {filtered: 'frame'}, {noLocks: true}, {lockFailure: true}, {noBeacon: true},
    {readFailure: true}, {writeFailure: true}, {silentWriteFailure: true}]) {
    const rt = runtime(settings);
    assert.doesNotThrow(() => { rt.run(); rt.show(); }); await rt.settle();
    assert.equal(rt.shared.calls.length, 0, JSON.stringify(settings));
    assert.equal(rt.shared.storage.has(dailyKey), false, JSON.stringify(settings));
  }
});

test('a refused or throwing queue restores the prior marker and allows recovery', async () => {
  for (const previous of [null, '2026-11-16']) for (const failure of [{queued: false}, {beaconThrows: true}]) {
    const rt = runtime(failure);
    if (previous) rt.shared.storage.set(dailyKey, previous);
    rt.run(); await rt.settle();
    assert.equal(rt.shared.storage.get(dailyKey) ?? null, previous);
    assert.equal(rt.shared.calls.length, 0);
    rt.settings.queued = true; rt.settings.beaconThrows = false;
    rt.window.dispatchEvent(new Event('focus')); await rt.settle();
    assert.equal(rt.shared.calls.length, 1);
    assert.equal(rt.shared.storage.get(dailyKey), '2026-11-17');
  }
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

test('the methods page CSP is widened without changing other directives', () => {
  const source = sources['calculation-methods.html'];
  const csp = policy(source);
  assert.ok(csp, 'methods page has its own CSP');
  const expected = directives(csp);
  if (!expected['script-src'].includes("'self'")) expected['script-src'].push("'self'");
  expected['script-src'].push('https://gc.zgo.at');
  expected['connect-src'].push(origin);
  expected['img-src'].push(origin);
  assert.deepEqual(directives(policy(exportMethods(source, {goatcounter: 'test-code'}))), expected);
});
