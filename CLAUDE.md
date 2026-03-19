# ambient-agent

Gmail・Google Calendar・Notion・Telegram を連携し、タスク抽出と日次ブリーフィングを自動化するエージェント。

## 開発コマンド

```bash
# ビルド・起動
docker compose build
docker compose up -d

# ログ確認
docker compose logs -f

# 再起動
docker compose down && docker compose up -d
```

## 構成

- **スケジューラ:** APScheduler（BlockingScheduler）
- **Telegram:** ロングポーリング（daemon スレッド）でリアルタイム受信
- **実行環境:** Docker コンテナ（root で動作）
- **cron で稼働時間管理:** 07:55 起動 / 20:00 停止

## 主要ファイル

| ファイル | 役割 |
|---|---|
| `agent/main.py` | スケジューラ・ジョブ登録 |
| `agent/calendar_handler.py` | 日次ブリーフィング・タスクリマインド |
| `agent/claude_agent.py` | Claude API ラッパー |
| `agent/gmail_handler.py` | Gmail → タスク抽出 |
| `agent/notion_handler.py` | Notion 読み書き |
| `agent/telegram_handler.py` | Telegram コマンド処理・ロングポーリング |
| `agent/telegram_notifier.py` | Telegram 送信 |
| `agent/usage_tracker.py` | API コスト記録・レポート |

## 注意事項

- **`start.sh` は使わない。** Docker がメインの実行環境。`start.sh` はホスト上で手動デバッグするときのみ使用。
- コード変更後は必ず `docker compose build && docker compose up -d` で反映する。
- `data/` ディレクトリ（`token.json`, `credentials.json`）は Git 管理外。本番環境のファイルを誤って削除しないこと。
- Notion API は `data_sources.query` を使う（`databases/{id}/query` はフォールバック）。
