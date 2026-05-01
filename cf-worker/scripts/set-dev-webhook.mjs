#!/usr/bin/env node
// dev 用 Telegram bot の webhook を tunnel URL に登録する
// 使い方: npm run webhook:dev -- https://<tunnel-host>.trycloudflare.com
//        npm run webhook:dev -- delete   (webhook を解除)

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN が .env.dev.local にありません");
  process.exit(1);
}

const arg = process.argv[2];
if (!arg) {
  console.error("使い方: npm run webhook:dev -- <tunnel-url>");
  console.error("       npm run webhook:dev -- delete");
  process.exit(1);
}

const isDelete = arg === "delete";
const apiUrl = isDelete
  ? `https://api.telegram.org/bot${token}/deleteWebhook`
  : `https://api.telegram.org/bot${token}/setWebhook`;
const body = isDelete ? null : new URLSearchParams({ url: `${arg.replace(/\/$/, "")}/webhook` });

const resp = await fetch(apiUrl, {
  method: "POST",
  body,
});
const data = await resp.json();

if (!data.ok) {
  console.error("失敗:", data);
  process.exit(1);
}

if (isDelete) {
  console.log("webhook を削除しました");
} else {
  console.log(`webhook を ${arg.replace(/\/$/, "")}/webhook に登録しました`);
}
