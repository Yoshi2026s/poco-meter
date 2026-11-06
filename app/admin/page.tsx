import { env } from "cloudflare:workers";
import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from "../chatgpt-auth";
import { isAnalyticsAdmin, jstDay, shiftDay, statsRange, readVisitorStats, visitorDetailFilters } from "../../lib/visitor-stats.mjs";
import "./stats.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "管理ページ | ポコメーター番長", robots: { index: false, follow: false } };
type Params = Record<string, string | string[] | undefined>;
const number = (value: number | null) => value === null ? "未計測" : value.toLocaleString("ja-JP");
const known = (value: string | null | undefined) => value || "不明";
const deviceNames: Record<string, string> = { smartphone: "スマートフォン", tablet: "タブレット", desktop: "PC", unknown: "不明" };
const countries = new Intl.DisplayNames("ja", { type: "region" });
const countryName = (country: string | null | undefined) => {
  if (!country) return "不明";
  try { return countries.of(country) || country; } catch { return country; }
};
const regionName = (row: { country: string | null; region: string | null; city: string | null }) => [row.country ? countryName(row.country) : null, row.region, row.city].filter(Boolean).join(" / ") || "不明";
const versionName = (family: string | null, version: string | null) => [family, version].filter(Boolean).join(" ") || "不明";
const visitTime = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
const decimal = (value: number | null, suffix = "") => value === null ? "未計測" : `${value.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}${suffix}`;
const ratio = (value: number | null) => value === null ? "算出不可" : decimal(value, "回");
const signed = (value: number | null, suffix = "") => value === null ? "比較不可" : `${value > 0 ? "+" : ""}${value.toLocaleString("ja-JP", { maximumFractionDigits: 1 })}${suffix}`;
const proportion = (value: number, total: number) => total > 0 ? value / total * 100 : 0;
const share = (value: number, total: number) => total > 0 ? `${proportion(value, total).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}%` : "対象なし";
const filterNames: Record<string, string> = { ip: "IP", country: "国", device: "端末", os: "OS", browser: "ブラウザ", q: "地域・機種", hour: "時間帯" };
function filterValue(key: string, value: string) {
  if (value === "unknown") return "不明";
  if (key === "country") return countryName(value);
  if (key === "device") return deviceNames[value] || value;
  if (key === "hour") return `${value}時台`;
  return value;
}
function statsHref(start: string, end: string, filters: Record<string, string> = {}, page?: number) {
  const query = new URLSearchParams({ start, end });
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  if (page !== undefined) query.set("page", String(page));
  return `?${query.toString()}`;
}
function FilterInputs({ filters }: { filters: Record<string, string> }) {
  return <>{Object.entries(filters).filter(([, value]) => value).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}</>;
}
function Share({ value, total }: { value: number; total: number }) {
  return <div className="admin-share"><span>{share(value, total)}</span><span className="admin-share-track" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, proportion(value, total)))}%` }} /></span></div>;
}
type BreakdownRow = { visitors: number; views: number };
function Breakdown({ title, rows, label, truncated = false, total }: { title: string; rows: BreakdownRow[]; label: (row: any) => string; truncated?: boolean; total: number }) {
  return <details className="admin-breakdown"><summary>{title}<span>{rows.length}分類</span></summary><div className="admin-detail-body">
    {truncated && <p className="admin-note">表示回数が多い上位25分類を表示しています。</p>}
    {!rows.length ? <p className="admin-empty">この期間の詳細データはありません。</p> : <div className="admin-table"><table><thead><tr><th scope="col">分類</th><th scope="col">延べ来訪者</th><th scope="col">表示回数</th><th scope="col">表示の割合</th></tr></thead><tbody>{rows.map((row, index) => <tr key={index}><th scope="row">{label(row)}</th><td>{number(row.visitors)}</td><td>{number(row.views)}</td><td><Share value={row.views} total={total} /></td></tr>)}</tbody></table></div>}
  </div></details>;
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  return <ProtectedStats params={params} />;
}
async function ProtectedStats({ params }: { params: Params }) {
  // Public Sites may have no complete sign-in session. Render an ordinary
  // landing page instead of sending the browser through an automatic loop.
  const user = await getChatGPTUser();
  const allowed = isAnalyticsAdmin(user, env);
  return <main className="visitor-admin">
    <header><div><p className="eyebrow">ポコメーター番長</p><h1>管理ページ</h1></div><a className="admin-button" href="/">計算機へ戻る</a></header>
    <nav className="admin-actions" aria-label="管理メニュー"><a className="admin-button" href="https://pococha-comment-library.freefreelife2000.chatgpt.site/admin/tools/meter" target="_blank" rel="noopener noreferrer">アクセス管理</a>{allowed && <a className="admin-button primary" href="/admin/messages">お問い合わせ管理</a>}</nav>
    {!user ? <section aria-labelledby="admin-login-title">
      <h2 id="admin-login-title">管理ページにログイン</h2>
      <p>サイト所有者のChatGPTアカウントでログインすると、日別来訪者統計を確認できます。</p>
      <div className="admin-actions"><a className="admin-button primary" href={chatGPTSignInPath("/admin")} target="_top">ChatGPTでログイン</a><a className="admin-button" href="/admin" target="_top">ログイン後に再読み込み</a></div>
      <p className="admin-note">Sitesのプレビュー内で開いている場合は、<a href="https://poco-meter.freefreelife2000.chatgpt.site/admin" target="_blank" rel="noopener noreferrer">管理ページを別タブで開く</a>からログインしてください。</p>
    </section> : !allowed ? <section role="alert"><h2>管理者専用ページです</h2><p>現在のアカウントには管理ページの閲覧権限がありません。このサイトの所有者のChatGPTアカウントに切り替えてください。</p><a className="admin-button" href={chatGPTSignOutPath("/admin")} target="_top">ログアウトして切り替える</a></section> : <Stats params={params} />}
  </main>;
}
async function Stats({ params }: { params: Params }) {
  const today = jstDay();
  let range, data, error = "", page = 1, filters: Record<string, string> = {};
  try {
    if ((params.start !== undefined && typeof params.start !== "string") || (params.end !== undefined && typeof params.end !== "string")) throw new RangeError("日付を1つずつ指定してください。");
    if (params.page !== undefined) {
      if (typeof params.page !== "string" || !/^[1-9]\d*$/.test(params.page) || !Number.isSafeInteger(Number(params.page)) || Number(params.page) > 100000) throw new RangeError("ページ番号は1〜100000の整数を1つ指定してください。");
      page = Number(params.page);
    }
    range = statsRange(params.start, params.end);
    filters = visitorDetailFilters({ ip: params.ip, country: params.country, device: params.device, os: params.os, browser: params.browser, q: params.q, hour: params.hour });
    data = await readVisitorStats(env, range, { page, filters });
  } catch (cause) {
    error = cause instanceof RangeError ? cause.message : "統計を読み込めませんでした。時間をおいて再読み込みしてください。";
    if (!(cause instanceof RangeError)) console.error("Visitor statistics unavailable");
  }
  const hasDetailsMeasured = !!data?.details.firstDay && data.end >= data.details.firstDay;
  return <>
    <section><div className="admin-section-title"><h2>日別来訪者統計</h2><span className="admin-badge">日本時間</span></div>
      <p className="admin-note">計算機をオンラインで開いたブラウザを集計します。同じブラウザは1日1来訪者。再読み込みは表示回数に加算します。</p>
      <nav className="admin-presets" aria-label="集計期間">{[7, 30, 90].map(days => <a key={days} className="admin-button" href={statsHref(shiftDay(today, 1 - days), today, filters)}>直近{days}日</a>)}</nav>
      <form className="admin-filter" action="/admin" method="get"><FilterInputs filters={filters} /><label>開始日<input type="date" name="start" defaultValue={range?.start || shiftDay(today, -29)} max={today} required /></label><label>終了日<input type="date" name="end" defaultValue={range?.end || today} max={today} required /></label><button className="admin-button primary" type="submit">表示・更新</button></form>
      {error && <p className="admin-error" role="alert">{error}</p>}
    </section>
    {data && <>
      {data.report.partialToday && <p className="admin-pending" role="note">本日分は集計中です。期間合計・平均には現時点の本日分が含まれ、今後のアクセスで変わります。</p>}
      {data.report.partialFirstDay && <p className="admin-pending" role="note">記録開始日は途中からの計測の可能性があるため、前日差・期間比較・曜日平均から除外します。期間合計・平均には実際の記録分を含みます。</p>}
      <div className="admin-cards">{[["今日の来訪者", data.todayStats.visitors], ["昨日の来訪者", data.yesterdayStats.visitors], ["期間の延べ来訪者", data.rows.some((row: { visitors: number | null }) => row.visitors !== null) ? data.totals.visitors : null], ["期間の表示回数", data.rows.some((row: { visitors: number | null }) => row.visitors !== null) ? data.totals.views : null], ["詳細検索の表示回数", data.details.firstDay && data.end >= data.details.firstDay ? data.details.measuredViews : null], ["詳細検索の異なるIP数", data.details.firstDay && data.end >= data.details.firstDay ? data.details.uniqueIPs : null]].map(([label, value]) => <section key={String(label)}><h3>{label}</h3><strong>{number(value as number | null)}</strong></section>)}</div>
      <section><details className="admin-breakdown admin-report"><summary>期間の傾向・前期間との比較<span>{data.report.measuredDays}/{data.report.requestedDays}日計測</span></summary><div className="admin-detail-body">
        <p className="admin-note">全体の来訪データです。下の詳細検索による絞り込みは反映しません。平均は計測済みの日数で計算し、期間に本日が含まれる場合は集計途中の本日分も含みます。</p>
        <div className="admin-report-cards">{[["1日平均の来訪者", decimal(data.report.averageVisitors)], ["1日平均の表示回数", decimal(data.report.averageViews)], ["1来訪者あたりの表示", ratio(data.report.viewsPerVisitor)], ["同じ日の2回目以降の表示", number(data.report.repeatViews)]].map(([label, value]) => <div key={label}><h3>{label}</h3><strong>{value}</strong></div>)}</div>
        <p className="admin-note">2回目以降の表示は「表示回数 − 日別来訪者数」の合計で、再訪した人数ではありません。</p>
        <div className="admin-peak"><h3>来訪者が最も多い日</h3>{data.report.peakDay ? <p><time dateTime={data.report.peakDay.day}>{data.report.peakDay.day.replaceAll("-", "/")}</time> ／ {number(data.report.peakDay.visitors)}来訪者・{number(data.report.peakDay.views)}回表示{data.report.peakDay.day === today && <span className="admin-badge">（集計中）</span>}</p> : <p>未計測</p>}</div>
        <h3>同じ長さの前期間と比較</h3><p className="admin-note">前期間：{data.report.comparison.start} 〜 {data.report.comparison.end} ／ {data.report.comparison.measuredDays}/{data.report.requestedDays}日計測</p>
        {!data.report.comparison.complete ? <p className="admin-empty">比較不可（期間未計測・記録開始日・本日集計中）。比較する両期間が記録開始日の翌日以降で、本日を含まない場合に比較できます。</p> : <div className="admin-table"><table><thead><tr><th scope="col">項目</th><th scope="col">前期間</th><th scope="col">増減</th><th scope="col">増減率</th></tr></thead><tbody><tr><th scope="row">延べ来訪者</th><td>{number(data.report.comparison.visitors)}</td><td>{signed(data.report.comparison.visitorsDelta)}</td><td>{signed(data.report.comparison.visitorsPercent, "%")}</td></tr><tr><th scope="row">表示回数</th><td>{number(data.report.comparison.views)}</td><td>{signed(data.report.comparison.viewsDelta)}</td><td>{signed(data.report.comparison.viewsPercent, "%")}</td></tr></tbody></table><p className="admin-note">前期間が0の場合、増減率は計算できません。</p></div>}
        <details className="admin-breakdown"><summary>曜日ごとの平均<span>開始日・本日を除く</span></summary><div className="admin-detail-body"><p className="admin-note">日付が過ぎた計測日を同じ曜日で比較します。記録開始日と、集計中の本日を除きます。</p><div className="admin-table"><table><thead><tr><th scope="col">曜日</th><th scope="col">計測日数</th><th scope="col">平均来訪者</th><th scope="col">平均表示</th></tr></thead><tbody>{data.report.weekdays.map((row: { weekday: number; days: number; averageVisitors: number | null; averageViews: number | null }) => <tr key={row.weekday}><th scope="row">{weekdays[row.weekday]}曜日</th><td>{row.days}日</td><td>{decimal(row.averageVisitors)}</td><td>{decimal(row.averageViews)}</td></tr>)}</tbody></table></div></div></details>
      </div></details></section>
      <section><h2>日別一覧</h2><p className="admin-note">{data.start} 〜 {data.end} ／ 新しい日付順</p>
        {!data.firstDay && <p className="admin-empty">まだ来訪記録がありません。公開後、計算機を開くと記録が始まります。</p>}
        <p className="admin-note">日付を押すと、その日の地域・端末・アクセス詳細に絞れます。</p>
        <div className="admin-table admin-daily-table"><table><thead><tr><th scope="col">日付</th><th scope="col">来訪者</th><th scope="col">表示回数</th></tr></thead><tbody>{data.rows.map((row: { day: string; visitors: number | null; views: number | null }) => <tr key={row.day}><th scope="row"><a href={`${statsHref(row.day, row.day, filters)}#visitor-detail-section`}><time dateTime={row.day}>{row.day.replaceAll("-", "/")}</time><small>{weekdays[new Date(row.day + "T00:00:00Z").getUTCDay()]}</small></a>{row.day === today && <small className="admin-day-pending">集計中</small>}</th><td>{number(row.visitors)}</td><td>{number(row.views)}</td></tr>)}</tbody></table></div>
        <details className="admin-breakdown"><summary>日別の前日差・表示の詳しい内訳</summary><div className="admin-detail-body"><p className="admin-note">前日が未計測の日と、記録開始日を含む前日差は比較不可です。本日分は集計中のため前日差を表示しません。詳細検索の影響を受けない全体データです。</p><div className="admin-table"><table><thead><tr><th scope="col">日付</th><th scope="col">来訪者の前日差</th><th scope="col">来訪者の増減率</th><th scope="col">表示の前日差</th><th scope="col">1来訪者あたり</th><th scope="col">2回目以降の表示</th></tr></thead><tbody>{data.report.daily.map((row: { day: string; deltaVisitors: number | null; deltaViews: number | null; visitorsPercent: number | null; viewsPerVisitor: number | null; repeatViews: number | null }) => <tr key={row.day}><th scope="row">{row.day.replaceAll("-", "/")}</th><td>{row.day === today ? "集計中" : signed(row.deltaVisitors)}</td><td>{row.day === today ? "集計中" : signed(row.visitorsPercent, "%")}</td><td>{row.day === today ? "集計中" : signed(row.deltaViews)}</td><td>{ratio(row.viewsPerVisitor)}</td><td>{number(row.repeatViews)}</td></tr>)}</tbody></table></div></div></details>
      </section>
      <section id="visitor-detail-section"><div className="admin-section-title"><h2>アクセス詳細の検索</h2><span className="admin-badge">下の詳細集計だけに反映</span></div>
        <p className="admin-note">全体の来訪者・表示回数、期間の傾向、日別一覧は変わりません。詳細の分類・IP一覧・個別アクセスを絞り込みます。</p>
        <div className="admin-active-filters"><strong>検索条件</strong>{Object.entries(filters).some(([, value]) => value) ? <><ul>{Object.entries(filters).filter(([, value]) => value).map(([key, value]) => <li key={key}>{filterNames[key]}：{filterValue(key, value)}</li>)}</ul><a className="admin-button" href={`${statsHref(data.start, data.end)}#visitor-detail-section`}>詳細検索を解除</a></> : <p>指定なし</p>}</div>
        <details className="admin-breakdown"><summary>検索条件を設定</summary><div className="admin-detail-body"><form className="admin-detail-filter" action="/admin#visitor-detail-section" method="get"><input type="hidden" name="start" value={data.start} /><input type="hidden" name="end" value={data.end} />
          <label>IPアドレス（完全一致）<input name="ip" defaultValue={filters.ip || ""} placeholder="例：192.0.2.1" maxLength={45} autoComplete="off" /></label>
          <label>国コード<input name="country" defaultValue={filters.country || ""} placeholder="JP・US・unknown（不明）" maxLength={7} list="admin-country-codes" /><datalist id="admin-country-codes"><option value="JP">日本</option><option value="US">アメリカ合衆国</option><option value="unknown">不明</option></datalist></label>
          <label>端末種別<select name="device" defaultValue={filters.device || ""}><option value="">すべて</option>{Object.entries(deviceNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>OS<select name="os" defaultValue={filters.os || ""}><option value="">すべて</option>{["iOS", "iPadOS / iOS", "Android", "Windows", "macOS", "Chrome OS", "Linux"].map(value => <option key={value} value={value}>{value}</option>)}<option value="unknown">不明</option></select></label>
          <label>ブラウザ<select name="browser" defaultValue={filters.browser || ""}><option value="">すべて</option>{["Safari", "Chrome", "Edge", "Firefox", "Samsung Internet", "Opera"].map(value => <option key={value} value={value}>{value}</option>)}<option value="unknown">不明</option></select></label>
          <label>時間帯（日本時間）<select name="hour" defaultValue={filters.hour || ""}><option value="">すべて</option>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={String(hour)}>{String(hour).padStart(2, "0")}時台</option>)}</select></label>
          <label className="admin-filter-wide">地域・都市・機種名<input name="q" defaultValue={filters.q || ""} placeholder="例：Tokyo・iPhone" maxLength={80} /></label>
          <button type="submit" className="admin-button primary admin-filter-wide">詳細を検索</button>
        </form></div></details>
        <p className="admin-filter-result">{hasDetailsMeasured ? <>詳細の表示回数：{number(data.details.measuredViews)}回 ／ 異なるIP：{number(data.details.uniqueIPs)}件</> : "この期間のアクセス詳細は未計測です。"}</p>
      </section>
      <section><div className="admin-section-title"><h2>地域・端末別の集計</h2><span className="admin-badge">項目を押して開閉</span></div>
        <p className="admin-note">詳細計測開始：{data.details.firstDay || "来訪待ち"}。更新前のIP・地域・端末情報は未計測です。分類別の来訪者は日別の延べ数で、同じブラウザが複数分類に含まれる場合があります。</p>
        <p className="admin-note">表示の割合は、現在の詳細検索に一致した表示回数を100%として計算します。</p>
        <Breakdown title="国別" rows={data.details.countries} label={row => countryName(row.country)} truncated={data.details.truncated?.countries} total={data.details.measuredViews} />
        <Breakdown title="地域・都市別" rows={data.details.regions} label={regionName} truncated={data.details.truncated?.regions} total={data.details.measuredViews} />
        <Breakdown title="端末種別・機種" rows={data.details.devices} label={row => `${deviceNames[row.deviceType] || "不明"} / ${known(row.deviceModel)}`} truncated={data.details.truncated?.devices} total={data.details.measuredViews} />
        <Breakdown title="OS・バージョン" rows={data.details.systems} label={row => versionName(row.osFamily, row.osVersion)} truncated={data.details.truncated?.systems} total={data.details.measuredViews} />
        <Breakdown title="ブラウザ・バージョン" rows={data.details.browsers} label={row => versionName(row.browserFamily, row.browserVersion)} truncated={data.details.truncated?.browsers} total={data.details.measuredViews} />
        <Breakdown title="端末とブラウザの組み合わせ" rows={data.details.deviceBrowsers} label={row => `${deviceNames[row.deviceType] || "不明"} / ${known(row.browserFamily)}`} truncated={data.details.truncated?.deviceBrowsers} total={data.details.measuredViews} />
        <Breakdown title="時間帯別（日本時間）" rows={hasDetailsMeasured ? data.details.hours : []} label={row => `${String(row.hour).padStart(2, "0")}時台`} total={data.details.measuredViews} />
        <Breakdown title="曜日別の表示" rows={hasDetailsMeasured ? data.details.weekdays : []} label={row => `${weekdays[row.weekday]}曜日`} total={data.details.measuredViews} />
        <Breakdown title="詳細検索に一致した日別一覧" rows={data.details.daily} label={row => row.day.replaceAll("-", "/")} total={data.details.measuredViews} />
        <details className="admin-breakdown"><summary>IPごとの集計<span>{data.details.ips.length}件</span></summary><div className="admin-detail-body"><p className="admin-note">IPを押すと完全一致で検索します。初回・最終は現在の期間と検索条件に一致したアクセス時刻です。</p>{data.details.truncated?.ips && <p className="admin-note">表示回数が多い上位25件を表示しています。</p>}{!data.details.ips.length ? <p className="admin-empty">この期間の詳細データはありません。</p> : <div className="admin-table"><table><thead><tr><th scope="col">IPアドレス・時刻</th><th scope="col">延べ来訪者</th><th scope="col">表示回数</th><th scope="col">表示の割合</th></tr></thead><tbody>{data.details.ips.map((row: { ipAddress: string | null; visitors: number; views: number; firstSeen: string; lastSeen: string }, index: number) => <tr key={row.ipAddress || `unknown-${index}`}><th scope="row">{row.ipAddress ? <a href={`${statsHref(data.start, data.end, { ...filters, ip: row.ipAddress })}#visitor-detail-section`}>{row.ipAddress}</a> : "不明"}<small className="admin-ip-time">初回：{visitTime.format(new Date(row.firstSeen))}</small><small className="admin-ip-time">最終：{visitTime.format(new Date(row.lastSeen))}</small></th><td>{number(row.visitors)}</td><td>{number(row.views)}</td><td><Share value={row.views} total={data.details.measuredViews} /></td></tr>)}</tbody></table></div>}</div></details>
        <details className="admin-breakdown"><summary>取得できた情報の割合</summary><div className="admin-detail-body"><p className="admin-note">詳細検索に一致した表示回数のうち、各情報を取得できた回数です。「機種名称あり」にはiPhoneなどの名称も含み、正確な世代・型番の取得率ではありません。更新前の詳細未計測記録は含みません。</p>{!hasDetailsMeasured ? <p className="admin-empty">この期間のアクセス詳細は未計測です。</p> : <div className="admin-table"><table><thead><tr><th scope="col">情報</th><th scope="col">取得あり</th><th scope="col">不明</th><th scope="col">取得の割合</th></tr></thead><tbody>{data.details.quality.map((row: { key: string; known: number; unknown: number }) => <tr key={row.key}><th scope="row">{({ ip: "IPアドレス", country: "国", region: "地域・都市", device: "端末種別", model: "機種名称あり", os: "OS", browser: "ブラウザ" } as Record<string, string>)[row.key] || row.key}</th><td>{number(row.known)}</td><td>{number(row.unknown)}</td><td><Share value={row.known} total={row.known + row.unknown} /></td></tr>)}</tbody></table></div>}</div></details>
      </section>
      <section id="access-details"><h2>アクセスごとの詳細</h2><p className="admin-note">新しいアクセス順。1ページ50件。OS・ブラウザ・機種はブラウザの申告に基づきます。取得できない情報は「不明」と表示します。</p>
        <details className="admin-breakdown admin-visit-details" open={params.page !== undefined}><summary>IP・地域・端末情報を見る<span>{data.details.pagination.total.toLocaleString("ja-JP")}件</span></summary><div className="admin-detail-body">
          {!data.details.events.length ? <p className="admin-empty">この期間の詳細データはありません。詳細計測前の情報は復元できません。</p> : <ol className="admin-events" start={(data.details.pagination.page - 1) * data.details.pagination.pageSize + 1}>{data.details.events.map((event: { occurredAt: string; ipAddress: string | null; country: string | null; region: string | null; city: string | null; deviceType: string; deviceModel: string | null; osFamily: string | null; osVersion: string | null; browserFamily: string | null; browserVersion: string | null }, index: number) => <li key={`${event.occurredAt}-${index}`}><time dateTime={event.occurredAt}>{visitTime.format(new Date(event.occurredAt))}</time><dl><div><dt>IPアドレス</dt><dd className="admin-ip">{known(event.ipAddress)}</dd></div><div><dt>地域</dt><dd>{regionName(event)}</dd></div><div><dt>端末</dt><dd>{deviceNames[event.deviceType] || "不明"} / {known(event.deviceModel)}</dd></div><div><dt>OS</dt><dd>{versionName(event.osFamily, event.osVersion)}</dd></div><div><dt>ブラウザ</dt><dd>{versionName(event.browserFamily, event.browserVersion)}</dd></div></dl></li>)}</ol>}
        </div></details>
        <nav className="admin-pagination" aria-label="アクセス詳細のページ">{data.details.pagination.page > 1 && <a className="admin-button" href={`${statsHref(data.start, data.end, filters, data.details.pagination.page - 1)}#access-details`}>前の50件</a>}<span>{data.details.pagination.page} / {Math.max(1, data.details.pagination.pages)}ページ</span>{data.details.pagination.page < data.details.pagination.pages && <a className="admin-button" href={`${statsHref(data.start, data.end, filters, data.details.pagination.page + 1)}#access-details`}>次の50件</a>}</nav>
      </section>
      <section className="admin-note"><h2>集計について</h2><p>記録開始：{data.firstDay || "来訪待ち"}。開始前の履歴は復元できません。期間の延べ来訪者は日別来訪者の合計で、期間全体の実人数ではありません。</p><p>端末・ブラウザの変更やCookie削除は別の来訪者として数えます。Cookieを利用できない場合は重複することがあります。オフライン中・通信失敗・JavaScript無効時などの利用は計測できません。</p><p>地域はIPアドレスから推定したおおよその場所です。GPSは使用しません。VPNや回線によって実際の場所と異なる場合があります。同じIPを複数人で使うこともあるため、IP数は人数ではありません。</p><p>OS・ブラウザ・端末機種はブラウザが通知した範囲で表示します。実際の種類・バージョンと異なる場合があります。iPhoneの正確な世代・型番は識別できず、機種が「不明」になる場合があります。</p><p>更新後のアクセスではIPアドレス・おおよその地域・端末・OS・ブラウザ情報を記録し、この管理ページでサイト所有者だけに表示します。メーター入力値・お問い合わせ内容は統計に保存しません。</p></section>
    </>}
  </>;
}
