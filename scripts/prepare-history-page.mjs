import {readFile,writeFile} from 'node:fs/promises';import {sealCalculatorHTML} from '../lib/browser-security.mjs';
import {normalizeHistoryRows,mergeHistoryRows} from '../calculator/history-core.mjs';
const root=new URL('../',import.meta.url);
export async function prepareHistoryPage(){const paths=['db/history-2025-2026.json','db/history-2026-10-02-03.json','db/seed.json'];const snapshots=await Promise.all(paths.map(async p=>JSON.parse(await readFile(new URL(p,root),'utf8'))));
 const byDay=new Map();for(const row of snapshots.flat()){const key=row.date+'|'+row.close,old=byDay.get(key);byDay.set(key,{...row,ranks:{...old?.ranks,...row.ranks}});}
 const rows=[...byDay.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.close.localeCompare(b.close));normalizeHistoryRows(rows);
 const [template,core,ui,main]=await Promise.all(['calculator/history-page-template.html','calculator/history-core.mjs','calculator/history-ui.mjs','calculator/index.html'].map(p=>readFile(new URL(p,root),'utf8')));
 const version=main.match(/最終更新バージョン：(v[\d.]+)/)?.[1];if(!version)throw Error('Version missing');
 const eCode=(await Promise.all(['calculator/e-border-core.mjs','calculator/e-border-store.mjs'].map(p=>readFile(new URL(p,root),'utf8')))).map(code=>code.replace(/^import .*;\n/gm,'').replace(/\bexport /g,'')).join('\n');
 const html=template.replace('__VERSION__',version).replace('__CORE__',core.replace(/\bexport /g,'')+'\n'+eCode).replace('__DATA__',JSON.stringify(rows).replaceAll('<','\\u003c')).replace('__UI__',ui.replace('__BORDER_API__','/api/borders').replace('__API_CREDENTIALS__','same-origin'));
 await writeFile(new URL('calculator/border-history.html',root),sealCalculatorHTML(html));return {version,dates:rows.length,records:normalizeHistoryRows(rows).length};}
if(process.argv[1]?.endsWith('prepare-history-page.mjs'))console.log(JSON.stringify(await prepareHistoryPage()));
