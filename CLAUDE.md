# ambient-agent — Claude 向けガイド

## 基本コマンド

```bash
# cf-worker のデプロイ
cd cf-worker && npx wrangler deploy

# cf-worker のログ確認
cd cf-worker && npx wrangler tail
```

## Git ルール

- コード変更後は必ずコミットして `git push` する。

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
