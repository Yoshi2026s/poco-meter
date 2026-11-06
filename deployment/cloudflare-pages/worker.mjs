import {borderApi} from '../../lib/border-store.mjs';

export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/')) {
      if(!['/api/borders','/api/borders/source-urls','/api/borders/refresh'].includes(url.pathname))return new Response(JSON.stringify({error:'Not found'}),{status:404,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
      // Only the production origin accepts owner-signed writes. Preview sites
      // and anonymous calculator visitors cannot write the shared database.
      if(request.method==='POST'&&(!env.BORDER_WRITER_ORIGIN||url.origin!==env.BORDER_WRITER_ORIGIN))return new Response(JSON.stringify({error:'Production writer origin required'}),{status:403,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
      return borderApi(request,env);
    }
    return env.ASSETS.fetch(request);
  }
};
