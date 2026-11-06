import assert from 'node:assert/strict';
import {historyCalendarMonth,historyMonthRange,validHistoryDate} from '../calculator/history-core.mjs';

// Cover the three possible week counts, leap days, both year bounds and a year transition.
const cases=[
 ['2026-02',0,28,28],
 ['2024-02',4,29,35],
 ['2021-05',6,31,42],
 ['2000-01',6,31,42],
 ['2000-02',2,29,35],
 ['2099-02',0,28,28],
 ['2099-12',2,31,35],
 ['2025-12',1,31,35],
 ['2026-01',4,31,35],
];
for(const [month,weekday,days,length] of cases){
 const calendar=historyCalendarMonth(month),range=historyMonthRange(month);
 assert.deepEqual({month:calendar.month,start:calendar.start,end:calendar.end},range);
 assert.equal(calendar.cells.length,length);
 assert.equal(calendar.cells.length%7,0);
 assert.deepEqual(calendar.cells.slice(0,weekday),Array(weekday).fill(null));
 assert.equal(calendar.cells[weekday],range.start);
 assert.equal(calendar.cells[weekday+days-1],range.end);
 assert.deepEqual(calendar.cells.slice(weekday+days),Array(length-weekday-days).fill(null));
 const dates=calendar.cells.filter(date=>date!==null);
 assert.equal(dates.length,days);
 assert.equal(new Set(dates).size,days);
 dates.forEach((date,index)=>{
  assert.equal(date,month+'-'+String(index+1).padStart(2,'0'));
  assert.equal(validHistoryDate(date),true);
  assert.equal(new Date(date+'T00:00:00Z').getUTCDay(),(weekday+index)%7);
 });
}
assert.equal(historyCalendarMonth(historyMonthRange('2025-12',1).month).start,'2026-01-01');
assert.equal(historyCalendarMonth(historyMonthRange('2026-01',-1).month).end,'2025-12-31');
for(const month of [undefined,null,202602,'','1999-12','2100-01','2026-00','2026-13','2026-2','2026-02-01',' 2026-02','2026-02 '])assert.equal(historyCalendarMonth(month),null);

// A local timezone must not move the weekday or calendar date.
const originalTZ=process.env.TZ;
try{
 const expected=historyCalendarMonth('2024-02');
 for(const timezone of ['Pacific/Honolulu','Asia/Tokyo','Pacific/Kiritimati']){
  process.env.TZ=timezone;
  assert.deepEqual(historyCalendarMonth('2024-02'),expected);
 }
}finally{if(originalTZ===undefined)delete process.env.TZ;else process.env.TZ=originalTZ;}
console.log('History calendar: Sunday-first 4/5/6 weeks, leap days, 2000/2099 boundaries, year transition, invalid months and timezone independence passed');
