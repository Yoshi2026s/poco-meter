# ボーダー自動取得をCodeへ移すための引継ぎ

更新日：2026/11/06（日本時間）
対象：https://github.com/Yoshi2026s/poco-meter
現行Sites：https://poco-meter.freefreelife2000.chatgpt.site/

## 今回の承認範囲
Code側で自動取得を行うための引継ぎ準備。実行開始の承認ではない。
既存ChatGPTタスクを無効のまま維持し、キー変更・新しい秘密値の共有・本番保存・新しい定期実行の有効化をしない。
旧同期ワークフローも再開しない。既存画面・計算式・データを変更しない。

## 現状と証拠の区別
- GitHubの既定ブランチは(root)。今回確認時点では開発資料のみで、アプリ本体はGitHubへ未移管。
- Sitesの正規ソース取得コミットは3c0e6c8190a02217db3c8a6c8ff8ef180d83e4f7。358ファイルをZIPで提供済み。
- ユーザーが転記したCodeの結果：358ファイルのハッシュ一致、公開版v2026.10.23.3との照合、締め時間別の計算・API値の一致、poco-meter-importに移管候補を準備。テスト・ビルド・コミットは未実施との報告。当方がPC内を直接確認した結果ではない。
- Code側のHANDOVER-追記案.mdと403経路表は、このリポジトリにはまだない。ローカルの原文を保持し、未取得のA〜G対応表を想像で再現しない。
- ChatGPT側で確認：タスク「Pocochaボーダーを毎日更新」（Automation_0413ad8670108191a1881897d59d6f4f）は無効。設定は毎日05:00 Asia/Tokyo。旧ソースREADMEは09:00と記載。正しい意図と取得元の掲載時刻の観測値は未確定。
- 2026/10/21 04:58 JSTの記録：取得先確認でHTTP403、保存せず自動更新停止。取得可能なのは結果要約だけで、完全URL、GET/POST、error本文、送信ヘッダーは未取得。
- last_attemptが認証後にしか更新されないなら、その未更新は「通信自体が一切届いていない」証拠ではない。認証前に拒否された可能性を残す。

## 直近の読み取り診断
2026/11/06 23:17 JSTまでに、このチャットの実行環境で実施。定期タスクの環境と同一とは確認できない。

| 手順 | URL | メソッド | ステータス | Content-Type / error | 指定ヘッダー |
| --- | --- | --- | --- | --- | --- |
| 1-1 | https://poco-meter.freefreelife2000.chatgpt.site/api/borders/source-urls | GET | 403 | text/plain; charset=UTF-8、JSON errorなし | X-Border-Writer-Timeなし、X-Border-Writer-Signatureなし、Originなし |
| 1-2 | https://one-carat.com/campus/archives/category/streamer-tips/pococha-rank-border | GET | 未実行 | 最初の403で中止 | 未送信 |
| 1-3 | 最新の13・22・24時締め記事 | GET | 未実行 | URL未取得 | 未送信 |
| 2 | /api/borders/source-urls | POST | 未実行 | 前提を満たさず | 未送信 |

この403の発生層は未確定。Sites・アプリ・実行環境の通信制限のいずれかと断定しない。
403を再試行・別経路取得で回避しない。
catalog/publication/v1の現在の実値は未取得。10/21当時の実値も不明。
公開設定サービスはR2の同一キーを現在値・revision・updatedAtで上書きする実装で、確認した処理には履歴保存がなかった。available:true、初期値、現在値を当時のenabledの証拠にしない。

### ソース上の403発生箇所（Code確認、取得コミット3c0e6c8）
| 経路 | 対象 | 403条件 | 応答 |
| --- | --- | --- | --- |
| A Sites基盤 | 全リクエスト | owner-private配信前認証など。ソース外で条件未確認 | 基盤依存 |
| B catalogGate（lib/catalog-gate.mjs） | 全メソッド | 所有者ヘッダー不一致かつ一覧サービスがenabled:false（到達不可・形式不正は503） | JSON `このツールは現在非公開です。` |
| C origin判定（build/sites-worker.ts） | POST | 配信originがBORDER_WRITER_ORIGIN（既定は本番origin）と違う | JSON `Production writer origin required` |
| D Originヘッダー（lib/border-store.mjs） | POST | Originヘッダーがあり自身のoriginと違う | JSON `Origin rejected` |
| E 署名ヘッダー形式（lib/border-writer-auth.mjs） | POST | キー形式不正・時刻が-60〜+300秒の範囲外・署名形式不正 | JSON `Border writer authorization required` |
| F HMAC検証 | POST | 本文SHA-256を含むHMACが不一致 | 同上 |
| G 取得元 | ONECARATへのGET | 取得元が拒否 | 取得元依存 |

- 流量制限・再送防止・サイズ超過は429・409・413・408・503で、403を返さない。
- アプリ（B〜F）の403はすべて`application/json`の応答。上の手順1-1の403は`text/plain`でJSON errorがないため、B〜Fのアプリ応答とは形式が一致しない。アプリより手前の層（Sites基盤、または診断した実行環境の通信制限）である可能性が高い。ただし、層は確定していない。
- 同じGETをユーザーPC上のCodeから実行した結果は200（2026/11/06）。実行環境によって結果が違う。
- 10/21の定期タスクの403がどれに当たるかは、記録が要約だけのため未特定。

## 自動取得の既存構成
1. GET /api/borders/source-urls で取得元一覧URLを得る。
2. ONECARATの通常の公開HTMLを取得。
3. 署名付きPOST /api/borders/source-urls に {indexHTML} を送って記事URLを調べる。
4. 返された正規URLのHTMLを取得。
5. 署名付きPOST /api/borders/refresh に {articles:[{url,html}]} を送る。
6. GET /api/borders でsync.last_attempt、sync.last_success、sync.status、締め時間別最新日付・保存値を確認。

3はボーダーを保存しない。ソース（lib/border-store.mjs）では再送防止の記録（claimSignedWrite）は5のrefreshでだけ書き込まれ、3ではDBへの書き込みはない（2026/11/06 Codeのテストで確認）。ただし署名付き操作なので、読み取りモードには含めない。
5は本番保存。新しい実行は別途明示承認が必要。
サーバー側の日付・締め時間・18ランクの検証、書き込み権限、重複防止を維持する。
元記事の更新日時をデータ日付と扱わない。欠損は0・他の締め時間・推測値で補完しない。
現在の取得処理で過去欠損を回収できないことと、他の検証可能な資料も含め永久に復元不能であることを区別する。今回バックフィルは行わない。

## 移行前に解決する2点
### 実行場所
「Code」は開発・操作環境であり、常時稼働の実行場所とは別。
PCのタスクスケジューラなら電源OFFやスリープで実行できない場合がある。
クラウドでの定期実行は費用・権限・秘密値の保存先を含めて決める必要がある。
今回どのスケジューラも設定・有効化しない。05:00と09:00も勝手に確定しない。
実行時刻と掲載時刻を混同せず、クラウドの時刻指定を使う場合はJSTとUTCを確認する。

### 認証と秘密値
GitHubの書き込み権限、Sitesのデプロイ権限、ボーダーAPIの署名権限は別。
GitHubへpushできてもSites更新やAPI保存はできるとは限らない。
現行タスクはChatGPT Sites接続から得るサービス資格を利用する設計だが、その資格をCodeへ転送・複製してよいことを意味しない。
トークン、BORDER_WRITER_KEY、導出キー、署名、Cookie、Authorizationの値を表示・ファイル保存・Gitコミット・共有しない。秘密値をユーザーに貼り付けさせない。
新しい実行先への秘密値の永続配置や新しい認証方式は今回未承認。既存環境変数の実値を取得せず、設定名・必要条件・不足権限だけ整理する。
署名アルゴリズム、本文のUTF-8バイト列、区切り文字のエスケープはlib/border-writer-auth.mjsとtests/border-write-auth.mjsを照合する。READMEの表現だけで改行やバックスラッシュを決めない。
期限切れの署名を再利用しない。認証・Origin制限・catalog gateを弱めない。

## Codeで次に準備する実装
アプリソースとローカル候補の差分を保全してから、ネットワークを使わない検証用コードを準備する。
- 入出力とHTTPクライアントを分離し、保存済みテストfixtureだけで検証する。
- 既定モードはネットワークなし・本番書き込みなし。
- 読み取り診断、nonceを書き込むURL発見POST、本番保存POSTを別操作にする。
- 本番保存とスケジュール有効化を、通常のテスト・ビルド・pushから起動しない。
- 403は再試行せず終了。アクセス制限回避のUA偽装、プロキシ、別経路取得は禁止。
- 接続先の許可リスト、タイムアウト、サイズ制限、同時実行防止を設ける。リダイレクト先へ認証情報を転送しない。
- エラーで従来の有効値を消さない。手入力目標・利用者データを変更しない。
- 同日・同締めの再実行を重複データにしない。
- 成功はPOSTのHTTP200だけで判断せず、GETの保存内容・同期状態を照合する。
- ログは日時、実行環境、手順、URL、メソッド、ステータス、Content-Type、サニタイズ済みerror、指定3ヘッダーの有無、締め時間別データ日を記録する。
- ヘッダー値やリクエスト全体、HTML全文、環境変数、例外に含まれる秘密値をログしない。errorに秘密値が混ざる場合はマスクする。
- ログの保管先・保持期間・通知先を決めるまでは外部通知やアップロードをしない。
- 403停止、非JSON応答、認証未設定、日付・ランク不正、保存失敗、部分欠損、二重起動を意味のあるテストで検証する。
- README、実装、設定例、引継ぎの時刻・手順を最終的に一致させる。

### Code側で実装済み（2026/11/06、通信なしのテストのみ）
- `automation/border-writer-client.mjs`：既存APIの書き込みクライアント。`automation/run-border-writer.mjs`：CLI。
- モード：`plan`（既定・通信なし）／`diagnose`（GETのみ）／`discover`（＋署名付きURL判定POST）／`refresh`（＋本番保存POST＋GET照合）。
- `refresh`は`--confirm-production-write`がないと通信前に停止。キーは環境変数`BORDER_WRITER_KEY`からだけ読む。形式が不正なら通信前に停止。CIでは`plan`以外を拒否。
- 403は即停止し、再試行しない。応答の形式から経路の候補（A／B／C／D／E・F／G）を記録する。GETだけは5xxと通信エラーのときに1回再試行する。POSTは再試行しない。
- 接続先はサイトのoriginとone-carat.comに限定。リダイレクトは拒否。タイムアウトは15秒、サイズ上限は3.6MB。ロックファイルで二重起動を防止（10分で失効）。
- ログに記録するのは、日時・手順・URL（クエリなし）・メソッド・ステータス・Content-Type・サニタイズ済みerror・3ヘッダーの有無だけ。キーと署名の値、64桁16進は記録しない。
- 成功の判定は、GET /api/borders で last_attempt・status・送信した日の値が一致することまで確認して行う。
- テスト：`tests/automation-border-client.mjs` 16件。本物のborderApiとインメモリSQLiteを使う。Node 22.23.4 で3回連続全件成功。
- 既存テスト：border-write-auth、history-search、border-source-regressions、border-read-cache、daily-borders は成功。calculation-engine、items-core-input、border-reliability-regressions は依存（next）が未インストールのため起動できず（依存インストールは未実施）。
- 同じ秒に同じ本文で署名した refresh は、サーバーが再送として409で拒否する（テストで確認）。

### 実行場所・認証経路・不足権限（整理）
| 項目 | 現状 | 不足・要判断 |
| --- | --- | --- |
| 実行場所 | 未決定。候補は、ユーザーPC（タスクスケジューラ）／GitHub Actions／その他クラウド | PCは電源・スリープ時に欠損。Actionsは公開リポジトリのため秘密値をSecretsに置く判断と、実行環境からの403の有無の確認が必要 |
| サイトへの到達 | ユーザーPCからのGETは200。ChatGPT実行環境からのGETは403（text/plain） | 選んだ実行場所から diagnose を1回実行して確認する（要承認） |
| 取得元への到達 | ユーザーPCからは200 | 実行場所ごとに未確認 |
| 署名キー | 本番のBORDER_WRITER_KEYは、ChatGPTのSites接続トークンから導出した値 | Code側には値も導出元もない。同じ値を移すのか、新しいキーを設定してChatGPT側の導出をやめるのか（キー変更）を決める必要がある。どちらもSitesの環境変数を扱う権限が必要で、ChatGPT側の操作になる |
| BORDER_WRITER_ORIGIN | 既定は本番origin | 変更不要（POSTの宛先は本番originのまま） |
| Sitesへのデプロイ | Code側には権限なし | 書き込みクライアントだけならデプロイは不要（サーバーは変更していない） |
| GitHub | ユーザーPCのghでYoshi2026sとして認証済み。(root)へpush可（保護なし） | Actionsで定期実行するなら、Secretsの登録とSites到達の確認が必要 |

CI（2026/11/06、run 42236514700）：自動取得クライアントの手順は16/16成功。既存の計算テストの手順は、依存（next）が未インストールのため失敗が続いている（取り込み時点からの既存の状態）。

## 承認が必要な運用開始段階
準備とローカルテスト後、実行場所、時刻、認証の提供方法、送信先、費用、復旧方法を具体的に示す。
ユーザーの明示承認後にだけ、保留中の実通信診断を再実施する。
承認された順序でURL発見POST、本番refreshの手動1回、GET照合へ進む。
成功確認後も、新しいCode側のスケジュールを有効にする前に承認を得る。
旧ChatGPTタスクは無効を維持し、二重更新を防ぐ。削除も勝手に行わない。

## 完了条件
- ソース移管・依存セットアップ・テスト結果を実測で確認。
- 実行環境・取得元・認証経路と403の扱いが明確。
- ユーザーが実行場所と時刻・認証方法を承認。
- 承認済み手動保存とGET照合が成功。
- 旧タスク無効と新タスク設定を個別確認。
- 定期実行の設定成功と、初回実行・保存成功を区別して報告。
今回の引継ぎ文書作成は、これらの完了を意味しない。
