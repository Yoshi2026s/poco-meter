import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from "../../chatgpt-auth";
import { env } from "cloudflare:workers";
import { isAnalyticsAdmin } from "../../../lib/visitor-stats.mjs";
import { readContactInbox } from "../../../lib/contact-store.mjs";
import ContactInbox from "./contact-inbox";
import "../stats.css";
import "./messages.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "お問い合わせ管理 | ポコメーター番長", robots: { index: false, follow: false } };
export default async function MessagesPage() {
  const user = await getChatGPTUser();
  const allowed = isAnalyticsAdmin(user, env);
  let data = null, unavailable = false;
  if (allowed) {
    try { if (!env.DB) throw new Error("Storage unavailable"); data = await readContactInbox(env.DB); }
    catch { unavailable = true; }
  }
  return <main className="visitor-admin contact-admin">
    <header><div><p className="eyebrow">ポコメーター番長</p><h1>お問い合わせ管理</h1></div><a className="admin-button" href="/admin">管理ページへ戻る</a></header>
    {!user ? <section><h2>管理者のログイン</h2><p>サイト所有者のChatGPTアカウントでログインすると、専用窓口に届いたメッセージを確認・返信できます。</p><div className="admin-actions"><a className="admin-button primary" href={chatGPTSignInPath("/admin/messages")} target="_top">ChatGPTでログイン</a><a className="admin-button" href="/admin/messages" target="_top">ログイン後に再読み込み</a></div><p className="admin-note"><a href="https://poco-meter.freefreelife2000.chatgpt.site/admin/messages" target="_blank" rel="noopener noreferrer">お問い合わせ管理を別タブで開く</a></p></section>
      : !allowed ? <section role="alert"><h2>管理者専用ページです</h2><p>このサイトの所有者のアカウントに切り替えてください。</p><a className="admin-button" href={chatGPTSignOutPath("/admin/messages")} target="_top">ログアウトして切り替える</a></section>
      : <><p className="admin-note">届いた内容は管理者だけが閲覧できます。返信は送信者のブラウザ内の「お問い合わせ」に表示されます。</p>{unavailable && <p role="alert">メッセージを読み込めませんでした。下の「更新」から再度お試しください。</p>}<ContactInbox initialData={data} /></>}
  </main>;
}
