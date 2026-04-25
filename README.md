# Ambient Agent

Gmail・Google Calendar・Notion・Telegram を連携し、タスク抽出と日次ブリーフィングを自動化するエージェント。

**実行環境: Cloudflare Workers（無料枠）**

## アーキテクチャ

```
[Telegram] ──webhook──▶ [Cloudflare Worker] ──▶ Notion / Gmail / Calendar / Claude
[Cron Triggers] ────────▶ [Cloudflare Worker]
                                  │
                          [D1] [KV Namespace]
                        状態管理・キャッシュ
```

| コンポーネント | 用途 |
|---|---|
| Cloudflare Workers | メイン実行環境（TypeScript） |
| Cloudflare D1 | スレッドマップ・カレンダー同期・処理済みメッセージ管理 |
| Cloudflare KV | Telegram オフセット・タスクキャッシュ・ブロックリスト |
| Cloudflare Cron Triggers | 定期ジョブのスケジューリング（4ジョブ） |

## スケジュール

### Cron ジョブ

| 時刻 (JST) | ジョブ | 内容 |
|---|---|---|
| 07:50 | morning_prep | ①ブロックリスト学習 → ②Gmail処理 → ③カレンダー同期 → ④優先度昇格 |
| 08:00 | morning_briefing | ①日次ブリーフィング → ②APIコストレポート → ③期限間近通知 |
| 13:00 | task_reminder | 未着手タスク一覧を Telegram に送信 |
| 月 09:00 | stale_tasks | 14日以上未更新タスクを通知 |

**morning_prep の詳細:**
- Gmail 未読メールを要約・タスク抽出し Notion に登録（返信スレッドは既存タスクを更新）
- 完了済みタスクのカレンダーイベントを削除、未着手タスクを Calendar に登録
- 期限3日以内の medium タスクを high に昇格

## Telegram コマンド

| コマンド | 動作 |
|---|---|
| `/help` | コマンド一覧を表示 |
| `/tasks` | 未着手タスク一覧（優先度・期限順） |
| `/done <番号>` | タスクを完了にする |
| `/skip <番号>` | タスクを中止にし、送信者をブロック |
| `/add <タスク名>` | タスクを追加する |
| `/due <番号> <日付>` | 期限を変更（例: `/due 3 2026-03-25`） |
| `/briefing` | 日次ブリーフィングを今すぐ実行 |
| `/blocklist` | ブロック中の送信者一覧 |
| `/unblock <メール>` | 送信者のブロックを解除 |
| URL 送信 | ページ内容を取得してタスクを抽出し Notion に登録 |
| テキスト・転送メッセージ送信 | Claude でタスク抽出して Notion に登録 |
| 画像送信 | Claude Vision でタスク抽出して Notion に登録 |

## Notion DB 必須プロパティ

| プロパティ名 | 種別 | 備考 |
|---|---|---|
| タイトル | タイトル | |
| Due | 日付 | |
| Priority | セレクト | high / medium / low |
| Status | ステータス | 未着手 / 完了 / 中止 など |
| Source | テキスト | Gmail / Telegram / URL など |
| SourceURL | URL | メール元タスクの Gmail リンク |

## ファイル構成

```
ambient-agent/
├── cf-worker/                    # Cloudflare Workers（本番環境）
│   ├── src/
│   │   ├── index.ts              # Worker エントリ（fetch + scheduled）
│   │   ├── types.ts              # 共通型定義
│   │   ├── clients/              # 外部 API クライアント
│   │   │   ├── anthropic.ts      # Claude API
│   │   │   ├── gcal-api.ts       # Google Calendar REST API
│   │   │   ├── gmail-api.ts      # Gmail REST API
│   │   │   ├── google-auth.ts    # OAuth2 トークンリフレッシュ
│   │   │   ├── notion.ts         # Notion API
│   │   │   └── telegram.ts       # Telegram Bot API
│   │   ├── handlers/             # ジョブ・コマンドハンドラー
│   │   │   ├── briefing.ts       # 日次ブリーフィング・コストレポート
│   │   │   ├── calendar.ts       # カレンダー同期・期限通知
│   │   │   ├── escalation.ts     # 優先度昇格・停滞タスク通知
│   │   │   ├── gmail.ts          # Gmail 処理・ブロックリスト学習
│   │   │   ├── task-formatter.ts # タスク一覧フォーマット
│   │   │   └── telegram.ts       # Webhook コマンドルーティング
│   │   └── storage/              # D1・KV アクセス層
│   │       ├── d1.ts             # D1 CRUD ヘルパー
│   │       └── kv.ts             # KV ヘルパー
│   ├── test/                     # Vitest テスト（84件）
│   ├── migrations/               # D1 スキーマ
│   ├── scripts/
│   │   ├── push-secrets.mjs      # Worker Secrets 一括登録
│   │   └── migrate-data.ts       # 既存 JSON → D1/KV 移行
│   ├── wrangler.toml             # Cloudflare 設定（D1・KV・Cron）
│   └── .env.local.example        # 環境変数テンプレート
├── agent/                        # Python 実装（旧・参照用）
├── prompts/
│   ├── extract_tasks.md          # タスク抽出プロンプト
│   └── analyze_email.md          # メール要約プロンプト
└── .github/workflows/
    └── deploy.yml                # master マージ時に自動デプロイ
```

## セットアップ

### 前提条件

- Cloudflare アカウント（無料）
- Node.js 18+
- wrangler CLI: `npm install -g wrangler`

### 1. Cloudflare リソース作成

```bash
cd cf-worker
cp .env.local.example .env.local
# .env.local に CLOUDFLARE_API_TOKEN・CLOUDFLARE_ACCOUNT_ID を記入

npm install
npm run d1 -- create ambient-agent-db
npm run kv -- namespace create AGENT_KV
# 出力された ID を wrangler.toml の該当箇所に設定

npm run d1 -- execute ambient-agent-db --remote --file=migrations/0001_initial.sql
```

### 2. Google OAuth 認証情報の取得

1. [Google Cloud Console](https://console.cloud.google.com/) で Gmail API・Calendar API を有効化
2. OAuth 2.0 クライアント ID（デスクトップアプリ）を作成
3. ローカルで初回認証を実行して `data/token.json` を生成:

```bash
pip install -r requirements.txt
python -c "from agent.google_auth import get_credentials; get_credentials()"
```

### 3. Notion インテグレーション

1. [Notion Integrations](https://www.notion.so/my-integrations) でインテグレーション作成
2. タスク DB を作成し、インテグレーションを DB に接続
3. DB の URL から ID（32桁）を取得

### 4. Worker Secrets の登録

`.env.local` にすべての値を記入後:

```bash
npm run secrets:push
```

| Secret | 取得先 |
|---|---|
| `ANTHROPIC_API_KEY` | [Anthropic Console](https://console.anthropic.com/settings/keys) |
| `NOTION_TOKEN` | Notion インテグレーションの Internal Secret |
| `NOTION_TASKS_DB_ID` | タスク DB の URL 末尾 32 文字 |
| `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | `getUpdates` API の `chat.id` |
| `GOOGLE_CLIENT_ID` | Google Cloud Console → 認証情報 |
| `GOOGLE_CLIENT_SECRET` | 同上 |
| `GOOGLE_REFRESH_TOKEN` | `data/token.json` の `refresh_token` |

### 5. デプロイ & Webhook 登録

```bash
npm run deploy

# Telegram Webhook を登録
curl -X POST "https://api.telegram.org/bot{TOKEN}/setWebhook" \
  -d "url=https://ambient-agent.{YOUR_SUBDOMAIN}.workers.dev/webhook"
```

## CI/CD

`master` ブランチへのマージ時に `cf-worker/` 以下の変更が検出されると、GitHub Actions が自動でテスト・デプロイを実行します。

必要な GitHub Secrets: `CLOUDFLARE_API_TOKEN`・`CLOUDFLARE_ACCOUNT_ID`

## 開発

```bash
cd cf-worker

# テスト
npm test

# ローカル開発サーバー
npm run dev

# ログ監視（デプロイ済み Worker）
npx dotenv -e .env.local -- wrangler tail --format=pretty
```
