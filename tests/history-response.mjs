import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {HISTORY_RESPONSE_MAX_BYTES,readHistoryResponse} from '../calculator/history-core.mjs';

const encode=value=>new TextEncoder().encode(value);
function trackedResponse(chunks=[],options={}){
 const calls={reads:0,cancels:0,releases:0,text:0};
 const reader={
  read(){calls.reads++;return options.read?options.read(calls.reads):Promise.resolve(chunks.length?{done:false,value:chunks.shift()}:{done:true});},
  cancel(){calls.cancels++;return options.cancel?.();},
  releaseLock(){calls.releases++;}
 };
 const response={
  headers:new Headers(options.length===undefined?{}:{'content-length':String(options.length)}),
  body:{getReader:()=>reader,cancel:()=>reader.cancel()},
  text(){calls.text++;throw Error('Unbounded text fallback must not be called');}
 };
 return {response,calls};
}
const tooLarge=error=>error instanceof RangeError&&/大きすぎ/.test(error.message);
const aborted=error=>error?.name==='AbortError';

test('reads native Fetch responses with or without Content-Length',async()=>{
 const expected=JSON.stringify({message:'過去のボーダー',rows:[]});
 for(const headers of [{},{'content-length':String(encode(expected).byteLength)}]){
  const response=new Response(expected,{headers});
  assert.equal(await readHistoryResponse(response),expected);
  assert.equal(response.body.locked,false);
 }
});

test('rejects oversized declared lengths before any read and cancels the body',async()=>{
 for(const length of [HISTORY_RESPONSE_MAX_BYTES+1,'9'.repeat(100)]){
  const {response,calls}=trackedResponse([encode('small')],{length});
  await assert.rejects(readHistoryResponse(response),tooLarge);
  assert.deepEqual(calls,{reads:0,cancels:1,releases:0,text:0});
 }
});

test('accepts exactly 8 MiB of actual bytes, independent of a smaller declaration',async()=>{
 const chunk=new Uint8Array(HISTORY_RESPONSE_MAX_BYTES).fill(97);
 const {response,calls}=trackedResponse([chunk.subarray(0,65536),chunk.subarray(65536)],{length:1});
 const text=await readHistoryResponse(response);
 assert.equal(text.length,HISTORY_RESPONSE_MAX_BYTES);
 assert.equal(text[0],'a');assert.equal(text.at(-1),'a');
 assert.deepEqual(calls,{reads:3,cancels:0,releases:1,text:0});
});

test('stops at the first chunk exceeding the byte limit and does not decode it',async()=>{
 const chunk=new Uint8Array(HISTORY_RESPONSE_MAX_BYTES).fill(97);
 // 0xff would cause a UTF-8 error if decoding occurred before the byte check.
 const {response,calls}=trackedResponse([chunk,new Uint8Array([255]),encode('unread')],{length:1});
 await assert.rejects(readHistoryResponse(response),tooLarge);
 assert.deepEqual(calls,{reads:2,cancels:1,releases:1,text:0});
});

test('checks missing or malformed Content-Length against the actual stream bytes',async()=>{
 for(const length of [undefined,'invalid','-1','1, 2']){
  const {response,calls}=trackedResponse([new Uint8Array(HISTORY_RESPONSE_MAX_BYTES+1)],{length});
  await assert.rejects(readHistoryResponse(response),tooLarge);
  assert.equal(calls.reads,1);assert.equal(calls.cancels,1);assert.equal(calls.text,0);
 }
});

test('counts UTF-8 bytes rather than JavaScript string length',async()=>{
 const text='日'.repeat(Math.floor(HISTORY_RESPONSE_MAX_BYTES/3)+1);
 assert.ok(text.length<HISTORY_RESPONSE_MAX_BYTES);
 const {response,calls}=trackedResponse([encode(text)]);
 await assert.rejects(readHistoryResponse(response),tooLarge);
 assert.equal(calls.cancels,1);
});

test('decodes Japanese, emoji and BOM correctly across every byte boundary',async()=>{
 const expected='{"message":"日本語🗓️・記録","value":123}';
 const bytes=encode('\uFEFF'+expected);
 const stream=new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(new Uint8Array([byte]));controller.close();}});
 assert.equal(await readHistoryResponse(new Response(stream)),expected);
});

test('rejects malformed or unfinished UTF-8 and cancels instead of replacing characters',async()=>{
 for(const chunks of [[new Uint8Array([255])],[new Uint8Array([227,129])]]){
  const {response,calls}=trackedResponse(chunks);
  await assert.rejects(readHistoryResponse(response),TypeError);
  assert.equal(calls.cancels,1);assert.equal(calls.releases,1);
 }
});

test('accepts byte views from another realm and rejects non-byte stream chunks',async()=>{
 const crossRealmBytes=vm.runInNewContext('new Uint8Array([65,66,67])');
 assert.equal(await readHistoryResponse(trackedResponse([crossRealmBytes]).response),'ABC');
 for(const chunk of ['ABC',new Uint16Array([65]),new DataView(new ArrayBuffer(1))]){
  const {response,calls}=trackedResponse([chunk]);
  await assert.rejects(readHistoryResponse(response),TypeError);
  assert.equal(calls.cancels,1);assert.equal(calls.releases,1);
 }
});

test('an already aborted signal cancels without reading',async()=>{
 const controller=new AbortController();controller.abort();
 const {response,calls}=trackedResponse([encode('unread')]);
 await assert.rejects(readHistoryResponse(response,controller.signal),aborted);
 assert.deepEqual(calls,{reads:0,cancels:1,releases:0,text:0});
});

test('aborts a pending read without waiting for an uncooperative cancel',async()=>{
 const controller=new AbortController();
 const {response,calls}=trackedResponse([],{read:()=>new Promise(()=>{}),cancel:()=>new Promise(()=>{})});
 const pending=readHistoryResponse(response,controller.signal);
 assert.equal(calls.reads,1);
 controller.abort();
 await assert.rejects(pending,aborted);
 assert.deepEqual(calls,{reads:1,cancels:1,releases:1,text:0});
});

test('native stream cancellation and lock cleanup follow abort',async()=>{
 const controller=new AbortController();let cancelled=0;
 const response=new Response(new ReadableStream({cancel(){cancelled++;}},{highWaterMark:0}));
 const pending=readHistoryResponse(response,controller.signal);
 controller.abort();
 await assert.rejects(pending,aborted);
 assert.equal(cancelled,1);assert.equal(response.body.locked,false);
});

test('read failures are preserved and cleanup survives rejected cancellation',async()=>{
 const failure=new Error('network failure');
 const {response,calls}=trackedResponse([],{read:()=>Promise.reject(failure),cancel:()=>Promise.reject(Error('cancel failure'))});
 await assert.rejects(readHistoryResponse(response),error=>error===failure);
 assert.equal(calls.cancels,1);assert.equal(calls.releases,1);
});

test('removes abort listeners after success and failure',async()=>{
 for(const fail of [false,true]){
  const controller=new AbortController();let adds=0,removes=0;
  const signal={get aborted(){return controller.signal.aborted;},addEventListener(...args){adds++;controller.signal.addEventListener(...args);},removeEventListener(...args){removes++;controller.signal.removeEventListener(...args);}};
  const {response,calls}=trackedResponse([fail?new Uint8Array([255]):encode('complete')]);
  if(fail)await assert.rejects(readHistoryResponse(response,signal),TypeError);
  else assert.equal(await readHistoryResponse(response,signal),'complete');
  assert.equal(adds,1);assert.equal(removes,1);
  controller.abort();
  assert.equal(calls.cancels,fail?1:0);
 }
});

test('empty bodies remain empty and unavailable stream readers fail closed',async()=>{
 assert.equal(await readHistoryResponse(new Response(null)),'');
 const {response,calls}=trackedResponse();delete response.body.getReader;
 await assert.rejects(readHistoryResponse(response),TypeError);
 assert.equal(calls.text,0);assert.equal(calls.cancels,1);
});
