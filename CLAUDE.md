# ambient-agent — Claude 向けガイド

## 基本コマンド

```bash
# cf-worker のデプロイ
cd cf-worker && npx wrangler deploy

# cf-worker のログ確認
cd cf-worker && npx wrangler tail
```

## Git ルール

- コード変更後はブランチを切り、PR を作成して master にマージする。
- ブランチ名の例: `feat/xxx`、`fix/xxx`、`docs/xxx`
- master への直接 push はしない。
- コミット前に全テストをパスさせる: `pytest` または `docker compose run --rm agent pytest`

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
- **Notion API は `data_sources.query` を使う。** `notion_handler.py` の `_query_db()` 参照。
- **重複通知が届いたら**、Docker コンテナが誤って起動していないか確認する。`docker compose ps` と `ps aux` で確認して重複プロセスを停止する。

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
