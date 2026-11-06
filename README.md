# ポコメーター番長

Pocochaの目標メーター計算・過去ボーダー管理ツールの開発引継ぎリポジトリです。

- 現行Sites：https://poco-meter.freefreelife2000.chatgpt.site/
- 開発先：このリポジトリ（Yoshi2026s/poco-meter）
- 開発環境：Claude Code
- [引継ぎ資料](docs/HANDOVER.md)
- [開発指示](AGENTS.md)
- [自動取得のCode移行引継ぎ](docs/AUTOMATION_CODE_HANDOVER.md)

## 現在の状態

2026/11/06に旧オフライン配布版の案内から、ポコメーター番長専用の開発資料へ変更しました。
このリポジトリには、アプリ本体・依存設定・ビルド／テスト環境はまだありません。
Sitesの編集元ソースの移管と、現行公開版との照合が必要です。現行アプリの完全な複製として扱わないでください。

リポジトリは公開されています。秘密情報、認証トークン、利用者データ、アクセスログはコミットしないでください。
GitHub Pagesは今回の確認時点で未設定です。資料更新によるSitesの自動更新はありません。

## Claude Codeで開始する

```bash
git clone https://github.com/Yoshi2026s/poco-meter.git poco-meter
cd poco-meter
claude
```

Claude Codeへの最初の指示：

> CLAUDE.mdとdocs/AUTOMATION_CODE_HANDOVER.mdを読み、PC側の移管候補を保全しながら、ボーダー自動取得をCodeへ移す準備をしてください。実行場所・認証経路を整理し、ネットワークなしのテストまで進めてください。タスク再開・キー変更・本番保存・新規スケジュール有効化はしないでください。

## 履歴

旧ツールの案内はGit履歴に残っています。旧移転案内を現在の公開・同期先として使用しないでください。
