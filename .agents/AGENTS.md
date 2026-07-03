# ambient-agent 固有ルール

## デバッグ
- AI の通知判定や挙動を過去に遡ってデバッグする場合、`wrangler tail` ではすでに流れてしまったログを追えないため、Cloudflare KV に保存された `usage:YYYY-MM-DD` ログ（`wrangler kv key get` を使用）を参照してレスポンス結果を確認すること。
- また、`usage` ログにも残らないような途中スキップ処理や、内部変数の詳細な状態を遡ってデバッグする場合は、D1 の `app_logs` テーブルを参照すること。（例: `npx wrangler d1 execute ambient-agent-db --command "SELECT * FROM app_logs ORDER BY timestamp DESC LIMIT 10" --remote`）

## 外部API・仕様の更新
- APIの価格、制限（レートリミット）、無料枠など、外部サービスの仕様に関連する数値をコード上で修正する際は、過去の記憶や推測に頼らず、必ず事前に `search_web` スキル/ツールを使用して最新の公式情報を確認してから実装を行うこと。
