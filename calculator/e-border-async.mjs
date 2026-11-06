export function eTimed(promise,milliseconds,signal,message='処理が長いため中止しました。通信を確認して再試行してください。'){
 return new Promise((resolve,reject)=>{
  let settled=false,timer;const finish=(fn,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);fn(value);};
  const abort=()=>finish(reject,Object.assign(Error('読取を中止しました。'),{name:'AbortError'}));
  Promise.resolve(promise).then(value=>finish(resolve,value),error=>finish(reject,error));
  if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>finish(reject,Object.assign(Error(message),{code:'ETIMEOUT'})),milliseconds);
 });
}
