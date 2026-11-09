import test from 'node:test';
import assert from 'node:assert/strict';
import {pageEngine,engine,plain,html} from './calculator-harness.mjs';

const KEY='pococha-meter-calc-v1',DRAFT=KEY+'-drafts',DISPLAY='pococha-meter-display-v1',date='2026-10-02';
const cfg=()=>({...plain(engine().state),snapshotVersion:'2026-10-02-v3',seedVer:3,seedVer13:1,target:'2000',current:'500',pick:'',rank:'S2',coreCount:'40',log:{[date]:{S2:[100,200,300],S1:[10,20,30]}}});
function memory(values={}){const map=new Map(Object.entries(values));return {map,getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};}
const input=(p,id,value,type='input')=>{p.element(id).value=value;p.element(id).dispatchEvent(new Event(type));};
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
const setup=(values={},caps={})=>{const m=memory({[KEY]:JSON.stringify(cfg()),...values});const p=pageEngine(undefined,{navigator:{onLine:false},localStorage:m,...caps});return {p,m};};
const draft=(key='22|S2|'+date,values=['111','222','333'])=>({version:1,drafts:{[key]:values},lastKey:key});
function backup(p){input(p,'saveContent','backup','change');input(p,'saveMethod','file','change');p.element('saveExport').click();return JSON.parse(p.element('backupText').value);}
function restore(p,data){p.element('paste').value=JSON.stringify(data);p.element('importBtn').click();}
const fileCaps={Blob,File,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{}}};
function shareSetup(options={}){const shares=[],downloads=[];const navigator={onLine:false,canShare:options.canShare??(()=>true),share:options.share??(data=>{shares.push(data);return Promise.resolve();})};const {p,m}=setup({}, {...fileCaps,navigator,onDownload:a=>downloads.push(a)});input(p,'saveMethod','share','change');return {p,m,shares,downloads};}
function swKit(options={}){
  const handlers={},messages=[],registrations=[];
  const kit={};const reply=(data,source=kit.worker)=>{for(const fn of handlers.message??[])fn({data,source});};
  const worker={postMessage:data=>{messages.push(data);if(!options.manual)reply({type:'POCOCHA_OFFLINE_STATUS',id:data.id,ready:options.ready??true,preparedAt:options.preparedAt??''});}};kit.worker=worker;
  const reg={active:worker};const sw={controller:worker,ready:Promise.resolve(reg),register:(url,opts)=>{registrations.push({url,opts});return options.registerError?Promise.reject(Error()):Promise.resolve(reg);},addEventListener:(type,fn)=>{(handlers[type]??=[]).push(fn);}};
  return {...kit,sw,messages,registrations,reply,emit:type=>{for(const fn of handlers[type]??[])fn();},caps:{isSecureContext:true,navigator:{onLine:options.online??true,serviceWorker:sw}}};
}

test('V01 storageイベント前でも他画面の新しい記録を上書きしない',()=>{const {p,m}=setup();const foreign=JSON.stringify({...cfg(),current:'1500'});m.map.set(KEY,foreign);input(p,'currentTop','700');assert.equal(m.map.get(KEY),foreign);assert.equal(p.element('remain').textContent,'1.3K');assert.match(p.element('storageStatus').textContent,/上書きしません/);});
test('V02 イベント前の保存領域削除をpagehideで復活させない',()=>{const {p,m}=setup();m.map.delete(KEY);p.dispatchWindow('pagehide');assert.equal(m.map.has(KEY),false);assert.match(p.element('storageStatus').textContent,/戻しません/);});
test('V03 clearのnullキー通知で自動保存と下書き保存を停止',()=>{const {p,m}=setup();m.map.clear();p.dispatchWindow('storage',{key:null,newValue:null,storageArea:m});input(p,'currentTop','900');input(p,'editZero','999');assert.equal(m.map.size,0);assert.match(p.element('storageStatus').textContent,/削除/);});
test('V04 sessionStorage等の別保存領域通知は無視',()=>{const {p,m}=setup();p.dispatchWindow('storage',{key:KEY,newValue:'{}',storageArea:{}});input(p,'currentTop','900');assert.equal(JSON.parse(m.map.get(KEY)).current,'900');});
test('V05 同じ値を背景・再表示のたびに書き込まない',()=>{const m=memory({[KEY]:JSON.stringify(cfg())});let writes=0;const storage={getItem:m.getItem,setItem:(k,v)=>{writes++;m.setItem(k,v);}};const p=pageEngine(undefined,{navigator:{onLine:false},localStorage:storage});const count=writes;p.document.hidden=true;p.dispatchDocument('visibilitychange');p.dispatchWindow('pagehide');p.dispatchWindow('pageshow',{persisted:false});assert.equal(writes,count);});
test('V06 bfcache復帰で保存済みデータの変更を検出',()=>{const {p,m}=setup();m.map.set(KEY,JSON.stringify({...cfg(),current:'800'}));p.dispatchWindow('pageshow',{persisted:true});assert.match(p.element('storageStatus').textContent,/別の画面/);input(p,'currentTop','600');assert.equal(JSON.parse(m.map.get(KEY)).current,'800');});
test('V07 保存前の読み取り例外でも画面の計算を継続',()=>{let failed=false;const m=memory({[KEY]:JSON.stringify(cfg())});const p=pageEngine(undefined,{navigator:{onLine:false},localStorage:{getItem:k=>{if(failed&&k===KEY)throw Error();return m.getItem(k);},setItem:m.setItem}});failed=true;input(p,'currentTop','900');assert.equal(p.element('remain').textContent,'1.1K');assert.match(p.element('storageStatus').textContent,/自動保存できません/);});
test('V08 一時的な保存失敗から次の有効入力で回復',()=>{let failed=false;const m=memory({[KEY]:JSON.stringify(cfg())});const p=pageEngine(undefined,{navigator:{onLine:false},localStorage:{getItem:m.getItem,setItem:(k,v)=>{if(failed&&k===KEY)throw Error();m.setItem(k,v);}}});failed=true;input(p,'currentTop','600');failed=false;input(p,'currentTop','700');assert.equal(JSON.parse(m.map.get(KEY)).current,'700');assert.equal(p.element('storageStatus').hidden,true);});
test('V09 下書きもイベント前の別画面変更を検出',()=>{const {p,m}=setup();const foreign=JSON.stringify(draft(undefined,['555','666','777']));m.map.set(DRAFT,foreign);input(p,'editZero','999');assert.equal(m.map.get(DRAFT),foreign);assert.match(p.element('editorMsg').textContent,/別の画面/);});
test('V10 下書き競合時もこの画面の入力をJSONへ控えられる',()=>{const {p,m}=setup();m.map.set(DRAFT,JSON.stringify(draft()));p.dispatchWindow('storage',{key:DRAFT,newValue:m.map.get(DRAFT),storageArea:m});input(p,'editZero','999');assert.equal(backup(p).editorDrafts.drafts['22|S2|'+date][0],'999');});
test('V11 128文字を超えるK付き数値の意味を再起動で保つ',()=>{const {p,m}=setup();const value='1.'+'0'.repeat(127)+'K';input(p,'editZero',value);const q=pageEngine(undefined,{navigator:{onLine:false},localStorage:m});assert.equal(q.element('editZero').value,value);assert.equal(engine().readNumber(q.element('editZero').value),1000);});
test('V12 下書きの256文字ちょうどを切り詰めない',()=>{const {p,m}=setup();const value='0'.repeat(255)+'1';input(p,'editZero',value);assert.equal(JSON.parse(m.map.get(DRAFT)).drafts['22|S2|'+date][0],value);assert.equal(p.element('editZero').getAttribute('maxlength'),'256');});
test('V13 257文字以上は無言で切り詰めて保存しない',()=>{const {p,m}=setup();input(p,'editZero','100');const before=m.map.get(DRAFT),long='0'.repeat(256)+'1';input(p,'editZero',long);assert.equal(m.map.get(DRAFT),before);assert.equal(p.element('editZero').value,long);assert.match(p.element('editorMsg').textContent,/256文字まで/);});
test('V14 別締め・別ランクの下書きで現在欄を上書きしない',()=>{const {p}=setup({[DRAFT]:JSON.stringify(draft('13|S1|'+date))});assert.equal(p.element('editZero').value,'100');assert.equal(p.element('editDate').value,date);});
test('V15 CSV取込後は一致する古い下書きを消し取込値を表示',()=>{const {p,m}=setup({[DRAFT]:JSON.stringify(draft())});p.element('paste').value=date+',S2,400,500,600,22';p.element('importBtn').click();assert.equal(p.element('editZero').value,'400');assert.equal(JSON.parse(m.map.get(DRAFT)).drafts['22|S2|'+date],undefined);});
test('V16 CSV取込で別ランクの下書きは残す',()=>{const d=draft();d.drafts['22|S1|'+date]=['41','42','43'];const {p,m}=setup({[DRAFT]:JSON.stringify(d)});p.element('paste').value=date+',S2,400,500,600,22';p.element('importBtn').click();assert.deepEqual(JSON.parse(m.map.get(DRAFT)).drafts['22|S1|'+date],['41','42','43']);});
test('V17 旧JSONバックアップ復元後は同じ記録の古い下書きを消す',()=>{const {p,m}=setup({[DRAFT]:JSON.stringify(draft())});restore(p,{pmcBackup:1,log:{[date]:{S2:[400,500,600]}}});assert.equal(p.element('editZero').value,'400');assert.equal(JSON.parse(m.map.get(DRAFT)).drafts['22|S2|'+date],undefined);});
test('V18 新JSONに含めた未確定下書きは記録と分けて復元',()=>{const {p,m}=setup();restore(p,{pmcBackup:1,log:{[date]:{S2:[400,500,600]}},editorDrafts:draft()});assert.equal(p.element('editZero').value,'111');assert.deepEqual(JSON.parse(m.map.get(KEY)).log[date].S2,[400,500,600]);assert.equal(JSON.parse(m.map.get(DRAFT)).drafts['22|S2|'+date][0],'111');});
test('V19 下書きだけの対応JSONも既存記録を保って結合',()=>{const {p,m}=setup();restore(p,{pmcBackup:1,editorDrafts:draft()});assert.equal(p.element('editZero').value,'111');assert.deepEqual(JSON.parse(m.map.get(KEY)).log[date].S1,[10,20,30]);assert.equal(p.element('importMsg').className,'toast');});
test('V20 不正な下書き付きJSONは記録も変更しない',()=>{const {p,m}=setup();const before=m.map.get(KEY);restore(p,{pmcBackup:1,log:{[date]:{S2:[400,500,600]}},editorDrafts:draft('22|X9|'+date)});assert.equal(m.map.get(KEY),before);assert.equal(p.element('importMsg').className,'toast err');});
test('V21 不正な表示設定付きJSONは記録も変更しない',()=>{const {p,m}=setup();const before=m.map.get(KEY);restore(p,{pmcBackup:1,log:{[date]:{S2:[400,500,600]}},display:{color:'unknown',weight:'bold'}});assert.equal(m.map.get(KEY),before);});
test('V22 JSONバックアップに全体とシンプルメニューの配色・太さを含める',()=>{const {p}=setup({[DISPLAY]:JSON.stringify({color:'pink',weight:'heavy'})});assert.deepEqual(backup(p).display,{color:'pink',weight:'bold',theme:'light',background:'theme',hudBackground:'black',listColor:'white',numberColor:'blue'});});
test('V23 表示設定のない旧バックアップでは現在の色を保持',()=>{const {p}=setup({[DISPLAY]:JSON.stringify({color:'green',weight:'bold'})});restore(p,{pmcBackup:1,log:{}});assert.equal(p.document.documentElement.getAttribute('data-screen-color'),'green');assert.equal(p.element('textWeight').value,'bold');});
test('V24 表示設定だけ保存失敗した場合も復元メッセージに明記',()=>{const m=memory({[KEY]:JSON.stringify(cfg())});const p=pageEngine(undefined,{navigator:{onLine:false},localStorage:{getItem:m.getItem,setItem:(k,v)=>{if(k===DISPLAY)throw Error();m.setItem(k,v);}}});restore(p,{pmcBackup:1,log:{},display:{color:'pink',weight:'heavy'}});assert.equal(p.element('screenColor').value,'pink');assert.match(p.element('importMsg').textContent,/表示設定または下書き/);assert.equal(p.element('importMsg').className,'toast err');});
test('V25 日付単位の削除で全ランクの下書きを端末から消す',()=>{const d=draft();d.drafts['22|S1|'+date]=['41','42','43'];const {p,m}=setup({[DRAFT]:JSON.stringify(d)});const row=p.element('logList').children.find(r=>r.children[0].textContent==='2026/10/02');const del=row.children.find(n=>n.className==='x');assert.match(del.getAttribute('aria-label'),/全ランク/);del.click();del.click();assert.deepEqual(JSON.parse(m.map.get(DRAFT)).drafts,{});const q=pageEngine(undefined,{navigator:{onLine:false},localStorage:m});assert.equal(q.element('editZero').value,'');});
test('V26 ランク単位の削除では他ランクの記録・下書きを保持',()=>{const d=draft();d.drafts['22|S1|'+date]=['41','42','43'];const {p,m}=setup({[DRAFT]:JSON.stringify(d)});p.element('deleteDay').click();p.element('deleteDay').click();assert.equal(JSON.parse(m.map.get(DRAFT)).drafts['22|S2|'+date],undefined);assert.deepEqual(JSON.parse(m.map.get(DRAFT)).drafts['22|S1|'+date],['41','42','43']);assert.deepEqual(JSON.parse(m.map.get(KEY)).log[date].S1,[10,20,30]);});
test('V27 下書き取消の保存失敗を成功と表示しない',()=>{const m=memory({[KEY]:JSON.stringify(cfg()),[DRAFT]:JSON.stringify(draft())});const p=pageEngine(undefined,{navigator:{onLine:false},localStorage:{getItem:m.getItem,setItem:(k,v)=>{if(k===DRAFT)throw Error();m.setItem(k,v);}}});p.element('loadDay').click();assert.equal(p.element('editZero').value,'100');assert.match(p.element('editorMsg').textContent,/更新できません/);});
test('V28 バックアップ下書きの上限・型・日付を厳密に検証',()=>{const e=engine();assert.throws(()=>e.cleanEditorDraftPayload(draft(undefined,['x'.repeat(257),'2','3']),true));assert.throws(()=>e.cleanEditorDraftPayload(draft('22|S2|2026-02-30'),true));assert.throws(()=>e.cleanEditorDraftPayload({version:1,drafts:{},lastKey:'missing'},true));const d={version:1,drafts:{},lastKey:''};for(let i=1;i<=33;i++)d.drafts['22|S2|2026-'+(i<=30?'09':'08')+'-'+String(i<=30?i:i-30).padStart(2,'0')]=['1','2','3'];assert.throws(()=>e.cleanEditorDraftPayload(d,true));});
test('V29 取込成功後の下書き削除失敗は再起動の注意を表示',()=>{const m=memory({[KEY]:JSON.stringify(cfg()),[DRAFT]:JSON.stringify(draft())});const p=pageEngine(undefined,{navigator:{onLine:false},localStorage:{getItem:m.getItem,setItem:(k,v)=>{if(k===DRAFT)throw Error();m.setItem(k,v);}}});p.element('paste').value=date+',S2,400,500,600,22';p.element('importBtn').click();assert.equal(p.element('editZero').value,'400');assert.match(p.element('importMsg').textContent,/下書き.*更新できません/);});
test('V30 他画面の表示設定変更を保存し返さず反映',()=>{const {p,m}=setup();const value=JSON.stringify({color:'blue',weight:'heavy'});m.map.set(DISPLAY,value);p.dispatchWindow('storage',{key:DISPLAY,newValue:value,storageArea:m});assert.equal(p.element('screenColor').value,'blue');assert.equal(p.document.documentElement.getAttribute('data-text-weight'),'bold');assert.equal(m.map.get(DISPLAY),value);});
test('V31 対応端末だけ既存の保存方法に共有を追加',()=>{const {p}=shareSetup();assert.equal(p.element('saveMethod').options.some(o=>o.value==='share'),true);assert.equal(p.element('saveExport').textContent,'共有して保存');});
test('V32 非対応端末では共有の選択肢を表示しない',()=>{const {p}=setup();assert.equal(p.element('saveMethod').options.some(o=>o.value==='share'),false);});
test('V33 このファイルを共有できない場合は手動コピーを提示',()=>{const {p,shares}=shareSetup({canShare:()=>false});p.element('saveExport').click();assert.equal(shares.length,0);assert.equal(p.element('backupText').hidden,false);assert.equal(JSON.parse(p.element('backupText').value).pmcBackup,1);assert.match(p.element('bkMsg').textContent,/共有できません/);});
test('V34 共有JSONの形式・ファイル名・内容を保持',async()=>{const {p,shares}=shareSetup();await p.element('saveExport').onclick();assert.equal(shares[0].files.length,1);const file=shares[0].files[0];assert.match(file.name,/pococha-backup-2026-10-03\.json/);assert.equal(file.type,'application/json;charset=utf-8');assert.equal(JSON.parse(await file.text()).settings.current,'500');});
test('V35 全記録CSVを共有してもBOMと締め列を保持',async()=>{const {p,shares}=shareSetup();input(p,'saveContent','csvAll','change');await p.element('saveExport').onclick();const file=shares[0].files[0];assert.equal(file.name,'pococha-daily-records.csv');const bytes=new Uint8Array(await file.arrayBuffer());assert.deepEqual([...bytes.slice(0,3)],[239,187,191]);assert.match(await file.text(),/2026-10-02,S2,100,200,300,22/);});
test('V36 選択期間CSVの共有に対象期間と計算根拠を保持',async()=>{const {p,shares}=shareSetup();input(p,'saveContent','csvPeriod','change');await p.element('saveExport').onclick();assert.match(shares[0].files[0].name,/pococha-analysis-22-S2-30d/);assert.match(await shares[0].files[0].text(),/rank/);});
test('V37 共有成功でも保存済みとは断定しない',async()=>{const {p}=shareSetup();await p.element('saveExport').onclick();assert.match(p.element('bkMsg').textContent,/保存先でファイルを確認/);assert.doesNotMatch(p.element('bkMsg').textContent,/保存しました/);assert.equal(p.element('saveExport').getAttribute('aria-busy'),'false');});
test('V38 AbortErrorで勝手に別のダウンロードを開始しない',async()=>{const {p,downloads}=shareSetup({share:()=>Promise.reject(Object.assign(Error(),{name:'AbortError'}))});await p.element('saveExport').onclick();assert.equal(downloads.length,0);assert.match(p.element('bkMsg').textContent,/閉じた場合や保存先がない/);assert.doesNotMatch(p.element('bkMsg').textContent,/キャンセルしました/);});
test('V39 共有拒否は選択済みのJSONを手動コピーへ残す',async()=>{const {p}=shareSetup({share:()=>Promise.reject(Object.assign(Error(),{name:'NotAllowedError'}))});await p.element('saveExport').onclick();assert.equal(p.element('backupText').selected,true);assert.equal(JSON.parse(p.element('backupText').value).settings.rank,'S2');assert.equal(p.element('bkMsg').className,'toast err');});
test('V40 遅い共有応答で後から行ったファイル保存を上書きしない',async()=>{let resolve;const {p,downloads}=shareSetup({share:()=>new Promise(r=>resolve=r)});const action=p.element('saveExport').onclick();input(p,'saveMethod','file','change');p.element('saveExport').click();const msg=p.element('bkMsg').textContent;resolve();await action;assert.equal(p.element('bkMsg').textContent,msg);assert.equal(downloads.length,1);});
test('V41 Fileが使えなくなった場合も共有失敗を閉じ込める',()=>{const {p}=setup({}, {navigator:{onLine:false,share:()=>{throw Error();},canShare:()=>true}});input(p,'saveMethod','share','change');p.element('saveExport').click();assert.equal(p.element('backupText').hidden,false);assert.match(p.element('bkMsg').textContent,/共有できません/);});
test('V42 同期的な共有例外でも忙しい状態を解除',()=>{const {p}=shareSetup({share:()=>{throw Error('sync');}});p.element('saveExport').click();assert.equal(p.element('saveExport').getAttribute('aria-busy'),'false');assert.equal(p.element('backupText').hidden,false);});
test('V43 不正な保存方法を共有機能へ渡さない',()=>{const {p,shares}=shareSetup();input(p,'saveMethod','bad','change');p.element('saveExport').click();assert.equal(shares.length,0);assert.match(p.element('bkMsg').textContent,/選んでください/);});
test('V44 既存workerがある起動でも更新を確認し準備状況を表示',async()=>{const kit=swKit(),{p}=setup({},kit.caps);await flush();assert.equal(kit.registrations.length,1);assert.equal(kit.registrations[0].url,'/meter-sw.js');assert.match(p.element('offlineStatus').textContent,/準備完了/);p.dispatchWindow('pageshow',{persisted:false});await flush();assert.equal(kit.registrations.length,1);});
test('V45 更新登録失敗でも既存の検証済みキャッシュを使用',async()=>{const kit=swKit({registerError:true}),{p}=setup({},kit.caps);await flush();assert.match(p.element('offlineStatus').textContent,/準備完了/);input(p,'currentTop','800');assert.equal(p.element('remain').textContent,'1.2K');});
test('初回登録の失敗より先に通信が戻っても、登録を自動でやり直す',async()=>{
 const kit=swKit(),navigator=kit.caps.navigator;
 const register=kit.sw.register;
 let rejectFirst,attempts=0;
 kit.sw.controller=null;
 kit.sw.register=(...args)=>++attempts===1?new Promise((_,reject)=>{rejectFirst=reject;}):register(...args);
 const {p}=setup({},kit.caps);
 navigator.onLine=false;p.dispatchWindow('offline');
 navigator.onLine=true;p.dispatchWindow('online');
 rejectFirst(Error('registration was interrupted'));
 await flush();
 assert.equal(attempts,2);
 assert.match(p.element('offlineStatus').textContent,/準備完了/);
});
test('初回のワーカー有効化を待っている間に通信が戻ると、待機が切れる前に登録をやり直す',async()=>{
 const kit=swKit(),navigator=kit.caps.navigator;
 let activate,attempts=0;
 kit.sw.controller=null;
 kit.sw.ready=new Promise(resolve=>{activate=resolve;});
 kit.sw.register=()=>{
  if(++attempts===1)return Promise.resolve({active:null});
  const registration={active:kit.worker};
  activate(registration);
  return Promise.resolve(registration);
 };
 const {p}=setup({},kit.caps);
 await flush();
 assert.equal(attempts,1);
 navigator.onLine=false;p.dispatchWindow('offline');
 navigator.onLine=true;p.dispatchWindow('online');
 await flush();
 assert.equal(attempts,2);
 assert.match(p.element('offlineStatus').textContent,/準備完了/);
});
test('復帰直後にまだ失敗予定の登録が返った場合も、準備待ちの期限後に登録をやり直す',async()=>{
 const kit=swKit(),navigator=kit.caps.navigator;
 let activate,attempts=0;
 kit.sw.controller=null;
 kit.sw.ready=new Promise(resolve=>{activate=resolve;});
 kit.sw.register=()=>{
  if(++attempts<3)return Promise.resolve({active:null});
  const registration={active:kit.worker};
  activate(registration);
  return Promise.resolve(registration);
 };
 const {p}=setup({},kit.caps);
 await flush();
 navigator.onLine=false;p.dispatchWindow('offline');
 navigator.onLine=true;p.dispatchWindow('online');
 await flush();
 assert.equal(attempts,2);
 p.flushTimers(15000);
 await flush();
 assert.equal(attempts,3);
 assert.match(p.element('offlineStatus').textContent,/準備完了/);
});
test('V46 worker切替時に古い応答を無視して新しい準備状況を確認',async()=>{const kit=swKit({manual:true,online:false}),{p}=setup({},kit.caps);const oldId=kit.messages[0].id;const newer={postMessage:data=>kit.reply({type:'POCOCHA_OFFLINE_STATUS',id:data.id,ready:false},newer)};kit.sw.controller=newer;kit.emit('controllerchange');kit.reply({type:'POCOCHA_OFFLINE_STATUS',id:oldId,ready:true});await flush();assert.match(p.element('offlineStatus').textContent,/未準備/);assert.doesNotMatch(p.element('offlineStatus').textContent,/準備完了/);});
test('V47 正しい準備日時だけJSTで表示し未来の値は無視',async()=>{const a=swKit({online:false,preparedAt:'2026-10-03T11:30:00Z'}),pa=setup({},a.caps).p;await flush();assert.match(pa.element('offlineStatus').textContent,/準備 10-03 20:30/);const b=swKit({online:false,preparedAt:'9999-12-31T00:00:00Z'}),pb=setup({},b.caps).p;await flush();assert.doesNotMatch(pb.element('offlineStatus').textContent,/9999/);});
test('V48 オフライン起動準備と入力保存失敗を区別',async()=>{const kit=swKit({online:false}),{p}=setup({}, {...kit.caps,localStorage:{getItem:()=>null,setItem:()=>{throw Error();}}});await flush();assert.match(p.element('offlineStatus').textContent,/準備完了/);assert.match(p.element('offlineStatus').textContent,/入力を端末に保存できません/);});
test('V49 共有画面の待機中でもメーター入力を更新できる',async()=>{let resolve;const {p}=shareSetup({share:()=>new Promise(r=>resolve=r)});const action=p.element('saveExport').onclick();input(p,'currentTop','1500');assert.equal(p.element('remain').textContent,'500');resolve();await action;});
test('V50 新しい保存方法も既存メニュー内に収め主要要素順を維持',()=>{const {p}=shareSetup();assert.equal(p.element('saveMethod').closest('#backupTools').id,'backupTools');assert.equal(p.element('offlineTools').closest('#backupTools').id,'backupTools');const ids=['remainingSummary','quickTargetControls','remainingItems'];const positions=ids.map(id=>html.indexOf('id="'+id+'"'));assert.ok(positions[0]<positions[1]&&positions[1]<positions[2]);for(const id of ['quickPresets','msg','refresh','trendRecent'])assert.equal(p.element(id),undefined);});
