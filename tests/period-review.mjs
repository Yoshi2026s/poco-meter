import test from 'node:test';
import assert from 'node:assert/strict';
import {engine,pageEngine,plain} from './calculator-harness.mjs';
const KEY='pococha-meter-calc-v1';
const base=()=>({...plain(engine().state),seedVer:3,seedVer13:1,goalDefaultsVersion:1,pick:'',target:'1000',current:'700',coreCount:'0'});
const saved=p=>JSON.parse(p.stored.get(KEY));
for(const [deadline,before,after] of [
 ['13:00','2026-10-03T12:59:59.900+09:00','2026-10-03T13:00:00+09:00'],
 ['22:00','2026-10-03T21:59:59.900+09:00','2026-10-03T22:00:00+09:00'],
 ['00:00','2026-10-03T23:59:59.900+09:00','2026-10-04T00:00:00+09:00'],
])test('Review appears at the exact '+deadline+' cutoff, preserves values and supports undo',()=>{
 const p=pageEngine({...base(),deadline,currentSavedAt:Date.parse(before)},{navigator:{onLine:false}});
 p.setNow(before);p.tick(1000);assert.equal(p.element('periodNotice').hidden,true);
 p.setNow(after);p.tick(1000);
 for(const id of ['periodNotice','periodNoticeActions','miniPeriodReview'])assert.equal(p.element(id).hidden,false,id);
 assert.equal(saved(p).current,'700');assert.equal(saved(p).target,'1000');
 p.element('miniPeriodReview').click();assert.equal(p.document.activeElement,p.element('currentMini'),'review goes to the simple-menu current field (detailed meter is hidden)');
 assert.equal(saved(p).current,'700');
 p.element('resetPeriodCurrent').click();assert.equal(saved(p).current,'0');assert.equal(saved(p).target,'1000');
 for(const id of ['periodNotice','periodNoticeActions','miniPeriodReview'])assert.equal(p.element(id).hidden,true,id);
 p.element('undoCurrent').click();assert.equal(saved(p).current,'700');assert.equal(p.element('periodNotice').hidden,false);
});
test('Invalid current input never dismisses the period review; a valid update does',()=>{
 const p=pageEngine({...base(),currentSavedAt:Date.parse('2026-10-02T20:00:00+09:00')},{navigator:{onLine:false}});
 p.element('reviewPeriodCurrent').click();assert.equal(p.document.activeElement,p.element('currentMini'));
 const input=p.element('currentMini');input.value='-1';input.dispatchEvent(new Event('input'));p.tick(1000);
 assert.equal(p.element('periodNotice').hidden,false);assert.equal(saved(p).current,'700');
 input.value='200';input.dispatchEvent(new Event('input'));assert.equal(saved(p).current,'200');assert.equal(p.element('periodNoticeActions').hidden,true);
});
test('Unsynchronized clock exposes unknown uncertainty in normal and fixed views',()=>{
 const p=pageEngine(base(),{navigator:{onLine:false}});
 assert.match(p.element('clockAccuracy').textContent,/未確認/);
 assert.equal(p.element('clockAccuracy').textContent,p.element('miniClockAccuracy').textContent);
});
test('Synchronized uncertainty is an estimate and survives failure until sample expiry',()=>{
 const e=engine();let mono=1000;e.performance={now:()=>mono};
 e.clockSample={monoMs:1000,timeMs:Date.parse('2026-10-03T21:00:00+09:00'),uncertaintyMs:1200};e.clockState='synced';
 assert.equal(e.clockBasis().accuracy,'通信誤差目安 ±2秒');
 e.clockState='failed';mono+=1000;assert.equal(e.clockBasis().accuracy,'通信誤差目安 ±2秒');
 assert.match(e.clockBasis().secondary,/再同期失敗/);
 mono+=300001;assert.match(e.clockBasis().accuracy,/未確認/);
});
