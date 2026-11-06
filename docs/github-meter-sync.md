# メーター更新候補と公開

公開先: https://pococha2026.github.io/poco-meter/
本人専用の未公開一覧: https://pococha2026-preview.freefreelife2000.chatgpt.site/

2026年10月10日から旧定期・手動workflowによる自動公開は停止しています。
公開Sitesのgithub-meter-release.jsonから自動コピーする手順は廃止しました。

scripts/prepare-github-meter.mjs が計算画面、算出方法、SW、manifest、3サイズのアイコンの7ファイルを生成します。
これらを private hub の scripts/create-candidate.mjs で meter 候補JSONとしてまとめて登録します。
登録だけでは公開しません。元の公開Sitesにも候補を先にデプロイしません。
所有者が一覧のmeter「公開版へ同期」を押した時だけ、固定候補の元bytes一式をGitHubへ反映します。

既存の計算・端末保存キー・出力・レイアウトを維持します。
動的ボーダーは従来のSites APIのGETを利用し、問い合わせは既存のSites窓口へリンクします。
個人データ・管理情報・問い合わせ・認証情報を候補へ含めません。

github-sync/ に残る旧同期コードは履歴用です。workflowのjobはskip状態を維持してください。
公開接続が未設定なら未実行と明記します。旧同期へのフォールバックはしません。
