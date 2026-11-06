import assert from 'node:assert/strict';
import {historyCardText} from '../calculator/history-core.mjs';

const row={date:'2026-10-03',rank:'S2',close:'22',values:[0,1001,23456789],origin:'archive',checkedAt:'2026-10-14T13:04:05+09:00',source:'https://one-carat.com/campus/archives/17568'};
const before=structuredClone(row);
assert.equal(historyCardText(row),`【過去のボーダー｜Pococha1012】
2026/10/03 S2 22時〆
±0：0 pt
+1：1,001 pt
+2：23,456,789 pt
記録：掲載資料 · 確認 2026-10-14 13:04:05
出典：https://one-carat.com/campus/archives/17568`);
assert.equal(historyCardText(row,'K'),`【過去のボーダー｜Pococha1012】
2026/10/03 S2 22時〆
±0：0K
+1：1K
+2：23,457K
記録：掲載資料 · 確認 2026-10-14 13:04:05
出典：https://one-carat.com/campus/archives/17568`);
assert.deepEqual(row,before,'Formatting must not change the stored row');

const local={...row,rank:'B3',close:'24',values:[1000,12500,100000],origin:'manual',checkedAt:'',source:'',target:'private target',current:'private current',toolURL:'https://private.invalid/'};
assert.equal(historyCardText(local),`【過去のボーダー｜Pococha1012】
2026/10/03 B3 24時〆
±0：1,000 pt
+1：12,500 pt
+2：100,000 pt
記録：手入力 · 確認日時なし`);
assert.doesNotMatch(historyCardText(local),/出典：|private|\\n/,'Omit an empty source, unrelated settings and literal newline escapes');
assert.equal(historyCardText({...local,close:'13',origin:'backup'},'K').split('\n')[1],'2026/10/03 B3 13時〆');
assert.equal(historyCardText({...local,origin:'legacy'}).split('\n').at(-1),'記録：旧版参考値 · 確認日時なし');
assert.equal(historyCardText({...local,origin:'unknown'}).split('\n').at(-1),'記録：出典未確認 · 確認日時なし');

// Integer K rounding must remain correct near the accepted limit.
const max=Math.floor(Number.MAX_SAFE_INTEGER/25),large={...local,values:[max-2,max-1,max]};
for(const [i,line] of historyCardText(large,'K').split('\n').slice(2,5).entries()){
 const number=line.split('：')[1].replaceAll(',','').slice(0,-1);
 assert.equal(BigInt(number),(BigInt(large.values[i])+500n)/1000n);
}
assert.equal(historyCardText({...local,values:[1000,12500,100000]},'K').split('\n')[2],'±0：1K');
console.log('History card copy: exact pt/rounded K text, all cutoffs, provenance, missing timestamp/source, no unrelated fields, immutable row and maximum-value rounding passed');
