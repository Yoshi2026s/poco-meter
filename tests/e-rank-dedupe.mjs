// E帯：旧ランク（E1〜E3）で保存済みの記録が、Eとして二重登録されないことを確かめる。
// - CSVを書き出して取り込み直す（EになったCSV行）と、同じ日付・締め・値の旧記録は保存済み扱い
// - 同じ下書きを再度復元したとき、旧ランクの下書きとEの下書きを重複として省く
// - 旧記録を編集画面で開いて保存するとき、ランクの表示名が同じなら元のランクを保つ（Eへ書き換えて元記録をごみ箱へ送らない）
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {eRow,eKey} from '../calculator/e-border-core.mjs';
import {eMergeState,eDraftPlan} from '../calculator/e-border-store.mjs';

const legacy=eRow({date:'2026-10-01',rank:'E1',close:'22',values:['300','2.0K','5.0K']});
const base={records:[legacy],hiddenSeeds:[],trash:[],lastChangedAt:''};

test('CSV round trip of a legacy E1 record does not add a second E record',()=>{
 const r=eMergeState(base,[{...legacy,rank:'E'}]);
 assert.equal(r.state.records.length,1);
 assert.equal(r.state.records[0].rank,'E1');
 assert.equal(r.same,1);
 assert.equal(r.state.trash.length,0);
});

test('An E row with different values for the same day is still saved, not silently dropped',()=>{
 const r=eMergeState(base,[{...legacy,rank:'E',values:['310','2.0K','5.0K']}]);
 assert.equal(r.state.records.length,2);
 assert.ok(r.state.records.some(x=>eKey(x)===eKey(legacy)));
});

test('Restoring the same draft file treats legacy-rank and E drafts as duplicates',()=>{
 const draft={date:'2026-10-01',rank:'E1',close:'22',values:['300','2.0K','5.0K']};
 const plan=eDraftPlan([draft],[{...draft,rank:'E'}]);
 assert.equal(plan.duplicates,1);
 assert.equal(plan.rows.length,0);
});

test('Editing a legacy record keeps its original rank when the visible rank is unchanged',()=>{
 for(const file of ['calculator/e-border-ui.mjs','calculator/e-border.html']){
  const src=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
  assert.match(src,/if\(original&&eRankLabel\(raw\.rank\)===eRankLabel\(original\.rank\)\)raw\.rank=original\.rank;/,file);
 }
});
