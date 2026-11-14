// メーター予想の情報源（イベント収集・補正値の集計）の最小テスト。ネットワーク不要。
import assert from 'node:assert/strict';
import {findPeriods, findRanks, classify, pickLabel, articleText, toEvent, SOURCES, tidyLabel, titleNameOf, newsItems, eventFrom, readPasted} from '../automation/collect-events.mjs';
import {snsText, snsEvent, snsLines, snsLineEvent, snsDayItems, rankText} from '../calculator/event-parse.mjs';
import {readFileSync} from 'node:fs';
import {eventParseBlock, injectEventParse} from '../scripts/prepare-event-parse.mjs';
import {paydayOf, calendarTags, buildFactors} from '../automation/build-meter-factors.mjs';

// 期間：年あり・年なし・同日の時刻範囲・「より開催」・エントリ期間の区別
{
  const p = findPeriods('📅 開催期間：2026年10月9日(金) 12:00 〜 2026年10月13日(火) 23:59\n🏃 エントリ期間：2026年9月28日(月) 16:00 〜 2026年10月3日(土) 1:59', '2026-10-01T00:00:00+09:00');
  assert.deepEqual(p.map(x => [x.start, x.end, x.isEntry]), [['2026-10-09', '2026-10-13', false], ['2026-09-28', '2026-10-03', true]]);
  assert.equal(p[0].startTime, '12:00'); assert.equal(p[0].endTime, '23:59'); assert.equal(p[0].labeled, true);
  const q = findPeriods('👑 プレミアリーグ（S6〜B1）：2026年10月19日(月) 0:00 〜 23:59', '2026-10-01');
  assert.deepEqual([q[0].start, q[0].end], ['2026-10-19', '2026-10-19']);
  assert.ok(q[0].ranks.includes('S6') && q[0].ranks.includes('B1') && !q[0].ranks.includes('C3'));
  const r = findPeriods('2026年11月13日（金）より開催される「3色対抗 世代ウォーズ」。', '2026-11-10');
  assert.deepEqual([r[0].start, r[0].end], ['2026-11-13', null]);
  const y = findPeriods('開催期間：12/28(月)〜1/3(日)', '2026-12-01');
  assert.deepEqual([y[0].start, y[0].end], ['2026-12-28', '2027-01-03']);
}
// ランク：範囲・E帯を端にした範囲・「Aランク」・全ランク
assert.deepEqual(findRanks('C3〜E1'), ['D1', 'D2', 'D3', 'C1', 'C2', 'C3']);
assert.deepEqual(findRanks('対象：Aランク'), ['A1', 'A2', 'A3']);
assert.equal(findRanks('全ランク対象').length, 18);
assert.equal(classify('POCO LAND 2026 開催', ''), 'big');
assert.equal(classify('夏の熱狂をふたたび。「Pococha甲子園 2026」 開催決定！', ''), 'big');
assert.notEqual(classify('【ポコガチャ1周年企画】オリジナルきせかえアイテムコンテスト', ''), 'big');
assert.notEqual(classify('リアル花火大会を配信画面で楽しもう', ''), 'big');
assert.equal(classify('【全ミッション一覧】 10月差し入れお届けミッション', ''), 'mission');

// 給料日：土日祝なら前の営業日（2026-01-10 は土曜 → 1/9 金、2026-05-05 は祝日だが 5日払いは対象外）
assert.equal(paydayOf(2026, 1, 10), '2026-01-09');
assert.equal(paydayOf(2026, 10, 25), '2026-10-23'); // 25日が日曜
assert.equal(paydayOf(2026, 11, 20), '2026-11-20'); // 金曜
assert.ok(calendarTags('2026-10-23').includes('payday25-actual'));
assert.ok(calendarTags('2026-10-24').includes('payday25-next'));
assert.ok(calendarTags('2026-10-25').includes('payday25'));

// 集計：曜日で値が違う合成データで、曜日の補正の向きが合うこと。欠損（0）は使わないこと。
{
  const records = [];
  for (let t = Date.parse('2025-01-01'); t <= Date.parse('2025-06-30'); t += 864e5) {
    const d = new Date(t).toISOString().slice(0, 10), w = new Date(t).getUTCDay();
    const base = w === 6 ? 110 : 100;
    records.push({date: d, close: '24', ranks: {A1: [base * 1000, base * 2000, base * 3000], B1: [0, 0, 0]}});
  }
  const f = buildFactors({records}, null);
  assert.ok(f.weekday['24']['土'].pct > 5, '土曜が高い');
  assert.equal(f.weekday['24']['水'].pct, 0, '平日は普段どおり（中央値なので土曜の影響を受けない）');
  assert.equal(f.weekdayByRank['24'].B1['土'].n, 0, '0は欠損扱い');
  assert.equal(f.calendar['24'].christmas.status, 'insufficient');
}
// イベント名の決め方：『』「」の名前 → 短い前置き → 直前の見出し。文の切れ端は名前にしない。
assert.equal(pickLabel('「Pococha Halloween Party」開催期間：', null), 'Pococha Halloween Party');
assert.equal(pickLabel('👑 プレミアリーグ（S6〜B1）：', null), 'プレミアリーグ（S6〜B1）');
assert.equal(pickLabel('開催期間：', 'POCO LAND 10周年祭'), 'POCO LAND 10周年祭 開催期間');
assert.equal(pickLabel('こんにちは、Pococha運営です！', '世代ウォーズ'), '世代ウォーズ');
assert.equal(pickLabel('本記事では、', null), null);
assert.equal(pickLabel('※', '夏祭り'), '夏祭り');
// 本文の区画だけを読み、見出しは「## 」付きの行になる
{
  const html = '<nav>メインコンテンツへスキップ 1/1〜1/2</nav><div class="note-common-styles__textnote-body isolate"><h2>冬祭り</h2><p>開催期間：2026年12月1日(火) 12:00 〜 2026年12月3日(木) 23:59</p><div><p>12/2(水) 20:30〜21:00 出演</p></div><p>使用期限：2026年12月1日 〜 2026年12月31日</p><p>開催期間：2026年12月1日(火) 12:00 〜 2026年12月3日(木) 23:59</p></div><footer>x</footer>';
  const text = articleText(html);
  assert.ok(!text.includes('メインコンテンツ') && text.includes('## 冬祭り'));
  const p = findPeriods(text, '2026-11-20');
  const ev = p.filter(x => !x.isEntry);
  assert.equal(ev.length, 1, '重複はまとめ、配信枠・使用期限は除く');
  assert.equal(ev[0].label, '冬祭り 開催期間');
  assert.deepEqual(p.filter(x => x.isEntry).map(x => x.kind).sort(), ['other', 'slot']);
  const e = toEvent(SOURCES[0], 'https://report.pococha.com/n/x', '<meta property="og:title" content="【ボイスライバー限定】冬祭り"><script>"datePublished":"2026-11-20T00:00:00+09:00"</script>' + html);
  assert.equal(e.periods.length, 1); assert.equal(e.excluded, 2); assert.deepEqual(e.audience, ['ボイス']);
}
// 名前の整え方：見出しの決まり文句（概要・ルール/詳細・〜について・末尾の開催期間）を外し、決まり文句だけなら記事タイトルの名前
assert.equal(tidyLabel('つなごうPocochaの輪！ポコキャラバン10周年祭 開催期間', 'x'), 'つなごうPocochaの輪！ポコキャラバン10周年祭');
assert.equal(tidyLabel('イベント概要 イベント期間', 'トーク番組出演権'), 'トーク番組出演権');
assert.equal(tidyLabel('ルール/詳細 イベント期間', '始球式'), '始球式');
assert.equal(tidyLabel('この記事でご紹介する内容', 'アイドル応援ミッション'), 'アイドル応援ミッション');
assert.equal(tidyLabel('“チーム対抗”ポコチャバトルについて', 'x'), '“チーム対抗”ポコチャバトル');
assert.equal(tidyLabel('「JOYSOUND認定 歌うまライバー決定戦！2026 Autumn」採点対象楽', 'x'), 'JOYSOUND認定 歌うまライバー決定戦！2026 Autumn');
assert.equal(tidyLabel('5月実施予定！Pococha内イベント「ミューズ プレオーディション」の概要 イベント期間', 'x'), 'ミューズ プレオーディション');
assert.equal(tidyLabel('ついに本戦！「ar30周年企画 年間出演モデルオーディション', 'x'), 'ついに本戦！ ar30周年企画 年間出演モデルオーディション', '閉じていない括弧は記号だけ外す');
assert.equal(tidyLabel('新人戦 予選期間', 'x'), '新人戦 予選期間', '段階名は残す');
assert.equal(tidyLabel('投票期間', 'きせかえコンテスト'), 'きせかえコンテスト', '期間の呼び名だけの名前は記事タイトルの名前に');
assert.equal(tidyLabel('', 'タイトル名'), 'タイトル名');
// 記事タイトルの名前：『』「」の名前を優先、日付・お知らせの【】や「のご紹介」を外す、内容のある【】は残す
assert.equal(titleNameOf('Pococha 年末の一大イベント「POCO LAND 10周年祭」開催決定！〜10年分の、いつもに拍手を〜'), 'POCO LAND 10周年祭');
assert.equal(titleNameOf('【9/16〜9/29】ファミリーみんなで新しいなかまを迎えよう！最大30,000コイン山分け 友達招待キャンペーン'), 'ファミリーみんなで新しいなかまを迎えよう！最大30,000コイン山分け 友達招待キャンペーン');
assert.equal(titleNameOf('【IDOL RISING】 アイドル応援ミッションのご紹介！'), '【IDOL RISING】 アイドル応援ミッション');
assert.equal(titleNameOf('【Music Pococha LIVE!!🎤 -福岡クリスマスアドベント 2026- 開催🌲✨】'), 'Music Pococha LIVE!! -福岡クリスマスアドベント 2026');
assert.equal(titleNameOf('「ヒーロー戦隊」アイテム登場!'), 'ヒーロー戦隊');
// 公式サイトの「お知らせ」：一覧ページの埋め込みデータから記事を取り出し、本文から期間（同じ日の時刻つき＝半日も）を読む
{
  const news = {props: {pageProps: {totalPageCount: 27, newsList: [
    {id: 'abc', title: '半日イベント開催', publishedAt: '2026-11-10T00:00:00Z', revisedAt: '2026-11-11T00:00:00Z', body: '<h3>■概要</h3><ul><li>開催期間：2026年11月20日（金）12:00〜23:59</li><li>対象：S1〜S6</li></ul>'},
    {id: 'def', title: 'お知らせ', publishedAt: '2026-11-01T00:00:00Z', body: '<p>アプリを更新しました。</p>'}]}}};
  const html = '<html><script id="__NEXT_DATA__" type="application/json">' + JSON.stringify(news) + '</script></html>';
  const r = newsItems(html);
  assert.equal(r.pages, 27); assert.equal(r.items.length, 2);
  assert.equal(r.items[0].modified, '2026-11-11T00:00:00Z', '更新日は revisedAt');
  const site = SOURCES.find(x => x.id === 'pococha-official-site');
  assert.ok(site && site.news && site.checked.terms.includes('第10条'), '取得元：公式サイトのお知らせ（規約の確認つき）');
  const ev = eventFrom(site, 'https://www.pococha.com/ja/news/abc', r.items[0], articleText(r.items[0].body));
  assert.deepEqual(ev.periods.map(p => [p.start, p.startTime, p.end, p.endTime]), [['2026-11-20', '12:00', '2026-11-20', '23:59']], '同じ日の12時間（半日）は配信枠として除外しない');
  assert.equal(ev.sourceId, 'pococha-official-site');
  assert.ok(ev.ranks.includes('S1') && ev.ranks.includes('S6'));
  assert.deepEqual(newsItems('<html></html>'), {items: [], pages: 0});
}
// 公式X・インスタの告知（貼り付け）：相対的な日付・「21時」・3時間の開催も読み、共有用の1行にして読み戻せる
{
  assert.equal(snsText('本日21時〜24時', '2026-11-14'), '2026年11月14日 21:00〜24:00');
  assert.equal(snsText('明日12時半スタート', '2026-12-31'), '2027年1月1日 12:30より開始');
  const post = '＼本日開催／\n夜の部ランキングイベント🌙\n本日21時〜24時の3時間限定！\n対象：S1〜S6ランク\n#ポコチャ\nhttps://x.com/pococha_jp/status/123';
  const ev = snsEvent(post, {posted: '2026-11-14', url: 'https://x.com/pococha_jp/status/123'});
  assert.equal(ev.title, '夜の部ランキングイベント', '飾りの行・ハッシュタグ・URLは名前にしない');
  assert.deepEqual(ev.periods.map(p => [p.start, p.startTime, p.end, p.endTime]), [['2026-11-14', '21:00', '2026-11-14', '24:00']], 'SNSでは3時間の開催も配信枠として除外しない');
  const lines = snsLines(ev, {posted: '2026-11-14', url: 'https://x.com/pococha_jp/status/123'});
  assert.deepEqual(lines, ['投稿日 2026-11-14｜夜の部ランキングイベント｜開催期間：2026年11月14日 21:00〜2026年11月14日 24:00｜対象：S1〜S6｜https://x.com/pococha_jp/status/123']);
  assert.ok(!lines[0].includes('限定'), '本文は残さない（事実だけ）');
  const back = snsLineEvent(lines[0]);
  assert.equal(back.sourceId, 'pococha-official-sns'); assert.equal(back.id, '123');
  assert.deepEqual(back.periods.map(p => [p.label, p.start, p.startTime, p.endTime]), [['夜の部ランキングイベント', '2026-11-14', '21:00', '24:00']]);
  assert.deepEqual(back.ranks, ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
  const day = snsDayItems(back, '2026-11-14');
  assert.equal(day.length, 1); assert.equal(day[0].ends, true); assert.equal(day[0].phase, 'first');
  assert.deepEqual(snsDayItems(back, '2026-11-15'), []);
  assert.equal(snsLineEvent('# 説明'), null); assert.equal(snsLineEvent('投稿日 2026-11-14｜名前だけ'), null);
  const noUrl = snsLineEvent('投稿日 2026-11-14｜秋祭り｜開催期間：2026年11月20日 12:00より開始');
  assert.ok(noUrl.url.startsWith('https://x.com/pococha_jp#'), 'URLの無い行も区別できる印を付ける'); assert.equal(noUrl.periods[0].end, null);
  // 1行だけの告知：名前に日時・対象・「開催！」を入れない。「12時から24時まで」「B帯」も読む
  const one = snsEvent('本日21時〜24時 夜の部ランキング開催！対象：S1〜S6', {posted: '2026-11-13'});
  assert.equal(one.title, '夜の部ランキング'); assert.deepEqual(one.ranks, ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
  assert.equal(snsEvent('11/20 12時〜23時59分 「ハロウィン前夜祭」開催決定！', {posted: '2026-11-13'}).title, 'ハロウィン前夜祭');
  const b = snsEvent('明日12時から24時まで、B帯限定のランキングを開催します', {posted: '2026-11-13'});
  assert.deepEqual(b.periods.map(p => [p.start, p.startTime, p.endTime]), [['2026-11-14', '12:00', '24:00']]); assert.deepEqual(b.ranks, ['B1', 'B2', 'B3']);
  assert.equal(rankText(['A1', 'A2', 'A3', 'S1']), 'A1〜S1'); assert.equal(rankText(['B1', 'B3']), 'B1、B3');
  assert.equal(rankText(findRanks('全ランク')), '全ランク'); assert.equal(rankText([]), '');
  // data/sns-events.txt：毎回作り直す（消した行は消える）・本文を持たない
  const site = SOURCES.find(x => x.id === 'pococha-official-sns');
  assert.ok(site && site.pasted === 'data/sns-events.txt' && /自動収集/.test(site.checked.terms), '取得元：公式X・インスタ（手動の貼り付け、規約の確認つき）');
  const byId = new Map([['old', {sourceId: 'pococha-official-sns', url: 'old'}], ['n', {sourceId: 'pococha-official-note', url: 'n'}]]);
  assert.equal(readPasted(site, byId, '# x\n' + lines[0] + '\nこわれた行'), 1);
  assert.deepEqual([...byId.keys()].sort(), ['https://x.com/pococha_jp/status/123', 'n']);
  assert.equal(byId.get('https://x.com/pococha_jp/status/123').line, undefined);
  assert.equal(readPasted(site, new Map(), readFileSync(new URL('../data/sns-events.txt', import.meta.url), 'utf8')), 0, '説明の行は読まない');
  // data/event-page-events.txt：公式イベントページを人が開いて確認した行。確認日が開催より後でも読み、取得元を分けて記録する
  const page = SOURCES.find(x => x.id === 'pococha-official-event-page');
  assert.ok(page && page.pasted === 'data/event-page-events.txt' && /ログイン/.test(page.checked.terms), '取得元：公式イベントページ（手動の確認、規約の確認つき）');
  const pageById = new Map([['keep', {sourceId: 'pococha-official-sns', url: 'keep'}], ['gone', {sourceId: 'pococha-official-event-page', url: 'gone'}]]);
  const pageLine = '確認日 2026-11-14｜デビューぽこトレ｜開催期間：2026年9月21日 12:00〜2026年9月21日 23:59｜対象：D1〜D3｜https://event.pococha.com/ja-jp/festivals/x_1';
  assert.equal(readPasted(page, pageById, '# x\n' + pageLine + '\n確認日 2026-11-14｜期間のない行｜対象：D1〜D3'), 1);
  assert.deepEqual([...pageById.keys()].sort(), ['https://event.pococha.com/ja-jp/festivals/x_1', 'keep'], '同じ取得元の古い行だけ消える');
  const pageEv = pageById.get('https://event.pococha.com/ja-jp/festivals/x_1');
  assert.deepEqual([pageEv.sourceId, pageEv.confirmedAt, pageEv.published, pageEv.line], ['pococha-official-event-page', '2026-11-14', null, undefined]);
  assert.deepEqual(pageEv.periods.map(p => [p.start, p.end, p.startTime, p.endTime]), [['2026-09-21', '2026-09-21', '12:00', '23:59']]);
  assert.deepEqual(pageEv.ranks, ['D1', 'D2', 'D3']);
  const pageFile = new Map();
  const pageCount = readPasted(page, pageFile, readFileSync(new URL('../data/event-page-events.txt', import.meta.url), 'utf8'));
  assert.ok(pageCount >= 2 && pageFile.size === pageCount, 'data/event-page-events.txt の行はすべて読めて、URLが重ならない');
  assert.ok([...pageFile.values()].every(e => /^https:\/\/event\.pococha\.com\//.test(e.url) && e.periods.length === 1 && e.periods[0].startTime), '公式イベントページのURLと開始時刻つき');
}
// 画面に書き写した読み取り部品が calculator/event-parse.mjs と一致すること（npm run pages:prepare）
{
  const page = readFileSync(new URL('../calculator/index.html', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../calculator/event-parse.mjs', import.meta.url), 'utf8');
  assert.equal(injectEventParse(page, source), page, 'index.html の読み取り部品が古い（npm run pages:prepare）');
  assert.ok(eventParseBlock(source).includes('var PocoEventParse=(function(){'));
}
console.log('meter-sources ok');
