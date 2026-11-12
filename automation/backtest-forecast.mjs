// 常時表示パネルの予想ボーダーの補正（model）を過去データから作り、答え合わせする。
// - 画面に載っている meterForecast・forecastBase（calculator/index.html）をそのまま取り出して使う（計算式を二重に持たない）。
// - model は締め時間×ランク帯ごとに、曜日・暦（給料日など）・大型イベントの補正と、目安の幅（p25・p75）を持つ。
//   各補正は「学習期間の前7割で作り、後3割で±10%以内の割合が上がったときだけ使う」（use* フラグ）。
// - 答え合わせ：from より前のデータだけで model を作り、from 以降の各日を前日までの記録で予想して比べる。
// - 画面用 model：全期間のデータで同じ手順で作り直したもの（data/forecast-backtest.json の model → 公開時に予想データへ）。
// 使い方：node automation/backtest-forecast.mjs [--from=2026-01-01] [--out=data/forecast-backtest.json]
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {forecastBundle, calendarTags, FORECAST_TAGS, TAG_LABELS} from './build-meter-factors.mjs';

const arg = (name, def) => { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : def; };
const DAY = 864e5;
const iso = t => new Date(t).toISOString().slice(0, 10);
const WD = '日月火水木金土';
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); const p = (s.length - 1) * q, i = Math.floor(p); return s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * (p - i); };
const pct = r => Math.round((r - 1) * 1000) / 10;
const MIN_DAYS = 8; // 補正を作るのに必要な実日数

// index.html から関数宣言を名前で取り出す（中括弧の対応で終わりを探す。文字列中に括弧を含まない関数に限る）。
export function extractFunctions(html, names) {
  return names.map(name => {
    const start = html.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`index.html に function ${name} がありません`);
    let depth = 0, i = html.indexOf('{', start);
    for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
    return html.slice(start, i + 1);
  }).join('\n');
}
export function loadMeterForecast(html) {
  const ctx = vm.createContext({});
  vm.runInContext(extractFunctions(html, ['aoIsoDay', 'aoMedian', 'forecastBase', 'meterForecast']), ctx);
  return ctx.meterForecast;
}

// 予想の基準値（補正なし）と、その日の暦タグ・大型イベントの段階を、全系列・全日について並べる。
function baseRows(borders, events, meterForecast, from, to) {
  const logs = {};
  for (const rec of borders.records) (logs[rec.close] ||= {})[rec.date] = rec.ranks;
  const span = Math.round((Date.parse(to) - Date.parse(from)) / DAY);
  const days = forecastBundle({weekday: {}}, events, from, {before: 0, after: span}).days;
  const rows = [];
  for (const [close, log] of Object.entries(logs)) for (const date of Object.keys(log).filter(d => d >= from && d <= to).sort()) {
    const day = days[date] || {tags: [], events: []};
    for (const [rank, vals] of Object.entries(log[date])) vals.forEach((actual, idx) => {
      if (!(actual > 0)) return;
      const f = meterForecast(log, date, rank, idx, close, null);
      if (f.status !== 'ok') return;
      const hit = day.events.find(e => e.type === 'big' && e.ranks.includes(rank));
      rows.push({date, close, band: rank[0], rank, idx, actual, base: f.base, ratio: actual / f.base,
        wd: WD[new Date(date + 'T00:00:00Z').getUTCDay()], tags: calendarTags(date).filter(t => FORECAST_TAGS.includes(t)), phase: hit ? hit.phase : null});
    });
  }
  return rows;
}

// 締め時間×ランク帯ごとの補正を作る（学習用の行だけを使う）。
function fitParts(rows) {
  const days = rs => new Set(rs.map(r => r.date)).size;
  const fac = rs => rs.length && days(rs) >= MIN_DAYS ? pct(Math.exp(median(rs.map(r => Math.log(r.ratio))))) : null;
  const weekday = {};
  for (const w of WD) { const v = fac(rows.filter(r => r.wd === w)); if (v !== null) weekday[w] = v; }
  const adj = r => r.ratio / (1 + (weekday[r.wd] ?? 0) / 100);
  const calendar = {};
  for (const tag of FORECAST_TAGS) {
    const rs = rows.filter(r => r.tags.includes(tag));
    if (days(rs) >= MIN_DAYS) calendar[tag] = {pct: pct(Math.exp(median(rs.map(r => Math.log(adj(r)))))), label: TAG_LABELS[tag]};
  }
  const event = {};
  for (const ph of ['first', 'middle', 'last']) {
    const rs = rows.filter(r => r.phase === ph);
    if (days(rs) >= MIN_DAYS) event[ph] = pct(Math.exp(median(rs.map(r => Math.log(adj(r))))));
  }
  return {weekday, calendar, event};
}
function applyParts(r, parts, use) {
  let ratio = 1;
  if (use.weekday && parts.weekday[r.wd] !== undefined) ratio *= 1 + parts.weekday[r.wd] / 100;
  if (use.calendar) for (const t of r.tags) if (parts.calendar[t]) ratio *= 1 + parts.calendar[t].pct / 100;
  if (use.event && r.phase && parts.event[r.phase] !== undefined) ratio *= 1 + parts.event[r.phase] / 100;
  return ratio;
}
const within10 = (rs, parts, use) => rs.filter(r => Math.abs(r.base * applyParts(r, parts, use) / r.actual - 1) <= 0.1).length / Math.max(1, rs.length);

export function fitModel(rows) {
  const model = {};
  const groups = {};
  for (const r of rows) ((groups[r.close] ||= {})[r.band] ||= []).push(r);
  for (const [close, bands] of Object.entries(groups)) for (const [band, rs] of Object.entries(bands)) {
    // 学習期間を日付で前7割・後3割に分け、後3割で効いた補正だけ使う（貪欲に1つずつ足す）。
    const dates = [...new Set(rs.map(r => r.date))].sort(), cut = dates[Math.floor(dates.length * 0.7)];
    const early = rs.filter(r => r.date < cut), late = rs.filter(r => r.date >= cut);
    const partsEarly = fitParts(early);
    const use = {weekday: false, calendar: false, event: false};
    let best = within10(late, partsEarly, use);
    for (const key of ['weekday', 'calendar', 'event']) {
      const trial = {...use, [key]: true}, score = within10(late, partsEarly, trial);
      if (score > best + 0.002) { use[key] = true; best = score; } // 0.2ポイント以上の改善だけ採用
    }
    const parts = fitParts(rs); // 使う補正は全学習期間で作り直す
    const resid = rs.map(r => r.actual / (r.base * applyParts(r, parts, use)));
    (model[close] ||= {})[band] = {
      useWeekday: use.weekday, useCalendar: use.calendar, useEvent: use.event,
      ...(use.weekday ? {weekday: parts.weekday} : {}), ...(use.calendar ? {calendar: parts.calendar} : {}), ...(use.event ? {event: parts.event} : {}),
      // 目安の幅：予想に対する実際の値の25〜75%点（予想の何%下〜何%上か）
      p25: Math.round((quantile(resid, 0.25) - 1) * 1000) / 10, p75: Math.round((quantile(resid, 0.75) - 1) * 1000) / 10,
      days: new Set(rs.map(r => r.date)).size,
    };
  }
  return model;
}

function stats(rows, predict) {
  if (!rows.length) return {n: 0};
  const errs = rows.map(r => ({e: predict(r) / r.actual - 1, b: r.base / r.actual - 1, r}));
  const abs = errs.map(x => Math.abs(x.e)).sort((a, b) => a - b), babs = errs.map(x => Math.abs(x.b)).sort((a, b) => a - b);
  const share = f => Math.round(errs.filter(f).length / errs.length * 1000) / 10, r1 = x => Math.round(x * 10) / 10;
  return {
    n: rows.length, days: new Set(rows.map(r => r.date)).size,
    medianAbsErr: r1(abs[abs.length >> 1] * 100), meanAbsErr: r1(abs.reduce((s, x) => s + x, 0) / abs.length * 100),
    within5: share(x => Math.abs(x.e) <= 0.05), within10: share(x => Math.abs(x.e) <= 0.10), within20: share(x => Math.abs(x.e) <= 0.20),
    inRange: share(x => x.r.inRange), baseMedianAbsErr: r1(babs[babs.length >> 1] * 100), baseWithin10: share(x => Math.abs(x.b) <= 0.10),
  };
}

export function backtest(borders, events, html, {from}) {
  const meterForecast = loadMeterForecast(html);
  const dates = [...new Set(borders.records.map(r => r.date))].sort();
  const first = dates[0], to = dates.at(-1);
  const all = baseRows(borders, events, meterForecast, first, to);
  const train = all.filter(r => r.date < from), test = all.filter(r => r.date >= from);
  const evalModel = fitModel(train);
  const predict = r => { const m = evalModel[r.close]?.[r.band]; if (!m) return r.base;
    const parts = {weekday: m.weekday || {}, calendar: m.calendar || {}, event: m.event || {}};
    return r.base * applyParts(r, parts, {weekday: m.useWeekday, calendar: m.useCalendar, event: m.useEvent}); };
  for (const r of test) { const m = evalModel[r.close]?.[r.band], p = predict(r); r.inRange = m ? p * (1 + m.p25 / 100) <= r.actual && r.actual <= p * (1 + m.p75 / 100) : false; }
  const by = key => Object.fromEntries([...new Set(test.map(key))].sort().map(k => [k, stats(test.filter(r => key(r) === k), predict)]));
  return {
    schema: 'poco-meter-forecast-backtest-v2',
    generatedAt: new Date().toISOString(),
    method: [
      '基準値は画面と同じ forecastBase（D帯：指数加重平均α0.5、S帯：指数加重中央値α0.15、A・B・C帯：指数加重中央値α0.05。前日まで最大42日）。',
      `答え合わせ：${from} より前のデータだけで補正（model）を作り、${from}〜${to} の各日を前日までの記録で予想した。`,
      '補正（曜日・暦・大型イベント）は締め時間×ランク帯ごとに、学習期間の前7割で作って後3割で±10%以内が上がったものだけを使う。',
      'within10 は誤差±10%以内の割合、inRange は目安の幅（過去の予想で実際の値の25〜75%点）に入った割合。base* は補正なしの場合。',
    ],
    period: {from, to, trainFrom: first, trainTo: iso(Date.parse(from) - DAY)},
    overall: stats(test, predict),
    byClose: by(r => r.close),
    byGroup: by(r => `${r.close}|${r.band}`),
    byBand: by(r => r.band),
    // 締め時間×ランク×ボーダーごと（画面の的中率・自信度に使う。同じ帯でも±0やS6は外れやすいため）
    bySeries: by(r => `${r.close}|${r.rank}|${r.idx}`),
    byBorder: by(r => ['±0', '+1', '+2'][r.idx]),
    evalModel,
    // 画面用：全期間で作り直した補正
    model: fitModel(all),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [borders, events, html] = await Promise.all([
    readFile(arg('borders', 'data/borders.json'), 'utf8').then(JSON.parse),
    readFile(arg('events', 'data/events.json'), 'utf8').then(JSON.parse).catch(() => null),
    readFile('calculator/index.html', 'utf8'),
  ]);
  const out = backtest(borders, events, html, {from: arg('from', '2026-01-01')});
  const file = arg('out', 'data/forecast-backtest.json');
  let prev = null; try { prev = JSON.parse(await readFile(file, 'utf8')); } catch {}
  const same = prev && JSON.stringify({...prev, generatedAt: null}) === JSON.stringify({...out, generatedAt: null});
  if (!same) await writeFile(file, JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify({period: out.period, overall: out.overall, written: !same}));
}
