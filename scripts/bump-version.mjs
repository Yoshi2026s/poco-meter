// ツール本体を変えたときに PAGES_VERSION（画面の「最終更新バージョン」）を更新する。
// 使い方：npm run version:bump   （日本時間の今日の日付で vYYYY.MM.DD.N を付け、同じ日なら N を1つ進める）
// データ更新だけのときは実行しない。
import {readFile, writeFile} from 'node:fs/promises';

const file = new URL('./build-pages.mjs', import.meta.url);
const source = await readFile(file, 'utf8');
const pattern = /export const PAGES_VERSION = \{version: 'v(\d{4})\.(\d{2})\.(\d{2})\.(\d+)'[^\n]*\};/;
const match = source.match(pattern);
if (!match) throw new Error('PAGES_VERSION の行が見つかりません');

const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
}).formatToParts(new Date()).map((p) => [p.type, p.value]));
const {year, month, day, hour, minute} = parts;
const sameDay = match[1] === year && match[2] === month && match[3] === day;
const serial = sameDay ? Number(match[4]) + 1 : 1;
const version = `v${year}.${month}.${day}.${serial}`;
const line = `export const PAGES_VERSION = {version: '${version}', updatedAt: '${year}-${month}-${day}T${hour}:${minute}:00+09:00', label: '${year}/${month}/${day} ${hour}:${minute}:00'};`;
await writeFile(file, source.replace(pattern, line));
console.log(version);
