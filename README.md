# Ambient Agent

Gmail・Google Calendar・Notion・Telegram を連携し、タスク抽出と日次ブリーフィングを自動化するエージェント。

**実行環境: Cloudflare Workers（無料枠）**

## アーキテクチャ

```
[Telegram] ──webhook──▶ [Cloudflare Worker] ──▶ Notion / Gmail / Calendar / Gemini
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
| Cloudflare Cron Triggers | 定期ジョブのスケジューリング（5ジョブ） |

## HTTP エンドポイント

| メソッド・パス | 用途 | 認証 |
|---|---|---|
| `POST /webhook` | Telegram Update 受信（コマンド・メッセージ） | Telegram |
| `GET /home-arrival` | iPhone ショートカット（帰宅 Wi-Fi 接続時）から呼び出し、Notion オープンタスクを Gemini が選定して Telegram 通知 | `Authorization: Bearer <ALERT_TOKEN>` |
| `GET /office-leave` | iPhone ショートカット（会社 Wi-Fi 切断時）から呼び出し、帰宅途中・翌朝に向けたタスクを Gemini が選定して Telegram 通知 | `Authorization: Bearer <ALERT_TOKEN>` |
| `POST /owntracks` | OwnTracks アプリ → マネージド MQTT(EMQX Cloud 等) → Webhook 経由で位置情報を受信。サーバー側ジオフェンス判定を行い、任意の場所への出入りに応じてアクションを実行 | `Authorization: Bearer <OWNTRACKS_TOKEN>` |

## スケジュール

### Cron ジョブ

| 時刻 (JST) | ジョブ | 内容 | 休日スキップ |
|---|---|---|---|
| 07:30〜21:30 毎時 | hourly_gmail | Gmail 未読を少しずつサイレント処理（通知せず KV に蓄積） + カレンダー同期 | なし（バックグラウンド処理のため） |
| 07:50 | morning_prep | ①ブロックリスト学習 → ②カレンダー同期 → ③バックログ昇格 → ④優先度昇格 | あり |
| 08:00 | morning_briefing | ①日次ブリーフィング → ②APIコストレポート → ③期限間近通知 → ④メール処理サマリ | あり |
| 月 09:00 | stale_tasks | 14日以上未更新タスクを通知 | あり |

> **休日スキップ**: 土日および日本の祝日（`holidays-jp.github.io` API 参照）は通知系ジョブを実行しない。帰宅通知（`/home-arrival`）・退社通知（`/office-leave`）も同様にスキップ。

**hourly_gmail の詳細:**
- 未読メールを要約・タスク抽出し Notion に登録（返信スレッドは既存タスクを更新）
- Notion ページのタイトルは Gemini が生成する「誰から何の用件か分かる短文」を使う（メール件名そのままは避ける）
- Telegram 通知はせず、結果を `email_digest:pending` (KV) に追記
- Workers の subrequest 上限（無料プラン 50/呼び出し）に達したら break、未処理分は次回 cron に持ち越し
- 個別メール処理エラーは log して続行
- メール処理後に `syncCalendar` を実行し、Notion で編集された日時を Google Calendar へ伝播（既存イベントは PATCH で日時のみ差し替え）

**morning_prep の詳細:**
- ブロックリスト学習: `sender_map` を走査し、ステータスが「中止」のタスクの送信者を `no_task_senders` (KV) に追加。完了済みは `sender_map` から外すだけ
- カレンダー同期: 完了済みタスクのカレンダーイベントを削除、未着手タスクを Calendar に登録
- バックログ昇格: 期限3日以内（過去 due 含む）の「バックログ」ステータスのタスクを「未着手」に昇格。Due 未設定のバックログは対象外
- 優先度昇格: 期限3日以内の medium タスクを high に昇格

**カレンダー登録のタイミング:**
- 期日付きタスクは作成時（Gmail / Telegram テキスト・画像・URL）に即座に Calendar へ登録（同日時刻指定タスクの取りこぼし防止）
- 返信メールで Due が前倒しされたときも、その場で Calendar イベントを差し替える
- hourly_gmail / morning_prep の同期は補完用。重複防止は D1 `calendar_sync` で行い、dedup キーは「期日時刻」単位（同一日付で時刻だけ変わっても反映）
- 既存イベントの日時変更は PATCH で行い、Calendar 側に追加されたメモや出席者を保持する

**morning_briefing の詳細:**
- 直近 24 時間に hourly_gmail が処理したメールをまとめて1通の「📧 メール処理サマリ」として Telegram 送信（タスク登録は件数のみ＋ダッシュボードリンク、アーカイブは件名一覧）

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
| テキスト・転送メッセージ送信 | Gemini でタスク抽出して Notion に登録 |
| 画像送信 | Gemini Vision で要約・タスク抽出 → 親タスクを Notion 登録、各アクションは Notion DB のサブアイテムとして個別登録、画像をページ本文に添付 |

## Notion DB 必須プロパティ

| プロパティ名 | 種別 | 備考 |
|---|---|---|
| タイトル | タイトル | |
| Due | 日付 | |
| Priority | セレクト | high / medium / low |
| Status | ステータス | 未着手 / 完了 / 中止 / バックログ など |
| Source | テキスト | Gmail / Telegram / URL など |
| SourceURL | URL | メール元タスクの Gmail リンク |
| 親アイテム | リレーション（同DB・自己） | Notion の「サブアイテム」機能で自動生成される双方向リレーション。プロパティ名が異なる場合は環境変数 `NOTION_SUBITEM_PARENT_PROP` で上書き可能 |

**サブタスク化:** メール／画像からタスクを生成する際、Gemini が抽出した各アクションは親ページ本文内のチェックボックスではなく **DB のサブアイテム（独立した子ページ）** として作成され、それぞれ Due / Priority / アイコンを個別に持つ。親ページはメール件名・本文を保持。

## ファイル構成

```
ambient-agent/
├── cf-worker/                    # Cloudflare Workers（本番環境）
│   ├── src/
│   │   ├── index.ts              # Worker エントリ（fetch + scheduled）
│   │   ├── types.ts              # 共通型定義
│   │   ├── clients/              # 外部 API クライアント
│   │   │   ├── gemini.ts      # Gemini API
│   │   │   ├── gcal-api.ts       # Google Calendar REST API
│   │   │   ├── gmail-api.ts      # Gmail REST API
│   │   │   ├── google-auth.ts    # OAuth2 トークンリフレッシュ
│   │   │   ├── notion.ts         # Notion API
│   │   │   └── telegram.ts       # Telegram Bot API
│   │   ├── handlers/             # ジョブ・コマンドハンドラー
│   │   │   ├── briefing.ts       # 日次ブリーフィング・コストレポート
│   │   │   ├── calendar.ts       # カレンダー同期・期限通知
│   │   │   ├── escalation.ts     # 優先度昇格・停滞タスク通知
│   │   │   ├── geofence-actions.ts # ジオフェンス アクション レジストリ
│   │   │   ├── gmail.ts          # Gmail 処理・ブロックリスト学習
│   │   │   ├── home-arrival.ts   # 帰宅トリガー（共通ランナーの薄いラッパ）
│   │   │   ├── location.ts       # OwnTracks 位置情報受信・ジオフェンス判定
│   │   │   ├── office-leave.ts   # 退社トリガー（共通ランナーの薄いラッパ）
│   │   │   ├── notification-trigger.ts # 帰宅/退社 共通の通知フロー
│   │   │   ├── task-formatter.ts # タスク一覧フォーマット
│   │   │   └── telegram.ts       # Webhook コマンドルーティング
│   │   ├── storage/              # D1・KV アクセス層
│   │   │   ├── d1.ts             # D1 CRUD ヘルパー
│   │   │   └── kv.ts             # KV ヘルパー
│   │   └── utils/                # 共通ユーティリティ
│   │       ├── geofence.ts       # ジオフェンス純粋関数（haversine・isInside・detectTransition）
│   │       ├── holiday.ts        # 土日・祝日判定（JST）
│   │       ├── jst.ts            # JST 日時ヘルパー（jstNow/jstDateStr/toDateStr 等）
│   │       └── task.ts           # 優先度定数・最優先タスク選択
│   ├── test/                     # Vitest テスト（221件）
│   ├── migrations/               # D1 スキーマ
│   │   ├── 0001_initial.sql      # Gmail・Calendar・タスク関連テーブル
│   │   └── 0002_location_history.sql # 位置情報履歴テーブル
│   ├── scripts/
│   │   ├── push-secrets.mjs       # Worker Secrets 一括登録
│   │   ├── setup-dev-tunnel.mjs   # dev 用 Cloudflare Named Tunnel + DNS をセットアップ
│   │   ├── run-dev-tunnel.mjs     # cloudflared を connector token で起動
│   │   ├── set-dev-webhook.mjs    # dev bot の Telegram webhook を登録/解除
│   │   └── migrate-data.ts        # 既存 JSON → D1/KV 移行
│   ├── wrangler.toml              # Cloudflare 設定（D1・KV・Cron）
│   ├── .env.local.example         # 本番デプロイ用環境変数テンプレート
│   └── .dev.vars.example          # ローカル dev 用 secrets テンプレート
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
npm run d1 -- execute ambient-agent-db --remote --file=migrations/0002_location_history.sql
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
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/app/apikey) |
| `NOTION_TOKEN` | Notion インテグレーションの Internal Secret |
| `NOTION_TASKS_DB_ID` | タスク DB の URL 末尾 32 文字 |
| `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | `getUpdates` API の `chat.id` |
| `ALERT_TOKEN` | `GET /home-arrival` / `GET /office-leave` 認証用の任意の長い乱数 |
| `OWNTRACKS_TOKEN` | `POST /owntracks` (OwnTracks Webhook) 認証用の任意の長い乱数 |
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

## OwnTracks 連携（位置ベーストリガー）

iPhone の OwnTracks アプリと EMQX Cloud（マネージド MQTT）を組み合わせ、任意の場所への
出入りに応じてアクションを実行する仕組みです。

### アーキテクチャ

```
iPhone OwnTracks ──MQTT/TLS(8883)──▶ EMQX Cloud（マネージドブローカー）
                                           │ ルールエンジン → Webhook
                                           ▼
                           POST /owntracks  (Cloudflare Worker)
                                           │
                     ┌─────────────────────┼────────────────────────┐
                     ▼                     ▼                         ▼
               D1: 位置履歴         ジオフェンス判定           遷移時フック実行
             location_history     utils/geofence.ts         geofence-actions.ts
                                  KV: geofence:state:<id>    home_arrival / office_leave /
                                                              telegram_notify ...
```

### セットアップ手順

#### 1. EMQX Cloud Serverless ブローカーを作成

1. [EMQX Cloud](https://www.emqx.com/ja/cloud) でアカウント作成 → Serverless プラン（無料枠あり）
2. MQTT ユーザー／パスワードを発行
3. **ルールエンジン** → アクション「Webhook(HTTP)」を追加:
   - SQL: `SELECT payload, topic FROM "owntracks/#"`
   - Method: POST
   - URL: `https://<worker-subdomain>.workers.dev/owntracks`
   - Header: `Authorization: Bearer <OWNTRACKS_TOKEN>`
   - Body: `${payload}`（OwnTracks の生 JSON をそのまま転送）

#### 2. OwnTracks アプリ設定（iPhone）

| 項目 | 値 |
|---|---|
| Mode | MQTT |
| Host | EMQX のブローカーホスト名 |
| Port | 8883 |
| TLS | 有効 |
| Username / Password | 上記で発行した値 |
| Topic Base | `owntracks/<ユーザー名>/<デバイス名>` |

#### 3. リージョン（場所）の設定

リージョン一覧を JSON 配列として KV に登録します。座標は git 管理外の KV に保存されます。

```bash
# スキーマ例
cat << 'EOF'
[
  {
    "id": "home",
    "lat": 35.6812,
    "lon": 139.7671,
    "radius_m": 150,
    "onEnter": "home_arrival"
  },
  {
    "id": "office",
    "lat": 35.7000,
    "lon": 139.7000,
    "radius_m": 150,
    "onLeave": "office_leave"
  },
  {
    "id": "gym",
    "lat": 35.6600,
    "lon": 139.7300,
    "radius_m": 100,
    "onEnter": { "action": "telegram_notify", "message": "🏋️ ジムに到着" },
    "onLeave": { "action": "telegram_notify", "message": "🏋️ ジムを退出" }
  }
]
EOF

# 本番 KV に投入
npx dotenv -e .env.local -- wrangler kv key put \
  --binding=AGENT_KV geofence:regions '[...]'
```

#### 4. 利用可能なアクション

| アクション ID | 説明 | パラメータ |
|---|---|---|
| `home_arrival` | 帰宅通知（既存フロー。祝日スキップ・タスク有無チェック込み） | なし |
| `office_leave` | 退社通知（既存フロー。祝日スキップ・タスク有無チェック込み） | なし |
| `telegram_notify` | 任意テキストを Telegram に送信 | `message`: 送信文字列（省略時は `{regionId} {transition}`） |

新しいアクションは `src/handlers/geofence-actions.ts` の `ACTIONS` に関数を追加するだけで利用可能。

## CI/CD

`master` ブランチへのマージ時に `cf-worker/` 以下の変更が検出されると、GitHub Actions が自動でテスト・デプロイを実行します。

必要な GitHub Secrets: `CLOUDFLARE_API_TOKEN`・`CLOUDFLARE_ACCOUNT_ID`

## 開発

```bash
cd cf-worker

# テスト
npm test

# ローカル開発サーバー（dev 環境セットアップ後）
npm run dev

# ログ監視（デプロイ済み Worker）
npx dotenv -e .env.local -- wrangler tail --format=pretty
```

### ローカル dev 環境

本番にデプロイせず、ローカルで Telegram / cron を含めた挙動を検証できる。D1・KV は wrangler dev のローカルエミュレーションで本番と完全分離。Notion は dummy（dev 専用 DB を作っても可）、Gmail / Calendar / Google は本番と同じ認証情報を流用する。

公開 URL には Cloudflare Named Tunnel（`dev-bot.eh6gac4.work`）を使い、connector token は API から都度取得するためローカル保存しない。

#### 一度だけのセットアップ

1. **dev 用 Telegram bot を作成**: [@BotFather](https://t.me/BotFather) で `/newbot` → 別名で作成し、トークンを控える
2. **cloudflared をインストール**:
   - macOS: `brew install cloudflared`
   - Linux: [公式ガイド](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
3. **`.env.local` を整備**: `CLOUDFLARE_API_TOKEN` には Account → Cloudflare Tunnel: Edit と Zone → DNS: Edit (`eh6gac4.work`) の権限を付与する
4. **`.dev.vars` を作成** (`wrangler dev` のローカル secret オーバーライド):
   ```bash
   cp .dev.vars.example .dev.vars
   # TELEGRAM_BOT_TOKEN を dev bot の値に
   # Notion は dummy のまま、Google / Google は .env.local と同じ値を入れる
   ```
5. **Tunnel + DNS をセットアップ** (idempotent):
   ```bash
   npm run tunnel:dev:setup
   # tunnel "ambient-agent-dev" を作成、DNS CNAME (dev-bot.eh6gac4.work) を作成
   ```
6. **dev bot の webhook を登録** (URL は固定なので一度だけ):
   ```bash
   npm run webhook:dev -- https://dev-bot.eh6gac4.work
   ```

#### 毎回の起動手順

```bash
# ターミナル1: dev サーバー起動
cd cf-worker
npm run dev   # http://localhost:8787 で待ち受け

# ターミナル2: cloudflared tunnel 起動
npm run tunnel:dev   # API から token 取得 → cloudflared を spawn
```

`@amby_dev_bot` にメッセージを送ると、Cloudflare edge → tunnel → ローカル Worker と流れ、ターミナル1にログが出る。Notion 関連のコマンドは dummy creds で 401 になる（想定通り）。

#### cron ジョブの手動実行

`wrangler dev --test-scheduled` 起動済みなので、以下で個別ジョブを発火できる:

```bash
# 例: 08:00 morning_briefing ジョブを実行
curl "http://localhost:8787/__scheduled?cron=0+23+*+*+*"
```

`cron` クエリは `wrangler.toml` の cron 文字列をスペース区切り → `+` 置換した値を使う。
