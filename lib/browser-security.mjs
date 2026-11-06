import {createHash} from 'node:crypto';
export function scriptSources(html) {
  const hashes=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].filter(match=>match[1].trim()).map(match=>"'sha256-"+createHash('sha256').update(match[1]).digest('base64')+"'");
  return [...new Set(hashes)].join(' ');
}
export function sealCalculatorHTML(html) {return html.replace(/script-src\s+[^;\"]+;/,"script-src "+scriptSources(html)+";");}
export function pagePolicy(html,admin=false) {
  const declared=html.match(/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/i)?.[1];
  const base=declared||`default-src 'none'; script-src 'self' ${scriptSources(html)}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'`;
  return base+`; frame-ancestors ${admin?"'none'":"'self' https://chatgpt.com"}`;
}
