import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';

const site = 'https://poco-meter.goatcounter.com';
const hour = 3_600_000;
const day = 24 * hour;
const port = 8791;
const host = `127.0.0.1:${port}`;
const number = new Intl.NumberFormat('ja-JP');
class DashboardError extends Error {}

export async function readToday(token, now = Date.now(), request = fetch) {
  const midnight = Math.floor((now + 9 * hour) / day) * day - 9 * hour;
  const url = new URL('/api/v0/stats/hits', site);
  url.searchParams.set('start', new Date(midnight).toISOString());
  url.searchParams.set('end', new Date(Math.floor(now / hour) * hour).toISOString());
  url.searchParams.set('limit', '100');
  const seen = new Set();
  const pages = [];
  let visitors = 0;
  for (let batch = 0; batch < 10; batch++) {
    const response = await request(url, {
      headers: {Authorization: `Bearer ${token}`, Accept: 'application/json'},
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      if ([401, 403].includes(response.status)) {
        throw new DashboardError('APIキーと統計の読み取り権限を確認してください。');
      }
      throw new DashboardError('GoatCounterから取得できませんでした。時間をおいて更新してください。');
    }
    const result = await response.json();
    if (typeof result.more !== 'boolean' || !(Array.isArray(result.hits) || result.hits === null)) break;
    for (const hit of result.hits ?? []) {
      if (seen.has(hit.path_id) || !Number.isSafeInteger(hit.path_id) ||
          !Number.isSafeInteger(hit.count) || hit.count < 0 ||
          typeof hit.path !== 'string') {
        throw new DashboardError('統計を正しく取得できませんでした。');
      }
      seen.add(hit.path_id);
      url.searchParams.append('exclude_paths', String(hit.path_id));
      if (hit.path === 'site-visitor-daily' && hit.event === true) visitors = hit.count;
      if (hit.event !== true && hit.path.startsWith('/')) {
        pages.push({path: hit.path, title: hit.title || hit.path, count: hit.count});
      }
    }
    if (!result.more) {
      return {
        date: new Date(now + 9 * hour).toISOString().slice(0, 10),
        visitors,
        pages: pages.sort((a, b) => b.count - a.count || a.path.localeCompare(b.path)),
      };
    }
    if (!result.hits?.length) break;
  }
  throw new DashboardError('すべてのページの統計を取得できませんでした。');
}

const escape = value => String(value).replace(/[&<>"']/g, char =>
  ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));

export function renderDashboard(data, error) {
  const rows = data?.pages.map(page => `<tr><th scope="row">${escape(page.title)}
    <small>${escape(page.path)}</small></th><td>${number.format(page.count)}</td></tr>`).join('');
  return `<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ポコメーター番長 | 訪問者統計</title>
<style>
  *{box-sizing:border-box} body{margin:0;background:#0b1422;color:#edf4ff;font:1rem/1.55 system-ui,sans-serif}
  main{max-width:720px;margin:auto;padding:clamp(16px,5vw,40px)}
  h1{font-size:1.25rem;margin:0} h2{font-size:1.1rem;margin:0}
  header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px}
  a{color:#b8dcff} .refresh{display:inline-grid;place-items:center;min-height:48px;min-width:64px;padding:0 12px;border:1px solid #779ac1;border-radius:8px}
  section{border:1px solid #324762;border-radius:12px;padding:clamp(14px,4vw,24px);background:#152437;margin-bottom:16px}
  .visitors{background:#163453}.count{font-size:clamp(3rem,13vw,5rem);font-weight:750;line-height:1.15;font-variant-numeric:tabular-nums;margin:.18em 0}.count span{font-size:1.125rem}
  small,time{color:#b5cbe2} small{display:block;font-weight:400;overflow-wrap:anywhere}
  table{width:100%;border-collapse:collapse;margin-top:12px} th,td{padding:12px 4px;border-bottom:1px solid #405673;text-align:left;overflow-wrap:anywhere}
  th:last-child,td{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
</style>
<main>
  <header><h1>ポコメーター番長<br>訪問者統計</h1><a class="refresh" href="/">更新</a></header>
  ${data ? `<section class="visitors" aria-labelledby="visitors">
    <h2 id="visitors">今日のサイト全体の訪問者数</h2>
    <p class="count">${number.format(data.visitors)} <span>人</span></p>
    <time datetime="${data.date}">${data.date}（日本時間）</time>
  </section>
  <section aria-labelledby="pages"><h2 id="pages">今日のページ別アクセス数</h2>
    ${rows ? `<table><thead><tr><th scope="col">ページ</th><th scope="col">アクセス数</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p>今日のページ別アクセスはまだありません。</p>'}
  </section>` : `<section role="alert"><h2>統計を表示できません</h2><p>${escape(error)}</p></section>`}
  <a href="${site}/">GoatCounter管理画面</a>
</main></html>`;
}

export function createDashboard(token, load = readToday) {
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
    if (req.headers.host !== host ||
        (req.headers['sec-fetch-site'] && !['none', 'same-origin'].includes(req.headers['sec-fetch-site']))) {
      res.writeHead(403).end();
      return;
    }
    if (req.method !== 'GET' || req.url !== '/') {
      res.writeHead(404).end();
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    try {
      res.end(renderDashboard(await load(token)));
    } catch (error) {
      const message = error instanceof DashboardError
        ? error.message : '接続できませんでした。時間をおいて更新してください。';
      res.writeHead(502).end(renderDashboard(null, message));
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.POCO_METER_GOATCOUNTER_TOKEN?.trim();
  if (!token) {
    console.error('統計読み取り用APIキーを POCO_METER_GOATCOUNTER_TOKEN に設定してください。');
    process.exitCode = 1;
  } else {
    createDashboard(token).listen(port, '127.0.0.1', () => {
      console.log(`訪問者統計: http://${host}/`);
    });
  }
}
