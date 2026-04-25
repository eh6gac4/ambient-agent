#!/usr/bin/env node
// Worker Secrets を .env.local から一括登録する
// 使い方: npm run secrets:push

import { execSync } from "node:child_process";

const SECRET_KEYS = [
  "ANTHROPIC_API_KEY",
  "NOTION_TOKEN",
  "NOTION_TASKS_DB_ID",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
];

let ok = 0;
let skipped = 0;
let failed = 0;

for (const key of SECRET_KEYS) {
  const value = process.env[key];
  if (!value) {
    console.warn(`  SKIP  ${key} (空なのでスキップ)`);
    skipped++;
    continue;
  }
  try {
    execSync(`wrangler secret put ${key}`, {
      input: value,
      stdio: ["pipe", "inherit", "inherit"],
    });
    console.log(`  OK    ${key}`);
    ok++;
  } catch {
    console.error(`  FAIL  ${key}`);
    failed++;
  }
}

console.log(`\n登録: ${ok}件 / スキップ: ${skipped}件 / 失敗: ${failed}件`);
if (failed > 0) process.exit(1);
