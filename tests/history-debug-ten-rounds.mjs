// Ten fresh-process regression passes; these are repeated tests, not ten
// independent human audits. The separate mobile audit covers 10M input cases.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=resolve(root,process.env.HISTORY_DEBUG_OUTPUT||'docs/history-debug-ten-rounds-result.json');
const files=['history-navigation','history-response','history-calendar','history-card-copy','history-storage','history-archive','history-search','history-independent','history-page-ui','github-meter-export','border-client-precision','border-read-cache','offline-sw-50','security-hardening'].map(name=>'tests/'+name+'.mjs');
const sources=['calculator/history-core.mjs','calculator/history-ui.mjs','calculator/history-page-template.html','calculator/border-history.html','calculator/index.html','calculator/sw.js','scripts/prepare-github-meter.mjs',...files];
const hashes=()=>Object.fromEntries(sources.map(path=>[path,createHash('sha256').update(readFileSync(root+path)).digest('hex')]));
const started=Date.now(),before=hashes(),rounds=[];
const report={status:'running',plannedRounds:10,files,excludedTest:'10000 distinct filter/date/pagination/unit conditions (superseded by separate 10M audit)',sourceSHA256:before,rounds,limitation:'Fresh Node processes, shipped code, DOM doubles, simulated network and service worker; no physical iPhone or Safari rendering.'};
mkdirSync(dirname(output),{recursive:true});
for(let round=1;round<=10;round++){
 const t=Date.now(),result=spawnSync(process.execPath,['--test','--test-concurrency=2','--test-reporter=tap','--test-skip-pattern=10000 distinct',...files],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024,timeout:180000});
 const out=result.stdout||'',number=label=>Number(out.match(new RegExp('^# '+label+' (\\d+)$','m'))?.[1]||0);
 const item={round,status:result.status===0?'passed':'failed',tests:number('tests'),passed:number('pass'),failed:number('fail'),skipped:number('skipped'),durationMs:Date.now()-t,exitCode:result.status};
 if(result.error)item.error=result.error.message;
 if(result.status!==0){item.failureOutput=(out+'\n'+result.stderr).slice(-30000);}
 rounds.push(item);report.durationMs=Date.now()-started;report.sourceUnchanged=JSON.stringify(before)===JSON.stringify(hashes());
 report.status=rounds.some(r=>r.status!=='passed')||!report.sourceUnchanged?'failed':round===10?'passed':'running';
 report.executedTests=rounds.reduce((sum,r)=>sum+r.tests,0);report.passedTests=rounds.reduce((sum,r)=>sum+r.passed,0);report.failedTests=rounds.reduce((sum,r)=>sum+r.failed,0);
 writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(item));
 if(report.status==='failed'){process.exitCode=1;break;}
}
console.log(JSON.stringify({status:report.status,rounds:rounds.length,passedTests:report.passedTests,failedTests:report.failedTests,durationMs:report.durationMs,sourceUnchanged:report.sourceUnchanged}));
