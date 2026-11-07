import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

// Exercise the functions shipped to browsers, without copying their formulas
// into a parallel implementation or executing page initialization.
const require = createRequire(import.meta.url);
const { parse } = (()=>{try{return require('next/dist/compiled/acorn');}catch{return require('acorn');}})();
const html = fs.readFileSync(new URL('../calculator/index.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1]).find(source => source.includes('function readNumber('));
assert.ok(script, 'The shipped calculator script must exist');
const ast = parse(script, { ecmaVersion: 'latest' });
const iife = ast.body.find(node => node.type === 'ExpressionStatement'
  && node.expression.type === 'CallExpression'
  && node.expression.callee.type === 'FunctionExpression');
assert.ok(iife, 'The calculator initialization must remain an extractable IIFE');
const statements = iife.expression.callee.body.body;
const constants = new Set(['automaticDataMissing', 'E_TARGET_SEEDS', 'eTargetCache', 'RANKS', 'PERIOD_KEYS', 'RECENT_PERIODS', 'PERIOD_LABELS', 'MAX_VALUE', 'state', 'storageFailed', 'DISPLAY_COLORS', 'DISPLAY_CUSTOM', 'DISPLAY_WEIGHTS', 'DISPLAY_THEMES', 'fmt', 'fmtK',
  'fmtRemainingK', 'DOGCAT', 'PANDA', 'HANABI', 'BASHA', 'CORE_TIERS',
  'METHOD_LABELS', 'BLABEL', 'offlineReadToken', 'offlineReader', 'offlineReadContext',
  'clockSample', 'clockBusy', 'clockAttemptMono', 'clockState']);
const definitions = statements.flatMap(node => {
  if (node.type === 'FunctionDeclaration') return [script.slice(node.start, node.end)];
  if (node.type !== 'VariableDeclaration') return [];
  return node.declarations.filter(declaration => constants.has(declaration.id.name)
    || ['needCoins', 'itemRange', 'coinRange', 'coreMul'].includes(declaration.id.name))
    .map(declaration => `var ${script.slice(declaration.start, declaration.end)};`);
}).join('\n');
const importAssignment = statements.find(node => node.type === 'ExpressionStatement'
  && script.slice(node.start, node.end).trim().startsWith("$('importBtn').onclick="));
assert.ok(importAssignment, 'Test the actual transactional backup import handler');

function engine(now = '2026-10-03T20:54:04+09:00') {
  let clock = Date.parse(now);
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      id, value: '', textContent: '', className: '', hidden: false,
      setAttribute() {}, removeAttribute() {}, setCustomValidity() {},
      getAttribute() { return null; }, focus() {},
      classList: { toggle() {}, add() {}, remove() {} },
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    Date: FixedDate, document: { getElementById: element, querySelectorAll: () => [] },
    $: element, inputErrors: {}, statsCache: {}, dataRevision: 0,
    numericComposing: {}, currentUndo: null, currentEdit: null, editorDrafts: {}, lastDraftKey: '', draftStorageFailed: false,
    setTimeout, clearTimeout, console,
  });
  vm.runInContext(definitions, context, { filename: 'calculator/index.html:extracted' });
  // These are normally normalized during the page's initialization. Set valid
  // baseline values so malformed-backup tests fail for their intended reason.
  context.state.analysisBorder = 0;
  context.state.goalDefaults = context.standardGoalDefaults();
  const noMutation = () => { throw new Error('Invalid backup reached a mutation/refresh'); };
  // A rejected import must exit before it reaches any of these operations.
  context.save = noMutation;
  context.update = noMutation;
  context.clearTargetResetUndo = noMutation;
  context.resetCurrentUndo = noMutation;
  context.applyCollapsedPreferences = noMutation;
  context.syncAllInputs = noMutation;
  context.syncGoalDefaultInputs = noMutation;
  context.loadEditor = noMutation;
  vm.runInContext(script.slice(importAssignment.start, importAssignment.end), context);
  context.setNow = value => { clock = Date.parse(value); };
  context.element = element;
  return context;
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }
function permitRefresh(e) {
  for (const name of ['save', 'update', 'clearTargetResetUndo', 'resetCurrentUndo',
    'applyCollapsedPreferences', 'syncAllInputs', 'syncGoalDefaultInputs', 'loadEditor', 'discardEditorDrafts', 'saveEditorDrafts']) {
    e[name] = () => name==='save'?true:undefined;
  }
}
function pointsFromK(text) {
  assert.match(text, /^\d+(?:\.\d{1,3})?K$|^\d+$/);
  if (!text.endsWith('K')) return BigInt(text);
  const [whole, fraction = ''] = text.slice(0, -1).split('.');
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
}
function statsForValues(e, values) {
  e.state.log = Object.fromEntries(values.map((value, index) => [
    `2026-09-${String(index + 1).padStart(2, '0')}`, { S2: [value, value, value] },
  ]));
  e.state.provenance = {};
  e.statsCache = {};
  const dates = Object.keys(e.state.log);
  return e.statsForWindow({ period: 'all', start: dates[0], end: dates.at(-1),
    dates, excludeLegacy: false }, 'S2', 0);
}

// A deliberately small DOM double for testing page initialization and real
// input handlers. Visual layout belongs to the separate browser verification.
function pageEngine(settings, capabilities = {}) {
  const elements = new Map();
  const stored = new Map(settings === undefined ? [] : [['pococha-meter-calc-v1', JSON.stringify(settings)]]);
  const nodes = [];
  const document = { activeElement: null, hidden: false, querySelectorAll: selector => {
    const match = selector.match(/^\[(data-[\w-]+)\]$/);
    return match ? nodes.filter(node => node.hasAttribute(match[1])) : [];
  },
    querySelector: () => null, execCommand: capabilities.execCommand ?? (() => false) };
  const documentHandlers = new Map(), windowHandlers = new Map(), viewportHandlers = new Map();
  const listen = (map, type, handler) => { if (!map.has(type)) map.set(type, []); map.get(type).push(handler); };
  const dispatch = (map, type, event = {}) => { for (const handler of map.get(type) ?? []) handler(event); };
  document.addEventListener = (type, handler) => listen(documentHandlers, type, handler);
  function matches(element, selector) {
    const simple = selector.trim();
    if (!simple || /[:>+~]/.test(simple)) return false;
    const parts = simple.split(/\s+/);
    if (parts.length > 1) {
      if (!matches(element, parts.pop())) return false;
      for (let parent = element.parentNode; parent; parent = parent.parentNode) if (matches(parent, parts.join(' '))) return true;
      return false;
    }
    const attr = simple.match(/^\[([\w-]+)\]$/); if (attr) return element.hasAttribute(attr[1]);
    const tag = simple.match(/^[\w-]+/); if (tag && tag[0].toUpperCase() !== element.tagName) return false;
    const id = simple.match(/#([\w-]+)/); if (id && id[1] !== element.id) return false;
    return [...simple.matchAll(/\.([\w-]+)/g)].every(match => element.classList.contains(match[1]));
  }
  const descendants = element => element.children.flatMap(child => [child, ...descendants(child)]);
  const query = (all, selector) => all.filter(element => selector.split(',').some(part => matches(element, part)));
  function makeElement(tagName = 'div', id = '') {
    const attributes = new Map();
    const handlers = new Map();
    let inner = '';
    const element = {
      id, nodeType: 1, tagName: tagName.toUpperCase(), value: '', textContent: '',
      className: '', dataset: {}, style: {setProperty(name,value){this[name]=String(value);}}, childNodes: [], hidden: false,
      parentNode: null, selectionStart: null, selectionEnd: null,
      get children() { return this.childNodes.filter(child => child.nodeType === 1); },
      get firstChild() { return this.childNodes[0] ?? null; },
      get lastChild() { return this.childNodes.at(-1) ?? null; },
      get nextSibling() { return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null; },
      get innerHTML() { return this.children.length ? this.children.map(child => `<${child.tagName.toLowerCase()} value="${child.value}">${child.innerHTML || child.textContent}</${child.tagName.toLowerCase()}>`).join('') : inner; },
      set innerHTML(value) {
        inner = String(value); for (const child of this.childNodes) child.parentNode = null; this.childNodes = [];
        if (this.tagName === 'SELECT') for (const match of inner.matchAll(/<option[^>]*value="([^"]*)"[^>]*>(.*?)<\/option>/g)) {
          const option = makeElement('option'); option.value = match[1]; option.textContent = match[2]; this.appendChild(option);
        }
      },
      get options() { return this.children.filter(child => child.tagName === 'OPTION'); },
      get selectedIndex() { return this.options.findIndex(option => option.value === this.value); },
      setAttribute(name, value) { attributes.set(name, String(value)); },
      removeAttribute(name) { attributes.delete(name); },
      getAttribute(name) { return attributes.get(name) ?? null; },
      hasAttribute(name) { return attributes.has(name); },
      setCustomValidity(message) { this.validationMessage = message; },
      removeChild(child) { const index=this.childNodes.indexOf(child);assert.ok(index>=0,'removed node must be a child');this.childNodes.splice(index,1);child.parentNode=null;return child; },
      appendChild(child) { child.parentNode?.removeChild(child);child.parentNode=this;this.childNodes.push(child);return child; },
      insertBefore(child, reference) { if(reference==null)return this.appendChild(child);assert.ok(this.childNodes.includes(reference),'insertBefore reference must be a child');if(child===reference)return child;child.parentNode?.removeChild(child);const index=this.childNodes.indexOf(reference);child.parentNode=this;this.childNodes.splice(index,0,child);return child; },
      cloneNode(deep = false) { const clone = makeElement(this.tagName); for (const [name, value] of attributes) clone.setAttribute(name, value); clone.value = this.value; clone.textContent = this.textContent; clone.className = this.className; clone.dataset = { ...this.dataset }; if (deep) this.children.forEach(child => clone.appendChild(child.cloneNode(true))); return clone; },
      getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
      querySelectorAll(selector) { return query(descendants(this), selector); },
      querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
      closest(selector) { const selectors=selector.split(',').map(part=>part.trim());for (let current = this; current; current = current.parentNode) if (selectors.some(part=>matches(current,part))) return current; return null; },
      classList: { toggle(name, value) {
        const classes = new Set(element.className.split(/\s+/).filter(Boolean));
        if (value ?? !classes.has(name)) classes.add(name); else classes.delete(name);
        element.className = [...classes].join(' ');
      }, add: name => element.classList.toggle(name, true), remove: name => element.classList.toggle(name, false),
      contains: name => element.className.split(/\s+/).includes(name) },
      addEventListener(type, handler) {
        if (!handlers.has(type)) handlers.set(type, []);
        handlers.get(type).push(handler);
      },
      dispatchEvent(event) { for (const handler of handlers.get(event.type) ?? []) handler.call(this, event); this['on' + event.type]?.call(this, event); return true; },
      focus() { if (!['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A', 'SUMMARY'].includes(this.tagName) && !this.hasAttribute('tabindex')) return; document.activeElement = this; this.dispatchEvent(new Event('focus')); dispatch(documentHandlers, 'focusin', { target: this }); },
      blur() { if (document.activeElement === this) { document.activeElement = null; this.dispatchEvent(new Event('blur')); dispatch(documentHandlers, 'focusout', { target: this }); } },
      select() { this.selected = true; }, setSelectionRange(start, end, direction) { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; },
      scrollIntoView(options) { this.lastScroll = options; }, remove() {}, click() { if(this.tagName==='A'&&this.download)capabilities.onDownload?.(this);return this.onclick?.call(this, new Event('click')); },
    };
    nodes.push(element); return element;
  }
  const markup = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const stack = [], voidTags = new Set(['input', 'meta', 'link', 'br', 'hr', 'img', 'area', 'base', 'embed', 'source', 'wbr', 'col', 'param', 'track']);
  for (const match of markup.matchAll(/<(\/?)([a-z][a-z0-9]*)\b([^>]*)>|([^<]+)/gi)) {
    if (match[4] !== undefined) { if (stack.length) stack.at(-1).appendChild({nodeType:3,textContent:match[4],parentNode:null});continue; }
    const [, closing, tag, attrs] = match;
    if (closing) { const index = stack.findLastIndex(node => node.tagName === tag.toUpperCase()); if (index >= 0) stack.splice(index); continue; }
    const id = attrs.match(/\bid="([^"]+)"/)?.[1] ?? '';
    const element = makeElement(tag, id);
    for (const attribute of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) {
      element.setAttribute(attribute[1], attribute[2]);
      if (attribute[1] === 'value') element.value = attribute[2];
      if (attribute[1] === 'class') element.className = attribute[2];
      if (attribute[1].startsWith('data-')) element.dataset[attribute[1].slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = attribute[2];
    }
    if(tag.toLowerCase()==='option'&&/(?:^|\s)selected(?:\s|=|$)/.test(attrs))element.setAttribute('selected','');
    if (stack.length) stack.at(-1).appendChild(element);
    if (id) elements.set(id, element);
    if (!voidTags.has(tag.toLowerCase()) && !attrs.trimEnd().endsWith('/')) stack.push(element);
  }
  // A native single-select initially uses its selected option or first option.
  for(const select of nodes.filter(node=>node.tagName==='SELECT'))select.value=(select.options.find(option=>option.hasAttribute('selected'))??select.options[0])?.value??'';
  document.querySelectorAll = selector => query(nodes.filter(node => node === document.body || node.closest('html')), selector);
  document.querySelector = selector => document.querySelectorAll(selector)[0] ?? null;
  document.getElementById = id => elements.get(id) ?? null;
  document.createElement = tag => makeElement(tag);
  document.body = nodes.find(node => node.tagName === 'BODY');
  document.documentElement = nodes.find(node => node.tagName === 'HTML');
  const timers = new Map(), intervals = new Map(); let timerId = 0;
  const window = { isSecureContext: capabilities.isSecureContext ?? false, location: { hash: '' }, addEventListener: (type, handler) => listen(windowHandlers, type, handler),
    matchMedia: capabilities.matchMedia ?? (query => ({ matches: query.includes('prefers-reduced-motion') ? !!capabilities.reducedMotion : false })),
    history: { pushState(_state, _unused, url) { window.location.hash = url; } },
    visualViewport: { addEventListener: (type, handler) => listen(viewportHandlers, type, handler) } };
  let intersectionCallback;
  class IntersectionObserverDouble { constructor(callback) { intersectionCallback = callback; } observe() {} }
  window.IntersectionObserver = IntersectionObserverDouble;
  let clock = Date.parse('2026-10-03T21:00:00+09:00');
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const context = vm.createContext({ Date: FixedDate, document, performance: capabilities.performance,
    window, navigator: capabilities.navigator ?? {}, Event, IntersectionObserver: IntersectionObserverDouble,
    localStorage: capabilities.localStorage ?? { getItem: key => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value) },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id), setInterval: (callback, delay) => { const id = ++timerId; intervals.set(id, { callback, delay }); return id; },
    clearInterval: id => intervals.delete(id),
    AbortController, FileReader:capabilities.FileReader, Blob:capabilities.Blob, File:capabilities.File, URL:capabilities.URL, fetch: capabilities.fetch ?? (() => new Promise(() => {})), console,
  });
  document.dispatchEvent=event=>{dispatch(documentHandlers,event.type,event);return true;};
  const simpleController=html.match(/<script id="simple-menu-controller">([\s\S]*?)<\/script>/)?.[1];
  if(simpleController)vm.runInContext(simpleController,context,{filename:'calculator/index.html:simple-menu-controller',timeout:5000});
  if(!capabilities.skipCalculatorInitialization)vm.runInContext(script, context, { filename: 'calculator/index.html:whole-script', timeout: 5000 });
  return { element: id => elements.get(id), stored, nodes, document, window,
    setNow: value => { clock = Date.parse(value); },
    tick: delay => { for (const timer of intervals.values()) if (timer.delay === delay) timer.callback(); },
    flushTimers: maxDelay => { const pending = [...timers]; for (const [id, timer] of pending) if (timer.delay <= maxDelay && timers.delete(id)) timer.callback(); },
    dispatchDocument: type => dispatch(documentHandlers, type),
    dispatchWindow: (type,event) => dispatch(windowHandlers, type,event),
    resizeViewport: () => dispatch(viewportHandlers, 'resize'),
    intersect: outside => intersectionCallback?.([{ isIntersecting: !outside, boundingClientRect: { top: outside ? -1 : 0 } }]),
  };
}

export { engine, pageEngine, plain, permitRefresh, pointsFromK, statsForValues, html };
