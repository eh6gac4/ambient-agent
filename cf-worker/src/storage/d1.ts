import type { Env } from "../types.js";
import { buildEmailSearchQuery } from "../utils/search.js";

const PROCESSED_RETENTION_DAYS = 30;

/** unixepoch 秒を持つテーブルから保持期間を過ぎた行を削除する。 */
async function deleteOlderThan(env: Env, table: string, column: string, days: number): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  await env.AGENT_DB.prepare(`DELETE FROM ${table} WHERE ${column} < ?`).bind(cutoff).run();
}

// gmail_thread_map
export async function getThreadMapEntry(env: Env, threadId: string): Promise<string | null> {
  const row = await env.AGENT_DB.prepare(
    "SELECT notion_page_id FROM gmail_thread_map WHERE thread_id = ?",
  )
    .bind(threadId)
    .first<{ notion_page_id: string }>();
  return row?.notion_page_id ?? null;
}

export async function setThreadMapEntry(env: Env, threadId: string, pageId: string): Promise<void> {
  await env.AGENT_DB.prepare(
    "INSERT OR REPLACE INTO gmail_thread_map (thread_id, notion_page_id) VALUES (?, ?)",
  )
    .bind(threadId, pageId)
    .run();
}

// task_sender_map
export async function getSenderForTask(env: Env, pageId: string): Promise<string | null> {
  const row = await env.AGENT_DB.prepare(
    "SELECT sender_email FROM task_sender_map WHERE notion_page_id = ?",
  )
    .bind(pageId)
    .first<{ sender_email: string }>();
  return row?.sender_email ?? null;
}

export async function setSenderForTask(env: Env, pageId: string, email: string): Promise<void> {
  await env.AGENT_DB.prepare(
    "INSERT OR REPLACE INTO task_sender_map (notion_page_id, sender_email) VALUES (?, ?)",
  )
    .bind(pageId, email)
    .run();
}

export async function deleteSenderMapEntry(env: Env, pageId: string): Promise<void> {
  await env.AGENT_DB.prepare("DELETE FROM task_sender_map WHERE notion_page_id = ?")
    .bind(pageId)
    .run();
}

export async function getAllSenderMap(env: Env): Promise<Map<string, string>> {
  const rows = await env.AGENT_DB.prepare(
    "SELECT notion_page_id, sender_email FROM task_sender_map",
  ).all<{ notion_page_id: string; sender_email: string }>();
  return new Map(rows.results.map((r) => [r.notion_page_id, r.sender_email]));
}

// calendar_sync
export async function getCalendarSync(env: Env, pageId: string): Promise<{ eventId: string; calendarDate: string } | null> {
  const row = await env.AGENT_DB.prepare(
    "SELECT event_id, calendar_date FROM calendar_sync WHERE notion_page_id = ?",
  )
    .bind(pageId)
    .first<{ event_id: string; calendar_date: string }>();
  if (!row) return null;
  return { eventId: row.event_id, calendarDate: row.calendar_date };
}

export async function setCalendarSync(env: Env, pageId: string, eventId: string, calendarDate: string): Promise<void> {
  await env.AGENT_DB.prepare(
    "INSERT OR REPLACE INTO calendar_sync (notion_page_id, event_id, calendar_date) VALUES (?, ?, ?)",
  )
    .bind(pageId, eventId, calendarDate)
    .run();
}

export async function deleteCalendarSync(env: Env, pageId: string): Promise<void> {
  await env.AGENT_DB.prepare("DELETE FROM calendar_sync WHERE notion_page_id = ?")
    .bind(pageId)
    .run();
}

export async function getAllCalendarSync(env: Env): Promise<Map<string, { eventId: string; calendarDate: string }>> {
  const rows = await env.AGENT_DB.prepare(
    "SELECT notion_page_id, event_id, calendar_date FROM calendar_sync",
  ).all<{ notion_page_id: string; event_id: string; calendar_date: string }>();
  return new Map(rows.results.map((r) => [r.notion_page_id, { eventId: r.event_id, calendarDate: r.calendar_date }]));
}

// processed_messages
export async function isProcessed(env: Env, messageId: string): Promise<boolean> {
  const row = await env.AGENT_DB.prepare(
    "SELECT 1 FROM processed_messages WHERE message_id = ?",
  )
    .bind(messageId)
    .first<{ 1: number }>();
  return row !== null;
}

export async function markProcessed(env: Env, messageId: string): Promise<void> {
  await env.AGENT_DB.prepare(
    "INSERT OR IGNORE INTO processed_messages (message_id) VALUES (?)",
  )
    .bind(messageId)
    .run();
}

export async function cleanOldProcessed(env: Env): Promise<void> {
  await deleteOlderThan(env, "processed_messages", "processed_at", PROCESSED_RETENTION_DAYS);
}

// emails
const EMAIL_RETENTION_DAYS = 180;
const EMAIL_BODY_MAX_CHARS = 20000;
// 抜粋の生成に必要なぶんだけ本文を持ち出す（全文を転送しない）。
const EMAIL_BODY_FETCH_CHARS = 4000;
const EMAIL_SEARCH_DEFAULT_LIMIT = 10;

export interface EmailRecord {
  messageId: string;
  subject: string;
  senderEmail: string;
  body: string;
  gmailUrl: string;
}

export interface EmailSearchResult {
  subject: string;
  senderEmail: string;
  gmailUrl: string;
  receivedAt: number;
  body: string;
}

export async function saveEmail(env: Env, record: EmailRecord): Promise<void> {
  await env.AGENT_DB.prepare(
    "INSERT OR REPLACE INTO emails (message_id, subject, sender_email, body, gmail_url) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(
      record.messageId,
      record.subject,
      record.senderEmail,
      record.body.slice(0, EMAIL_BODY_MAX_CHARS),
      record.gmailUrl,
    )
    .run();
}

/** 保管済みメールをキーワードの部分一致（全語 AND）で検索する。新しい順。 */
export async function searchEmails(
  env: Env,
  keywords: string[],
  limit = EMAIL_SEARCH_DEFAULT_LIMIT,
): Promise<EmailSearchResult[]> {
  if (!keywords.length) return [];

  const { where, binds } = buildEmailSearchQuery(keywords);
  const rows = await env.AGENT_DB.prepare(
    `SELECT subject, sender_email, substr(body, 1, ${EMAIL_BODY_FETCH_CHARS}) AS body, gmail_url, received_at
       FROM emails WHERE ${where} ORDER BY received_at DESC LIMIT ?`,
  )
    .bind(...binds, limit)
    .all<{
      subject: string;
      sender_email: string;
      body: string;
      gmail_url: string;
      received_at: number;
    }>();

  return rows.results.map((r) => ({
    subject: r.subject,
    senderEmail: r.sender_email,
    gmailUrl: r.gmail_url,
    receivedAt: r.received_at,
    body: r.body,
  }));
}

export async function cleanOldEmails(env: Env): Promise<void> {
  await deleteOlderThan(env, "emails", "received_at", EMAIL_RETENTION_DAYS);
}

// location_history
const LOCATION_RETENTION_DAYS = 90;

export interface LocationRecord {
  tst: number;
  lat: number;
  lon: number;
  acc?: number | null;
  device?: string | null;
}

export async function insertLocation(env: Env, record: LocationRecord): Promise<void> {
  await env.AGENT_DB.prepare(
    "INSERT INTO location_history (tst, lat, lon, acc, device) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(record.tst, record.lat, record.lon, record.acc ?? null, record.device ?? null)
    .run();
}

export async function cleanOldLocations(env: Env): Promise<void> {
  await deleteOlderThan(env, "location_history", "tst", LOCATION_RETENTION_DAYS);
}

// app_logs
export async function insertAppLog(env: Env, level: string, message: string, data?: any): Promise<void> {
  // Cloudflare Logpush (Workers Trace Events) 向けに標準出力にも出す
  if (level === "error") {
    console.error(`[${level}] ${message}`, data ? JSON.stringify(data) : "");
  } else {
    console.info(`[${level}] ${message}`, data ? JSON.stringify(data) : "");
  }

  try {
    await env.AGENT_DB.prepare(
      "INSERT INTO app_logs (level, message, data) VALUES (?, ?, ?)"
    )
      .bind(level, message, data ? JSON.stringify(data) : null)
      .run();
  } catch (err) {
    console.error("insertAppLog failed:", err);
  }
}

const APP_LOG_RETENTION_DAYS = 14;

export async function cleanOldAppLogs(env: Env): Promise<void> {
  await env.AGENT_DB.prepare(
    "DELETE FROM app_logs WHERE timestamp < datetime('now', 'localtime', ?)"
  )
    .bind(`-${APP_LOG_RETENTION_DAYS} days`)
    .run();
}
