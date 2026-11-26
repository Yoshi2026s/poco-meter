# ポコメーター番長 引継ぎ（現状）

更新日：2026/11/27（日本時間）

共通ルールは [AGENTS.md](../AGENTS.md)。この文書は「今の状態」だけを書き、**200行・20KB以内**に保つ。版ごとの画面仕様・検証結果の詳細は [archive/HANDOVER-2026-11-21.md](archive/HANDOVER-2026-11-21.md)（2026/11/21までの旧本文）を、必要な語で検索して該当箇所だけ読む。

## 作業の流れ（要点）
- 開始：`git fetch origin` → 開いているPRを確認 → `origin/(root)` から `claude/<内容>`（Codex は `codex/<内容>`）で1件1ブランチ。
- 検証：関連テスト（[CODEMAP.md](CODEMAP.md)「テストの選び方」）→ `npm run check`。UI変更は `npm run test:extra`。
- 統合：PRは `(root)` 宛て、CI「メーター計算・ボーダー保存の検証」合格後に squash マージ（マージ後の作業ブランチは自動削除）。「GitHub Pages 公開」の成功と公開URLの版を確認。
- 交代時はPR本文（[テンプレート](../.github/pull_request_template.md)）に、目的・ブランチ/SHA・検証結果・未確認と次の手順を書く。

## 構成
- 公開：GitHub Pages https://yoshi2026s.github.io/poco-meter/ （既定ブランチ `(root)` への push で自動公開）
- ボーダー：`data/borders.json`。GitHub Actions が毎日 05:00・17:00 JST に ONE CARAT から取得（記事本文＋月別表画像の2系統）。同じジョブでPococha公式noteのイベント新着も収集する。
- 旧Sites・署名キー・旧ChatGPTタスクは使わない。旧Sitesには新URLへの移転案内を掲示済み。ただし2026/11/19時点で旧Sitesは稼働中で、書き込みAPI（/api/borders/refresh）と管理ページが応答する。止める・キーを無効にするのはSites側の操作（ユーザー作業）。GitHub Secrets は2026/11/20に登録なし（`gh secret list` が空）を確認済み。
- ツール版：`scripts/build-pages.mjs` の `PAGES_VERSION`（v2026.11.27.4）。
- 第三者掲載のイベント（半日・1日・複数日）：照合記録 `docs/pococha-event-sources.md` の表（| 名前 | 開催期間 | ランク |）と「○/○の第三者掲載はA（12:00〜23:59、D3〜S6）…」の箇条書きから、期間を読める開催を `automation/extract-task-events.mjs` が `data/calendar-event-candidates.json`（公式未確認の候補、毎回作り直し）にする。公式の行（task-events）には混ぜず、画面では「公式未確認」と表示。公式に同じ名前で期間が重なる開催があれば公式だけを出す。メイン画面の開催中は公式・候補を別々に最大12件。イベントカレンダーの日付マスとメイン画面のイベント欄には半日イベントに「半日」の印を出す（v2026.11.27.4）。
- E帯の旧ランク（E1〜E3）の記録は、日付・締め・値が同じEの記録（CSVの書き出し→取り込み、下書きの再復元）と同じものとして扱い、二重登録しない。旧記録を編集して保存しても元のランクを保つ（v2026.11.26.1、`tests/e-rank-dedupe.mjs`）。
- 訪問者統計：GoatCounter（`GOATCOUNTER_CODE` が空なら無効、現在 `poco-meter`）。公開4画面のページ別集計に加え、共通イベント `site-visitor-daily`（「サイト全体の訪問者数（1日・日本時間）」）で同じブラウザーを日本時間0時〜翌0時の1日1件にまとめる。[管理画面](https://poco-meter.goatcounter.com/)の同名行を読む。「合計」はイベントを除外したページ訪問数。`scripts/goatcounter-site-visit.js` が Web Locks で複数タブを直列化し、`poco-meter-daily-visit-v1` に最後の送信受付日だけを保存。日別イベントだけは公式 `ns=true` で8時間判定を使わず、翌日0時直後も数える。Cookie・独自IDなし。別端末/別ブラウザー/保存データ削除後は別件になり得る。固定版 count.v5.js＋公式SRI・ヘルパーSRI・自アクセス除外を維持。以前の8時間集計 `site-visitor` は過去データとして残し、日別と合算しない。見方・送信失敗時の扱い・対応条件は [訪問者統計](codex-tasks/visitor-stats.md) を参照。
- 目標のボーダー選択（メーターのボーダー欄・詳細側の `quickBorder`・`pickBorder`）は ±0・+1・+2 のみで「手入力」の選択肢は無い。目標値を直接入力した時も欄は直前のボーダー（`state.analysisBorder`、無ければ±0）を表示し、フォーカスが外れただけでは自動計算に戻さない。別のボーダーを選ぶか「既定値」で自動計算に戻る。既定値設定の `defaultBorder` だけは「手入力」を残す（JSで追加）。
- メーター画面のYoshi1012タグ（`.tool-creator-logo`）はフッターの `.footer-support` 内、「免責事項」の右隣（2列グリッドの右）で、免責事項ボタンと同じ幅・高さ44px。免責事項を開くと本文の下に回る。
- 公開物には `404.html`（存在しないアドレス用の案内）を含む。サブ3画面のアイコン・説明文・テーマ色と、計算画面の共有用タグ（OGP）は `scripts/build-pages.mjs` が公開時に付ける。公開URLは同ファイルの `PUBLIC_URL`。

## 安全性・リポジトリ設定（残り）
- 同じ origin の注意：https://yoshi2026s.github.io は同じアカウントの他の公開 Pages（pococha-dentetsu など9件）と同じ origin で、localStorage・IndexedDB・CSP の 'self' を共有する。pococha-dentetsu は gstatic の Firebase を SRI なしで読む。保存データは計算用の値だけで機微度は低いが、根本策は poco-meter を独自ドメインか別アカウントへ分けること。ルートのユーザーサイト（yoshi2026s.github.io）にスコープ "/" の Service Worker を置かないこと。
- 旧コードに残る別アカウント名「pococha2026」（github-sync/、lib/border-store.mjs の CORS、scripts/prepare-github-meter.mjs など。公開物には出ない、tests/public-safety.mjs で検出）は、GitHub 上にそのアカウントが存在せず第三者が取得できる名前。旧Sites用コードを整理するときに削除する。
- 未対応の低リスク：OCR の IndexedDB キャッシュのキーに版がない（データ差し替え時は cachePath に版を付ける）、CSP の不要な許可（img-src の data:/blob: など）、iframe 埋め込み対策、取得値の急変検知、バックアップ取り込みの取り消し、「残りをコピー」の文に必要コインが入る、マージ済みブランチが多数（削除は承認が必要）。
- リポジトリ設定（2026/11/20、ユーザー承認）：脆弱性の非公開報告（SECURITY.md から案内）と依存関係の脆弱性アラートを有効、Actions は GitHub 製のみ（allowed_actions=selected・github_owned_allowed）で SHA 固定必須（sha_pinning_required）、Wiki・プロジェクトは無効。新しいアクションを使うときはこの設定に合うか確認する（GitHub 製以外・タグ指定は動かない。中でタグ指定のアクションを呼ぶ composite アクションも動かないため、pages.yml は upload-pages-artifact の代わりに tar＋SHA 固定の upload-artifact を使う）。
- 残り（ユーザー作業）：取得元 ONE CARAT への転載許諾の問い合わせ／旧Sitesの停止（書き込みAPI・管理ページ）／GitHub のメール設定（Keep my email addresses private・Block command line pushes that expose my email）。
- 必須チェック（CI合格の必須化）・自動マージは見送り（2026/11/21 ユーザー決定）。ボーダー自動更新が GITHUB_TOKEN で `(root)` に直接 push しているため、必須化すると自動更新が止まる。

## データの状態
- 初期値は旧Sites公開APIの1951件（〜2026-10-18）。10/19〜11/03 は月別表画像から補完済み（証跡 `db/backfill-2026-10-19-to-11-03-evidence.json`）。
- 欠け：10/31 13時（取得元の表が空欄）。3日経過前の日は自動更新の第2系統が後日補う。
- 補完した日・取得元に無い日は `data/border-provenance.json` に記録される。
- 予想・イベント・情報源（`data/events.json`・`meter-factors.json`・`forecast-*.json` など）の仕組みは旧本文「データの状態」を参照。

## 未確認・既知のテスト差
- 画面系テスト（`npm run test:extra`）13本は v2026.11.21.1 で全合格（Chromiumのエミュレーション）。hud-items-browser の320px既存不合格は解消。
- 物理端末のSafariとOSキーボードは未確認。
- 標準外の旧テスト（2026/11/16 全件実行、`0968ad7`）：`tests/*.mjs` のうち標準チェック・画面系以外の77本中51本は合格。失敗26本はすべて取込直後 `8913782` でも失敗しており、現行コードの不具合ではない（落ちる項目が増えた7本も、仕様変更・廃止した欄・取得ファイルが1本増えたことによるずれと確認）。
  - 旧Sites・Worker前提（Pages版では使わない）：`admin-worker`・`contact-*`（images・tracking・worker）・`cloudflare-pages-migration`・`security-hardening`・`security-management`・`image-metadata-security`・`debug-current-10000`。
  - 古い仕様の期待値：`e-border-100-rounds`（E1〜E3。現行は `e-rank-unified` が合格）・`strengthen-50`・`mobile-debug-50`（廃止した `adjustAmount` 等）・`retired-external-app-features`・`fixed-panel-focus`・`save-menu`・`saved-record-months`・`pococha-clock-ui`・`border-client-precision`・`border-reliability-regressions`（旧API前提、予想データの取得分だけ呼び出し回数が多い）・`history-debug-ten-rounds`（内部の `security-hardening` のみ失敗）。
  - オフライン系 `offline-ui-50`・`offline-ui-5000`・`offline-sw-5000`・`offline-reliability-1000` も同様。`meter-validation-ten-rounds` は5分を超えるため未完了。`history-mobile-audit` は引数が必要。
  - 古いテストを直すときは1本ずつ仕様を確かめて期待値を更新する（実行すると `docs/` に結果JSONを書くものがあるので、終わったら元に戻す）。

## 主なユーザー決定（覆さない）
- 使うのは「ボーダー自動更新」と「計算画面」。Pages版ではアクセス統計送信・管理ページリンク・Pocochaサーバー時刻を外す（時刻は端末時刻と明示）。
- 時刻の誤差は「標準時との差」を表示（公開サーバーのDateヘッダーを同一オリジンのHEADで複数回測定、v2026.11.07.11、ユーザー決定）。静的ページからPococha公式の時刻は読めない（CORS）ため、Pococha時刻との差とは表示しない。
- HAISHIN LAB は規約で無断転載禁止のため取得元に使わない。
- シンプルメニューは全画面幅でメイン画面（通常配置、ON/OFFなし）。残りアイテム目安はその中、補助メニューはその直下に同じ幅で統合し、配色はページ全体の設定に従う（v2026.11.07.8）。補助メニューの順は ボーダー別の必要量（ランク・締め時間を選択。締め時間は画面全体の締め時間と連動）→（締め時刻（手入力））→記録の編集・バックアップ。「目標詳細設定」（`#targetStudio`）と「アイテム登録」（`#itemRegister`）・登録アイテムの必要数・メイン画面の「詳細」「詳細設定」「デフォルト値設定」ボタンは v2026.11.20.6 で画面から削除（ユーザー決定）。自動目標の計算が内部の選択欄（pickPeriod など）を使うため要素は hidden・inert で残す。保存済みの items・goalDefaults は消さない（起動時の既定値適用はそのまま動く）。「時刻設定・ポイント調整」は v2026.11.15.2 で廃止（ユーザー決定）：現在値の加減算と配信終了予定を削除し、締め時刻の欄だけ「締め時間＝手入力」のときに表示（`#customDeadlineCard`）。保存データの `endTime` は互換のため読み書きを残すが計算には使わない。過去のボーダー表へは専用リンクから開く。開いた状態は再読込で保持せず、起動時は全て閉じる（v2026.11.07.9、ユーザー決定）。詳細メーター `#fullMeterMenu` はシンプルメニューと重複するため常時非表示（計算・保存の内部状態として要素は残す。表示や操作を戻さない）。目標・残り時間が画面外に出たら上部に細い状態バー。旧ON/OFFの保存キー `pococha-meter-hud-v1`・`pococha-meter-items-window-v1` は読まず、消さずに残す。
- メイン画面と、スマホ・タッチ画面の詳細メーターの主要ボタン・入力は44px以上、入力欄は16px以上（iOSの拡大防止）。旧設計の「詳細メーターの締め時間・コア数・目標設定欄は36px以下」は廃止（v2026.11.07.7）。
- スマホで開くと目標・現在が初期値に戻るのは既存仕様（storage-recovery-regressions）。
- 標準ランクはS2（v2026.11.09.11）。旧標準の全項目と一致する保存済み既定値はS2へ移行し、変更済みの既定値と過去ボーダーの保存済み検索条件を引き継ぐ。集計期間は 前日・2日前・3日前（各1日分）・直近7日・直近14日・直近30日・当月・先月・3か月・全期間。直近系は昨日（日本時間）まで、集計最終日の指定は直近30日のみ。記録の無い日は補わず「データ無し」。

## 参照先
- 開発ルール・検証コマンド（ChatGPTでの作業手順を含む）：[../AGENTS.md](../AGENTS.md)
- ファイルの場所・関数・テストの選び方：[CODEMAP.md](CODEMAP.md)
- 画面・計算の要望一覧：[REQUESTS.md](REQUESTS.md)
- 旧Sitesでの自動取得の経緯：[AUTOMATION_CODE_HANDOVER.md](AUTOMATION_CODE_HANDOVER.md)。現行処理は `.github/workflows/border-update.yml` と `automation/update-borders-json.mjs` を参照する。
- 旧Sites時代の報告類：`archive/`（参照のみ。現行の指示ではない）
