import test from 'node:test';
import assert from 'node:assert/strict';
import {engine,pageEngine,plain,html} from './calculator-harness.mjs';

// Exercise the shipped export handlers. This DOM double does not verify a
// browser's download UI, clipboard permissions or physical phone rendering.
const key='pococha-meter-calc-v1';
const settings=()=>({...plain(engine().state),seedVer:3,seedVer13:1,
  snapshotVersion:'2026-10-02-v3',goalDefaultsVersion:1,target:'1001',current:'0',pick:'',
  log:{'2026-10-02':{S1:[100,200,300]},'2026-09-30':{S1:[500,600,700]}},
  log13:{'2026-10-01':{S2:[1,2,3]}},log24:{'2026-10-01':{B1:[10,20,30]}},
  presets:[{name:'旧目標',val:400}],provenance:{'22':{'2026-09-30':{S1:{origin:'legacy',source:'旧版'}}}}});
const choose=(p,id,value)=>{p.element(id).value=value;p.element(id).dispatchEvent(new Event('change'));};
function setup(extra={}){
  const files=[],copies=[];
  const p=pageEngine(settings(),{Blob,URL:{createObjectURL(blob){files.push({blob});return 'blob:test';},revokeObjectURL(){}},
    onDownload(anchor){files.at(-1).name=anchor.download;},navigator:{clipboard:{writeText:async text=>{copies.push(text);}}},...extra});
  return {p,files,copies};
}

test('保存する3種類はファイルとコピーで同じ内容を出力する',async()=>{
  const {p,files,copies}=setup();const before=JSON.parse(p.stored.get(key));
  for(const kind of ['backup','csvAll','csvPeriod']){
    choose(p,'saveContent',kind);choose(p,'saveMethod','file');p.element('saveExport').click();
    const file=files.at(-1),text=await file.blob.text();
    choose(p,'saveMethod','copy');await p.element('saveExport').click();
    // Blob.text() strips a UTF-8 BOM; clipboard strings keep it.
    assert.equal(copies.at(-1).replace(/^\uFEFF/,''),text.replace(/^\uFEFF/,''));
    assert.match(file.name,kind==='backup'?/\.json$/:/\.csv$/);
    if(kind==='backup'){
      const backup=JSON.parse(text);assert.equal(backup.formatVersion,4);
      assert.deepEqual(backup.presets,before.presets);assert.equal(backup.settings.target,'1001');
    }else if(kind==='csvAll'){
      assert.match(text,/2026-10-01,S2,1,2,3,13/);assert.match(text,/2026-10-02,S1,100,200,300,22/);
      assert.match(text,/2026-10-01,B1,10,20,30,24/);assert.doesNotMatch(text,/2026-09-30,S1/);
    }else{
      assert.match(text,/status,source,selected_border/);assert.match(text,/2026-10-02,S1,100,200,300,22,recorded/);
      assert.match(text,/2026-09-30,S1,,,,22,legacy_excluded/);assert.doesNotMatch(text,/,S2,1,2,3,13/);
    }
  }
  const after=JSON.parse(p.stored.get(key));
  for(const field of ['target','current','coreCount','rank','log','log13','log24','items','presets'])assert.deepEqual(after[field],before[field]);
});

test('保存は下部の統合メニューだけに残し、開くだけでは書き出さない',()=>{
  const {p,files}=setup(),section=p.element('backupTools').closest('section.card');
  assert.equal(p.document.querySelector('#quickBackup'),null);
  section.querySelector('.sectionToggle').dispatchEvent(new Event('click'));
  assert.equal(section.classList.contains('collapsed'),false);
  assert.equal(p.element('backupTools').querySelectorAll('#saveExport').length,1);
  assert.equal(files.length,0);
});

test('ファイル作成失敗では選択したCSVを手動コピーできる',()=>{
  const {p}=setup({Blob:class{constructor(){throw new Error('blocked');}}});
  choose(p,'saveContent','csvAll');p.element('saveExport').click();
  assert.equal(p.element('backupText').hidden,false);assert.equal(p.element('backupText').selected,true);
  assert.equal(p.element('backupTools').open,true);assert.match(p.element('backupText').value,/date,rank,zero/);
  assert.match(p.element('bkMsg').textContent,/全記録CSV.*開始できません/);
});

test('後から実行したファイル保存の結果を古いコピー失敗で上書きしない',async()=>{
  let reject;const pending=new Promise((_,r)=>{reject=r;});
  const {p,files}=setup({navigator:{clipboard:{writeText:()=>pending}}});
  choose(p,'saveMethod','copy');const job=p.element('saveExport').click();
  choose(p,'saveContent','csvAll');choose(p,'saveMethod','file');p.element('saveExport').click();
  const status=p.element('bkMsg').textContent;reject(new Error('denied'));await job;
  assert.equal(p.element('bkMsg').textContent,status);assert.equal(p.element('backupText').hidden,true);
  assert.match(files.at(-1).name,/\.csv$/);
});

test('選択期間の保存説明はランク・集計期間の変更に即連動する',()=>{
  const {p}=setup();choose(p,'saveContent','csvPeriod');choose(p,'quickRank','S2');choose(p,'quickPeriod','month');
  assert.match(p.element('saveExportHelp').textContent,/当月.*S2/);
});

test('削除対象のDOMを参照せず、時計更新と保存互換を維持する',()=>{
  const {p}=setup();
  for(const id of ['refresh','quickPresets','presets','preName','preVal','addPre','msg','regen','copy','toast','trendRecent','trendPrevious','trendDifference','analysisCSV','exportCSV','bkCopy','downloadBackup'])assert.equal(p.element(id),undefined,id);
  assert.doesNotMatch(html,/<small class="offline-badge">スマホ対応/);
  const current=p.element('left').textContent;p.setNow('2026-10-03T21:00:01+09:00');p.tick(1000);
  assert.notEqual(p.element('left').textContent,current);assert.equal(JSON.parse(p.stored.get(key)).presets[0].name,'旧目標');
  assert.ok(p.element('toolUpdatedDate'));assert.ok(p.element('formulaLine'));assert.ok(p.element('recentChart'));
});
