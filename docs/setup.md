# セットアップ記録

## セットアップ完了（2026-03-19）

| 項目 | 状態 |
|---|---|
| `ANTHROPIC_API_KEY` | 設定済み |
| `TELEGRAM_BOT_TOKEN` | 設定済み |
| `TELEGRAM_CHAT_ID` | 設定済み |
| `NOTION_TOKEN` | 設定済み |
| `NOTION_TASKS_DB_ID` | 設定済み |
| `data/credentials.json` | 配置済み（Google OAuth） |
| `data/token.json` | 認証済み（Gmail + Calendar スコープ） |
| Notion Integration 共有 | 完了（Integration をデータベースにコネクト済み） |
| GitHub リポジトリ | push済み |

## 動作確認結果

| 機能 | 結果 |
|---|---|
| Telegram 通知 | ✅ 送信成功 |
| Google Calendar 取得 | ✅ 正常 |
| Gmail → Claude → Notion タスク登録 | ✅ 正常（未読20件処理、5タスク登録） |

## 運用設定

- **起動スクリプト:** `start.sh`（PIDファイルで二重起動防止）
- **自動起動:** `@reboot` cron で登録済み
- **ログ:** `data/agent.log`
- **スケジュール:** Gmail確認15分毎 / 日次ブリーフィング毎朝8時 (Telegram)
- **停止方法:** `kill $(cat /tmp/ambient-agent.pid)`
