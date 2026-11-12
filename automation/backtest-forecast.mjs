// 常時表示パネルの予想ボーダーを、過去データで答え合わせする。
// - 画面に載っている meterForecast（calculator/index.html）をそのまま取り出して使う（計算式を二重に持たない）。
// - 補正値は検証期間より前のデータだけで集計し直す（答えを見て補正しないため）。
// - 各日の予想は前日までの記録だけを使う（meterForecast の仕様）。
// 使い方：node automation/backtest-forecast.mjs [--from=2026-01-01] [--out=data/forecast-backtest.json]
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {buildFactors, forecastBundle} from './build-meter-factors.mjs';

const arg = (name, def) => { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : def; };
const DAY = 864e5;
const iso = t => new Date(t).toISOString().slice(0, 10);
export const GROUPS = {D: 'D帯', C: 'C帯', B: 'B帯', A: 'A帯', S: 'S帯'};

// index.html から関数宣言を名前で取り出す（中括弧の対応で終わりを探す。文字列中の括弧は使っていない関数に限る）。
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
  vm.runInContext(extractFunctions(html, ['aoIsoDay', 'aoMedian', 'meterForecast']), ctx);
  return ctx.meterForecast;
}

function stats(rows) {
  if (!rows.length) return {n: 0};
  const abs = rows.map(r => Math.abs(r.err)).sort((a, b) => a - b);
  const pctIn = lim => Math.round(rows.filter(r => Math.abs(r.err) <= lim).length / rows.length * 1000) / 10;
  const r1 = x => Math.round(x * 10) / 10;
  return {
    n: rows.length,
    days: new Set(rows.map(r => r.date)).size,
    medianAbsErr: r1(abs[abs.length >> 1] * 100),
    meanAbsErr: r1(abs.reduce((s, x) => s + x, 0) / abs.length * 100),
    bias: r1(rows.reduce((s, r) => s + r.err, 0) / rows.length * 100), // ＋は予想が実際より高い
    within5: pctIn(0.05), within10: pctIn(0.10), within20: pctIn(0.20),
    inRange: rows[0].inRange === undefined ? undefined : Math.round(rows.filter(r => r.inRange).length / rows.length * 1000) / 10,
    baseMedianAbsErr: r1([...rows.map(r => Math.abs(r.baseErr))].sort((a, b) => a - b)[rows.length >> 1] * 100),
    baseWithin10: Math.round(rows.filter(r => Math.abs(r.baseErr) <= 0.10).length / rows.length * 1000) / 10,
    improvedShare: Math.round(rows.filter(r => Math.abs(r.err) < Math.abs(r.baseErr)).length / rows.length * 1000) / 10,
  };
}

export function backtest(borders, events, html, {from}) {
  const meterForecast = loadMeterForecast(html);
  const dates = [...new Set(borders.records.map(r => r.date))].sort();
  const to = dates.at(-1);
  const train = {records: borders.records.filter(r => r.date < from)};
  const factors = buildFactors(train, events);
  const span = Math.round((Date.parse(to) - Date.parse(from)) / DAY);
  const bundle = forecastBundle(factors, events, from, {before: 0, after: span});
  const logs = {};
  for (const rec of borders.records) { (logs[rec.close] ||= {})[rec.date] = rec.ranks; }
  const rows = [];
  for (const [close, log] of Object.entries(logs)) for (const date of Object.keys(log).filter(d => d >= from).sort()) {
    for (const [rank, vals] of Object.entries(log[date])) vals.forEach((actual, idx) => {
      if (!(actual > 0)) return;
      const f = meterForecast(log, date, rank, idx, close, bundle);
      if (f.status !== 'ok') return;
      rows.push({date, close, rank, idx, err: f.value / actual - 1, baseErr: f.base / actual - 1,
        inRange: f.low !== null ? f.low <= actual && actual <= f.high : false, big: (bundle.days[date]?.events || []).some(e => e.type === 'big' && e.ranks.includes(rank))});
    });
  }
  const by = (key) => Object.fromEntries([...new Set(rows.map(key))].sort().map(k => [k, stats(rows.filter(r => key(r) === k))]));
  return {
    schema: 'poco-meter-forecast-backtest-v1',
    generatedAt: new Date().toISOString(),
    method: [
      `補正値（曜日・暦・大型イベント）は ${from} より前のデータだけで集計し、${from}〜${to} を答え合わせした。`,
      '予想は画面と同じ meterForecast（直近14日・前日までの中央値×補正）。前日までの記録が5日未満の日は対象外。',
      'err = 予想 ÷ 実際 − 1。within10 は誤差±10%以内の割合、inRange は目安の幅に入った割合（同じ曜日の過去の半数が入る幅なので約50%が目安）。',
      'base* は補正なし（中央値のみ）の場合。improvedShare は補正で誤差が小さくなった割合。',
    ],
    period: {from, to, trainTo: iso(Date.parse(from) - DAY)},
    overall: stats(rows),
    byClose: by(r => r.close),
    byGroup: Object.fromEntries(Object.entries(by(r => `${r.close}|${r.rank[0]}`)).map(([k, v]) => [k, v])),
    byBorder: by(r => ['±0', '+1', '+2'][r.idx]),
    byBigEvent: by(r => r.big ? '大型イベント期間（対象ランク）' : 'それ以外'),
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
