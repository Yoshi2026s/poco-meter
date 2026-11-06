const CATALOG_ORIGIN='https://pococha-comment-access.freefreelife2000.chatgpt.site';
async function boundedCatalogAccess(toolId){
 const controller=new AbortController();let timer,reader;
 const work=(async()=>{
  const r=await fetch(CATALOG_ORIGIN+'/api/catalog/access/'+toolId,{headers:{'User-Agent':'Pococha1012-Catalog/1.0','Accept':'application/json'},redirect:'manual',cache:'no-store',signal:controller.signal});
  if(r.status!==200)throw Error('Catalog HTTP');
  const length=r.headers.get('Content-Length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>4096))throw Error('Catalog size');
  if(!r.body)throw Error('Catalog body');reader=r.body.getReader();let size=0;const chunks=[];
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>4096)throw Error('Catalog size');chunks.push(part.value);}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
  const s=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!s||s.id!==toolId||typeof s.enabled!=='boolean')throw Error('Catalog schema');return s.enabled;
 })();
 try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Catalog timeout'));},8000);})]);}
 finally{clearTimeout(timer);controller.abort();if(reader)void reader.cancel().catch(()=>{});}
}
export async function catalogGate(request,env,toolId){
 const owner=!!env.CATALOG_OWNER_EMAIL&&!!request.headers.get('oai-authenticated-user-id')&&request.headers.get('oai-authenticated-user-email')?.toLowerCase()===env.CATALOG_OWNER_EMAIL.toLowerCase();
 if(owner)return null;
 let enabled=false,unavailable=false;
 try{enabled=await boundedCatalogAccess(toolId);}catch{unavailable=true;}
 if(enabled)return null;
 const message=unavailable?'公開設定を確認できません。時間をおいて開き直してください。':'このツールは現在非公開です。';
 const h={'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex','Vary':'Cookie, oai-authenticated-user-id, oai-authenticated-user-email'};
 const status=unavailable?503:403;
 if(new URL(request.url).pathname.startsWith('/api/')||!['GET','HEAD'].includes(request.method))return new Response(JSON.stringify({error:message}),{status,headers:{...h,'Content-Type':'application/json; charset=utf-8'}});
 return new Response(request.method==='HEAD'?null:'<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>公開設定</title><body><main><h1>'+message+'</h1><p><a href="/signin-with-chatgpt?return_to=%2F" target="_top">所有者としてログイン</a></p></main></body></html>',{status,headers:{...h,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; base-uri 'none'"}});
}
