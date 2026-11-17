// Pocochaイベントカレンダー（メーター画面の「過去のボーダー表」リンクの下）。
// 公開時に作る data/event-days.json（automation/build-meter-factors.mjs の calendarEventDays）から、月の各日に
// 開催中と最終日（イベラス）のイベントを並べる。npm run pages:prepare で calculator/index.html の目印の間に書き写す。
// import/export 以外の書き方は index.html の中でもそのまま動くようにする（外部の部品を使わない）。
export const EVENT_CALENDAR_SCHEMA = 'poco-meter-event-days-v1';
export const EVENT_CALENDAR_RANKS = ['S6', 'S5', 'S4', 'S3', 'S2', 'S1', 'A3', 'A2', 'A1', 'B3', 'B2', 'B1', 'C3', 'C2', 'C1', 'D3', 'D2', 'D1'];
export const EVENT_TYPE_LABELS = {big: '大型イベント', event: 'イベント', collab: 'コラボ・出演権', newcomer: '新規ライバー向け', mission: 'ミッション', item: 'アイテム', notice: 'お知らせ'};
const EVENT_TYPE_ORDER = {big: 0, event: 1, collab: 2, newcomer: 3, mission: 4, item: 5, notice: 6};
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const validDate = v => typeof v === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;

// 月の範囲（前後の月にずらす）と、日曜始まりの7列のマス（前後の空きは null）
export function eventMonthRange(month, delta = 0) {
  if (typeof month !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month) || !Number.isInteger(delta) || Math.abs(delta) > 1200) return null;
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + delta, 1));
  const start = d.toISOString().slice(0, 10); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0);
  const end = d.toISOString().slice(0, 10);
  return validDate(start) && validDate(end) ? {month: start.slice(0, 7), start, end} : null;
}
export function eventMonthCells(month) {
  const range = eventMonthRange(month); if (!range) return null;
  const cells = Array(new Date(range.start + 'T00:00:00Z').getUTCDay()).fill(null);
  for (let day = 1; day <= Number(range.end.slice(8)); day++) cells.push(range.month + '-' + String(day).padStart(2, '0'));
  while (cells.length % 7) cells.push(null);
  return {...range, cells};
}
// リンクは Pococha公式・掲載元の第三者カレンダー（yotei.ember-w.com）・照合記録（このリポジトリ）だけ出す
export const isOfficialURL = v => { try { const h = new URL(v).hostname; return h === 'pococha.com' || h.endsWith('.pococha.com'); } catch { return false; } };
export function eventCalendarURL(v) {
  if (typeof v !== 'string') return '';
  try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password && (isOfficialURL(v) || u.hostname === 'yotei.ember-w.com' || u.hostname === 'github.com' && u.pathname.startsWith('/Yoshi2026s/poco-meter/')) ? u.href : ''; } catch { return ''; }
}
export function eventCalendarName(x) {
  const clean = s => String(s || '').replace(/\p{Extended_Pictographic}|️|‍/gu, '').replace(/[＼／]/g, ' ').replace(/\s+/g, ' ').trim();
  const t = clean(x && x.title), l = clean(String((x && x.label) || '').replace(/\s*(開催期間|イベント期間|開催日程|開催日時|キャンペーン期間)$/, ''));
  if (!l || l.length < 2) return t.slice(0, 60);
  // 「決勝」「第2弾」など段階名だけのときは、記事タイトルの『』内（無ければ先頭20字）を前に付ける
  if (/^(予選|準決勝|決勝|本戦|本選|準々決勝|第\d+(弾|回|ステージ|日程)|ステージ\d*|リーグ|前半|後半|DAY\d+)/.test(l) && l.length <= 12) {
    const q = t.match(/[『「]([^』」]{2,30})[』」]/);
    return (q ? q[1] : t.replace(/【[^】]*】/g, '').trim().slice(0, 20)) + ' ' + l;
  }
  return l.slice(0, 60);
}
// イベントの並び順：date（表示する日）から最終日（イベラス）までが近いもの → 開催期間が短いもの、の順に上へ。
// 期間・残りは分で比べる（時刻が無ければ開始 0:00・終了 24:00 とみなす）。日付が読めないものは後ろに回す。
export function eventSoonOrder(date) {
  const day = v => validDate(v) ? Date.parse(v + 'T00:00:00Z') / 864e5 : NaN;
  const min = (v, d) => { const m = typeof v === 'string' && v.match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : d; };
  const key = x => {
    const s = day(x && x.start), e = validDate(x && x.end) ? day(x.end) : s, end = min(x && x.endTime, 1440);
    const len = (e - s) * 1440 + end - min(x && x.startTime, 0), left = (e - day(date)) * 1440 + end;
    return [Number.isFinite(len) ? len : Infinity, Number.isFinite(left) ? left : Infinity];
  };
  const cmp = (p, q) => p === q ? 0 : p < q ? -1 : 1;
  return (a, b) => { const ka = key(a), kb = key(b); return cmp(ka[1], kb[1]) || cmp(ka[0], kb[0]); };
}
export function validEventDays(d) { return isObj(d) && d.schema === EVENT_CALENDAR_SCHEMA && Array.isArray(d.list) && d.list.length <= 50000 && isObj(d.days); }
// rank を指定すると、そのランクが対象のものと対象ランク不明のものだけを残す（対象のものには target を付ける）。
export function eventCalendarMonth(data, month, rank = '') {
  const calendar = eventMonthCells(month);
  if (!calendar || !validEventDays(data) || rank && !EVENT_CALENDAR_RANKS.includes(rank)) return null;
  const time = v => typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v) ? v : '';
  const pick = (i, last, candidate = false) => {
    const x = Number.isInteger(i) ? data.list[i] : null;
    if (!isObj(x) || typeof x.title !== 'string') return null;
    const ranks = Array.isArray(x.ranks) ? EVENT_CALENDAR_RANKS.filter(r => x.ranks.includes(r)) : []; // 上位ランクから順に
    if (rank && ranks.length && !ranks.includes(rank)) return null;
    const start = validDate(x.start) ? x.start : '', end = validDate(x.end) ? x.end : start;
    return {name: eventCalendarName(x), type: Object.prototype.hasOwnProperty.call(EVENT_TYPE_LABELS, x.type) ? x.type : '', last, candidate, ranks, rankRange: candidate && typeof x.rankRange === 'string' ? x.rankRange : '', target: !!rank && ranks.includes(rank),
      start, end, startTime: time(x.startTime), endTime: time(x.endTime), url: eventCalendarURL(x.url)};
  };
  // 最終日 → 開催中に分け、その中はイベラスが近く期間が短い順（同じなら種類・対象ランク）。公式未確認の候補（c）も正式イベントと同じに並べる
  const order = date => { const soon = eventSoonOrder(date); return (a, b) => (a.last === b.last ? 0 : a.last ? -1 : 1) || soon(a, b) || (EVENT_TYPE_ORDER[a.type] ?? 9) - (EVENT_TYPE_ORDER[b.type] ?? 9) || (b.target ? 1 : 0) - (a.target ? 1 : 0); };
  let count = 0;
  const cells = calendar.cells.map(date => {
    if (!date) return null;
    const day = isObj(data.days[date]) ? data.days[date] : {}, ids = k => Array.isArray(day[k]) ? day[k] : [], seen = new Set();
    const items = [...ids('l').map(i => pick(i, true)), ...ids('e').map(i => pick(i, false)), ...ids('c').map(i => { const x = pick(i, false, true); if (x) x.last = (x.end || x.start) === date; return x; })] // 候補もその日が最終日ならイベラス
      .filter(x => x && !seen.has(x.name + '|' + x.start) && seen.add(x.name + '|' + x.start)).sort(order(date));
    count += items.length;
    return {date, items, big: items.some(x => x.type === 'big'), lasts: items.filter(x => x.last).length};
  });
  const from = validDate(data.from) ? data.from : '', to = validDate(data.to) ? data.to : '';
  return {...calendar, rank, cells, count, from, to, covered: !!from && !!to && calendar.end >= from && calendar.start <= to};
}
// 期間の表示。表示中の日と年が違う日付だけ年を付ける（例：11/11〜2027/02/22）
export function eventSpan(x, ref = '') {
  const md = d => (d.slice(0, 4) !== String(ref).slice(0, 4) ? d.slice(0, 4) + '/' : '') + d.slice(5).replace('-', '/');
  const s = x.start ? md(x.start) : '', e = x.end && x.end !== x.start ? md(x.end) : '';
  return s + (x.startTime ? ' ' + x.startTime : '') + (e || x.endTime ? '〜' + (e ? e + ' ' : '') + (x.endTime || '') : '');
}

// 画面：box（中身を描き直す要素）に月の表を出す。load は data/event-days.json を返す Promise。開いたときに open() を呼ぶ。
export function createEventCalendar(box, {load, today = () => new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10)} = {}) {
  const doc = box.ownerDocument || document;
  let data = null, loading = false, error = '', month = '', rank = '', selected = '';
  const el = (tag, text, cls) => { const n = doc.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  const find = id => (box.querySelector ? box.querySelector('#' + id) : null);
  async function open() {
    render();
    if (data || loading || typeof load !== 'function') return;
    loading = true; error = ''; render();
    try { const d = await load(); if (!validEventDays(d)) throw new Error('形式が違います'); data = d; }
    catch { error = 'イベント情報を読み込めませんでした。通信できる状態で開き直してください。'; }
    finally { loading = false; render(); }
  }
  function render() {
    box.replaceChildren();
    if (loading) { box.appendChild(el('p', 'イベント情報を読み込んでいます…', 'evc-note')); return; }
    if (!data) {
      box.appendChild(el('p', error || '開くとイベント情報を読み込みます。', 'evc-note'));
      if (error) { const retry = el('button', 'もう一度読み込む', 'evc-btn'); retry.type = 'button'; retry.id = 'evcRetry'; retry.addEventListener('click', open); box.appendChild(retry); }
      return;
    }
    const now = today(); if (!month) month = now.slice(0, 7);
    const model = eventCalendarMonth(data, month, rank);
    if (!model) { box.appendChild(el('p', '月・ランクを確認してください。', 'evc-note')); return; }
    const nav = el('div', undefined, 'evc-nav'), prev = el('button', '‹ 前月', 'evc-btn'), next = el('button', '翌月 ›', 'evc-btn'), label = el('strong', Number(model.month.slice(0, 4)) + '年' + Number(model.month.slice(5, 7)) + '月');
    prev.type = next.type = 'button'; prev.id = 'evcPrev'; next.id = 'evcNext'; label.id = 'evcLabel';
    prev.setAttribute('aria-label', 'イベントカレンダーの前の月'); next.setAttribute('aria-label', 'イベントカレンダーの次の月');
    prev.disabled = !eventMonthRange(model.month, -1) || !!model.from && model.month <= model.from.slice(0, 7);
    next.disabled = !eventMonthRange(model.month, 1) || !!model.to && model.month >= model.to.slice(0, 7);
    for (const [b, d] of [[prev, -1], [next, 1]]) b.addEventListener('click', () => { const r = eventMonthRange(model.month, d); if (!r) return; month = r.month; selected = ''; render(); find(d < 0 ? 'evcPrev' : 'evcNext')?.focus?.({preventScroll: true}); });
    nav.appendChild(prev); nav.appendChild(label); nav.appendChild(next); box.appendChild(nav);
    const rankRow = el('div', undefined, 'evc-rank'), rankLabel = el('label', '対象ランク'), rankSelect = el('select');
    rankSelect.id = 'evcRank'; rankLabel.htmlFor = 'evcRank';
    for (const r of ['', ...EVENT_CALENDAR_RANKS]) { const o = el('option', r || 'すべて表示'); o.value = r; rankSelect.appendChild(o); }
    rankSelect.value = rank;
    rankSelect.addEventListener('change', () => { rank = rankSelect.value; render(); find('evcRank')?.focus?.({preventScroll: true}); });
    rankRow.appendChild(rankLabel); rankRow.appendChild(rankSelect); box.appendChild(rankRow);
    const legend = el('p', undefined, 'evc-legend'); legend.appendChild(el('span', '件数＝その日のイベント')); legend.appendChild(el('span', '大型', 'evc-tag big')); legend.appendChild(el('span', 'ラス＝最終日', 'evc-tag last')); box.appendChild(legend);
    const week = el('div', undefined, 'evc-week'); week.setAttribute('aria-hidden', 'true');
    for (const w of ['日', '月', '火', '水', '木', '金', '土']) week.appendChild(el('span', w));
    box.appendChild(week);
    const days = model.cells.filter(c => c && c.items.length).map(c => c.date);
    if (!days.includes(selected)) selected = days.includes(now) ? now : '';
    const grid = el('div', undefined, 'evc-grid');
    for (const cell of model.cells) {
      if (!cell) { const blank = el('span', undefined, 'evc-blank'); blank.setAttribute('aria-hidden', 'true'); grid.appendChild(blank); continue; }
      const b = el('button', undefined, 'evc-day' + (cell.date === now ? ' today' : '')); b.type = 'button'; b.setAttribute('data-event-day', cell.date);
      b.appendChild(el('span', String(Number(cell.date.slice(8))), 'evc-num'));
      if (cell.items.length) b.appendChild(el('span', cell.items.length + '件', 'evc-count'));
      if (cell.big) b.appendChild(el('span', '大型', 'evc-tag big'));
      if (cell.lasts) b.appendChild(el('span', 'ラス' + (cell.lasts > 1 ? cell.lasts : ''), 'evc-tag last'));
      b.disabled = !cell.items.length; b.setAttribute('aria-pressed', String(cell.date === selected));
      b.setAttribute('aria-label', cell.date + ' ' + (cell.items.length ? cell.items.map(x => (x.last ? '最終日 ' : '') + x.name).join('、') : 'イベント情報なし'));
      b.addEventListener('click', () => { selected = cell.date; render(); find('evcDetail')?.scrollIntoView?.({block: 'nearest', behavior: 'auto'}); box.querySelector?.('[data-event-day="' + cell.date + '"]')?.focus?.({preventScroll: true}); });
      grid.appendChild(b);
    }
    box.appendChild(grid);
    const detail = el('div', undefined, 'evc-detail'); detail.id = 'evcDetail'; detail.setAttribute('aria-live', 'polite');
    const cell = model.cells.find(c => c && c.date === selected);
    if (cell) {
      detail.appendChild(el('h4', cell.date.replaceAll('-', '/') + 'のイベント（' + cell.items.length + '件）'));
      const list = el('ul', undefined, 'evc-list');
      for (const x of cell.items) {
        const li = el('li', undefined, 'evc-item' + (x.last ? ' last' : '') + (x.type === 'big' ? ' big' : '')), head = el('div', undefined, 'evc-head');
        if (x.last) head.appendChild(el('span', '最終日', 'evc-tag last'));
        if (x.type === 'big') head.appendChild(el('span', '大型', 'evc-tag big'));
        head.appendChild(el('strong', x.name)); li.appendChild(head);
        const ranks = x.rankRange ? '掲載ランク ' + x.rankRange : x.ranks.length ? '対象 ' + (x.ranks.length > 6 ? x.ranks[0] + '〜' + x.ranks[x.ranks.length - 1] : x.ranks.join('・')) : '対象ランクの記載なし';
        const span = eventSpan(x, cell.date);
        li.appendChild(el('p', [EVENT_TYPE_LABELS[x.type] || '', span ? '期間 ' + span : '', ranks].filter(Boolean).join(' ／ '), 'evc-meta'));
        if (x.url) { const a = el('a', isOfficialURL(x.url) ? '公式の告知を開く ↗' : '掲載元を開く ↗', 'evc-link'); a.href = x.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; li.appendChild(a); }
        list.appendChild(li);
      }
      detail.appendChild(list);
    } else {
      detail.appendChild(el('p', model.covered ? (model.count ? '日付を押すと、その日のイベントを表示します。' : 'この月は表示できるイベント情報がありません。')
        : 'この月はイベント情報の範囲外です（' + model.from.replaceAll('-', '/') + '〜' + model.to.replaceAll('-', '/') + '）。', 'evc-note'));
    }
    box.appendChild(detail);
    box.appendChild(el('p', '公式の告知や第三者のイベントカレンダーなどで期間を確認できたイベントを表示します（1日につき開催中は最大8件＋最終日のもの）。内容・条件はアプリ内の告知で確認してください。', 'evc-note'));
  }
  return {open, render};
}
