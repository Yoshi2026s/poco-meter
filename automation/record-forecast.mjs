// 日々のメーター予想を記録し、実際のボーダーが取れたら答え合わせして残す（data/forecast-log.json）。
// - 予想：締め時間ごとに「記録済みの最新日の翌日」（＝まだ結果が出ていない日）を、画面と同じ meterForecast・予想データで予想する。
//   一度記録した予想は書き換えない（後から作り直した予想と混ぜないため）。対象日は今日か明日（JST）に限る。
// - 答え合わせ：記録済みの予想のうち、data/borders.json にその日・締め時間の値が入ったものへ実際の値を書き足す。
// - 欠損（0・未取得）は答え合わせに使わない。
// 使い方：node automation/record-forecast.mjs [--file=data/forecast-log.json] [--now=2026-11-13T05:00:00+09:00]
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {forecastBundle} from './build-meter-factors.mjs';
import {loadMeterForecast} from './backtest-forecast.mjs';

export const LOG_SCHEMA = 'poco-meter-forecast-log-v1';
const DAY = 864e5;
const iso = t => new Date(t).toISOString().slice(0, 10);
const arg = (name, def) => { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : def; };
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const r1 = x => Math.round(x * 10) / 10;

// その日・締め時間の締め（JST）。24時締めは翌日0時。
export function closeEnd(date, close) { return Date.parse(date + 'T00:00:00+09:00') + Number(close) * 3600e3; }
// 予想と実際の値から、誤差（%）の一覧を作る
export function errorsOf(entry) {
  const out = [];
  if (!entry.actual) return out;
  for (const [rank, fs] of Object.entries(entry.forecasts)) (fs || []).forEach((f, idx) => {
    const a = entry.actual[rank]?.[idx];
    if (f && f[0] > 0 && a > 0) out.push({rank, idx, err: (a / f[0] - 1) * 100, inRange: f[1] != null && f[2] != null ? a >= f[1] && a <= f[2] : null});
  });
  return out;
}
function stats(errs) {
  if (!errs.length) return {n: 0};
  // 誤差は0.1%単位に丸めてから判定する（+10%ちょうどが浮動小数の誤差で10.000…1%になり外れ扱いになるのを防ぐ）
  const abs = errs.map(e => r1(Math.abs(e.err))), ranged = errs.filter(e => e.inRange !== null);
  return {n: errs.length, within10: r1(abs.filter(x => x <= 10).length / abs.length * 100), medianAbsErr: r1(median(abs)),
    ...(ranged.length ? {inRange: r1(ranged.filter(e => e.inRange).length / ranged.length * 100)} : {})};
}
// 集計：全体・締め時間別・締め時間×ランク×ボーダー別（パネルの「記録の的中」に使う）・直近30日
export function summarize(entries, todayISO) {
  const checked = Object.values(entries).filter(e => e.actual);
  const rows = checked.flatMap(e => errorsOf(e).map(x => ({...x, close: e.close, date: e.date})));
  const by = key => Object.fromEntries([...new Set(rows.map(key))].sort().map(k => [k, stats(rows.filter(r => key(r) === k))]));
  const from30 = iso(Date.parse(todayISO) - 30 * DAY);
  return {checkedDays: checked.length, firstDate: checked.map(e => e.date).sort()[0] || null, overall: stats(rows),
    last30: stats(rows.filter(r => r.date >= from30)), byClose: by(r => r.close), bySeries: by(r => `${r.close}|${r.rank}|${r.idx}`)};
}

export function recordForecasts({borders, events, factors, backtest, html, log, now = Date.now()}) {
  const meterForecast = loadMeterForecast(html);
  const out = log && log.schema === LOG_SCHEMA ? structuredClone(log) : {schema: LOG_SCHEMA, entries: {}};
  const today = iso(now + 9 * 3600e3), tomorrow = iso(Date.parse(today) + DAY);
  const logs = {};
  for (const rec of borders.records) (logs[rec.close] ||= {})[rec.date] = rec.ranks;
  const added = [], checked = [];
  for (const [close, byDate] of Object.entries(logs)) {
    const dates = Object.keys(byDate).sort(), target = iso(Date.parse(dates.at(-1)) + DAY), key = `${target}|${close}`;
    if (out.entries[key] || (target !== today && target !== tomorrow)) continue;
    // 締め時間を過ぎた日は記録しない（結果が出てからの予想を「事前の予想」として残さないため）
    if (now >= closeEnd(target, close)) continue;
    const bundle = forecastBundle(factors, events, target, {before: 1, after: 1, backtest});
    const forecasts = {};
    for (const rank of Object.keys(byDate[dates.at(-1)])) {
      if (rank === 'E') continue;
      forecasts[rank] = [0, 1, 2].map(idx => {
        const f = meterForecast(byDate, target, rank, idx, close, bundle);
        return f.status === 'ok' ? [Math.round(f.value), f.low != null ? Math.round(f.low) : null, f.high != null ? Math.round(f.high) : null] : null;
      });
    }
    out.entries[key] = {date: target, close, recordedAt: new Date(now).toISOString(), dataGeneratedAt: bundle.generatedAt || null, forecasts, actual: null};
    added.push(key);
  }
  for (const [key, e] of Object.entries(out.entries)) {
    if (e.actual) continue;
    const ranks = logs[e.close]?.[e.date];
    if (!ranks) continue;
    // 欠損（0）は null にして答え合わせから外す
    e.actual = Object.fromEntries(Object.entries(ranks).filter(([r]) => e.forecasts[r]).map(([r, v]) => [r, v.map(x => (x > 0 ? x : null))]));
    e.checkedAt = new Date(now).toISOString();
    checked.push(key);
  }
  out.entries = Object.fromEntries(Object.entries(out.entries).sort(([a], [b]) => a.localeCompare(b)));
  out.summary = summarize(out.entries, today);
  return {log: out, added, checked};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = arg('file', 'data/forecast-log.json');
  const json = path => readFile(path, 'utf8').then(JSON.parse);
  const [borders, events, factors, backtest, html, log] = await Promise.all([
    json('data/borders.json'), json('data/events.json').catch(() => null), json('data/meter-factors.json'),
    json('data/forecast-backtest.json').catch(() => null), readFile('calculator/index.html', 'utf8'), json(file).catch(() => null),
  ]);
  const nowArg = arg('now', null);
  const result = recordForecasts({borders, events, factors, backtest, html, log, now: nowArg ? Date.parse(nowArg) : Date.now()});
  if (result.added.length || result.checked.length || !log) await writeFile(file, JSON.stringify(result.log) + '\n');
  console.log(JSON.stringify({added: result.added, checked: result.checked, summary: result.log.summary.overall}));
}
