import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {verifyBorderWrite} from '../lib/border-writer-auth.mjs';
import {borderApi} from '../lib/border-store.mjs';
const key='ab'.repeat(32),env={BORDER_WRITER_KEY:key},now=Date.now();
function signed(path,body,stamp=String(Math.floor(now/1000)),override={}) {
  const digest=createHash('sha256').update(body).digest('hex');
  const signature=createHmac('sha256',Buffer.from(key,'hex')).update(`POST\n${path}\n${stamp}\n${digest}`).digest('hex');
  return new Request('https://example.chatgpt.site'+path,{method:'POST',body,headers:{'X-Border-Writer-Time':stamp,'X-Border-Writer-Signature':signature,...override}});
}
const body=JSON.stringify({indexHTML:'日本語\n実際の本文'}),path='/api/borders/source-urls';
const request=signed(path,body);
assert.equal(await verifyBorderWrite(request,new TextEncoder().encode(body),env,now),true);
assert.equal(await verifyBorderWrite(request,new TextEncoder().encode(body+' '),env,now),false);
assert.equal(await verifyBorderWrite(request,new TextEncoder().encode(body),{},now),false);
for(const stamp of [String(Math.floor(now/1000)-301),String(Math.floor(now/1000)+61),'01','NaN','0'])assert.equal(await verifyBorderWrite(signed(path,body,stamp),new TextEncoder().encode(body),env,now),false);
for(const p of [path,'/api/borders/refresh']) {
  let touched=false;const protectedEnv={...env,DB:{prepare(){touched=true;throw new Error('Unexpected write');}}};
  const anonymous=await borderApi(new Request('https://example.chatgpt.site'+p,{method:'POST',body:'not JSON'}),protectedEnv);
  assert.equal(anonymous.status,403);assert.equal(touched,false);
  assert.equal((await borderApi(signed(p,'{}',undefined,{'X-Border-Writer-Signature':'0'.repeat(64)}),protectedEnv)).status,403);
  assert.equal(touched,false);
}
assert.equal((await borderApi(new Request('https://example.chatgpt.site'+path),{})).status,200);
const fixture=await readFile(new URL('./fixtures/category.html',import.meta.url),'utf8');
const lookup=await borderApi(signed(path,JSON.stringify({indexHTML:fixture})),env);
assert.equal(lookup.status,200);assert.equal((await lookup.json()).urls.length,3);
assert.equal((await borderApi(signed('/api/borders/refresh','{}'),env)).status,400);
assert.equal((await borderApi(signed(path,'x'.repeat(3000001)),env)).status,413);
assert.equal((await borderApi(signed(path,body,undefined,{Origin:'https://other.example'}),env)).status,403);
console.log('Border writer authorization passed: independent Node/WebCrypto signature, tampering, missing key, clock bounds, anonymous rejection before DB, public discovery, actual source, payload and origin limits.');
