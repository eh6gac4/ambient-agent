/**
 * データ移行スクリプト
 * 使い方: npx tsx scripts/migrate-data.ts
 *
 * 既存の data/*.json を Cloudflare D1 / KV へ移行する。
 * 実行前に wrangler.toml の database_id と kv_namespace id を設定すること。
 */

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const DATA_DIR = "../data";

function wrangler(args: string): string {
  return execSync(`wrangler ${args}`, { encoding: "utf-8", cwd: "../" });
}

function migrateThreadMap(): void {
  const path = `${DATA_DIR}/gmail_thread_map.json`;
  if (!existsSync(path)) {
    console.log("gmail_thread_map.json not found, skipping");
    return;
  }
  const data: Record<string, string> = JSON.parse(readFileSync(path, "utf-8"));
  const entries = Object.entries(data);
  if (!entries.length) return;

  console.log(`Migrating ${entries.length} thread map entries...`);
  for (const [threadId, pageId] of entries) {
    const sql = `INSERT OR REPLACE INTO gmail_thread_map (thread_id, notion_page_id) VALUES ('${threadId}', '${pageId}');`;
    wrangler(`d1 execute ambient-agent-db --command "${sql}"`);
  }
  console.log("✓ gmail_thread_map migrated");
}

function migrateCalendarSync(): void {
  const path = `${DATA_DIR}/calendar_sync.json`;
  if (!existsSync(path)) {
    console.log("calendar_sync.json not found, skipping");
    return;
  }
  const data: Record<string, { event_id: string; calendar_date: string }> = JSON.parse(
    readFileSync(path, "utf-8"),
  );
  const entries = Object.entries(data);
  if (!entries.length) return;

  console.log(`Migrating ${entries.length} calendar sync entries...`);
  for (const [pageId, { event_id, calendar_date }] of entries) {
    const sql = `INSERT OR REPLACE INTO calendar_sync (notion_page_id, event_id, calendar_date) VALUES ('${pageId}', '${event_id}', '${calendar_date}');`;
    wrangler(`d1 execute ambient-agent-db --command "${sql}"`);
  }
  console.log("✓ calendar_sync migrated");
}

function migrateSenderMap(): void {
  const path = `${DATA_DIR}/task_sender_map.json`;
  if (!existsSync(path)) {
    console.log("task_sender_map.json not found, skipping");
    return;
  }
  const data: Record<string, string> = JSON.parse(readFileSync(path, "utf-8"));
  const entries = Object.entries(data);
  if (!entries.length) return;

  console.log(`Migrating ${entries.length} sender map entries...`);
  for (const [pageId, email] of entries) {
    const sql = `INSERT OR REPLACE INTO task_sender_map (notion_page_id, sender_email) VALUES ('${pageId}', '${email}');`;
    wrangler(`d1 execute ambient-agent-db --command "${sql}"`);
  }
  console.log("✓ task_sender_map migrated");
}

function migrateNoTaskSenders(): void {
  const path = `${DATA_DIR}/no_task_senders.txt`;
  if (!existsSync(path)) {
    console.log("no_task_senders.txt not found, skipping");
    return;
  }
  const content = readFileSync(path, "utf-8").trim();
  if (!content) return;

  wrangler(`kv:key put --binding=AGENT_KV "no_task_senders" "${content.replace(/"/g, '\\"')}"`);
  console.log("✓ no_task_senders migrated to KV");
}

function extractRefreshToken(): void {
  const path = `${DATA_DIR}/token.json`;
  if (!existsSync(path)) {
    console.log("token.json not found. You need to run Google OAuth manually.");
    return;
  }
  const token = JSON.parse(readFileSync(path, "utf-8"));
  if (token.refresh_token) {
    console.log("\n=== Google Refresh Token ===");
    console.log("Run: wrangler secret put GOOGLE_REFRESH_TOKEN");
    console.log("Then paste:", token.refresh_token);
  } else {
    console.log("No refresh_token found in token.json");
  }
}

// Main
console.log("=== ambient-agent データ移行 ===\n");
migrateThreadMap();
migrateCalendarSync();
migrateSenderMap();
migrateNoTaskSenders();
extractRefreshToken();
console.log("\n✓ 移行完了");
console.log("\n次のステップ:");
console.log("1. 上記の refresh_token を wrangler secret put GOOGLE_REFRESH_TOKEN で登録");
console.log("2. その他の secrets を登録 (wrangler secret put ANTHROPIC_API_KEY 等)");
console.log("3. Telegram Webhook を設定:");
console.log("   curl -X POST https://api.telegram.org/bot{TOKEN}/setWebhook -d 'url=https://ambient-agent.YOUR_SUBDOMAIN.workers.dev/webhook'");
