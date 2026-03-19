# Ambient Agent

Gmail・Google Calendar・Notion を連携し、タスク抽出と日次ブリーフィングを自動化するエージェント。

## セットアップ

### 1. Google OAuth 認証情報の取得

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクト作成
2. Gmail API・Calendar API を有効化
3. OAuth 2.0 クライアント ID（デスクトップアプリ）を作成
4. `credentials.json` をダウンロードして `data/` に配置

### 2. Notion インテグレーション

1. [Notion Integrations](https://www.notion.so/my-integrations) でインテグレーション作成
2. トークンを `.env` の `NOTION_TOKEN` に設定
3. タスク DB を作成し、インテグレーションを DB に接続
4. DB の URL から ID（32桁）を `NOTION_TASKS_DB_ID` に設定

Notion DB の必須プロパティ:
| プロパティ名 | 種別 |
|---|---|
| Name | タイトル |
| Due | 日付 |
| Priority | セレクト（high / medium / low） |
| Status | セレクト（pending / done） |
| Source | テキスト |

### 3. 環境変数

```bash
cp .env.example .env
# .env を編集
```

### 4. 初回認証（NUC上で一度だけ実行）

```bash
pip install -r requirements.txt
mkdir -p data
python -c "from agent.google_auth import get_credentials; get_credentials()"
# ブラウザが開くので認証 → data/token.json が生成される
```

### 5. Docker で起動

```bash
docker compose up -d
docker compose logs -f
```

## スケジュール

### システム稼働時間（cron）

| 時刻 | 動作 |
|---|---|
| 07:55 | Docker 起動 |
| 20:00 | Docker 停止（夜間停止） |
| reboot 時 | 自動起動 |

### 定期ジョブ（APScheduler）

| 時刻 / 間隔 | ジョブ | 詳細 |
|---|---|---|
| 08:00 | 日次ブリーフィング | 当日の Google Calendar イベント・Notion 未着手タスク・期限切れタスクを Claude で要約し Telegram に送信 |
| 08:05 | API コストレポート | 前日分の Claude API 利用コストを Telegram に送信 |
| 3時間毎 | タスクリマインド | Notion の未着手タスク一覧を Telegram に送信 |
| 15分毎 | Gmail チェック | 未読メールを取得 → Claude でタスク抽出 → Notion に登録 |

## ファイル構成

```
ambient-agent/
├── docker-compose.yml
├── Dockerfile
├── requirements.txt
├── .env.example
├── data/                  # token.json, credentials.json（Git 管理外）
├── agent/
│   ├── main.py            # スケジューラ
│   ├── claude_agent.py    # Claude API ラッパー
│   ├── google_auth.py     # OAuth 共通
│   ├── gmail_handler.py   # Gmail → タスク抽出
│   ├── calendar_handler.py # Calendar → ブリーフィング
│   └── notion_handler.py  # Notion 読み書き
└── prompts/
    └── extract_tasks.md   # タスク抽出プロンプト
```
