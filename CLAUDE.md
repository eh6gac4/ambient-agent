# ambient-agent — Claude 向けガイド

## 基本コマンド

```bash
# コード変更後は必ずリビルド
docker compose build && docker compose up -d

# ログ確認
docker compose logs -f
```

## Git ルール

- コード変更後は必ずコミットして `git push` する。

## 重要な注意事項

- **`start.sh` は使わない。** Docker がメインの実行環境。ホスト上での手動デバッグ時のみ使用。
- **`data/` を削除しない。** `token.json`・`credentials.json` は Git 管理外で、消えると再認証が必要になる。
- **Notion API は `data_sources.query` を使う。** `notion_handler.py` の `_query_db()` 参照。
- **409 Conflict が出たら**、同一 Bot Token で複数プロセスが動いている。`docker compose ps` と `ps aux` で確認して重複プロセスを停止する。

## ドキュメント更新ルール

コードを変更したら、影響する箇所を README.md に反映する。

| 変更内容 | 更新箇所 |
|---|---|
| ジョブの追加・削除・時刻変更 | スケジュール表 |
| Telegram コマンドの追加・変更 | Telegram コマンド表 |
| ファイルの追加・削除 | ファイル構成 |
| Notion DB プロパティの変更 | Notion DB 必須プロパティ表 |

## アーキテクチャ

- APScheduler（BlockingScheduler）でジョブ管理
- Telegram はロングポーリング（daemon スレッド）でリアルタイム受信
- サービスは **24時間365日稼働**。Claude API 呼び出しのみ `OPERATING_START_HOUR`〜`OPERATING_END_HOUR`（デフォルト 08:00〜21:00 JST）に制限
- reboot 時に `docker compose up -d` で自動起動（cron）
