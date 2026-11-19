import {createHash} from 'node:crypto';
export function scriptSources(html) {
  const hashes=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].filter(match=>match[1].trim()).map(match=>"'sha256-"+createHash('sha256').update(match[1]).digest('base64')+"'");
  return [...new Set(hashes)].join(' ');
}
// 封印時に元のページから残す送信元は許可リスト方式：'self'・'wasm-unsafe-eval'・https の個別ホスト（ワイルドカード・ポートなし）だけ。
// 古いハッシュ・nonce（作り直す）、インライン全許可・eval 系、*・*.example.com・https://*・http:・//host・スキーム全許可などはすべて捨てる。
const KEPT_SCRIPT_SOURCE=/^(?:'self'|'wasm-unsafe-eval'|https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[a-z0-9._~\/-]*)?)$/i;
export function sealCalculatorHTML(html) {
  return html.replace(/script-src\s+([^;\"]+);/,(_,declared)=>{
    const kept=declared.trim().split(/\s+/).filter(token=>KEPT_SCRIPT_SOURCE.test(token));
    return "script-src "+[scriptSources(html),...new Set(kept)].filter(Boolean).join(' ')+";";
  });
}
export function pagePolicy(html,admin=false) {
  const declared=html.match(/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/i)?.[1];
  const base=declared||`default-src 'none'; script-src 'self' ${scriptSources(html)}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'`;
  return base+`; frame-ancestors ${admin?"'none'":"'self' https://chatgpt.com"}`;
}
