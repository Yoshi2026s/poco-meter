# Claude Codeへのソース移管案内

2026/11/06にSitesの正規ソースリポジトリから取得。
取得コミット：3c0e6c8190a02217db3c8a6c8ff8ef180d83e4f7
対象GitHub：https://github.com/Yoshi2026s/poco-meter
現行Sites：https://poco-meter.freefreelife2000.chatgpt.site/

このZIPには取得時点の追跡対象358ファイルをそのまま格納。Git履歴、依存インストール、実行環境、認証トークン、環境変数の実値、本番DB・R2の内容は含まない。db/内のJSONは元ソースの追跡対象ファイルであり、本番DBの最新ダンプではない。ファイルごとのSHA-256はSOURCE_MANIFEST.jsonを参照。

GitHubリポジトリのルートへ取り込む際、既存CLAUDE.md、AGENTS.md、README.md、docs/HANDOVER.mdは上書きしない。ZIP内の旧AGENTS.mdとREADME.mdは資料として比較し、旧名義の公開先・古い同期指示は実行しない。他の既存ファイルにも差分がある場合は確認する。GitHub公開前にはソース内の設定・個人情報・埋め込み値を確認すること。このZIPの作成は公開リポジトリへの全ソース公開を意味しない。

公開版v2026.10.23.3の締め時間別計算とAPI値の一致、ボーダー同期の10/19からの停止は、ユーザーが転記したClaude Codeの検証結果。当方で今回追試した結果ではない。調査優先順位はデータ更新停止の原因確認へ見直す。欠損期間の空欄を0や他の締め時間の値で埋めない。

SitesとGitHubは別のリポジトリ。GitHubへのpushでSitesが自動更新されるとは限らない。ChatGPTのSites接続資格はClaude Codeへ付与していない。ZIP内.openai/hosting.jsonは対象識別とDB/R2バインディング名だけで、公開権限ではない。Sites短期認証トークン・BORDER_WRITER_KEYは要求・共有・コミットしない。Sites公開や本番操作が必要なら、当該接続を使えるChatGPT側で別途実行する。

依存環境：package.jsonのenginesとpackageManager、pnpm-lock.yaml、既存スクリプトを確認。テストtests/cutoff-reference-target.mjsは今回、next/dist/compiled/acornが未インストールのため起動できなかった。テスト成功・ビルド成功・公開版との一致は未確認。SOURCE_MANIFESTの照合のみ実施。
