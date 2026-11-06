# Pocochaメーター計算：Cloudflare Pages移行用

このファイルは公開準備用です。まだ新しい公開URLは作成されていません。
現在の画面・計算・選択メニュー・保存・オフライン機能を維持しています。
`public/` だけがウェブ公開用で、データ移行ファイルは含めません。

## 公開前に必要なもの

Cloudflareの無料アカウントにログインし、PagesのプロジェクトとD1データベースを作成します。
Pagesの実際の公開URLは作成後に確認します。希望名が使えるとは限りません。
有料プランへの変更やドメインの購入は不要です。

1. D1データベースを新規作成し、`01-schema.sql`、`02-borders.sql` の順にインポートします。
   既存データのあるデータベースには実行しないでください。
2. Pagesに `public/` のファイルをアップロードします。`_worker.js` を含めてください。
3. 本番用D1バインディングを `DB` という名前で設定します。
4. 実際に割り当てられた本番のoriginを `BORDER_WRITER_ORIGIN` に設定します。
5. 所有者用のアプリ署名キーを秘密の環境変数 `BORDER_WRITER_KEY` に設定します。
   生のSitesトークンやキーをこのファイル・ブラウザ・公開フォルダーへ保存しないでください。
6. 設定を反映して公開し、ログインなしで画面、API、オフライン保存を確認します。
7. 移行済みの記録件数・各締めの最新日付・同期情報を読み戻して照合します。
8. 正式な掲載記事の署名付き保存が成功した後だけ、既存の毎日更新タスクに
   新しい公開先への更新を追加します。公開前のタスクは変更しません。

## 保存用署名

元のSitesプロジェクトの所有者が `get_site` から返却トークンを取得します。
メモリ内だけで以下のUTF-8文字列のSHA-256を求め、その32バイトをPages用キーにします。

```text
pococha-pages-border-writer-v1
<元の正確なproject_id>
<実際のPages本番origin>
<所有者get_siteの返却トークン>
```

各POSTのJSONを一度だけ直列化し、同じ本文バイト列を送ります。
整数Unix秒を `X-Border-Writer-Time` に、次のUTF-8文字列のHMAC-SHA256小文字hexを
`X-Border-Writer-Signature` に設定します。キーは32バイトにデコードした値を使います。

```text
POST
<pathname>
<同じUnix秒>
<本文バイト列のSHA-256小文字hex>
```

Pagesには署名・時刻・掲載済み記事HTMLだけを送ります。
`OAI-Sites-Authorization` と生のSitesトークンは元のSite以外へ送りません。
元のSiteとPagesのキーは異なります。未設定・偽造署名・本文変更・過去5分超・未来60秒超・
プレビューoriginの保存は403で拒否します。403を迂回したり認証情報を再生成しません。

## データと無料枠

`verified-borders.json` は実際の旧Siteの共有ボーダーだけです。
個人の目標・現在値・記録・表示設定は含みません。元の確認日時を保持しており、
この移行準備によって新しい「更新成功」の日時を作りません。
端末内の個人データは、現在の保存メニューからバックアップを作成し、
新URLで復元してください。ホーム画面のショートカットとオフライン準備も新URLで行います。

通常の画面配信は静的配信です。APIだけがFunctionsを使用します。
無料枠にはAPI回数・CPU時間・D1の読み書き量の上限があります。
実Cloudflareでの記事処理のCPU上限確認は、公開後に必要です。
新しい公開先と自動更新の確認が終わるまで、現在のSiteと毎日更新は維持します。

## 公式資料

- https://developers.cloudflare.com/pages/get-started/direct-upload/
- https://developers.cloudflare.com/pages/functions/advanced-mode/
- https://developers.cloudflare.com/pages/functions/bindings/
- https://developers.cloudflare.com/d1/best-practices/import-export-data/
- https://developers.cloudflare.com/pages/functions/pricing/
