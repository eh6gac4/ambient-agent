import { env as workerEnv } from "cloudflare:test";
import type { Env } from "../../src/types.js";

/**
 * タスクストア (D1) を使うテスト用のヘルパー。
 *
 * vitest-pool-workers が wrangler.toml の TASKS_DB バインディングからローカル D1 を
 * 用意するので、そこに notion-tasks の migrations/0001_init.sql と同じスキーマを流す。
 * 定義がずれるとテストだけ通って本番で落ちるため、向こうを変えたらここも合わせる。
 */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS tasks (
     id               TEXT PRIMARY KEY,
     notion_url       TEXT NOT NULL DEFAULT '',
     title            TEXT NOT NULL DEFAULT '',
     icon_type        TEXT CHECK (icon_type IS NULL OR icon_type IN ('emoji', 'url')),
     icon_value       TEXT,
     status           TEXT,
     priority         TEXT CHECK (priority IS NULL OR priority IN ('high', 'medium', 'low')),
     due              TEXT,
     location         TEXT,
     source           TEXT,
     source_url       TEXT,
     body             TEXT NOT NULL DEFAULT '',
     created_time     TEXT NOT NULL,
     last_edited_time TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS task_tags (
     task_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
     tag     TEXT NOT NULL,
     PRIMARY KEY (task_id, tag)
   )`,
  `CREATE TABLE IF NOT EXISTS task_assignees (
     task_id  TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
     assignee TEXT NOT NULL,
     PRIMARY KEY (task_id, assignee)
   )`,
  `CREATE TABLE IF NOT EXISTS task_relations (
     from_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
     to_id   TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
     type    TEXT NOT NULL CHECK (type IN ('parent', 'next')),
     PRIMARY KEY (from_id, to_id, type)
   )`,
  `CREATE TABLE IF NOT EXISTS task_comments (
     id           TEXT PRIMARY KEY,
     task_id      TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
     text         TEXT NOT NULL,
     author       TEXT NOT NULL DEFAULT 'Unknown',
     created_time TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS task_attachments (
     id           TEXT PRIMARY KEY,
     task_id      TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
     sort_order   INTEGER NOT NULL,
     name         TEXT NOT NULL,
     r2_key       TEXT NOT NULL,
     content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
     size         INTEGER NOT NULL DEFAULT 0,
     created_time TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS option_sets (
     kind       TEXT NOT NULL CHECK (kind IN ('tag', 'location')),
     value      TEXT NOT NULL,
     sort_order INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (kind, value)
   )`,
];

const TABLES = [
  "task_attachments",
  "task_comments",
  "task_relations",
  "task_assignees",
  "task_tags",
  "option_sets",
  "tasks",
];

/** スキーマを作り直し、空の状態の Env を返す。 */
export async function setupTaskStore(): Promise<Env> {
  const env = workerEnv as unknown as Env;
  await env.TASKS_DB.batch(SCHEMA.map((sql) => env.TASKS_DB.prepare(sql)));
  await env.TASKS_DB.batch(TABLES.map((t) => env.TASKS_DB.prepare(`DELETE FROM ${t}`)));
  return env;
}

/** テスト用に tasks 行を直接差し込む。 */
export async function seedTask(
  env: Env,
  row: {
    id: string;
    title?: string;
    status?: string;
    priority?: string | null;
    due?: string | null;
    location?: string | null;
    source?: string | null;
    sourceUrl?: string | null;
    body?: string;
    notionUrl?: string;
    lastEdited?: string;
  },
): Promise<void> {
  const ts = row.lastEdited ?? new Date().toISOString();
  await env.TASKS_DB.prepare(
    `INSERT INTO tasks (id, notion_url, title, status, priority, due, location, source, source_url, body, created_time, last_edited_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      row.id,
      row.notionUrl ?? "",
      row.title ?? "タスク",
      row.status ?? "未着手",
      row.priority === undefined ? "medium" : row.priority,
      row.due ?? null,
      row.location ?? null,
      row.source ?? "Telegram",
      row.sourceUrl ?? null,
      row.body ?? "",
      ts,
      ts,
    )
    .run();
}

/** YYYY-MM-DD を今日からの日数オフセットで作る（実装側の toDateStr と同じ UTC 基準）。 */
export function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
