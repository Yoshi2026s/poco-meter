import {createHash} from 'node:crypto';
export function scriptSources(html) {
  const hashes=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].filter(match=>match[1].trim()).map(match=>"'sha256-"+createHash('sha256').update(match[1]).digest('base64')+"'");
  return [...new Set(hashes)].join(' ');
}
// 封印時に捨てる送信元：古いハッシュ・nonce（作り直す）、インライン全許可・eval 系、ワイルドカード・スキーム全許可。
// それ以外（https://cdn.jsdelivr.net などの個別ホスト、'self'、'wasm-unsafe-eval'）は元のページの指定を残す。
const DROPPED_SCRIPT_SOURCE=/^(?:'(?:sha(?:256|384|512)-[^']*|nonce-[^']*|unsafe-inline|unsafe-eval|unsafe-hashes|strict-dynamic|none)'|\*|[a-z][a-z0-9+.-]*:)$/i;
export function sealCalculatorHTML(html) {
  return html.replace(/script-src\s+([^;\"]+);/,(_,declared)=>{
    const kept=declared.trim().split(/\s+/).filter(token=>token&&!DROPPED_SCRIPT_SOURCE.test(token));
    return "script-src "+[scriptSources(html),...new Set(kept)].filter(Boolean).join(' ')+";";
  });
}
export function pagePolicy(html,admin=false) {
  const declared=html.match(/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/i)?.[1];
  const base=declared||`default-src 'none'; script-src 'self' ${scriptSources(html)}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'`;
  return base+`; frame-ancestors ${admin?"'none'":"'self' https://chatgpt.com"}`;
}
