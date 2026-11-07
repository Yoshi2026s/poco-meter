import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, pageEngine, plain, html } from './calculator-harness.mjs';

// Mobile interaction regressions; retired preset/announcement cases were removed.
// This is a DOM/event double, not a
// smartphone browser or rendering engine; the distinction is intentional.
const key = 'pococha-meter-calc-v1';
const page = (settings = {}, capabilities = {}) => pageEngine({ ...plain(engine().state),
  seedVer: 3, seedVer13: 1, snapshotVersion: '2026-10-02-v3', goalDefaultsVersion: 1,
  target: '1001', current: '0', coreCount:'40', ...settings }, capabilities);
const saved = p => JSON.parse(p.stored.get(key));
const input = (p, id, value, type = 'input') => { p.element(id).value = value; p.element(id).dispatchEvent(new Event(type)); };
const press = (p, id, details = {}) => p.element(id).dispatchEvent({ type: 'keydown', key: 'Enter', keyCode: 13, isComposing: false, preventDefault() {}, ...details });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const presetButton = (p, attr, value) => p.nodes.find(node => node.dataset[attr] === value);
const section = (p, id) => p.element(id).closest('section.card');
const openSection = (p, id) => { const sec = section(p, id); if (sec.classList.contains('collapsed')) sec.querySelector('.sectionToggle').click(); return sec; };
const autoSettings = { pick: 0, log: { '2026-10-02': { S1: [100, 200, 300], S2: [10, 20, 30] } }, provenance: {} };

test('D01 現在値の完了キーで反映して入力を終了', () => {
  const p = page(); p.element('currentTop').focus(); input(p, 'currentTop', '１Ｋ'); press(p, 'currentTop');
  assert.equal(saved(p).current, '1000'); assert.equal(p.element('remain').textContent, '1'); assert.notEqual(p.document.activeElement, p.element('currentTop'));
});
test('D02 不正な現在値の完了キーでは入力欄に留まる', () => {
  const p = page({ current: '500' }); p.element('currentTop').focus(); input(p, 'currentTop', '-1'); press(p, 'currentTop');
  assert.equal(saved(p).current, '500'); assert.equal(p.document.activeElement, p.element('currentTop')); assert.equal(p.element('currentTop').getAttribute('aria-invalid'), 'true');
});
test('D03 目標値の完了キーで手入力を設定して終了', () => {
  const p = page(); p.element('target').focus(); input(p, 'target', '1.2万'); press(p, 'target');
  assert.equal(saved(p).target, '12000'); assert.equal(saved(p).pick, ''); assert.notEqual(p.document.activeElement, p.element('target'));
});
test('D04 未完成の目標を完了キーで適用しない', () => {
  const p = page(); p.element('target').focus(); input(p, 'target', ''); press(p, 'target');
  assert.equal(saved(p).target, '1001'); assert.equal(p.document.activeElement, p.element('target'));
});
test('D05 コア数の完了キーと全角数字', () => {
  const p = page(); p.element('coreCountTop').focus(); input(p, 'coreCountTop', '４５'); press(p, 'coreCountTop');
  assert.equal(saved(p).coreCount, '45'); assert.equal(p.element('coreCountTop').value, '45'); assert.notEqual(p.document.activeElement, p.element('coreCountTop'));
});
test('D06 コア数のIME未確定値と229確定キーを保護', () => {
  const p = page(); p.element('coreCountTop').focus(); p.element('coreCountTop').dispatchEvent(new Event('compositionstart'));
  input(p, 'coreCountTop', '４５'); press(p, 'coreCountTop', { keyCode: 229 }); assert.equal(saved(p).coreCount, '0'); assert.equal(p.document.activeElement, p.element('coreCountTop'));
  p.element('coreCountTop').dispatchEvent(new Event('compositionend')); assert.equal(saved(p).coreCount, '45');
});
test('D07 コア0は有効で、未入力と混同しない', () => {
  const p = page(); p.element('coreCountTop').focus(); input(p, 'coreCountTop', '0'); press(p, 'coreCountTop');
  assert.equal(saved(p).coreCount, '0'); assert.equal(p.element('coreBonusTop').textContent, '100%');
});
test('D08 コア上限外の完了キーでは前の値を保持', () => {
  const p = page(); p.element('coreCountTop').focus(); input(p, 'coreCountTop', '1001'); press(p, 'coreCountTop');
  assert.equal(saved(p).coreCount, '0'); assert.equal(p.document.activeElement, p.element('coreCountTop'));
});
test('D09 IMEの229キーで加算を実行しない', () => {
  const p = page(); input(p, 'adjustAmount', '100'); press(p, 'adjustAmount', { keyCode: 229 }); assert.equal(saved(p).current, '0');
});
test('D10 通常Enterの加算は1回だけ反映', () => {
  const p = page(); input(p, 'adjustAmount', '1K'); press(p, 'adjustAmount'); assert.equal(saved(p).current, '1000'); assert.match(p.element('adjustStatus').textContent, /＋1,000 pt/);
});
test('D11 IME確定Enterでアイテムを誤登録しない', () => {
  const p = page(); input(p, 'itemName', '花火'); input(p, 'itemVal', '1080'); press(p, 'itemVal', { keyCode: 229 }); assert.equal(saved(p).items.length, 0);
  press(p, 'itemVal'); assert.equal(saved(p).items.length, 1);
});
test('D13 changeだけが届く入力でも残りを更新', () => {
  const p = page(); input(p, 'currentTop', '500', 'change'); assert.equal(p.element('remain').textContent, '501'); assert.equal(p.element('current').value, '500');
});
test('D14 桁区切りを外してもカーソル位置を維持', () => {
  const p = page({ current: '12500' }); const field = p.element('currentTop'); field.selectionStart = 3; field.selectionEnd = 6; field.focus();
  assert.equal(field.value, '12500'); assert.equal(field.selectionStart, 2); assert.equal(field.selectionEnd, 5);
});
test('D15 日本語変換途中の不正文字で現在値を0にしない', () => {
  const p = page({ current: '500' }); p.element('currentTop').focus(); p.element('currentTop').dispatchEvent(new Event('compositionstart')); input(p, 'currentTop', 'あ');
  assert.equal(saved(p).current, '500'); p.element('currentTop').value = '１０００'; p.element('currentTop').dispatchEvent(new Event('compositionend')); assert.equal(p.element('remain').textContent, '1');
});
test('D16 連続入力の取消は編集開始時へ戻す', () => {
  const p = page({ current: '500' }); p.element('currentTop').focus(); input(p, 'currentTop', '6'); input(p, 'currentTop', '60'); input(p, 'currentTop', '600'); press(p, 'currentTop');
  p.element('undoCurrent').click(); assert.equal(saved(p).current, '500');
});
test('D17 0より下へのタップ減算は実差分を表示', () => {
  const p = page({ current: '50' }); presetButton(p, 'addtop', '-1000').click(); assert.equal(saved(p).current, '0'); assert.match(p.element('currentActionMsg').textContent, /−50 pt.*0 ptで止め/);
});
test('D18 上限を超えるタップ加算は上限で停止', () => {
  const max = engine().MAX_VALUE; const p = page({ current: String(max - 1) }); presetButton(p, 'addtop', '100000').click(); assert.equal(saved(p).current, String(max)); assert.match(p.element('currentActionMsg').textContent, /＋1 pt.*上限/);
});
test('D19 コア不正値は参考換算を変えない', () => {
  const p = page(); const before = p.element('coinNeed').textContent; input(p, 'coreCountTop', '1K'); assert.equal(p.element('coinNeed').textContent, before); assert.equal(saved(p).coreCount, '0');
});
test('D20 目標の空欄編集中は適用ボタンを無効化', () => {
  const p = page(); input(p, 'target', ''); assert.equal(p.element('applyManualTarget').disabled, true); assert.equal(saved(p).target, '1001'); assert.equal(p.element('inputStatus').getAttribute('aria-live'), 'polite');
});
test('D21 小型期間メニューの変更を保存', () => {
  const p = page(autoSettings); input(p, 'quickPeriod', 'month', 'change'); assert.equal(saved(p).period, 'month'); assert.equal(saved(p).target, '100');
});
test('D22 ランクメニューはS6からEの順', () => {
  const p = page(autoSettings); const ranks = p.element('quickRank').options.map(option => option.value); assert.equal(ranks[0], 'S6'); assert.equal(ranks.at(-1), 'E');
  input(p, 'quickRank', 'S2', 'change'); assert.equal(saved(p).target, '10');
});
test('D23 手入力モードへの変更では設定済み値を保持', () => {
  const p = page(autoSettings); const target = saved(p).target; input(p, 'quickBorder', '', 'change'); assert.equal(saved(p).pick, ''); assert.equal(saved(p).target, target); assert.equal(p.document.activeElement, p.element('target'));
});
test('D24 算出方法は短い表示と詳細な説明を両立', () => {
  const p = page(autoSettings); const option = p.element('quickMethod').options.find(option => option.value === 'p75'); assert.equal(option.textContent, '上位25%');
  input(p, 'quickMethod', 'p75', 'change'); assert.equal(saved(p).targetMethod, 'p75'); assert.match(p.element('quickMethod').title, /上位25/);
});
test('D25 締めの手入力選択は定期更新で戻さない', () => {
  const p = page(); input(p, 'closeSel', 'custom', 'change'); p.tick(1000); assert.equal(p.element('closeSel').value, 'custom'); assert.match(p.element('closeSel').title, /変更中/); assert.equal(saved(p).deadline, '22:00');
});
test('D26 手入力の不正時刻は前の締めで計算', () => {
  const p = page(); input(p, 'closeSel', 'custom', 'change'); input(p, 'deadline', '24:99'); p.tick(1000);
  assert.equal(saved(p).deadline, '22:00'); assert.equal(p.element('closeSel').value, 'custom'); assert.equal(p.element('left').textContent, '01:00:00.0');
});
test('D27 24時締めを選択しても00時と同じ期間を計算', () => {
  const p = page(); input(p, 'closeSel', '00:00', 'change'); assert.equal(saved(p).deadline, '00:00'); assert.equal(p.element('left').textContent, '03:00:00.0'); assert.match(p.element('closeSel').title, /24:00/);
});
test('D28 バックアップ復元で手入力中フラグも解除', () => {
  const p = page(); input(p, 'closeSel', 'custom', 'change'); p.element('paste').value = JSON.stringify({ pmcBackup: 1, log: {}, settings: { ...saved(p), deadline: '13:00' } }); p.element('importBtn').click();
  assert.equal(saved(p).deadline, '13:00'); assert.equal(p.element('closeSel').value, '13:00'); assert.doesNotMatch(p.element('closeSel').title, /変更中/);
});
test('D29 記録ナビでキーボードを開かず見出しにフォーカス', () => {
  const p = page(); const anchor = p.document.querySelector('.navlinks a[href]');
  const record = p.nodes.find(node => node.getAttribute('href') === '#recordEditor'); assert.ok(anchor || record);
  record.dispatchEvent({ type: 'click', preventDefault() {} }); assert.equal(p.document.activeElement, section(p, 'recordEditor').querySelector('.sectionToggle')); assert.notEqual(p.document.activeElement, p.element('editZero'));
});
test('D30 日別記録の編集を選んだ場合は入力欄へ移動', () => {
  const p = page(autoSettings); const edit = p.element('analysisRows').children.flatMap(row => row.children).flatMap(cell => cell.children).find(node => node.dataset.date === '2026-10-02');
  edit.click(); assert.equal(p.element('editDate').value, '2026-10-02'); assert.equal(p.document.activeElement, p.element('editZero'));
});
test('D31 画面内メニューの移動を戻る操作の履歴に残す', () => {
  const p = page(); p.element('openBorderTargets').click(); assert.equal(p.window.location.hash, '#targetStudio');
});
test('D32 動きの軽減設定をメニュー移動へ反映', () => {
  const p = page({}, { reducedMotion: true }); p.element('openBorderTargets').click(); assert.equal(p.element('targetStudio').lastScroll.behavior, 'auto');
});
test('D33 動きの軽減設定を日別編集移動へも反映', () => {
  const p = page(autoSettings, { reducedMotion: true }); const edit = p.element('analysisRows').children.flatMap(row => row.children).flatMap(cell => cell.children).find(node => node.dataset.date === '2026-10-02'); edit.click(); assert.equal(p.element('recordEditor').lastScroll.behavior, 'auto');
});
test('D34 メーターが画面内外でもシンプルメニューを表示し、旧非表示加算ボタンは表示中のワンタップ加算に置き換え', () => {
  const p = page();
  for (const outside of [false, true]) {
    p.intersect(outside); assert.equal(p.element('mini').getAttribute('aria-hidden'), 'false'); assert.equal(p.element('mini').classList.contains('show'), true);
    assert.equal(p.element('miniAdd'), undefined); assert.ok(p.element('miniAdd1k')); assert.equal(p.element('currentMini').tabIndex, 0); assert.equal(p.element('targetMini').tabIndex, 0);
  }
});
test('D35 現在値の入力中も終了後も固定HUDを表示する', () => {
  const p = page(); p.intersect(true); p.element('currentTop').focus(); assert.equal(p.element('mini').getAttribute('aria-hidden'), 'false'); assert.equal(p.element('mini').classList.contains('show'), true);
  assert.equal(p.document.body.classList.contains('editing-field'), true); assert.equal(p.element('miniAdd'), undefined); assert.ok(p.element('miniAdd1k')); assert.equal(p.element('currentMini').tabIndex, 0);
  p.element('currentTop').blur(); p.flushTimers(0); assert.equal(p.element('mini').getAttribute('aria-hidden'), 'false'); assert.equal(p.document.body.classList.contains('editing-field'), false);
});
test('D36 選択メニュー操作中も固定HUDを表示して編集状態を維持する', () => {
  const p = page(); p.intersect(true); p.element('quickRank').focus(); assert.equal(p.element('mini').classList.contains('show'), true); assert.equal(p.element('mini').getAttribute('aria-hidden'), 'false'); assert.equal(p.document.body.classList.contains('editing-field'), true);
  assert.equal(p.element('miniAdd'), undefined); assert.ok(p.element('miniAdd1k')); assert.equal(p.element('miniRank').tabIndex, 0);
});
test('D37 画面の表示領域変更で入力中の欄を見える位置へ', () => {
  const p = page(); p.element('currentTop').focus(); p.resizeViewport(); p.flushTimers(80); assert.equal(p.element('currentTop').lastScroll.block, 'nearest');
});
test('D38 残りコピーの成功は正確なptを含む', async () => {
  let copied; const p = page({}, { navigator: { clipboard: { writeText: async text => { copied = text; } } } }); await p.element('copyRemaining').click();
  assert.match(copied, /あと 1,001 pt/); assert.equal(p.element('summaryText').hidden, true); assert.match(p.element('summaryStatus').textContent, /コピーしました/);
});
test('D39 コピー拒否時は手動欄を表示して選択', async () => {
  const p = page({}, { navigator: { clipboard: { writeText: async () => { throw new Error('denied'); } } } }); await p.element('copyRemaining').click();
  assert.equal(p.element('summaryText').hidden, false); assert.equal(p.element('summaryText').selected, true); assert.equal(p.document.activeElement, p.element('summaryText')); assert.match(p.element('summaryStatus').textContent, /手動でコピー/);
});
test('D40 遅れたバックアップコピー失敗は折畳み祖先も開く', async () => {
  const pending = deferred(); const p = page({}, { navigator: { clipboard: { writeText: () => pending.promise } } }); const sec = openSection(p, 'backupText'); input(p,'saveMethod','copy','change');const job = p.element('saveExport').click(); sec.querySelector('.sectionToggle').click();p.element('backupTools').open=false;pending.reject(new Error('denied')); await job;
  assert.equal(sec.classList.contains('collapsed'), false); assert.equal(sec.querySelector('.section-body').hidden, false); assert.equal(p.element('backupText').hidden, false);
});
test('D41 分析コピーのfalse結果でも手動欄を表示', async () => {
  const p = page({}, { navigator: { clipboard: { writeText: async () => false } } }); await p.element('copyAnalysis').click(); assert.equal(p.element('analysisText').hidden, false); assert.match(p.element('analysisText').value, /目標メーター分析/); assert.match(p.element('analysisMessage').textContent, /手動でコピー/);
});
test('D42 古いコピー結果で新しい失敗案内を上書きしない', async () => {
  const first = deferred(), second = deferred(); let calls = 0; const p = page({}, { navigator: { clipboard: { writeText: () => (++calls === 1 ? first.promise : second.promise) } } }); const a = p.element('copyRemaining').click(), b = p.element('copyRemaining').click(); second.reject(new Error('denied')); await b; first.resolve(); await a;
  assert.match(p.element('summaryStatus').textContent, /手動でコピー/); assert.equal(p.element('summaryText').hidden, false);
});
test('D44 古い成功通知のタイマーで新しいエラーを消さない', async () => {
  let calls = 0; const p = page({}, { navigator: { clipboard: { writeText: async () => { if (++calls > 1) throw new Error('denied'); } } } });input(p,'saveMethod','copy','change');await p.element('saveExport').click();await p.element('saveExport').click();p.flushTimers(2500);assert.equal(p.element('bkMsg').className, 'toast err');assert.match(p.element('bkMsg').textContent, /手動でコピー/);
});
test('D45 代替コピー成功後に起点ボタンへフォーカス復帰', async () => {
  const p = page({}, { navigator: { clipboard: { writeText: async () => false } }, execCommand: () => true }); p.element('copyRemaining').focus(); await p.element('copyRemaining').click(); assert.equal(p.element('summaryText').hidden, true); assert.equal(p.document.activeElement, p.element('copyRemaining'));
});
test('D46 Clipboard未対応でも代替コピーを試行', () => {
  let calls = 0; const p = page({}, { execCommand: () => { calls++; return true; } });input(p,'saveMethod','copy','change');p.element('saveExport').click();assert.equal(calls, 1);assert.equal(p.element('backupText').hidden, true);assert.equal(p.element('bkMsg').textContent, 'バックアップをコピーしました。');
});
test('D47 スマホ用CSSは既存の最後に適用して旧指定を上書き', () => {
  const marker = html.indexOf('/* mobile-usability:start */'); assert.ok(marker > html.lastIndexOf('<style'));
  const tail = html.slice(marker, html.indexOf('</style>', marker)); assert.match(tail, /#liveMeter \.goal-inputs input\{height:2\.75rem;min-height:max\(44px,2\.75rem\);font-size:1rem/);
  assert.match(tail, /#liveMeter #closeSel\{[^}]*height:2\.75rem/); assert.match(tail, /\.quick-target-selects select\{height:2\.75rem/); assert.match(tail, /#appliedContext\{font-size:\.75rem!important/);
});
test('D48 長い残り数値でも正確な値と読上げ説明を保持', () => {
  const max = engine().MAX_VALUE; const p = page({ target: String(max) }); assert.equal(p.element('remain').dataset.size, 'long'); assert.equal(p.element('remain').textContent, '360287970189.639K'); assert.equal(p.element('remain').getAttribute('aria-label'), '残り 360,287,970,189,639 pt');
});
test('D49 拡大を禁止せず左右の安全余白と入力属性を確保', () => {
  const viewport = html.match(/name="viewport" content="([^"]+)"/)[1]; assert.doesNotMatch(viewport, /user-scalable=no|maximum-scale=1/);
  assert.match(html, /padding-left:max\(10px,env\(safe-area-inset-left/); assert.match(html, /100% - 2 \* max\(10px,env\(safe-area-inset-left/);
  const p = page(); assert.equal(p.element('coreCountTop').getAttribute('enterkeyhint'), 'done'); assert.equal(p.element('currentTop').getAttribute('inputmode'), 'decimal');
});
test('D50 全体の項目順・標準デフォルト・保存内容を維持', () => {
  const p = page(); const groups = ['remainingSummary', 'quickTargetControls', 'remainingItems', 'manualGoal', 'currentTop'];
  const order = groups.map(id => html.indexOf(`id="${id}"`)); assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.equal(saved(p).rank, 'S1'); assert.equal(saved(p).coreCount, '0'); assert.equal(saved(p).target, '1001'); assert.equal(saved(p).current, '0');
});
