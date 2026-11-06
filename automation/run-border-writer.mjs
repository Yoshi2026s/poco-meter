#!/usr/bin/env node
// Usage: node automation/run-border-writer.mjs [--mode=plan|diagnose|discover|refresh]
//        [--confirm-production-write] [--report=path.json] [--lock=path.lock]
// The default is "plan", which makes no network request.
// BORDER_WRITER_KEY is read only from the environment and never printed or saved.
import {writeFile} from 'node:fs/promises';
import {runBorderWriter, MODES} from './border-writer-client.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [name, ...rest] = arg.replace(/^--/, '').split('=');
  return [name, rest.length ? rest.join('=') : true];
}));
const known = new Set(['mode', 'confirm-production-write', 'report', 'lock']);
const unknown = Object.keys(args).filter(name => !known.has(name));
if (unknown.length) {
  console.error('不明な引数：' + unknown.join(', '));
  process.exit(64);
}
const mode = typeof args.mode === 'string' ? args.mode : 'plan';
if (!(mode in MODES)) {
  console.error('modeは ' + Object.keys(MODES).join(' / ') + ' のいずれかです。');
  process.exit(64);
}
if (process.env.CI && mode !== 'plan') {
  console.error('CIでは plan 以外を実行しません。');
  process.exit(64);
}

const report = await runBorderWriter({
  mode,
  fetch: mode === 'plan' ? undefined : globalThis.fetch,
  env: {BORDER_WRITER_KEY: process.env.BORDER_WRITER_KEY},
  confirmProductionWrite: args['confirm-production-write'] === true,
  lockPath: typeof args.lock === 'string' ? args.lock : undefined,
});
const text = JSON.stringify(report, null, 2);
if (typeof args.report === 'string') await writeFile(args.report, text + '\n', {encoding: 'utf8', flag: 'wx'});
console.log(text);
process.exit(report.outcome === 'ok' || report.outcome === 'planned' ? 0 : 2);
