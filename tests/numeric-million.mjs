import assert from 'node:assert/strict';
import {engine} from './calculator-harness.mjs';
const e=engine();let count=0;
for(let n=1;n<=250000;n++){
 for(const input of [String(n),n.toLocaleString('en-US'),(n/1000).toFixed(3)+'K',(n/10000).toFixed(4)+'万']){assert.equal(e.readNumber(input),n,input);count++;}
}
console.log(JSON.stringify({status:'passed',assertions:count,scope:'Integer point parsing, comma grouping, K and 万 conversions. Not one million browser sessions or fixes.'}));
