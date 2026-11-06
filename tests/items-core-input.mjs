import assert from 'node:assert/strict';
import {pageEngine,engine,plain} from './calculator-harness.mjs';
const config={...plain(engine().state),target:'100000',current:'0',coreCount:'0',seedVer:3,seedVer13:1,snapshotVersion:'2026-10-02-v3',goalDefaults:{...plain(engine().standardGoalDefaults()),applyOnLoad:false}};
const p=pageEngine(config,{navigator:{onLine:false}}),el=id=>p.element(id),edit=(id,value)=>{el(id).value=value;el(id).dispatchEvent(new Event('input'));};
const before=el('coinNeed').textContent;edit('coreCountItems','40');assert.equal(el('coreCountTop').value,'40');assert.equal(el('coreBonusTop').textContent,'109%');assert.notEqual(el('coinNeed').textContent,before);assert.equal(JSON.parse(p.stored.get('pococha-meter-calc-v1')).coreCount,'40');
edit('coreCountTop','0');assert.equal(el('coreCountItems').value,'0');assert.equal(el('coinNeed').textContent,before);
for(const invalid of ['-1','1001','2.5','abc']){edit('coreCountItems',invalid);assert.equal(el('coreCountItems').getAttribute('aria-invalid'),'true');assert.equal(el('coreBonusTop').textContent,'100%');assert.equal(el('coinNeed').textContent,before);}
edit('coreCountItems','１０００');assert.equal(el('coreCountTop').value,'1000');assert.equal(el('coreCountItems').getAttribute('aria-invalid'),'false');
console.log('Items HUD core input: immediate calculation, bidirectional sync, saved value, invalid input and fullwidth integers passed');
