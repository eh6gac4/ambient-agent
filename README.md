# Ambient Agent

Gmail・Google Calendar・Notion・Telegram を連携し、タスク抽出と日次ブリーフィングを自動化するエージェント。

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

| プロパティ名 | 種別 | 備考 |
|---|---|---|
| タイトル | タイトル | |
| Due | 日付 | |
| Priority | セレクト | high / medium / low |
| Status | ステータス | 未着手 / 完了 |
| Source | テキスト | Gmail / Telegram など |
| SourceURL | URL | メール元タスクの Gmail リンク |

### 3. 環境変数

```bash
cp .env.example .env
# .env を編集
```

### 4. 初回認証（一度だけ実行）

```bash
pip install -r requirements.txt
mkdir -p data
python -c "from agent.google_auth import get_credentials; get_credentials()"
# ポート 9999 で HTTP サーバーが起動する
# スマホブラウザで http://<このPCのIP>:9999 を開いて Google 認証
# 表示されたコードをターミナルに入力 → data/token.json が生成される
```

### 5. Docker で起動

```bash
docker compose up -d
docker compose logs -f
```

## スケジュール

### システム稼働（cron）

| タイミング | 動作 |
|---|---|
| reboot 時 | `docker compose up -d` で自動起動 |
| 5分毎 | watchdog でコンテナ死活監視（停止時に Telegram 通知） |
| 毎週月曜 10:00 | `/simplify` でリファクタリングを実行し結果を Telegram に送信 |

サービスは **24時間365日稼働**。コストのかかる Claude API 呼び出しのみ 08:00〜21:00 JST に制限。

### 定期ジョブ（APScheduler）

| 時刻 / 間隔 | ジョブ | 詳細 |
|---|---|---|
| 07:55 | Gmail メール処理 | 未読メールを要約・タスク抽出。新規スレッド → Notion に登録。返信スレッド → 既存タスクにチェックリスト追記・優先度昇格・期限前倒し。タスクなし → アーカイブ。結果を Telegram に通知 |
| 07:57 | カレンダー同期 | 完了済みタスクのイベントを削除 → 未着手タスク（due あり・未同期）を Google Calendar に登録 |
| 07:58 | 優先度昇格 | 期限3日以内の medium タスクを high に昇格し Telegram に通知 |
| 08:00 | 日次ブリーフィング | 当日の Google Calendar イベント・Notion 未着手タスク・期限切れタスクを Claude で要約し Telegram に送信 |
| 08:05 | API コストレポート | 前日分の Claude API 利用コストを Telegram に送信 |
| 13:00 | タスクリマインド | Notion の未着手タスク一覧を Telegram に送信 |

## Telegram コマンド

| コマンド | 動作 |
|---|---|
| `/help` | コマンド一覧を表示 |
| `/tasks` | 未着手タスク一覧（期限でグループ化） |
| `/done <番号>` | タスクを完了にする |
| `/add <タスク名>` | タスクを追加する |
| `/due <番号> <日付>` | タスクの期限を変更する（例: `/due 3 2026-03-25`） |
| `/briefing` | 日次ブリーフィングを今すぐ実行 |
| URL 送信 | ページ内容を取得してタスクを抽出し Notion に登録 |
| テキスト送信 | Claude でタスク抽出して Notion に登録 |
| 転送メッセージ | 同上 |

## ファイル構成

```
ambient-agent/
├── docker-compose.yml
├── Dockerfile
├── requirements.txt
├── .env.example
├── data/                    # token.json, credentials.json（Git 管理外）
├── agent/
│   ├── main.py              # スケジューラ・ジョブ登録
│   ├── config.py            # 定数・環境変数（JST・稼働時間など）
│   ├── claude_agent.py      # Claude API ラッパー
│   ├── google_auth.py       # OAuth 共通
│   ├── gmail_handler.py     # Gmail 未読処理（要約・タスク抽出・アーカイブ）
│   ├── google_calendar.py   # Google Calendar 書き込み・タスク同期
│   ├── calendar_handler.py  # ブリーフィング・リマインド
│   ├── notion_handler.py    # Notion 読み書き
│   ├── task_formatter.py    # タスク一覧フォーマット共通ユーティリティ
│   ├── telegram_handler.py  # Telegram コマンド・ロングポーリング
│   ├── telegram_notifier.py # Telegram 送信
│   └── usage_tracker.py     # API コスト記録・レポート
├── prompts/
│   ├── extract_tasks.md     # タスク抽出プロンプト（URL・Telegram用）
│   └── analyze_email.md     # メール要約＋タスク抽出プロンプト
├── scripts/
│   ├── watchdog.py          # コンテナ死活監視
│   └── run_simplify.py      # 週次リファクタリング実行・Telegram 通知
└── tests/                   # pytest ユニットテスト
```
