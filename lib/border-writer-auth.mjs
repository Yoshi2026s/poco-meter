// Only the unattended owner updater signs shared border writes. Calculator
// visitors and read-only source discovery never need authentication.
const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const keyBytes = value => Uint8Array.from(value.match(/../g), b => parseInt(b, 16));
export function borderWriterHeadersValid(request, env, now = Date.now()) {
  const key = env.BORDER_WRITER_KEY;
  const stamp = request.headers.get('X-Border-Writer-Time') ?? '';
  const signature = request.headers.get('X-Border-Writer-Signature') ?? '';
  const path = new URL(request.url).pathname;
  if (request.method !== 'POST' || !['/api/borders/source-urls', '/api/borders/refresh'].includes(path)) return false;
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key) || !/^[1-9][0-9]{9,10}$/.test(stamp) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const age = Math.floor(now / 1000) - Number(stamp);
  if (age < -60 || age > 300) return false;
  return true;
}
export async function verifyBorderWrite(request, rawBody, env, now = Date.now()) {
  if (!borderWriterHeadersValid(request, env, now)) return false;
  const key = env.BORDER_WRITER_KEY;
  const stamp = request.headers.get('X-Border-Writer-Time');
  const signature = request.headers.get('X-Border-Writer-Signature');
  const path = new URL(request.url).pathname;
  const digest = hex(await crypto.subtle.digest('SHA-256', rawBody));
  const message = encoder.encode(`POST\n${path}\n${stamp}\n${digest}`);
  const signingKey = await crypto.subtle.importKey('raw', keyBytes(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', signingKey, keyBytes(signature), message);
}
