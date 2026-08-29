# ambient-agent — Claude 向けガイド

## 基本コマンド

```bash
# cf-worker のデプロイ
cd cf-worker && npx wrangler deploy

# cf-worker のログ確認
cd cf-worker && npx wrangler tail
```

## 本番状態のデバッグ（read-only）

```bash
# ジオフェンス定義・状態（KV）
npx wrangler kv key get geofence:regions --binding=AGENT_KV --remote
npx wrangler kv key get geofence:state:home --binding=AGENT_KV --remote

# タスクストア（D1: binding=TASKS_DB, database=notion-tasks）
npx wrangler d1 execute notion-tasks --remote --json \
  --command "SELECT id, title, status, priority, due FROM tasks WHERE status IN ('未着手','進行中') ORDER BY due LIMIT 20;"

# 位置履歴（D1: binding=AGENT_DB, table=location_history）
npx wrangler d1 execute AGENT_DB --remote --json \
  --command "SELECT datetime(tst,'unixepoch','+9 hours') jst, lat, lon FROM location_history ORDER BY tst DESC LIMIT 20;"

# Worker ログ（observability 有効。event=geofence_transition / notification_trigger）
npx wrangler tail
```

## Git ルール

- コード変更後はブランチを切り、PR を作成して master にマージする。
- ブランチ名の例: `feat/xxx`、`fix/xxx`、`docs/xxx`
- master への直接 push はしない。
- コミット前に全テストをパスさせる: `cd cf-worker && npm test`

## 開発フロー

`cf-worker/` 配下のコード変更を伴う機能開発では、dev 環境（`npm run dev` + `npm run tunnel:dev`）を **Claude が自動で起動・停止する**。ユーザーは手動でコマンドを叩かない。

- **起動タイミング**: `cf-worker/src/`・`cf-worker/test/`・`cf-worker/wrangler.toml` 等を変更する feat/fix ブランチに着手する直前に、バックグラウンドで両プロセスを起動する
  - ターミナル1: `cd cf-worker && npm run dev`
  - ターミナル2: `cd cf-worker && npm run tunnel:dev`
- **停止タイミング**: 対応 PR がマージされたタイミングで両プロセスを `TaskStop` で停止する
- **対象外**: ドキュメントのみの変更、`cf-worker/` 外の変更、READ-ONLY な調査タスクでは起動不要
- 既に起動中なら再起動しない（バックグラウンド task ID をセッション内で管理）
- ユーザーが「起動しないで」と明示した場合は従う
- dev URL は固定: `https://dev-bot.eh6gac4.work`（再登録不要）

詳細手順は `README.md`「ローカル dev 環境」を参照。

## 重要な注意事項

- **メインの実行環境は Cloudflare Workers（`cf-worker/`）。** Docker は使用しない。
- **`data/` を削除しない。** `token.json`・`credentials.json` は Git 管理外で、消えると再認証が必要になる。
- **タスクの登録先は notion-tasks と共有する D1（`TASKS_DB` = データベース `notion-tasks`）。** 実装は `cf-worker/src/clients/tasks.ts`。Notion API は使わない。
- **タスクのスキーマの正は notion-tasks リポジトリの `migrations/0001_init.sql`。** 向こうが変わったら `clients/tasks.ts` と `test/helpers/task-store.ts` の DDL を追従させる。
- **テスト等で日本時間（JST）の日付文字列を生成する際**は `new Date().toISOString()` を避け、`Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo" })` を使用する（実行環境のタイムゾーン差異によるバグを防ぐため）。

## ドキュメント更新ルール

コードを変更したら、影響する箇所を README.md に反映する。

| 変更内容 | 更新箇所 |
|---|---|
| ジョブの追加・削除・時刻変更 | スケジュール表 |
| Telegram コマンドの追加・変更 | Telegram コマンド表 |
| ファイルの追加・削除 | ファイル構成 |
| Notion DB プロパティの変更 | Notion DB 必須プロパティ表 |

## アーキテクチャ

- Cloudflare Workers でジョブ管理（`cf-worker/src/index.ts`）
- Telegram は Webhook でリアルタイム受信
- サービスは **24時間365日稼働**。Claude API 呼び出しのみ `OPERATING_START_HOUR`〜`OPERATING_END_HOUR`（デフォルト 08:00〜21:00 JST）に制限
