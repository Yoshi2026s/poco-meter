"use client";
import { useRef, useState } from "react";
type Thread = { id: string; subject: string; createdAt: number; updatedAt: number; lastAuthor: string };
type Attachment = { url: string; type: string; size: number };
type Message = { id: string; author: string; content: string; createdAt: number; attachment?: Attachment | null; attachments?: Attachment[] };
type Inbox = { threads: Thread[]; thread: Thread | null; messages: Message[]; nextBefore: string | null; page: number; total: number; hasNext: boolean };
const date = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
async function request(path: string, options?: RequestInit) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(path, { ...options, credentials: "same-origin", cache: "no-store", signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "保存・読み込みを確認できませんでした。");
    return data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("通信に時間がかかっています。内容を残して再度お試しください。");
    throw error;
  } finally { clearTimeout(timer); }
}
export default function ContactInbox({ initialData }: { initialData: Inbox | null }) {
  const [data, setData] = useState(initialData), [text, setText] = useState(""), [status, setStatus] = useState(""), [loading, setLoading] = useState(false), [sending, setSending] = useState(false), [revoking, setRevoking] = useState(false);
  const revision = useRef(0), busy = useRef(false), loadingRef = useRef(false), draft = useRef(""), payload = useRef<{ requestId: string; threadId: string; content: string } | null>(null);
  async function load(thread?: string, page = data?.page || 1, before?: string) {
    const generation = ++revision.current; loadingRef.current = true; setLoading(true);
    const query = new URLSearchParams({ page: String(page) }); if (thread) query.set("thread", thread); if (before) query.set("before", before);
    try { const found = await request(`/api/admin/contact?${query}`); if (generation === revision.current) { setData(found); return true; } }
    catch (error) { if (generation === revision.current) setStatus(error instanceof Error ? error.message : "読み込みを確認できませんでした。"); }
    finally { if (generation === revision.current) { loadingRef.current = false; setLoading(false); } }
    return false;
  }
  function selectConversation(thread?: string, page = data?.page || 1) {
    if (busy.current || loadingRef.current) return;
    if (draft.current.trim() && !window.confirm("入力中の返信を破棄して、問い合わせを切り替えますか？")) return;
    setText(""); draft.current = ""; payload.current = null; setStatus(""); load(thread, page);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy.current || loadingRef.current || !data?.thread || !text.trim()) return;
    const snapshot = text, threadId = data.thread.id, content = snapshot.trim();
    if (!payload.current || payload.current.threadId !== threadId || payload.current.content !== content) payload.current = { requestId: crypto.randomUUID(), threadId, content };
    busy.current = true; setSending(true); setStatus("送信中…");
    try {
      const result = await request("/api/admin/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload.current) });
      if (!result.ok || result.threadId !== threadId) throw new Error("保存を確認できませんでした。内容を残して再度お試しください。");
      if (draft.current === snapshot) { setText(""); draft.current = ""; } payload.current = null; setStatus("返信を送信しました。"); await load(threadId);
    } catch (error) { setStatus(error instanceof Error ? error.message : "送信を確認できませんでした。内容を残して再度お試しください。"); }
    finally { busy.current = false; setSending(false); }
  }
  async function revokeSession() {
    if (busy.current || loadingRef.current || !data?.thread) return;
    const threadId = data.thread.id;
    if (!window.confirm("この利用者の現在の問い合わせセッションを失効させますか？ 同じブラウザで作成したすべての問い合わせの閲覧・追記ができなくなり、元に戻せません。管理側の記録は残ります。利用者は新しいセッションで新規問い合わせを作成できます。")) return;
    busy.current = true; setRevoking(true); setStatus("アクセスを失効しています…");
    try {
      const result = await request("/api/admin/contact/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threadId }) });
      if (!result.ok || result.threadId !== threadId || result.revoked !== true) throw new Error("失効を確認できませんでした。もう一度お試しください。");
      setStatus("利用者の問い合わせセッションを失効しました。管理側の記録と入力中の返信は残っています。");
    } catch (error) { setStatus(error instanceof Error ? error.message : "失効を確認できませんでした。もう一度お試しください。"); }
    finally { busy.current = false; setRevoking(false); }
  }
  const disabled = loading || sending || revoking;
  return <section>
    <div className="admin-section-title"><h2>専用メッセージ窓口</h2><button type="button" className="admin-button" disabled={disabled} onClick={() => load(data?.thread?.id)}>更新</button></div>
    <p role="status" aria-live="polite">{status}</p>
    {!data ? <p>「更新」でメッセージを読み込めます。</p> : <>
      <p className="admin-note">{data.total.toLocaleString("ja-JP")}件 ／ 更新が新しい順・1ページ30件。未回答の問い合わせには「返信待ち」と表示します。</p>
      <div className="contact-inbox-grid"><div><h3>お問い合わせ一覧</h3><ul className="contact-thread-list">{data.threads.map(thread => <li key={thread.id}><button type="button" className="admin-button" disabled={disabled} aria-current={data.thread?.id === thread.id ? "true" : undefined} onClick={() => selectConversation(thread.id)}><strong>{thread.subject}</strong><time dateTime={new Date(thread.updatedAt).toISOString()}>{date.format(new Date(thread.updatedAt))}</time><span>{thread.lastAuthor === "visitor" ? "返信待ち" : "返信済み"}</span></button></li>)}</ul>{!data.threads.length && <p>まだお問い合わせは届いていません。</p>}
      <nav className="admin-pagination" aria-label="お問い合わせのページ"><button className="admin-button" disabled={disabled || data.page <= 1} onClick={() => selectConversation(undefined, data.page - 1)}>前へ</button><span>{data.page}ページ</span><button className="admin-button" disabled={disabled || !data.hasNext} onClick={() => selectConversation(undefined, data.page + 1)}>次へ</button></nav></div>
      <div>{data.thread && <><h3>{data.thread.subject}</h3><ol className="contact-message-list">{data.messages.map(item => <li key={item.id} data-author={item.author}><strong>{item.author === "owner" ? "管理者" : "利用者"}</strong><time dateTime={new Date(item.createdAt).toISOString()}>{date.format(new Date(item.createdAt))}</time>{item.content && <p>{item.content}</p>}{(item.attachments || (item.attachment ? [item.attachment] : [])).slice(0, 5).map((attachment, index) => /^\/api\/admin\/contact\/attachments\/[0-9a-f-]{36}(?:\?image=[1-5])?$/.test(attachment.url) && <a key={attachment.url} className="contact-admin-attachment" href={attachment.url} target="_blank" rel="noopener noreferrer"><img src={attachment.url} alt={`お問い合わせの添付画像${index + 1}`} loading="lazy" referrerPolicy="no-referrer" /><span>添付画像{index + 1}を開く</span></a>)}</li>)}</ol>{data.nextBefore && <button className="admin-button" disabled={disabled} onClick={() => load(data.thread!.id, data.page, data.nextBefore!)}>前のメッセージ</button>}
      <form className="contact-reply-form" onSubmit={submit}><label htmlFor="contact-admin-reply">返信内容</label><textarea id="contact-admin-reply" required readOnly={loading} maxLength={1500} rows={6} value={text} onChange={event => { setText(event.target.value); draft.current = event.target.value; }} placeholder="利用者への返信をご記入ください。" /><button className="admin-button primary" type="submit" disabled={disabled || !text.trim()}>返信を送信</button></form>
      <p className="admin-note">漏えいが疑われる問い合わせセッションを失効できます。同じブラウザの全問い合わせが対象です。管理側の記録は残ります。</p><button type="button" className="admin-button" disabled={disabled} onClick={revokeSession}>利用者の履歴アクセスを失効</button></>}</div></div>
    </>}
  </section>;
}
