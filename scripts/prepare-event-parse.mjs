// calculator/event-parse.mjs（イベント情報の読み取り部品）を calculator/index.html の目印の間に書き写す。
// 画面の「公式X・インスタの告知を読み取る」と自動収集（automation/collect-events.mjs）で同じ読み取り方を使うため。
// 使い方：node scripts/prepare-event-parse.mjs（npm run pages:prepare に含む）。npm run check が不一致を検出する。
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root = new URL('../', import.meta.url);
export const BEGIN = '/* event-parse:begin（calculator/event-parse.mjs から npm run pages:prepare で生成。ここは手で書き換えない） */';
export const END = '/* event-parse:end */';
const NAMES = ['snsEvent', 'snsLines', 'snsLineEvent', 'snsDayItems', 'rankText'];

export function eventParseBlock(source) {
  const code = source.replace(/^export (const|function|let) /gm, '$1 ');
  if (/^\s*(?:export|import)\b/m.test(code)) throw new Error('event-parse.mjs に書き写せない export/import があります');
  return `${BEGIN}\n  var PocoEventParse=(function(){\n'use strict';\n${code.trim()}\nreturn {${NAMES.map(n => `${n}:${n}`).join(',')}};\n})();\n  ${END}`;
}
export function injectEventParse(html, source) {
  const a = html.indexOf(BEGIN), b = html.indexOf(END);
  if (a < 0 || b < a || html.indexOf(BEGIN, a + 1) >= 0) throw new Error('index.html に event-parse の目印が1組ありません');
  return html.slice(0, a) + eventParseBlock(source) + html.slice(b + END.length);
}
export async function prepareEventParse() {
  const [html, source] = await Promise.all(['calculator/index.html', 'calculator/event-parse.mjs'].map(p => readFile(new URL(p, root), 'utf8')));
  const out = injectEventParse(html, source);
  if (out !== html) await writeFile(new URL('calculator/index.html', root), out);
  return {changed: out !== html};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await prepareEventParse()));
