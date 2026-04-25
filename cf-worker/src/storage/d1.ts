import type { Env } from "../types.js";

const PROCESSED_RETENTION_DAYS = 30;

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
  const cutoff = Math.floor(Date.now() / 1000) - PROCESSED_RETENTION_DAYS * 86400;
  await env.AGENT_DB.prepare(
    "DELETE FROM processed_messages WHERE processed_at < ?",
  )
    .bind(cutoff)
    .run();
}
