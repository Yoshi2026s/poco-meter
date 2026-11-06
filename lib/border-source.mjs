export const SOURCE_INDEX = 'https://one-carat.com/campus/archives/category/streamer-tips/pococha-rank-border';
import {readLimitedBytes} from './security-limits.mjs';
export const FALLBACK_URLS = [
  'https://one-carat.com/campus/archives/89495',
  'https://one-carat.com/campus/archives/89496',
  'https://one-carat.com/campus/archives/89497',
];
export const RANKS = ['D1','D2','D3','C1','C2','C3','B1','B2','B3','A1','A2','A3','S1','S2','S3','S4','S5','S6'];
const MAX = Math.floor(Number.MAX_SAFE_INTEGER / 25);
export const jstDate = (now = new Date()) => new Date(now.getTime()+9*3600e3).toISOString().slice(0,10);
export const validDate = d => {
  if(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d))return false;
  const parsed=new Date(d+'T00:00:00Z');
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===d;
};
export const validTriple = v => Array.isArray(v) && v.length===3 && v.every(n=>Number.isSafeInteger(n)&&n>0&&n<=MAX) && v[0]<=v[1] && v[1]<=v[2];
export const sourceUrl = s => /^https:\/\/one-carat\.com\/campus\/archives\/\d+$/.test(s);
const INTEGER_TEXT='(?:\\d{1,3}(?:,\\d{3})+|\\d+)';
const BORDER_ROW=new RegExp('^【([DCBAS]\\d)】\\s*［±0］('+INTEGER_TEXT+')\\s*［\\+1］('+INTEGER_TEXT+')\\s*［\\+2］('+INTEGER_TEXT+')$');
function plain(s) {
  return s.replace(/<[^>]*>/g,'').replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n)))
    .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
}
export function discoverArticles(html) {
  const found = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    // A malformed navigation/ad link must not discard all valid articles.
    let title;try{title=plain(m[2]);}catch{continue;}
    const period=title.match(/(20\d{2})年(\d{1,2})月/), close=title.match(/(13|22|24)時締め/);
    if(!period||+period[2]<1||+period[2]>12||!/Pococha.*ボーダー/.test(title)||!close)continue;
    let url;try{url=new URL(m[1],SOURCE_INDEX).href.replace(/\/$/,'');}catch{continue;}
    if(sourceUrl(url)) found.push({url,month:+period[1]*12+(+period[2]),close:close[1]});
  }
  const latest=new Map();for(const row of found.sort((a,b)=>b.month-a.month))if(!latest.has(row.close))latest.set(row.close,row.url);
  return [...latest.values()];
}
export function parseArticle(html,url,now=new Date()) {
  if(!sourceUrl(url))throw new Error('Unsupported source');
  const titles=[...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m=>plain(m[1]));
  const title=titles.find(t=>/20\d{2}年\d{1,2}月.*Pococha.*ボーダー.*(13|22|24)時締め/.test(t));
  const info=title?.match(/(20\d{2})年(\d{1,2})月.*(13|22|24)時締め/);
  if(!info||+info[2]<1||+info[2]>12)throw new Error('Source title changed');
  const section=[...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2\b|$)/gi)].find(m=>/前日ランクボーダー.*コピー/.test(plain(m[1])))?.[2];
  if(!section)throw new Error('Daily copy section missing');
  const headings=[...section.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)];
  const heading=headings[0];
  const day=heading&&plain(heading[1]).trim().match(/^(\d{1,2})月(\d{1,2})日$/);
  if(!day)throw new Error('Explicit data date missing');
  const month=+day[1], articleMonth=+info[2];
  if(month!==articleMonth && month!==(articleMonth===1?12:articleMonth-1))throw new Error('Unexpected data month');
  const year=+info[1]-(month>articleMonth?1:0);
  const date=String(year)+'-'+String(month).padStart(2,'0')+'-'+day[2].padStart(2,'0');
  if(!validDate(date)||date>=jstDate(now))throw new Error('Data day is incomplete or invalid');
  // Values belong only to this explicitly labelled day. A later heading must
  // never provide missing ranks for the first day.
  const dailySection=section.slice(heading.index+heading[0].length,headings[1]?.index??section.length);
  const ranks={};
  for(const m of dailySection.matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi)) {
    const row=plain(m[1]).trim().match(BORDER_ROW);
    if(!row)throw new Error('Border format changed');
    const rank=row[1],vals=row.slice(2).map(s=>Number(s.replace(/,/g,'')));
    if(!RANKS.includes(rank)||ranks[rank]||!validTriple(vals))throw new Error('Invalid border triple');
    ranks[rank]=vals;
  }
  if(RANKS.some(r=>!ranks[r])||Object.keys(ranks).length!==18)throw new Error('Incomplete ranks');
  return {date,close:info[3],ranks,sourceURL:url};
}
export async function fetchHtml(url,fetcher=fetch) {
  const response=await fetcher(url,{headers:{Accept:'text/html'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Source HTTP '+response.status);
  if(!response.headers.get('content-type')?.includes('text/html'))throw new Error('Source content type changed');
  const body=new TextDecoder('utf-8',{fatal:true}).decode(await readLimitedBytes(response,3600000));
  if(body.length>1200000)throw new Error('Source too large');
  return body;
}
export function resolveBorderRows(rows) {
  const unique=new Map(),conflicts=new Set();
  for(const row of rows){
    const key=row.date+'|'+row.close,prior=unique.get(key);
    if(conflicts.has(key))continue;
    if(prior&&RANKS.some(rank=>JSON.stringify(prior.ranks[rank])!==JSON.stringify(row.ranks[rank]))){
      unique.delete(key);conflicts.add(key);continue;
    }
    if(!prior)unique.set(key,row);
  }
  const accepted=[...unique.values()],cutoffs=new Set(accepted.map(row=>row.close));
  return {rows:accepted,partial:conflicts.size>0||['13','22','24'].some(close=>!cutoffs.has(close))};
}
export async function collectBorders(now=new Date(),fetcher=fetch,known=[]) {
  let discovered=[],indexOk=false;
  try {discovered=discoverArticles(await fetchHtml(SOURCE_INDEX,fetcher)); indexOk=discovered.length>0;} catch { /* Keep last verified records on source failure. */ }
  const urls=discovered.length===3?discovered:[...new Set([...discovered,...known.filter(sourceUrl),...FALLBACK_URLS])].slice(0,9);
  const results=await Promise.allSettled(urls.map(async url=>parseArticle(await fetchHtml(url,fetcher),url,now)));
  const rows=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
  const errors=results.filter(r=>r.status==='rejected').length;
  // Matching repeated observations are safe to deduplicate. Conflicting
  // observations stay unverified, regardless of which URL was fetched first.
  const resolved=resolveBorderRows(rows);
  return {rows:resolved.rows,partial:!indexOk||errors>0||resolved.partial};
}
