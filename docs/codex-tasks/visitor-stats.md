# Codex 指示書：訪問者統計（GoatCounter）を公開版に追加する

状態：実装済み（PR #119・v2026.11.16.3）

## サイト全体の訪問者数（日別・2026/11/17更新）

ユーザーの訂正により、v2026.11.17.3から **日本時間0時〜翌0時の1日につき、同じブラウザーを1件** として数える。

- 管理画面の「ページ」にある **サイト全体の訪問者数（1日・日本時間）**（イベント名 `site-visitor-daily`）の数値を見る。今日なら開始日・終了日を両方今日にする。フィルター `site-visitor-daily` でこの行だけに絞れる。複数日の数値は各日の人数の合計であり、期間全体の重複なし人数ではない。
- 全4画面で共通。同じ日のページ移動・再読み込み・ブラウザー再起動・8時間以上経過した再訪でも再送しない。同じブラウザーであれば回線が変わっても再送しない。表示中のページが0時をまたいだ場合や、翌日に非表示タブ/バックグラウンドから復帰した場合は翌日分を送る。日付は端末時計から日本時間に換算する。
- ブラウザー内の `poco-meter-daily-visit-v1` に最後の送信受付日（`YYYY-MM-DD`）だけを保存し、Web Locks で複数タブの確認・保存・送信を直列化する。個人識別ID・Cookieは追加しない。計算入力やバックアップの既存キーは変更しない。免責事項に日付の保存を明記する。
- 別ブラウザー・別端末・プライベートモード・保存データ削除後は別件になり得る。同じブラウザーを複数人で共有した場合は1件となる。厳密な実人数ではなく、ブラウザー単位の日別人数の目安。Web Locks/永続保存/Beaconが使えない環境、除外中、既知のオフライン状態では日別イベントを送らない。
- 送信先は既存GoatCounterのみ。[公式JS API](https://www.goatcounter.com/help/js)の `filter()` と `url()` を使い、固定版v5に未実装の `no_session` だけは[現行公式JS](https://github.com/arp242/goatcounter/blob/main/public/count.js)と同じ `ns=true` を加える。日別イベントだけ8時間判定を外すことで、前日23:59と当日0:01をそれぞれ1件にする。通常のページ別計測は従来どおり。
- Beaconの送信キュー受付前に日付を保存する。キュー受付が拒否/例外なら元の日付へ戻し、次の訪問・オンライン復帰等で再試行する。受付後は配送結果が不明でも同日に再送しないため、後続のネットワーク障害等で過少になる可能性がある。保存した日付はサーバーでの集計成功を保証するものではない。保存の失敗でも画面操作は止めない。
- 「合計」はユーザー設定 → ダッシュボード → 合計サイトページビューで「イベントを除外」を有効にし、ページ訪問数として読む。「ページ」見出しの総数やブラウザー等の統計を人数として読まない。
- 旧 `site-visitor`（約8時間単位、PR #124）は過去データを保全して残す。新しい版からは送らず、日別の数値と合算しない。過去データの日別人数への変換はできない。
- 追加処理は `scripts/goatcounter-site-visit.js`。公開時のみ4画面へSRI付きで追加。CDN失敗・非表示・事前描画・例外に対応。インラインJSや404への追加、SWの変更はしない。コード空ではタグ/ヘルパー/日付保存の説明を配らない。
- 自アクセス除外は、対象の各ブラウザーで `https://yoshi2026s.github.io/poco-meter/#toggle-goatcounter` を開き「DISABLED」を確認する。同じURLを再度開くと解除される。ブラウザーデータ削除後や別ブラウザーでは再設定する。過去の集計は変わらない。

以下は最初のページ別統計導入時の指示書。

（Codex への依頼文：「docs/codex-tasks/visitor-stats.md の指示書に従って実装して」。リポジトリ Yoshi2026s/poco-meter、既定ブランチ `(root)`）

## 目的
GitHub Pages 公開版（https://yoshi2026s.github.io/poco-meter/）の4画面で、ページ別のアクセス数を **GoatCounter** で集計できるようにする。
- 対象：`index.html`（計算）・`border-history.html`（過去のボーダー表）・`e-border.html`（E帯）・`calculation-methods.html`（算出方法）
- Cookie なし、IPアドレスを自前で保存しない、同意バナーなし。
- 統計は GoatCounter の管理画面（オーナーのログイン）で見る。このリポジトリに管理ページは作らない。

## 最初に読むもの
1. `AGENTS.md`（共通ルール。必ず従う）
2. `docs/CODEMAP.md`（どこを触るか）
3. `scripts/build-pages.mjs`（公開物の加工。`exportCalculator`・`exportHistory`・`exportEBorder`・`withPageHead`・`assertClean`・`buildPages`）
- `calculator/index.html`（540KB）・`calculator/border-history.html`（1.2MB）は全文を読まない。`rg --max-columns 300` で行を特定して必要な範囲だけ読む。

## 前提・決めてあること
- サイトコード（`https://<code>.goatcounter.com` の `<code>`）はオーナーが GoatCounter でアカウントを作って決める。**アカウント作成・ログインは行わない。**
- そのため `scripts/build-pages.mjs` に定数を1つ置く：
  ```js
  // GoatCounter のサイトコード。空なら計測タグを入れない。
  export const GOATCOUNTER_CODE = '';
  ```
  - 空文字のときは公開物を今と1バイトも変えない（既存テストがそのまま通ること）。
  - 値が入ったときだけ4画面に計測タグを入れる。値は `/^[a-z0-9-]{2,50}$/` で検証し、合わなければビルドを失敗させる。
- オーナーからコードを受け取っていない場合は空のまま PR を出し、PR本文の「未確認・残作業」に「GOATCOUNTER_CODE の設定待ち」と書く。

## 実装内容
### 1. 計測タグは公開物（`_site/`）にだけ入れる
- 編集元の `calculator/*.html`・テンプレート（`*-template.html`）には入れない。`scripts/build-pages.mjs` の加工で入れる。
- 4画面とも `</body>` の直前に1回だけ入れる（`replaceOnce` 系で、2回以上や0回なら失敗させる）。`404.html` には入れない。
- スクリプトは GoatCounter 公式ドキュメント（https://www.goatcounter.com/help/start と https://www.goatcounter.com/help/countjs-versions）を確認し、**バージョン付きの count.js と公式に示された SRI（integrity）ハッシュ**を使う。例（形だけ。値は公式で確認する）：
  ```html
  <script data-goatcounter="https://<code>.goatcounter.com/count" async src="https://gc.zgo.at/count.vN.js" crossorigin="anonymous" integrity="sha384-..."></script>
  ```
  - 公式の値を確認できなかった場合は推測で書かず、PRで止めて報告する。
- インラインスクリプトは追加しない（CSP のハッシュ管理を増やさないため）。

### 2. CSP（Content-Security-Policy）を最小限だけ広げる
各画面は `<meta http-equiv="Content-Security-Policy">` で厳しく制限している（計算画面は `script-src` がハッシュ列挙、`connect-src 'self'`）。コードが入っているときだけ、公開物の CSP に次を足す：
- `script-src` に `https://gc.zgo.at`
- `connect-src` と `img-src` に `https://<code>.goatcounter.com`（count.js は sendBeacon または画像で送るため）
- それ以外の指定は変えない。`assertClean` の既存チェック（スクリプトハッシュが CSP にあること）を壊さない。
- `calculation-methods.html` にも CSP があるか確認し、ある場合は同じ扱い。無い場合は追加しない。

### 3. 変えてはいけないもの
- Service Worker（`calculator/sw.js`）は他オリジンの要求を扱わない作り（`url.origin !== self.location.origin` で素通し）。計測を SW でキャッシュ・中継しない。オフライン時に計測が失敗しても画面に影響しないこと。
- 端末の保存キー（`pococha-meter-calc-v1` など）とデータ形式。
- `<meta name="referrer" content="no-referrer">` などの既存の metaは残す。
- 旧Sites時代の自前統計（`lib/visitor-stats.mjs`・`app/admin/`・`db/schema.ts` の site_visit_events・計算画面内の `pococha-public-access-tracker`）は復活させない。`assertClean` が `pococha-public-access-tracker` を禁止している状態も維持。
- URLのハッシュ（`#always-on`・`#rank=...` など）は GoatCounter が既定で無視する。パスに付け足して送らない。
- `data/borders.json` は手で編集しない。

### 4. 利用者への説明
- 計算画面の免責事項（`calculator/index.html` の `#toolDisclaimerText`）に、コードが入っているときだけ1文を足す（公開物の加工で入れる）：
  「アクセス数の集計に GoatCounter を使用しています（Cookie は使わず、個人を特定する情報は保存しません）。」
- 言い回しは GoatCounter の公式説明（https://www.goatcounter.com/help/gdpr など）と食い違わないよう確認する。
- 他の3画面のフッター表記は変えなくてよい。

### 5. テスト
- 新しいテスト `tests/pages-visitor-stats.mjs` を作り、`scripts/check.sh` の21行目のテスト一覧に追加する。確認すること：
  1. `GOATCOUNTER_CODE` が空のとき、4画面に `goatcounter`・`gc.zgo.at` が含まれない。
  2. テスト用コード（例 `test-code`）を渡して作ると、4画面それぞれに計測タグがちょうど1つ、`integrity` 付き、CSP の `script-src`・`connect-src`・`img-src` に必要なオリジンが入り、ほかの CSP 指定は空のときと同じ。`404.html` には入らない。
  3. 不正なコード（大文字・記号・空白など）でビルドが失敗する。
  4. 計算画面の免責事項に一文が入る（コードありのときだけ）。
- テストからコードを渡せるよう、`buildPages` / `export*` にオプション引数（例 `{goatcounter}`）を足し、既定値は定数を使う。既存の呼び出しは変えない。

## 手順
1. `git fetch origin` → `git switch -c codex/visitor-stats "origin/(root)"`。開いているPRで `scripts/build-pages.mjs` を触るものがあれば、マージを待つかオーナーに確認する。
2. 実装・テスト追加。
3. ツール本体の変更なので `npm run version:bump`。テンプレートや `.mjs` を変えて生成物に影響する場合は `npm run pages:prepare` して生成物もコミット。
4. `npm test` → `npm run check`（Node 22以上）。`npm run test:extra` も実行（約8分）。
5. 一時的に `GOATCOUNTER_CODE='test-code'` でビルドし、`_site/` をローカル配信して、ブラウザーの開発者ツールで CSP 違反が出ないこと・4画面が従来どおり動くこと（スマホ縦 375px・横持ち）を確認する。確認後は空に戻す（オーナーのコードが届いていればその値）。`_site/` はコミットしない。
6. `docs/CHANGELOG.md` の先頭に1行（日付・版・内容・検証）。`docs/HANDOVER.md` の「構成」に「訪問者統計：GoatCounter（`GOATCOUNTER_CODE` が空なら無効）」を書き換えで追加。`docs/REQUESTS.md` は変えない。この指示書の先頭（見出しの下）に「状態：実装済み（PR番号・版）」を1行書き足す。
7. PR は `(root)` 宛て、本文は `.github/pull_request_template.md` の見出しに沿う。実行していないテスト・未確認の項目は「未確認・残作業」に書く（実施していないものを完了扱いにしない）。

## 完了条件
- コード空：公開物が変更前と同じ（版表記を除く）で、`npm run check` 合格。
- コードあり：4画面で GoatCounter に計測が送られ、CSP 違反なし、オフライン・常時表示モード・保存と再読込が従来どおり。
- 公開後、オーナーが GoatCounter 管理画面で4ページが別々に数えられていることを確認できる。

## してはいけないこと
- GoatCounter や他サービスのアカウント作成、APIキー・トークンのコミット。
- 計測先を GoatCounter 以外に増やす、IP・端末機種などを独自に送る。
- 強制push、`(root)` への直接コミット、`data/borders.json` の手編集、`_site/` のコミット。
