// ChatGPTの定期タスクが書く照合記録（docs/pococha-event-sources.md）から、期間を読めるイベントを
// 取り込み用の1行（data/task-events.txt）にする。この行は collect-events.mjs が他の手動の行と同じ仕組みで読み、
// メーター画面のイベント欄・イベントカレンダー・的中率カレンダーに出る。
// - 読むのは「## YYYY-MM-DD」の日付の節にある箇条書きだけ。見出しに「参考」を含む小見出し（結果・補足）の下は読まない。
// - 公式未確認（第三者カレンダーの候補・未確認・保留の欄）の行も正式イベントとして扱う（2026-11-17 ユーザー決定）。
//   本文に「中止」「延期」などがある行は読まない。リンクは Pococha公式URL → それ以外の掲載元URL → この記録 の順に使う。
// - 期間は「11/26 12:00〜12/2 23:59:59」「11/17 10:00〜23:59」「11/13〜11/17」の形だけを読む（年は確認日に一番近い年）。読めない行は推測で埋めない。
// - 既に他の取得元（公式note・公式サイト・手動の行）にある同じ開催日の同じ名前のイベントは足さない（二重表示を防ぐ）。
// 使い方：node automation/extract-task-events.mjs [--record=docs/pococha-event-sources.md] [--events=data/events.json] [--out=data/task-events.txt]
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

export const TASK_SOURCE_ID = 'pococha-official-task';
const SKIP_HEADING = /参考/;
const SKIP_TEXT = /中止|延期|取りやめ|取り止め|予定未定/;
// 掲載元に使わないサイト（HAISHIN LAB は無断転載禁止）
const BLOCKED_HOST = /(^|\.)haishin-?lab\./i;
// URL の無い行のリンク先（この照合記録）
export const RECORD_URL = 'https://github.com/Yoshi2026s/poco-meter/blob/HEAD/docs/pococha-event-sources.md';
const NOT_NAME = /^(?:エントリ|応募|締切|受付)/;
const D = String.raw`(?:(\d{4})[\/年])?(\d{1,2})[\/月](\d{1,2})日?(?:\s*[（(][^）)]{1,3}[）)])?`;
const T = String.raw`(\d{1,2}:\d{2})(?::\d{2})?(?:頃)?`;
const PERIOD = new RegExp(`${D}\\s*(?:${T})?\\s*[〜～~]\\s*(?:${D})?\\s*(?:${T})?`);

const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const valid = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCMonth() === m - 1 && t.getUTCDate() === +d; };
const days = (a, b) => (Date.parse(a) - Date.parse(b)) / 864e5;
const hhmm = t => t ? t.replace(/^(\d):/, '0$1:') : null;
const norm = s => String(s || '').normalize('NFKC').replace(/[\s【】「」『』〈〉《》()（）\[\]・!！?？★☆🌟✨🔥]/gu, '').toLowerCase();

function sourceUrl(text) {
  const urls = [];
  for (const m of text.matchAll(/https?:\/\/[^\s｜）)」、。]+/g)) {
    try { const u = new URL(m[0]); if (u.protocol === 'https:' && !u.username && !u.password && !BLOCKED_HOST.test(u.hostname)) urls.push(u); } catch {}
  }
  const u = urls.find(u => u.hostname === 'pococha.com' || u.hostname.endsWith('.pococha.com')) || urls[0];
  return u ? `${u.origin}${u.pathname}${u.search}` : RECORD_URL;
}
// 確認日に一番近い年（前後1年）を選ぶ
function nearestYear(m, d, confirmed) {
  const y0 = +confirmed.slice(0, 4);
  return [y0 - 1, y0, y0 + 1].filter(y => valid(y, m, d)).sort((a, b) => Math.abs(days(iso(a, m, d), confirmed)) - Math.abs(days(iso(b, m, d), confirmed)))[0];
}
export function parsePeriod(text, confirmed) {
  const m = text.match(PERIOD);
  if (!m) return null;
  const [, y1, m1, d1, t1, y2, m2, d2, t2] = m;
  if (!m2 && !t2) return null; // 「11/26〜」だけ（終わりが無い）は読まない
  const sy = y1 ? +y1 : nearestYear(+m1, +d1, confirmed);
  if (!sy || !valid(sy, +m1, +d1)) return null;
  const start = iso(sy, +m1, +d1);
  let end = start;
  if (m2) {
    let ey = y2 ? +y2 : sy;
    if (!y2 && iso(ey, +m2, +d2) < start) ey++;
    if (!valid(ey, +m2, +d2)) return null;
    end = iso(ey, +m2, +d2);
  }
  if (end < start || days(end, start) > 120) return null;
  return {start, end, startTime: hhmm(t1), endTime: hhmm(t2), index: m.index};
}
function nameOf(body, index) {
  let s = body.slice(0, index).replace(/\*\*/g, '').trim();
  if (s.includes('：')) s = s.split('：')[0];
  s = s.replace(/[「」『』]/g, '').replace(/(?:の開催期間|の期間|開催期間|期間)?\s*(?:は|が|：|:|、|,)?\s*$/u, '').replace(/[〜～]+$/, '').trim();
  if (!s || s.length > 60 || NOT_NAME.test(s) || /https?:/.test(s)) return null;
  return s;
}
function ranksOf(body) {
  const m = body.match(/対象[^。]*?([DSABCE][1-6])\s*[〜～~]\s*([DSABCE][1-6])/) || body.match(/([DSABCE][1-6])\s*[〜～~]\s*([DSABCE][1-6])の掲載/);
  return m ? `${m[1]}〜${m[2]}` : null;
}
const fmt = (date, time) => { const [y, m, d] = date.split('-').map(Number); return `${y}年${m}月${d}日${time ? ` ${time}` : ''}`; };

// 記録（Markdown）と既存のイベント（events.json の events）から、取り込み用の行と読まなかった理由を返す。
export function extractTaskEvents(markdown, existing = []) {
  const others = existing.filter(e => e && e.sourceId !== TASK_SOURCE_ID);
  const found = new Map();
  const skipped = [];
  let confirmed = null, heading = '';
  for (const raw of String(markdown || '').split(/\r?\n/)) {
    const day = raw.match(/^##\s+(\d{4}-\d{2}-\d{2})/);
    if (day) { confirmed = day[1]; heading = ''; continue; }
    const sub = raw.match(/^###\s+(.*)/);
    if (sub) { heading = sub[1]; continue; }
    if (/^#{1,2}\s/.test(raw)) { confirmed = null; continue; } // 日付でない見出し（説明など）の下は読まない
    const item = raw.match(/^\s*[-*]\s+(.*)/);
    if (!item || !confirmed) continue;
    const body = item[1];
    const short = body.replace(/https?:\/\/\S+/g, '').slice(0, 40);
    if (SKIP_HEADING.test(heading)) continue; // 参考（結果・補足）の欄は対象外（理由の記録も不要）
    const url = sourceUrl(body);
    if (SKIP_TEXT.test(body)) { skipped.push({confirmed, text: short, reason: '中止・延期などの記載あり'}); continue; }
    const p = parsePeriod(body, confirmed);
    if (!p) { skipped.push({confirmed, text: short, reason: '期間を読めない'}); continue; }
    const name = nameOf(body, p.index);
    if (!name) { skipped.push({confirmed, text: short, reason: 'イベント名を読めない'}); continue; }
    const key = norm(name);
    const dup = others.find(e => (e.periods || []).some(q => q.start === p.start && (q.end || q.start) === p.end
      && [e.title, q.label].some(t => { const n = norm(t); return n && (n.includes(key) || key.includes(n)); })));
    if (dup) { skipped.push({confirmed, text: name, reason: `既にあり（${dup.url}）`}); continue; }
    const id = createHash('sha1').update(`${key}|${p.start}|${p.end}|${p.startTime || ''}`).digest('hex').slice(0, 10);
    const prev = found.get(id);
    if (prev && prev.confirmed >= confirmed) continue; // 同じ事実は一番新しい確認日の1行だけ
    found.set(id, {confirmed, name, url, ranks: ranksOf(body), ...p, id});
  }
  const lines = [...found.values()].sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name))
    .map(e => [`確認日 ${e.confirmed}`, e.name, `開催期間：${fmt(e.start, e.startTime)}〜${fmt(e.end, e.endTime)}`, ...(e.ranks ? [`対象：${e.ranks}`] : []), `${e.url}#task-${e.id}`].join('｜'));
  return {lines, skipped};
}

// 記録の表（「| 名前 | 開催期間 | ランク |」の形）にある、同じ日に終わる開催（半日・1日イベント）を
// 「公式未確認の候補」として取り出す（data/calendar-event-candidates.json）。公式の行（data/task-events.txt）には混ぜない。
// - 日付の節（## YYYY-MM-DD）の表だけを読む。見出しに「参考」があっても読む（第三者カレンダーの表は参考欄に置かれるため）。
// - 見出し行に「期間」を含む列が無い表は読まない。中止・延期などの記載がある行、名前・期間を読めない行は入れない（推測で埋めない）。
// - 「11/24の第三者掲載はA（12:00〜23:59、D3〜S6）、…」の形の箇条書き（proseCandidates）も同じく候補にする。
// - 掲載元は表の直前（同じ小見出しの中）にある最後の、Pococha公式以外のURL。無ければこの記録。HAISHIN LAB は使わない。
// - 同じ名前・同じ日・同じ開始時刻は一番新しい確認日の1件だけ。公式の行との重複は画面用データを作るときに除く。
const cells = row => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim());
const isTable = raw => /^\s*\|.*\|\s*$/.test(raw);
const isRule = raw => /^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/.test(raw);
const tidyName = s => String(s || '').replace(/\*\*/g, '').replace(/\s*[（(](?:\d{1,2}\/\d{1,2}|\d{1,2}月\d{1,2}日)回?[）)]\s*$/u, '').replace(/[「」『』]/g, '').trim();
function rankRange(text) {
  const m = String(text || '').normalize('NFKC').match(/([DSABCE][1-6])\s*[〜～~-]\s*([DSABCE][1-6])/) || String(text || '').normalize('NFKC').match(/^\s*([DSABCE][1-6])\s*$/);
  return m ? (m[2] ? `${m[1]}〜${m[2]}` : m[1]) : null;
}
// 候補の掲載元：Pococha公式以外の最初のURL（第三者の掲載を公式の告知と見誤らせない）。無ければ null。
function candidateUrl(text) {
  for (const m of String(text || '').matchAll(/https?:\/\/[^\s｜）)」、。]+/g)) {
    try { const u = new URL(m[0]); if (u.protocol === 'https:' && !u.username && !u.password && !BLOCKED_HOST.test(u.hostname) && u.hostname !== 'pococha.com' && !u.hostname.endsWith('.pococha.com')) return `${u.origin}${u.pathname}${u.search}`; } catch {}
  }
  return null;
}
// 箇条書きの「11/24の第三者掲載はA（12:00〜23:59、D3〜S6）、B（同時刻、E1〜D3）、C（12:00〜11/26 23:59、…）。」から、同じ日に終わるもの（A・B）だけ。
// 「本日開始の第三者候補は…」の本日は節の日付。別の日付を含む（複数日にまたがる）ものと、時刻を読めないものは入れない。
const PROSE = /^(?:本日|(\d{1,2})\/(\d{1,2}))(?:開始)?の(?:既存の?)?第三者(?:掲載|候補)は([^。]+)/;
const PROSE_ITEM = /([^、（(]{2,60}?)[（(]((\d{1,2}:\d{2})〜(\d{1,2}:\d{2})|同時刻)、\s*([DSABCE][1-6]\s*[〜～~]\s*[DSABCE][1-6])[）)]/gu;
export function proseCandidates(body, confirmed) {
  const m = String(body || '').match(PROSE);
  if (!m || SKIP_TEXT.test(m[3])) return [];
  let date = confirmed;
  if (m[1]) { const y = nearestYear(+m[1], +m[2], confirmed); if (!y) return []; date = iso(y, +m[1], +m[2]); }
  const out = [];
  let last = null;
  for (const x of m[3].matchAll(PROSE_ITEM)) {
    const times = x[3] ? [hhmm(x[3]), hhmm(x[4])] : last;
    if (!times) continue;
    last = times;
    const name = tidyName(x[1].replace(/^(?:既存(?:表|候補)?の|新規の?)/, ''));
    if (!name || NOT_NAME.test(name)) continue;
    out.push({name, date, startTime: times[0], endTime: times[1], rankRange: rankRange(x[5])});
  }
  return out;
}
export function extractTableCandidates(markdown) {
  const found = new Map();
  let confirmed = null, url = null, cols = null;
  const add = (c, src) => {
    const id = `${norm(c.name)}|${c.date}|${c.startTime || ''}`, prev = found.get(id);
    if (prev && prev.confirmed >= confirmed) return;
    found.set(id, {name: c.name, date: c.date, ...(c.startTime ? {startTime: c.startTime} : {}), ...(c.endTime ? {endTime: c.endTime} : {}), ...(c.rankRange ? {rankRange: c.rankRange} : {}), url: src || RECORD_URL, confirmed});
  };
  for (const raw of String(markdown || '').split(/\r?\n/)) {
    const day = raw.match(/^##\s+(\d{4}-\d{2}-\d{2})/);
    if (day) { confirmed = day[1]; url = null; cols = null; continue; }
    if (/^#{1,2}\s/.test(raw)) { confirmed = null; cols = null; continue; }
    if (/^###\s/.test(raw)) { url = null; cols = null; continue; }
    if (!confirmed) continue;
    if (!isTable(raw)) {
      cols = null;
      const u = candidateUrl(raw); if (u) url = u;
      const item = raw.match(/^\s*[-*]\s+(.*)/);
      if (item) for (const c of proseCandidates(item[1], confirmed)) add(c, u);
      continue;
    }
    if (isRule(raw)) continue;
    const c = cells(raw);
    if (!cols) { // 見出し行
      const period = c.findIndex(x => /期間|日時|日程/.test(x));
      cols = period > 0 ? {period, rank: c.findIndex(x => /ランク|対象/.test(x))} : {skip: true};
      continue;
    }
    if (cols.skip || SKIP_TEXT.test(raw)) continue;
    const name = tidyName(c[0]), p = parsePeriod(c[cols.period] || '', confirmed);
    if (!name || name.length > 60 || NOT_NAME.test(name) || /https?:/.test(name) || !p || p.end !== p.start) continue;
    add({name, date: p.start, startTime: p.startTime, endTime: p.endTime, rankRange: cols.rank > 0 ? rankRange(c[cols.rank]) : null}, url);
  }
  return [...found.values()].sort((a, b) => a.date.localeCompare(b.date) || (a.startTime || '').localeCompare(b.startTime || '') || a.name.localeCompare(b.name));
}

export const HEADER = `# ChatGPTの定期タスクの照合記録（docs/pococha-event-sources.md）から自動で作る行。手で編集しない（次の実行で作り直される）。
# 作り方：automation/extract-task-events.mjs が日付の節（「参考」の欄を除く）にある、期間を読める行を取り出す。公式未確認（第三者カレンダー・候補・未確認）の行も正式イベントとして入れる。
#   中止・延期の行、他の取得元に同じ開催日・同じ名前のイベントがある行は入れない。
# 形：確認日 YYYY-MM-DD｜イベント名｜開催期間：…〜…｜対象：…｜掲載元のURL#task-識別子（Pococha公式URL優先。URLが無い行はこの記録）
`;

async function main() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return resolve(root, a ? a.slice(n.length + 3) : d); };
  const md = await readFile(arg('record', 'docs/pococha-event-sources.md'), 'utf8').catch(() => '');
  let events = [];
  try { events = JSON.parse(await readFile(arg('events', 'data/events.json'), 'utf8')).events || []; } catch {}
  const {lines, skipped} = extractTaskEvents(md, events);
  await writeFile(arg('out', 'data/task-events.txt'), HEADER + lines.map(l => l + '\n').join(''));
  // 表の半日・1日イベント（公式未確認の候補）。内容が変わったときだけ書き換える。
  const candidates = extractTableCandidates(md), file = arg('candidates', 'data/calendar-event-candidates.json');
  const text = JSON.stringify(candidates, null, 2) + '\n';
  if (await readFile(file, 'utf8').catch(() => '') !== text) await writeFile(file, text);
  console.log(JSON.stringify({lines: lines.length, candidates: candidates.length, skipped}, null, 1));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
