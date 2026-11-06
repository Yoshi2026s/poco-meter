import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const COLLECTOR_ORIGIN = 'https://pococha-comment-access.freefreelife2000.chatgpt.site';
export const ADMIN_ORIGIN = 'https://pococha-comment-library.freefreelife2000.chatgpt.site';
export const TRACKER_ID = 'pococha-public-access-tracker';
const GH = 'https://pococha2026.github.io';
const sites = slug => ({ origin: `https://${slug}.freefreelife2000.chatgpt.site`, paths: ['/', '/index.html'] });
const github = paths => ({ origin: GH, paths });
const roots = path => [path + '/', path + '/index.html'];
export const TOOL_PAGES = Object.freeze({
  meter: [sites('poco-meter'), github(roots('/poco-meter'))],
  coin: [sites('pococha-same-coin'), github(roots('/same-coin'))],
  answers: [sites('pococha-challenge'), github([...roots('/pococha-answers'), ...roots('/pococha-challenge')])],
  comments: [sites('pococha-comment-library'), github(roots('/comments'))],
  profile: [sites('pococha-profile-search'), github(roots('/profile-search'))],
  support: [sites('pococha-support-desk-2630')],
  activity: [sites('pococha-activity-ledger-40')],
  visual: [sites('pococha-visual-form')],
  members: [sites('yoshi-members')],
  record: [github(['/yell-log.html', '/yell-log-share.html'])],
  catalog: [github(['/', '/index.html'])],
  preview: []
});
const START = '<!-- Pococha1012 security management: start -->';
const END = '<!-- Pococha1012 security management: end -->';
const OLD_START = '<!-- Pococha1012 public access tracker: start -->';
const OLD_END = '<!-- Pococha1012 public access tracker: end -->';
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function validateTool(toolId, track) {
  if (!Object.hasOwn(TOOL_PAGES, toolId)) throw new Error('Unknown tool ID.');
  if (track && toolId === 'preview') throw new Error('Preview pages must never record visits.');
}
export function adminUrl(toolId) { validateTool(toolId, false); return ADMIN_ORIGIN + '/admin/tools/' + toolId; }

// This script only sends a validated page path and coarse device metadata.
// There are no reads of inputs, cookies, settings, query strings, fragments or storage.
export function buildTracker(toolId) {
  validateTool(toolId, true);
  return `(() => {
  "use strict";
  const toolId = ${JSON.stringify(toolId)};
  const allowedPages = ${JSON.stringify(TOOL_PAGES[toolId])};
  const collectorOrigin = ${JSON.stringify(COLLECTOR_ORIGIN)};
  const guard = "__pococha1012Visit_" + toolId;
  if (window[guard]) return;
  window[guard] = true;
  let preparing = false, sent = false, eventId;
  function allowed() {
    try {
      if (!allowedPages.some(item => location.origin === item.origin && item.paths.includes(location.pathname))) return false;
      if (navigator.webdriver || document.visibilityState === "hidden") return false;
      if (navigator.globalPrivacyControl === true) return false;
      if ([navigator.doNotTrack, navigator.msDoNotTrack, window.doNotTrack].some(value => /^(?:1|yes)$/i.test(String(value || "")))) return false;
      if (/bot|spider|crawl|slurp|headless|phantom|selenium|playwright|puppeteer|lighthouse|preview|facebookexternalhit|whatsapp|telegrambot/i.test(String(navigator.userAgent || ""))) return false;
      if (window.top !== window.self) {
        // Sites normally renders inside ChatGPT. Other embedded/automated frames are excluded.
        if (!location.origin.endsWith(".chatgpt.site") || new URL(document.referrer || "").origin !== "https://chatgpt.com") return false;
        const ancestors = Array.from(location.ancestorOrigins || []);
        if (ancestors.some(origin => origin !== "https://chatgpt.com" && origin !== location.origin)) return false;
      }
      return typeof fetch === "function";
    } catch { return false; }
  }
  function metadata() {
    const ua = String(navigator.userAgent || "");
    const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && Number(navigator.maxTouchPoints || 0) > 1);
    const android = /Android/i.test(ua);
    let os = "unknown";
    if (ios) os = "ios";
    else if (android) os = "android";
    else if (/Windows/i.test(ua)) os = "windows";
    else if (/CrOS/i.test(ua)) os = "chromeos";
    else if (/Macintosh|Mac OS X/i.test(ua)) os = "macos";
    else if (/Linux|X11/i.test(ua)) os = "linux";
    let device = "unknown";
    if (/iPad/i.test(ua) || (ios && /Macintosh/i.test(ua))) device = "tablet";
    else if (/iPhone|iPod|Mobile/i.test(ua)) device = "mobile";
    else if (android) device = "tablet";
    else if (os !== "unknown") device = "desktop";
    let browser = "unknown";
    if (/Edg(?:e|A|iOS)?\\//i.test(ua)) browser = "edge";
    else if (/OPR\\/|Opera|OPT\\//i.test(ua)) browser = "opera";
    else if (/SamsungBrowser\\//i.test(ua)) browser = "samsung";
    else if (/Firefox\\/|FxiOS\\//i.test(ua)) browser = "firefox";
    else if (/Chrome\\/|CriOS\\//i.test(ua)) browser = "chrome";
    else if (/Safari\\//i.test(ua)) browser = "safari";
    else if (ua) browser = "other";
    return { device, os, browser, model: "unknown" };
  }
  async function withReportedModel(meta) {
    let timer;
    try {
      const hints = navigator.userAgentData;
      if (!hints || typeof hints.getHighEntropyValues !== "function") return meta;
      const result = await Promise.race([
        Promise.resolve().then(() => hints.getHighEntropyValues(["model"])),
        new Promise(resolve => { timer = setTimeout(() => resolve(null), 500); })
      ]);
      const model = typeof result?.model === "string" ? result.model.trim() : "";
      if (/^[A-Za-z0-9][A-Za-z0-9 ._()+,-]{0,79}$/.test(model) && !/^(?:k|unknown|generic|android|iphone|ipad|ipod|pc)$/i.test(model) && !/^(?:\\d{1,3}\\.){3}\\d{1,3}$/.test(model)) meta.model = "reported:" + model;
    } catch { /* Unsupported hints remain unknown. */ }
    finally { if (timer !== undefined) clearTimeout(timer); }
    return meta;
  }
  function uuid() {
    try {
      if (typeof crypto.randomUUID === "function") {
        const value = crypto.randomUUID();
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return value;
      }
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
      return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
    } catch { return undefined; }
  }
  async function record() {
    if (sent || preparing || !allowed()) return;
    preparing = true;
    try {
      const meta = await withReportedModel(metadata());
      if (!allowed()) return;
      eventId ||= uuid();
      if (!eventId) return;
      const page = location.origin + location.pathname;
      const body = JSON.stringify({ toolId, eventId, page, meta });
      if (body.length > 1024) return;
      sent = true;
      await fetch(collectorOrigin + "/api/visits", {
        method: "POST", headers: { "Content-Type": "application/json" }, body,
        credentials: "omit", cache: "no-store", keepalive: true, referrerPolicy: "no-referrer"
      });
    } catch { /* Tracking failure must never interrupt the tool. */ }
    finally { preparing = false; }
  }
  window.addEventListener("pageshow", record);
  document.addEventListener("visibilitychange", record);
  void record();
})();`;
}

function stripTracker(html) {
  let oldHashes = [];
  html = html.replace(new RegExp(`${escapeRegex(OLD_START)}[\\s\\S]*?${escapeRegex(OLD_END)}\\s*`, 'g'), segment => {
    for (const match of segment.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) oldHashes.push(createHash('sha256').update(match[1]).digest('base64'));
    return '';
  });
  html = html.replace(new RegExp(`<script\\b[^>]*\\bid=["']${TRACKER_ID}["'][^>]*>([\\s\\S]*?)<\\/script\\s*>\\s*`, 'gi'), (_all, script) => { oldHashes.push(createHash('sha256').update(script).digest('base64')); return ''; });
  html = html.replace(new RegExp(`${escapeRegex(START)}[\\s\\S]*?${escapeRegex(END)}\\s*`, 'g'), '');
  html = html.replace(/<p\b[^>]*\bid=["']pococha-public-access-privacy["'][^>]*>[\s\S]*?<\/p>\s*/gi, '');
  return { html, oldHashes };
}
function updateCsp(html, script, oldHashes) {
  const hash = script ? `'sha256-${createHash('sha256').update(script).digest('base64')}'` : null;
  const cspTags = [...html.matchAll(/<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi)];
  // An absent policy is not replaced with a generic policy that could break existing tools.
  for (const match of cspTags) {
    const tag = match[0];
    const content = tag.match(/\bcontent=("([^"]*)"|'([^']*)')/i);
    if (!content) throw new Error('CSP meta content is required.');
    let directives = (content[2] ?? content[3]).replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, '&').split(';').map(value => value.trim()).filter(Boolean).map(value => value.split(/\s+/));
    const find = name => directives.find(value => value[0].toLowerCase() === name);
    const defaults = find('default-src')?.slice(1);
    for (const name of ['script-src', ...(find('script-src-elem') ? ['script-src-elem'] : [])]) {
      let directive = find(name);
      if (!directive && hash) { directive = [name, ...(defaults || [])]; directives.push(directive); }
      if (!directive) continue;
      const clean = directive.slice(1).filter(value => !oldHashes.some(old => value === `'sha256-${old}'`));
      directive.splice(1, directive.length - 1, ...clean);
      if (hash) {
        for (let i = directive.length - 1; i > 0; i--) if (directive[i] === "'none'") directive.splice(i, 1);
        if (!directive.includes(hash)) directive.push(hash);
      } else if (directive.length === 1) directive.push("'none'");
    }
    if (script) {
      let connect = find('connect-src');
      if (!connect && defaults) { connect = ['connect-src', ...defaults]; directives.push(connect); }
      if (connect) {
        for (let i = connect.length - 1; i > 0; i--) if (connect[i] === "'none'") connect.splice(i, 1);
        if (!connect.includes(COLLECTOR_ORIGIN)) connect.push(COLLECTOR_ORIGIN);
      }
    }
    const policy = directives.map(value => value.join(' ')).join('; ');
    // Typical policies use a double-quoted content attribute. Preserve and safely escape it.
    const escaped = policy.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    html = html.replace(tag, tag.replace(content[0], `content="${escaped}"`));
  }
  return html;
}
export function addSecurityManagement(html, toolId, { track = true, admin = true } = {}) {
  validateTool(toolId, track);
  if (typeof html !== 'string' || !/<\/body\s*>/i.test(html)) throw new Error('A complete HTML document is required.');
  const stripped = stripTracker(html);
  let clean = stripped.html;
  const script = track ? buildTracker(toolId) : null;
  clean = updateCsp(clean, script, stripped.oldHashes);
  const management = admin ? `<a id="pococha-security-management" href="${adminUrl(toolId)}" target="_blank" rel="noopener noreferrer">管理ページ</a>` : '';
  if (management) {
    clean = clean.replace(/<a\b[^>]*\bid=["']pococha-security-management["'][^>]*>[\s\S]*?<\/a>\s*/gi, '');
    if (/<\/footer\s*>/i.test(clean)) clean = clean.replace(/<\/footer\s*>/i, `${START}\n${management}\n${END}\n</footer>`);
    else clean = clean.replace(/<\/body\s*>/i, `<footer>${START}\n${management}\n${END}</footer>\n</body>`);
  }
  if (script) clean = clean.replace(/<\/body\s*>/i, `<script id="${TRACKER_ID}">${script}</script>\n</body>`);
  return clean;
}
export function buildAdminLanding(toolId) {
  const url = adminUrl(toolId);
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'"><title>管理ページ</title></head><body><main><h1>管理ページ</h1><p><a href="${url}" target="_blank" rel="noopener noreferrer">管理ページを開く</a></p></main></body></html>\n`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , path, toolId, flag] = process.argv;
  if (!path || !toolId || (flag && flag !== '--admin-only')) throw new Error('Usage: node scripts/security-tools.mjs /absolute/index.html toolId [--admin-only]');
  const original = await readFile(path, 'utf8');
  const next = addSecurityManagement(original, toolId, { track: flag !== '--admin-only' });
  if (next !== original) await writeFile(path, next);
  console.log(JSON.stringify({ path, toolId, changed: next !== original }));
}
