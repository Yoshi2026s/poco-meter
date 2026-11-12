// data/borders.json（＋ data/events.json）から、メーター予想の補正値（曜日・給料日・暦・イベント）を集計し
// data/meter-factors.json に保存する。推測で値を作らず、件数が少ない項目は insufficient として明示する。
// 使い方：node automation/build-meter-factors.mjs [--borders=data/borders.json] [--events=data/events.json] [--out=data/meter-factors.json]
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const arg = (name, def) => { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : def; };
export const RANKS = ['D1','D2','D3','C1','C2','C3','B1','B2','B3','A1','A2','A3','S1','S2','S3','S4','S5','S6'];
export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const MIN_DAYS = 8;        // 実際の日数がこれ未満の項目は insufficient（件数はランク×値の延べ数なので日数で判定）
const WINDOW = 14;         // 基準値：前後14日の同じ系列の中央値（自分の日は除く）
const MIN_BASE = 10;       // 基準値を出すのに必要な点数

// 内閣府「国民の祝日」（振替休日・国民の休日を含む）。2024-12〜2027-01。
export const HOLIDAYS = new Set([
  '2025-01-01','2025-01-13','2025-02-11','2025-02-23','2025-02-24','2025-03-20','2025-04-29','2025-05-03','2025-05-04','2025-05-05','2025-05-06',
  '2025-07-21','2025-08-11','2025-09-15','2025-09-23','2025-10-13','2025-11-03','2025-11-23','2025-11-24',
  '2026-01-01','2026-01-12','2026-02-11','2026-02-23','2026-03-20','2026-04-29','2026-05-03','2026-05-04','2026-05-05','2026-05-06',
  '2026-07-20','2026-08-11','2026-09-21','2026-09-22','2026-09-23','2026-10-12','2026-11-03','2026-11-23',
  '2027-01-01','2027-01-11',
]);

const DAY = 864e5;
const iso = t => new Date(t).toISOString().slice(0, 10);
const wd = d => new Date(d + 'T00:00:00Z').getUTCDay();
const isOff = d => wd(d) === 0 || wd(d) === 6 || HOLIDAYS.has(d) || /-12-(29|30|31)$|-01-0[1-3]$/.test(d);
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); const p = (s.length - 1) * q, i = Math.floor(p); return s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * (p - i); };
const pct = r => Math.round((r - 1) * 1000) / 10;

// 一般的な給料日（10日・20日・25日）。土日祝なら前の営業日に支給される慣行で「実支給日」も出す。
export function paydayOf(year, month, day) {
  let t = Date.UTC(year, month - 1, day);
  while (isOff(iso(t))) t -= DAY;
  return iso(t);
}

export function calendarTags(d) {
  const [y, m, day] = d.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const tags = [];
  for (const p of [10, 20, 25]) {
    if (day === p) tags.push(`payday${p}`);
    const actual = paydayOf(y, m, p);
    if (actual === d) tags.push(`payday${p}-actual`);
    if (iso(Date.parse(actual) + DAY) === d) tags.push(`payday${p}-next`);
  }
  if (day <= 3) tags.push('month-start');
  if (day > last - 3) tags.push('month-end');
  if (HOLIDAYS.has(d)) tags.push('holiday');
  if (/-12-(2[89]|3[01])$|-01-0[1-3]$/.test(d)) tags.push('year-end');
  if (/-0(4-29|4-30|5-0[1-6])$/.test(d)) tags.push('golden-week');
  if (/-08-1[1-6]$/.test(d)) tags.push('obon');
  if (/-12-2[45]$/.test(d)) tags.push('christmas');
  if (/-02-14$/.test(d)) tags.push('valentine');
  return tags;
}

export const TAG_LABELS = {
  'payday10': '10日（暦日）', 'payday10-actual': '10日払いの実支給日', 'payday10-next': '10日払いの翌日',
  'payday20': '20日（暦日）', 'payday20-actual': '20日払いの実支給日', 'payday20-next': '20日払いの翌日',
  'payday25': '25日（暦日）', 'payday25-actual': '25日払いの実支給日', 'payday25-next': '25日払いの翌日',
  'month-start': '月初（1〜3日）', 'month-end': '月末（最後の3日）', 'holiday': '祝日・振替休日', 'year-end': '年末年始（12/28〜1/3）',
  'golden-week': 'ゴールデンウィーク（4/29〜5/6）', 'obon': 'お盆（8/11〜8/16）', 'christmas': 'クリスマス（12/24・25）', 'valentine': 'バレンタイン（2/14）',
};

function summarize(pts, key = 'adj') {
  const ratios = pts.map(p => p[key]);
  const days = new Set(pts.map(p => p.date)).size;
  if (!ratios.length) return {n: 0, days: 0, status: 'insufficient'};
  const logs = ratios.map(Math.log);
  const med = Math.exp(median(logs));
  const out = {n: ratios.length, days, ratio: Math.round(med * 10000) / 10000, pct: pct(med), p25: pct(Math.exp(quantile(logs, 0.25))), p75: pct(Math.exp(quantile(logs, 0.75)))};
  // 「普段より上がりやすい日の割合」：基準値を上回った日の割合
  out.upShare = Math.round(ratios.filter(r => r > 1).length / ratios.length * 1000) / 10;
  if (days < MIN_DAYS) out.status = 'insufficient';
  return out;
}

export function buildPoints(borders) {
  const series = new Map();
  for (const rec of borders.records) for (const [rank, vals] of Object.entries(rec.ranks || {})) {
    if (!Array.isArray(vals)) continue;
    vals.forEach((v, i) => {
      if (!(v > 0)) return; // 欠損や0は使わない
      const k = `${rec.close}|${rank}|${i}`;
      if (!series.has(k)) series.set(k, new Map());
      series.get(k).set(rec.date, v);
    });
  }
  const points = [];
  for (const [k, m] of series) {
    const [close, rank, idx] = k.split('|');
    for (const [d, v] of m) {
      const t = Date.parse(d), near = [];
      for (let o = -WINDOW; o <= WINDOW; o++) { if (!o) continue; const x = m.get(iso(t + o * DAY)); if (x) near.push(x); }
      if (near.length < MIN_BASE) continue;
      points.push({date: d, close, rank, idx: +idx, ratio: v / median(near)});
    }
  }
  return points;
}

export function eventDays(events) {
  // 大型イベント（type=big）の期間を日ごとに展開。対象ランクが取れない記事は全ランク扱いにせず、ランク不明として別集計する。
  const days = new Map();
  for (const e of events?.events || []) {
    if (e.type !== 'big' || e.confidence === 'none') continue;
    const periods = e.periods?.length ? e.periods : (e.start ? [{start: e.start, end: e.end || e.start, ranks: e.ranks}] : []);
    for (const p of periods) {
      if (!p.start) continue;
      const end = p.end || p.start;
      const ranks = p.ranks?.length ? p.ranks : e.ranks || [];
      for (let t = Date.parse(p.start); t <= Date.parse(end); t += DAY) {
        const d = iso(t);
        const phase = d === p.start ? 'first' : d === end ? 'last' : 'middle';
        if (!days.has(d)) days.set(d, []);
        days.get(d).push({title: e.title, url: e.url, ranks, phase});
      }
    }
  }
  return days;
}

export function buildFactors(borders, events) {
  const points = buildPoints(borders);
  const closes = [...new Set(points.map(p => p.close))].sort();
  const dates = borders.records.map(r => r.date).sort();
  // 1) 曜日：締め時間ごと（全ランク）と、締め時間×ランクごと
  const weekday = {}, weekdayByRank = {};
  for (const c of closes) {
    weekday[c] = Object.fromEntries(WEEKDAYS.map((w, i) => [w, summarize(points.filter(p => p.close === c && wd(p.date) === i), 'ratio')]));
    weekdayByRank[c] = Object.fromEntries(RANKS.map(r => [r, Object.fromEntries(WEEKDAYS.map((w, i) => {
      const s = summarize(points.filter(p => p.close === c && p.rank === r && wd(p.date) === i), 'ratio');
      return [w, s.n ? {pct: s.pct, n: s.n, days: s.days, ...(s.status ? {status: s.status} : {})} : {n: 0, status: 'insufficient'}];
    }))]));
  }
  const wdRatio = (c, d) => weekday[c]?.[WEEKDAYS[wd(d)]]?.ratio || 1;
  // 2) 給料日・暦：曜日の影響を割り引いた値（ratio ÷ 曜日補正）で集計
  const tagNames = Object.keys(TAG_LABELS);
  const calendar = {};
  for (const c of closes) {
    calendar[c] = {};
    const pts = points.filter(p => p.close === c).map(p => ({...p, adj: p.ratio / wdRatio(c, p.date), tags: calendarTags(p.date)}));
    for (const tag of tagNames) calendar[c][tag] = {label: TAG_LABELS[tag], ...summarize(pts.filter(p => p.tags.includes(tag)))};
    calendar[c].normal = {label: 'どれにも当たらない日', ...summarize(pts.filter(p => !p.tags.length))};
  }
  // 3) イベント：大型イベント期間中（対象ランク一致）かどうか、初日・中日・最終日
  const ev = eventDays(events);
  const event = {};
  for (const c of closes) {
    const pts = points.filter(p => p.close === c).map(p => ({...p, adj: p.ratio / wdRatio(c, p.date)}));
    const hit = (p, phase) => (ev.get(p.date) || []).some(x => x.ranks.includes(p.rank) && (!phase || x.phase === phase));
    const unknownRank = p => (ev.get(p.date) || []).some(x => !x.ranks.length);
    event[c] = {
      'big-target': {label: '大型イベント期間中（対象ランク）', ...summarize(pts.filter(p => hit(p)))},
      'big-first': {label: '大型イベント初日（対象ランク）', ...summarize(pts.filter(p => hit(p, 'first')))},
      'big-middle': {label: '大型イベント中日（対象ランク）', ...summarize(pts.filter(p => hit(p, 'middle')))},
      'big-last': {label: '大型イベント最終日（対象ランク）', ...summarize(pts.filter(p => hit(p, 'last')))},
      'big-rank-unknown': {label: '大型イベント期間中（対象ランク不明）', ...summarize(pts.filter(p => !hit(p) && unknownRank(p)))},
      'no-big-event': {label: '大型イベントなし', ...summarize(pts.filter(p => !ev.has(p.date)))},
    };
  }
  return {
    schema: 'poco-meter-factors-v1',
    generatedAt: new Date().toISOString(),
    method: [
      '各系列（締め時間×ランク×3つの値それぞれ）で、前後14日の中央値を「普段の値」とし、その日の値との比を出す（自分の日は除く。前後の点が10未満なら使わない）。',
      '曜日：比の中央値（対数で集計）を「普段比 pct %」として出す。p25・p75 は散らばり、upShare は普段を上回った割合。n は延べ件数（ランク×3つの値）、days は実際の日数。',
      '給料日・暦・イベント：曜日の影響を割り引いた比（比 ÷ その締め時間の曜日補正）で集計。',
      '給料日は一般的な10日・20日・25日。土日祝・年末年始なら前の営業日に支給される慣行で「実支給日」と「その翌日」も出す。',
      `実際の日数が${MIN_DAYS}日未満の項目は status: insufficient（予想に使わない）。欠損日は0や他の締め時間の値で埋めない。`,
      'イベントは data/events.json の type=big かつ期間を検出できたものだけを使う。対象ランク不明のものは別集計。',
    ],
    coverage: {from: dates[0], to: dates.at(-1), records: borders.records.length, points: points.length, closes,
      bigEventDays: [...ev.keys()].filter(d => d >= dates[0] && d <= dates.at(-1)).length},
    weekday, calendar, event, weekdayByRank,
  };
}

// 画面（常時表示パネル）用の小さな配布物。補正値のうち予想に使えるもの（insufficient 以外）と、
// 今日の前後の日ごとの暦タグ・開催イベントだけを入れる。公開時（scripts/build-pages.mjs）に作る。
export const FORECAST_TAGS = ['payday10-actual', 'payday10-next', 'payday20-actual', 'payday20-next', 'payday25-actual', 'payday25-next',
  'month-start', 'month-end', 'holiday', 'year-end', 'golden-week', 'obon', 'christmas', 'valentine'];
const TYPE_ORDER = {big: 0, event: 1, collab: 2, newcomer: 3, mission: 4, item: 5, notice: 6};
export function forecastBundle(factors, events, todayISO, {before = 3, after = 45, backtest = null} = {}) {
  const usable = s => s && s.status !== 'insufficient' && Number.isFinite(s.pct);
  const pick = obj => Object.fromEntries(Object.entries(obj || {}).filter(([, s]) => usable(s)).map(([k, s]) => [k, {pct: s.pct, ...(s.label ? {label: s.label} : {}), days: s.days}]));
  const out = {schema: 'poco-meter-forecast-v1', generatedAt: factors.generatedAt, today: todayISO, coverage: factors.coverage, weekday: {}, weekdayByRank: {}, calendar: {}, event: {}, days: {}};
  for (const c of Object.keys(factors.weekday || {})) {
    out.weekday[c] = Object.fromEntries(Object.entries(factors.weekday[c]).filter(([, s]) => usable(s)).map(([w, s]) => [w, {pct: s.pct, p25: s.p25, p75: s.p75, days: s.days}]));
    out.weekdayByRank[c] = Object.fromEntries(Object.entries(factors.weekdayByRank?.[c] || {}).map(([r, ws]) => [r, Object.fromEntries(Object.entries(ws).filter(([, s]) => usable(s)).map(([w, s]) => [w, s.pct]))]));
    out.calendar[c] = pick(Object.fromEntries(FORECAST_TAGS.map(t => [t, factors.calendar?.[c]?.[t]])));
    out.event[c] = pick({first: factors.event?.[c]?.['big-first'], middle: factors.event?.[c]?.['big-middle'], last: factors.event?.[c]?.['big-last']});
  }
  const t0 = Date.parse(todayISO + 'T00:00:00Z');
  for (let t = t0 - before * DAY; t <= t0 + after * DAY; t += DAY) {
    const d = iso(t);
    const list = [];
    for (const e of events?.events || []) {
      if (e.confidence === 'none') continue;
      for (const p of e.periods || []) {
        const end = p.end || p.start;
        if (!p.start || d < p.start || d > end) continue;
        list.push({title: e.title.slice(0, 60), label: p.label ? p.label.slice(0, 40) : null, type: e.type, ranks: (p.ranks?.length ? p.ranks : e.ranks) || [],
          phase: d === p.start ? 'first' : d === end ? 'last' : 'middle', ends: d === end, start: p.start, end: p.end || null, endTime: p.endTime || null, url: e.url});
      }
    }
    // 同じ記事の重複を除き、大型→通常イベント→その他の順に最大8件。
    const seen = new Set();
    const uniq = list.sort((a, b) => (a.phase === 'last' ? 0 : 1) - (b.phase === 'last' ? 0 : 1))
      .filter(x => { if (seen.has(x.url)) return false; seen.add(x.url); return true; }) // 1記事1件（最終日の期間を優先）
      .sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) || (b.ranks.length ? 1 : 0) - (a.ranks.length ? 1 : 0)).slice(0, 8);
    // 本日のイベラス（この日が最終日のもの。1日だけの開催も含む）は件数を絞りすぎないよう別に持つ。
    const seenLast = new Set();
    const lasts = list.filter(x => x.ends).filter(x => { if (seenLast.has(x.url)) return false; seenLast.add(x.url); return true; })
      .sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) || (a.endTime || '24:00').localeCompare(b.endTime || '24:00')).slice(0, 15);
    out.days[d] = {tags: calendarTags(d).filter(x => FORECAST_TAGS.includes(x)), events: uniq, lasts};
  }
  // 過去データの答え合わせ（automation/backtest-forecast.mjs）の要約。締め時間×ランク帯の的中率だけを入れる。
  if (backtest?.model) out.model = backtest.model; // 締め時間×ランク帯ごとの補正と目安の幅（画面の meterForecast が使う）
  if (backtest?.byGroup) out.accuracy = {period: backtest.period, overall: pickAcc(backtest.overall),
    byGroup: Object.fromEntries(Object.entries(backtest.byGroup).map(([k, s]) => [k, pickAcc(s)]))};
  return out;
}
const pickAcc = s => s && {within10: s.within10, within20: s.within20, medianAbsErr: s.medianAbsErr, inRange: s.inRange, days: s.days, n: s.n};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const borders = JSON.parse(await readFile(arg('borders', 'data/borders.json'), 'utf8'));
  let events = null; try { events = JSON.parse(await readFile(arg('events', 'data/events.json'), 'utf8')); } catch {}
  const out = buildFactors(borders, events);
  const file = arg('out', 'data/meter-factors.json');
  // 集計結果が変わらなければ書き換えない（生成日時だけの差分コミットを作らない）。
  let prev = null; try { prev = JSON.parse(await readFile(file, 'utf8')); } catch {}
  const same = prev && JSON.stringify({...prev, generatedAt: null}) === JSON.stringify({...out, generatedAt: null});
  if (!same) await writeFile(file, JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify({...out.coverage, written: !same}));
}
