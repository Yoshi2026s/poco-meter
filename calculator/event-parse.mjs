// イベント記事・お知らせ・SNSの投稿文から、期間・時間帯・対象ランク・名前などの事実を読み取る部品（ネットワーク・Node専用の機能を使わない）。
// 自動収集（automation/collect-events.mjs）と画面（calculator/index.html の貼り付け読み取り）で共用する。
// 画面へは scripts/prepare-event-parse.mjs が index.html の目印の間に書き写す（npm run pages:prepare）。直したら作り直してコミットする。
export const RANKS = ['D1','D2','D3','C1','C2','C3','B1','B2','B3','A1','A2','A3','S1','S2','S3','S4','S5','S6'];

const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, ' ');

// note の記事本文（note-common-styles__textnote-body の div）だけを取り出す。見つからなければページ全体。
export function articleBody(html) {
  const i = html.indexOf('note-common-styles__textnote-body');
  if (i < 0) return html;
  const s = html.lastIndexOf('<div', i);
  const re = /<\/?div\b/g; re.lastIndex = s;
  let depth = 0, m;
  while ((m = re.exec(html))) { depth += m[0] === '<div' ? 1 : -1; if (depth === 0) return html.slice(s, m.index); }
  return html.slice(s);
}

export function articleText(html) {
  return decode(articleBody(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<h[2-4][^>]*>/gi, '\n## ')
    .replace(/<(br|\/p|\/h[1-6]|\/li|\/div|\/tr|\/td|\/th|\/figcaption)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t　]+/g, ' ').replace(/\n\s*\n+/g, '\n');
}

export function articleMeta(html) {
  const title = decode(html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/)?.[1] || html.match(/<title>([^<]*)<\/title>/)?.[1] || '')
    .replace(/｜Pococha\(ポコチャ\)公式\s*$/, '').trim();
  const published = html.match(/"datePublished":"([^"]+)"/)?.[1] || null;
  const modified = html.match(/"dateModified":"([^"]+)"/)?.[1] || published;
  return {title, published, modified};
}

const z = n => String(n).padStart(2, '0');
const toFull = (s) => s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/：/g, ':').replace(/／/g, '/');

// 「2026年10月9日(金) 12:00 〜 2026年10月13日(火) 23:59」「10/9(金)12:00〜10/13(火)23:59」などを拾う。
export function findPeriods(text, publishedISO) {
  const t = toFull(text);
  const pubYear = publishedISO ? +publishedISO.slice(0, 4) : new Date().getFullYear();
  const pubMonth = publishedISO ? +publishedISO.slice(5, 7) : 1;
  const D = String.raw`(?:(\d{4})年)?(\d{1,2})(?:月|/)(\d{1,2})日?\s*(?:[\(（][^)）]{1,3}[\)）])?\s*(\d{1,2}:\d{2})?`;
  // 範囲：日付〜日付／日付 時刻〜時刻（同日）／日付より開催（開始のみ）
  const re = new RegExp(D + String.raw`\s*(?:[〜~～\-–]\s*(?:` + D + String.raw`|(\d{1,2}:\d{2}))|より(?:開催|スタート|開始))`, 'g');
  const yearOf = (y, mo) => { if (y) return +y; let v = pubYear; if (+mo < pubMonth - 6) v++; return v; };
  const out = [];
  const lines = t.split('\n');
  lines.forEach((line, li) => {
    for (const m of line.matchAll(re)) {
      const [, y1, mo1, d1, h1, y2, mo2, d2, h2, hOnly] = m;
      if (+mo1 > 12 || +d1 > 31 || +mo1 < 1 || +d1 < 1) continue;
      const ys = yearOf(y1, mo1);
      const start = `${ys}-${z(mo1)}-${z(d1)}`;
      let end = null, endTime = null;
      if (mo2) {
        if (+mo2 > 12 || +d2 > 31) continue;
        let ye = y2 ? +y2 : ys; if (!y2 && +mo2 < +mo1) ye = ys + 1;
        end = `${ye}-${z(mo2)}-${z(d2)}`; endTime = h2 || null;
      } else if (hOnly) { end = start; endTime = hOnly; }
      if (!h1 && !mo2 && hOnly) continue; // 「10:00〜12:00」だけの行は日付範囲ではない
      if (end && (end < start || (Date.parse(end) - Date.parse(start)) / 864e5 > 120)) continue;
      const prefix = line.slice(0, m.index).replace(/^## /, '');
      const head = [lines[li - 1], lines[li - 2]].filter(Boolean).join(' ');
      // 直前の見出し（## 行）。日付の行から12行以内のもの。
      let heading = null;
      for (let k = li - 1; k >= Math.max(0, li - 12); k--) if (/^## /.test(lines[k] || '')) { heading = cleanLabel(lines[k].slice(3)); break; }
      const ctx = `${heading || ''} ${prefix}`;
      const labeled = /開催期間|イベント期間|開催日程|開催日時|キャンペーン期間|期間[:：]|予選|本戦|準決勝|決勝|ステージ|リーグ|より(開催|スタート|開始)/.test(prefix + m[0]);
      const isEntry = /エントリー?期間|応募期間|申込|受付/.test(prefix);
      // イベントそのものの期間ではないもの（使用期限・配信時間・募集や選考・結果発表など）
      const nonEvent = NON_EVENT.test(prefix) || (!labeled && NON_EVENT.test(heading || ''));
      const mins = x => x ? +x.split(':')[0] * 60 + +x.split(':')[1] : null;
      const slot = end === start && h1 && endTime && mins(endTime) > mins(h1) && mins(endTime) - mins(h1) <= 180 && !labeled;
      out.push({start, end, startTime: h1 || null, endTime, label: pickLabel(prefix, heading), labeled, isEntry: isEntry || nonEvent || slot,
        kind: isEntry ? 'entry' : nonEvent ? 'other' : slot ? 'slot' : 'event', ranks: findRanks(ctx).length ? findRanks(ctx) : findRanks(head)});
    }
  });
  // 同じ期間の重複はまとめる（名前は見出し付き・具体的なものを残す）。
  const best = new Map();
  for (const p of out) {
    const k = `${p.start}|${p.end}|${p.isEntry}`, cur = best.get(k);
    const score = q => (q.labeled ? 2 : 0) + (q.label ? 1 : 0) + (q.ranks.length ? 1 : 0);
    if (!cur || score(p) > score(cur)) best.set(k, p);
  }
  return [...best.values()];
}

export const NON_EVENT = /使用期限|有効期限|利用期限|交換期限|獲得対象期限|次回配信|配信日時|配信スケジュール|配信予定|放送|募集期間|応募|選考|審査|結果発表|発表日|受け?取り期限|付与|適用期間|お届け予定|販売期間|購入期間/;
export const GENERIC = /^(開催期間|イベント期間|開催日程|開催日時|キャンペーン期間|集計期間|期間|日程|スケジュール|第\d+日程|イベント名)$/;
export function cleanLabel(s) {
  return String(s || '').replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, '').replace(/[:：\s・■▼▶︎●◆◇★☆【】]+$/, '').replace(/^[\s・■▼▶︎●◆◇★☆]+/, '')
    .replace(/^イベント名\s*[:：]\s*/, '').replace(/\s+/g, ' ').trim();
}
// 見出しの決まり文句（概要・詳細・ルール・「〜について」・末尾の「開催期間」等）を名前から外す。
// 決まり文句しか残らないときは記事タイトルの名前を使う。予選・本戦・投票などの段階名は残す。
const BOILER = /^(?:(?:イベント|キャンペーン|企画|大会)?(?:概要|詳細|内容|ルール|の流れ)(?:[/・／](?:概要|詳細|ルール|内容))*|この記事でご紹介する内容|この記事の内容|豪華賞品はこちら[！!]?|対象ランク|対象者?|スケジュール|エントリー?|(?:投票|公開|対象|確認|検証|計測対象|アンケート|配信|通常配信)期間)$/;
// 記事タイトルから名前を作る：『』「」の名前を優先し、日付やお知らせの【】と「のご紹介」を外し、切れた括弧を残さない。
// 括弧の外に残る語が短い（「〜」開催決定！）か決まり文句（の概要）なら、括弧内だけを名前にする
const QUOTE_TAIL = /^(?:の?(?:概要|詳細|内容|ご紹介|お知らせ|ルール説明)|(?:開催|決定|に関する|をPocochaで).*|.{0,10})$/;
// 閉じていない括弧は記号だけ外し（中身は残す）、末尾の区切り記号を落とす
function cutDangling(t) {
  for (const [o, c] of [['【', '】'], ['「', '」'], ['『', '』'], ['（', '）'], ['(', ')']]) {
    if (t.lastIndexOf(o) > t.lastIndexOf(c)) t = t.slice(0, t.lastIndexOf(o)) + ' ' + t.slice(t.lastIndexOf(o) + 1);
  }
  return t.replace(/\s+/g, ' ').replace(/[\s：:・、〜~×-]+$/, '').trim();
}
// 長い名前は区切り（空白・！・」など）で切る。区切りが前すぎるときは文字数で切る
function cutAt(t, max) {
  if (t.length <= max) return t;
  const head = t.slice(0, max), i = Math.max(...[' ', '！', '!', '」', '』', '】', '×'].map(ch => head.lastIndexOf(ch)));
  return i >= 20 ? head.slice(0, i + (/[！!」』】]/.test(head[i]) ? 1 : 0)) : head;
}
export function titleNameOf(title) {
  const raw = cleanLabel(String(title || '').replace(/[＼／]/g, ' '));
  // 日付・お知らせだけの【】（【9/16〜9/29】【期間限定】【新イベ開催予告】など）は外す
  const stripped = raw.replace(/【[^】]*(?:\d+\s*[/月]|限定|登場|開催予告|お知らせ|告知|更新|追記|速報|NEW|予告|結果発表)[^】]*】/g, ' ').replace(/\s+/g, ' ').trim();
  let t = stripped.length >= 6 ? stripped : raw;
  t = t.replace(/(?:のご紹介|開催決定|を開催|開催)[！!]*$/, '').trim();
  const q = t.match(/^[^『「]{0,20}[『「]([^』」]{4,40})[』」](.*)$/);
  if (q && QUOTE_TAIL.test(q[2].trim())) return q[1];
  return cutDangling(cutAt(t, 48)) || cutDangling(raw.slice(0, 48));
}
export function tidyLabel(label, titleName) {
  let l = cleanLabel(label);
  for (let i = 0; i < 3; i++) {
    const before = l;
    l = l.replace(/\s*(?:の)?(?:開催期間|イベント期間|キャンペーン期間|開催日程|開催日時)$/, '').replace(/\s*について$/, '').trim();
    const parts = l.split(' ');
    if (parts.length > 1 && BOILER.test(parts[0])) l = parts.slice(1).join(' ');
    if (parts.length > 1 && BOILER.test(parts[parts.length - 1])) l = parts.slice(0, -1).join(' ');
    l = l.replace(/^(?:\d+月実施予定[！!]?\s*)?Pococha内イベント/, '').trim();
    const q = l.match(/^[^「『]{0,30}[「『]([^」』]{2,40})[」』](.+)$/);
    if (q && QUOTE_TAIL.test(q[2].trim())) l = q[1];
    l = cutDangling(l);
    if (l === before) break;
  }
  if (!l || l.length < 2 || GENERIC.test(l) || BOILER.test(l) || /^(?:イベント|キャンペーン)$/.test(l)) return titleName || null;
  // 以前の収集で記事タイトルを途中で切った名前は、整えた記事タイトルの名前に置き換える
  if (titleName && titleName.length > l.length && titleName.startsWith(l)) return titleName;
  return l;
}
// 名前の決め方：①行内の『』「」で囲まれた名前 ②行の前置きが短い名前ならそれ ③直前の見出し（＋前置きが「開催期間」等なら付ける）
export function pickLabel(prefix, heading) {
  const p = cleanLabel(prefix);
  const quoted = p.match(/[『「]([^』」]{2,40})[』」]/);
  if (quoted) return quoted[1];
  const short = p && p.length >= 2 && p.length <= 24 && !/[。、！？!?]|です|ます|こちら|以下|本記事|こんにちは/.test(p) && !/^[\d※＊*（(]|\/$|^【?$/.test(p);
  if (short && !GENERIC.test(p)) return p;
  if (heading && heading.length <= 40) return short && GENERIC.test(p) ? `${heading} ${p}` : heading;
  return short ? p : null;
}

// 「S1〜S6」「B1-A3」「Aランク」「全ランク」などから対象ランクを集める。
export function findRanks(text) {
  const t = toFull(text).replace(/ランク/g, 'ランク ');
  const set = new Set();
  if (/全ランク|すべてのランク|全てのランク/.test(t)) RANKS.forEach(r => set.add(r));
  const ORDER = ['E1', 'E2', 'E3', ...RANKS]; // E帯は範囲の端としてだけ使い、結果には含めない
  for (const m of t.matchAll(/([SABCDE])([1-6])\s*[〜~～\-–ー]\s*([SABCDE])([1-6])/g)) {
    const a = ORDER.indexOf(m[1] + m[2]), b = ORDER.indexOf(m[3] + m[4]);
    if (a >= 0 && b >= 0) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) set.add(ORDER[i]);
  }
  for (const m of t.matchAll(/(?:^|[^A-Za-z])([SABCD])ランク/g)) RANKS.filter(r => r[0] === m[1]).forEach(r => set.add(r));
  return RANKS.filter(r => set.has(r));
}

// 大型イベント：全体のボーダーを動かしうる、ランク横断の年間・季節の大会だけ（タイトルで判定）。
const BIG = /POCO\s?LAND|POCO\s?AWARD|ギルドカップ|Pococha\s?甲子園|世代ウォーズ|周年祭|総合ランキング/i;
export function classify(title, text) {
  const s = `${title}\n${text.slice(0, 1500)}`;
  if (BIG.test(title)) return 'big';
  if (/新規ライバー|デビュー|ルーキー/.test(title)) return 'newcomer';
  if (/ミッション/.test(title)) return 'mission';
  if (/アイテム|イベントカレンダー/.test(title)) return 'item';
  if (/×|コラボ|出演権|モデル|オーディション|決定戦|選抜/.test(s.slice(0, 200))) return 'collab';
  if (/イベント|ランキング|開催/.test(title)) return 'event';
  return 'notice';
}

export function toEvent(source, url, html) {
  return eventFrom(source, url, articleMeta(html), articleText(html));
}
// 記事のタイトル・公開日・更新日と本文の文字から、イベントの事実（期間・ランク・種類など）を作る。
export function eventFrom(source, url, {title, published, modified}, text, {sns = false} = {}) {
  // SNSの告知は短い時間帯（3時間以下）の開催も多いので、配信枠として除外しない
  const periods = findPeriods(text, modified || published).map(p => sns && p.kind === 'slot' ? {...p, isEntry: false, kind: 'event'} : p);
  // 公開日〜最終更新日の前後だけを対象にする（過去の実績紹介や翌年の予告を拾いすぎないため）。
  const lo = published ? Date.parse(published.slice(0, 10)) - 30 * 864e5 : -Infinity;
  const hi = modified ? Date.parse(modified.slice(0, 10)) + 90 * 864e5 : Infinity;
  const titleName = titleNameOf(title);
  const main = periods.filter(p => !p.isEntry && Date.parse(p.start) >= lo && Date.parse(p.start) <= hi).map(p => ({...p, label: p.label && !GENERIC.test(p.label) ? tidyLabel(p.label, titleName) : titleName}));
  const type = classify(title, text);
  const ranks = findRanks(text);
  // 期間が1つだけのときは記事全体の期間とみなす。複数あるとき（予定表・まとめ記事）は periods を個別に使う。
  const single = main.length === 1 ? main[0] : null;
  const confidence = !main.length ? 'none' : main.some(p => p.labeled) ? 'high' : 'low';
  return {id: url.replace(/\/+$/, '').split('/').pop(), title, url, sourceId: source.id, sourceKind: source.kind, published, modified, type,
    start: single?.start || null, end: single?.end || null, periods: main.map(({isEntry, kind, ...p}) => p), ranks, confidence, audience: audienceOf(title, text),
    excluded: periods.filter(p => p.isEntry).length, fetchedAt: new Date().toISOString()};
}

// イベントの対象（内容の手がかり）。タイトルと本文の冒頭から判定する。
export function audienceOf(title, text) {
  const s = `${title}\n${String(text).slice(0, 2000)}`, out = [];
  if (/ボイス(ライバー|配信)/.test(s)) out.push('ボイス');
  if (/新規ライバー|デビュー|ルーキー/.test(title)) out.push('新規ライバー');
  if (/リスナー(限定|向け|のみ)|リスナーランキング/.test(s)) out.push('リスナー');
  if (/事務所|ギルド/.test(title)) out.push('事務所');
  if (/ファミリー/.test(title)) out.push('ファミリー');
  return out;
}

// 公式サイトの「お知らせ」一覧ページ（Next.js の埋め込みデータ）から、記事（id・タイトル・公開日・更新日・本文）を取り出す。
export function newsItems(html) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return {items: [], pages: 0};
  const pp = JSON.parse(m[1])?.props?.pageProps || {};
  const items = (pp.newsList || []).filter(n => n && n.id && n.title).map(n => ({id: n.id, title: String(n.title), published: n.publishedAt || n.createdAt || null, modified: n.revisedAt || n.updatedAt || n.publishedAt || null, body: String(n.body || '')}));
  return {items, pages: +pp.totalPageCount || 0};
}

// ---- 公式X・Instagram の告知（人が貼り付けた投稿文）----
// 各SNSは規約で許可のない自動収集が禁止のため、自動では取りに行かない。人が貼り付けた投稿文から事実（名前・期間・時間帯・対象ランク・投稿URL）だけを取り出し、
// 「共有用の1行」（投稿日｜名前｜開催期間：…｜対象：…｜URL）にする。本文は保存しない。画面の端末保存と data/sns-events.txt はこの1行の形で持つ。
const SNS_DECOR = /^(?:【[^】]{0,8}】)?\s*(?:本日|今日|今夜|明日|まもなく)?\s*(?:開催|スタート|開始|告知|お知らせ|速報|START|NEW|予告|開催決定|ついに)?[!！]*$/i;
export const SNS_SOURCE = {id: 'pococha-official-sns', kind: 'official'};
// 投稿文の相対的な日付（本日・今日・今夜・明日・明後日）を投稿日からの月/日に、「12時」「21時30分」「21時半」を「12:00」形式に、「12:00スタート」を「12:00より開始」にする。
export function snsText(text, postedISO) {
  const base = Date.parse(String(postedISO || '').slice(0, 10) + 'T00:00:00Z');
  const md = n => { if (!Number.isFinite(base)) return ''; const d = new Date(base + n * 864e5); return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日 `; };
  return toFull(String(text || ''))
    .replace(/(\d{1,2})時(?:(\d{1,2})分|(半))?/g, (m, h, mi, half) => `${h}:${half ? '30' : z(mi || 0)}`)
    .replace(/明後日/g, () => md(2)).replace(/明日/g, () => md(1)).replace(/本日|今日|今夜|今晩/g, () => md(0))
    .replace(/(\d{1,2}:\d{2})\s*(?:から|～|〜|~)?\s*(?:スタート|開始|開幕)/g, '$1より開始');
}
const fmtDay = iso => `${+iso.slice(0, 4)}年${+iso.slice(5, 7)}月${+iso.slice(8, 10)}日`;
// 対象ランクを「S1〜S6」「全ランク」のように続き番号でまとめる
export function rankText(ranks) {
  const set = new Set(ranks || []);
  if (!set.size) return '';
  if (RANKS.every(r => set.has(r))) return '全ランク';
  const runs = []; let a = null, b = null;
  RANKS.forEach((r, i) => { if (set.has(r)) { if (a === null) a = i; b = i; } if ((!set.has(r) || i === RANKS.length - 1) && a !== null) { runs.push(a === b ? RANKS[a] : `${RANKS[a]}〜${RANKS[b]}`); a = null; } });
  return runs.join('、');
}
// 投稿文 → イベント（期間ごと）。posted は投稿日（YYYY-MM-DD）。
export function snsEvent(text, {posted, url = ''} = {}) {
  // 名前：「」『』の名前 → 飾りだけの行（＼本日開催／・【告知】など）・URL・ハッシュタグを除いた最初の行
  const lines = String(text || '').split('\n').map(x => cleanLabel(x.replace(/[＼／\\/]/g, ' ').replace(/https?:\S+|#\S+/g, ' '))).filter(x => x && !SNS_DECOR.test(x));
  const quoted = String(text || '').match(/[『「]([^』」\n]{2,40})[』」]/);
  const title = (quoted ? quoted[1] : lines[0] || '').slice(0, 80);
  return eventFrom(SNS_SOURCE, url || `sns:${posted}`, {title, published: posted, modified: posted}, snsText(text, posted), {sns: true});
}
// イベント → 共有用の1行（期間ごと）。
export function snsLines(ev, {posted, url = ''} = {}) {
  const titleName = titleNameOf(ev.title) || ev.title || 'イベント';
  return (ev.periods || []).map(p => {
    const name = String(p.label || titleName).replace(/[｜|]/g, ' ').slice(0, 60);
    const period = `${fmtDay(p.start)}${p.startTime ? ' ' + p.startTime : ''}${p.end ? `〜${fmtDay(p.end)}${p.endTime ? ' ' + p.endTime : ''}` : 'より開始'}`;
    const ranks = rankText(p.ranks && p.ranks.length ? p.ranks : ev.ranks);
    return [`投稿日 ${posted}`, name, `開催期間：${period}`, ranks ? `対象：${ranks}` : '', url].filter(Boolean).join('｜');
  });
}
// 共有用の1行 → イベント（期間は1つ）。読めない行は null。
export function snsLineEvent(line) {
  const s = String(line || '').trim();
  if (!s || /^#/.test(s)) return null;
  const parts = s.split('｜').map(x => x.trim());
  const posted = (s.match(/投稿日\s*(\d{4}-\d{2}-\d{2})/) || [])[1];
  if (!posted || parts.length < 3) return null;
  const url = (s.match(/https?:\/\/[^\s｜]+/) || [''])[0];
  const name = parts[1];
  const rest = parts.slice(2).filter(x => !/^https?:\/\//.test(x)).join('\n');
  // URLの無い行は公式Xのページに印（#投稿日-名前）を付けて区別する（一覧の重複除外がURLで判定するため）
  const link = url || `https://x.com/pococha_jp#${encodeURIComponent(posted + '-' + name)}`;
  const ev = eventFrom(SNS_SOURCE, link, {title: name, published: posted, modified: posted}, `## ${name}\n${rest}`, {sns: true});
  if (!ev.periods.length) return null;
  return {...ev, id: url ? ev.id : `sns-${posted}-${name}`, url: link, line: s, periods: ev.periods.map(p => ({...p, label: name}))};
}
// その日のイベント（予想データ meter-forecast.json の days[日].events と同じ形・同じ決め方）。phase：first=初日 middle=途中 last=最終日。終了日不明は開始日だけ。
export function snsDayItems(ev, date) {
  const out = [];
  for (const p of (ev && ev.periods) || []) {
    const end = p.end || p.start;
    if (!p.start || date < p.start || date > end) continue;
    out.push({title: ev.title, label: p.label || ev.title, type: ev.type, ranks: p.ranks && p.ranks.length ? p.ranks : ev.ranks || [],
      phase: date === p.start ? 'first' : date === end ? 'last' : 'middle', ends: date === end,
      start: p.start, end: p.end || null, startTime: p.startTime || null, endTime: p.endTime || null, url: ev.url || '', sns: true});
  }
  return out;
}
