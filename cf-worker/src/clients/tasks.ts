import type { Env, Task, TaskInput, ExtractedTask } from "../types.js";
import { toDateStr } from "../utils/jst.js";
import { PRIORITY_ORDER } from "../utils/task.js";

/**
 * タスクストア。
 *
 * 登録先は notion-tasks (https://todo.eh6gac4.work) が使う Cloudflare D1
 * データベース `notion-tasks`。同一アカウントの D1 を TASKS_DB バインディングで
 * 直接読み書きする（Notion API 経由をやめた理由は README「タスクストア」参照）。
 *
 * スキーマの正は notion-tasks の `migrations/0001_init.sql`。カラムを増やす・
 * 意味を変える変更は向こう側が先で、こちらは追従する。
 */

const STATUS_PENDING = "未着手";
const STATUS_IN_PROGRESS_GROUP = ["進行中", "確認中", "一時中断"];
const STATUS_DONE = "完了";
const STATUS_CANCELLED = "中止";
const STATUS_BACKLOG = "バックログ";

/** /tasks やブリーフィングで「オープン」とみなすステータス */
const OPEN_STATUSES = [STATUS_PENDING, ...STATUS_IN_PROGRESS_GROUP];

const EMAIL_BODY_MAX_CHARS = 10000;

/** 添付ファイル 1 件あたりの上限 (notion-tasks 側の実装と合わせる) */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// LLM が "返信" や "📩 返信" のような非絵文字/混在文字列を返すことがある。
// notion-tasks の UI は icon_value をそのまま絵文字として描画するので、
// 絵文字（ZWJ シーケンス・肌色修飾・国旗・キーキャップ含む）のみ通し、
// それ以外は undefined を返して icon を付けずに登録を継続させる。
const EMOJI_ALLOWED_RE =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|[\u200D\uFE0F\u20E3#*0-9])+$/u;
const EMOJI_REQUIRED_RE = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20E3]/u;

interface TaskRow {
  id: string;
  notion_url: string;
  title: string;
  status: string | null;
  priority: string | null;
  due: string | null;
  location: string | null;
  source_url: string | null;
  body: string;
  last_edited_time: string;
}

/** R2 へアップロード済みで、まだどのタスクにも紐付いていない添付ファイル。 */
export interface PendingAttachment {
  id: string;
  key: string;
  name: string;
  contentType: string;
  size: number;
}

export function sanitizeEmoji(icon?: string): string | undefined {
  if (!icon) return undefined;
  const trimmed = icon.trim();
  if (!trimmed || trimmed.length > 16) return undefined;
  if (!EMOJI_ALLOWED_RE.test(trimmed)) return undefined;
  if (!EMOJI_REQUIRED_RE.test(trimmed)) return undefined;
  return trimmed;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return crypto.randomUUID();
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(", ");
}

/**
 * Due の保存形式を notion-tasks 側 (`src/lib/due-date.ts`) に合わせる。
 * 日付のみはそのまま、時刻付きは `YYYY-MM-DDTHH:mm:ss.sss+09:00`。
 * LLM は "2026-05-01T10:00" のようにオフセット無しで返すため補う。
 */
function normalizeDue(due: string): string {
  if (!due.includes("T")) return due;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(due)) return due;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(due);
  if (!m) return due;
  return `${m[1]}T${m[2]}:${m[3]}:${m[4] ?? "00"}.000+09:00`;
}

/**
 * 本文 Markdown に付けるセクション。
 * 長すぎるメールは D1 の行を膨らませるだけなので打ち切る。
 */
function buildBodySection(bodyText: string, headingLabel: string): string {
  const trimmed = bodyText.trim();
  if (!trimmed) return "";

  const truncated = trimmed.length > EMAIL_BODY_MAX_CHARS
    ? trimmed.slice(0, EMAIL_BODY_MAX_CHARS) + "\n\n…(以下省略)"
    : trimmed;

  return `---\n\n### ${headingLabel}\n\n${truncated}`;
}

function appendBodySection(current: string, section: string): string {
  if (!section) return current;
  return current.trim() ? `${current.trim()}\n\n${section}` : section;
}

function rowToTask(row: TaskRow): Task {
  return {
    title: row.title,
    due: row.due,
    priority: (row.priority ?? "medium") as Task["priority"],
    status: row.status ?? STATUS_PENDING,
    location: row.location,
    lastEdited: row.last_edited_time ? row.last_edited_time.slice(0, 10) : null,
    url: row.notion_url ?? "",
    pageId: row.id,
  };
}

const SELECT_COLUMNS =
  "id, notion_url, title, status, priority, due, location, source_url, body, last_edited_time";

async function selectTasks(
  env: Env,
  where: string,
  binds: unknown[],
  orderBy = "",
): Promise<TaskRow[]> {
  const order = orderBy ? ` ORDER BY ${orderBy}` : "";
  const result = await env.TASKS_DB.prepare(`SELECT ${SELECT_COLUMNS} FROM tasks WHERE ${where}${order}`)
    .bind(...binds)
    .all<TaskRow>();
  return result.results ?? [];
}

async function fetchTaskRow(env: Env, taskId: string): Promise<TaskRow | null> {
  return env.TASKS_DB.prepare(`SELECT ${SELECT_COLUMNS} FROM tasks WHERE id = ?`)
    .bind(taskId)
    .first<TaskRow>();
}

/** tasks を 1 行更新する。last_edited_time は常に更新する。 */
async function updateTaskRow(
  env: Env,
  taskId: string,
  updates: Record<string, unknown>,
): Promise<number> {
  const columns = Object.keys(updates);
  const sets = [...columns.map((c) => `${c} = ?`), "last_edited_time = ?"];
  const result = await env.TASKS_DB.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...columns.map((c) => updates[c]), nowIso(), taskId)
    .run();
  return result.meta?.changes ?? 0;
}

/**
 * Telegram から受け取った画像を R2 に置く。タスク作成前に（Gemini の解析と
 * 並行して）呼ぶため、キーに taskId は含めない。DB 側は `task_attachments.r2_key`
 * だけを見るので、キーの形は notion-tasks の UI/取得経路に影響しない。
 */
export async function uploadTaskImage(
  env: Env,
  imageData: ArrayBuffer,
  mediaType: string,
  filename: string,
): Promise<PendingAttachment | null> {
  if (!env.TASK_ATTACHMENTS) return null;
  if (imageData.byteLength > MAX_UPLOAD_BYTES) return null;

  try {
    const id = newId();
    const key = `tasks/attachments/${id}/${filename}`;
    await env.TASK_ATTACHMENTS.put(key, imageData, { httpMetadata: { contentType: mediaType } });
    return { id, key, name: filename, contentType: mediaType, size: imageData.byteLength };
  } catch {
    return null;
  }
}

interface InsertOptions {
  body?: string;
  parentTaskId?: string;
  attachment?: PendingAttachment;
}

async function insertTask(env: Env, task: TaskInput, options: InsertOptions = {}): Promise<string> {
  const id = newId();
  const ts = nowIso();
  const emoji = sanitizeEmoji(task.icon);
  const priority = task.priority ?? "medium";

  const statements = [
    env.TASKS_DB.prepare(
      `INSERT INTO tasks
         (id, notion_url, title, icon_type, icon_value, status, priority, due, source, source_url, body, created_time, last_edited_time)
       VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      task.title,
      emoji ? "emoji" : null,
      emoji ?? null,
      STATUS_PENDING,
      ["high", "medium", "low"].includes(priority) ? priority : "medium",
      task.due ? normalizeDue(task.due) : null,
      task.source ?? "Telegram",
      task.sourceUrl ?? null,
      options.body ?? "",
      ts,
      ts,
    ),
  ];

  // 親子は有向辺 1 本。`from_id の親が to_id`（notion-tasks の task_relations）。
  if (options.parentTaskId) {
    statements.push(
      env.TASKS_DB.prepare(
        `INSERT OR IGNORE INTO task_relations (from_id, to_id, type) VALUES (?, ?, 'parent')`,
      ).bind(id, options.parentTaskId),
    );
  }

  if (options.attachment) {
    const a = options.attachment;
    statements.push(
      env.TASKS_DB.prepare(
        `INSERT INTO task_attachments (id, task_id, sort_order, name, r2_key, content_type, size, created_time)
         VALUES (?, ?, 0, ?, ?, ?, ?, ?)`,
      ).bind(a.id, id, a.name, a.key, a.contentType, a.size, ts),
    );
  }

  await env.TASKS_DB.batch(statements);
  return id;
}

export async function addTask(
  env: Env,
  task: TaskInput,
  subtasks?: ExtractedTask[],
  bodyText?: string,
  attachment?: PendingAttachment,
): Promise<string | null> {
  const taskId = await insertTask(env, task, {
    body: buildBodySection(bodyText ?? "", "📧 メール本文"),
    attachment,
  });

  if (subtasks?.length) {
    for (const sub of subtasks) {
      await addSubtask(env, taskId, {
        title: sub.title,
        due: sub.due,
        priority: sub.priority,
        icon: sub.icon,
        source: task.source,
        sourceUrl: task.sourceUrl,
      });
    }
  }

  return taskId;
}

export async function addSubtask(
  env: Env,
  parentTaskId: string,
  task: TaskInput,
): Promise<string | null> {
  try {
    return await insertTask(env, task, { parentTaskId });
  } catch (err) {
    console.warn(`addSubtask failed for parent=${parentTaskId}:`, err);
    return null;
  }
}

export async function getOpenTasks(env: Env): Promise<Task[]> {
  // 表示順は呼び出し側 (task-formatter の sortTasks) が決めるが、並べ替えない
  // 経路 (長期未更新タスク通知など) のために期限順で安定させておく。
  const rows = await selectTasks(
    env,
    `status IN (${placeholders(OPEN_STATUSES.length)})`,
    OPEN_STATUSES,
    "due IS NULL, due ASC, created_time ASC",
  );
  return rows.map(rowToTask);
}

export async function escalatePriorityTasks(env: Env): Promise<Task[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = toDateStr(today);
  const deadline = new Date(today);
  deadline.setDate(deadline.getDate() + 3);
  const deadlineStr = toDateStr(deadline);

  // due は日付のみ / 日時の両方が入るので、先頭 10 文字（YYYY-MM-DD）で比較する。
  const rows = await selectTasks(
    env,
    `status IN (${placeholders(OPEN_STATUSES.length)})
       AND priority = 'medium'
       AND due IS NOT NULL
       AND substr(due, 1, 10) >= ?
       AND substr(due, 1, 10) <= ?`,
    [...OPEN_STATUSES, todayStr, deadlineStr],
  );

  const escalated: Task[] = [];
  for (const row of rows) {
    await updateTaskRow(env, row.id, { priority: "high" });
    escalated.push(rowToTask(row));
  }
  return escalated;
}

// バックログに退避してあるタスクのうち、due が今から 3 日以内 (過去 due 含む) に
// 入っているものを未着手に昇格させる。締切のないバックログ (due=null) は対象外。
export async function promoteBacklogTasks(env: Env): Promise<Task[]> {
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + 3);
  const deadlineStr = toDateStr(deadline);

  const rows = await selectTasks(
    env,
    `status = ? AND due IS NOT NULL AND substr(due, 1, 10) <= ?`,
    [STATUS_BACKLOG, deadlineStr],
  );

  const promoted: Task[] = [];
  for (const row of rows) {
    await updateTaskRow(env, row.id, { status: STATUS_PENDING });
    promoted.push(rowToTask(row));
  }
  return promoted;
}

export async function completeTask(env: Env, taskId: string): Promise<void> {
  const changes = await updateTaskRow(env, taskId, { status: STATUS_DONE });
  if (!changes) throw new Error(`completeTask failed: task not found (${taskId})`);
}

export async function cancelTask(env: Env, taskId: string): Promise<void> {
  const changes = await updateTaskRow(env, taskId, { status: STATUS_CANCELLED });
  if (!changes) throw new Error(`cancelTask failed: task not found (${taskId})`);
}

export async function getTaskStatus(env: Env, taskId: string): Promise<string | null> {
  const row = await env.TASKS_DB.prepare("SELECT status FROM tasks WHERE id = ?")
    .bind(taskId)
    .first<{ status: string | null }>();
  return row?.status ?? null;
}

export async function getTaskTitleAndDue(
  env: Env,
  taskId: string,
): Promise<{ title: string; due: string | null } | null> {
  const row = await env.TASKS_DB.prepare("SELECT title, due FROM tasks WHERE id = ?")
    .bind(taskId)
    .first<{ title: string; due: string | null }>();
  if (!row) return null;
  return { title: row.title, due: row.due };
}

export async function updateTaskDue(env: Env, taskId: string, due: string): Promise<void> {
  const changes = await updateTaskRow(env, taskId, { due: normalizeDue(due) });
  if (!changes) throw new Error(`updateTaskDue failed: task not found (${taskId})`);
}

export async function updateTaskFromReply(
  env: Env,
  taskId: string,
  subtasks: ExtractedTask[],
  priority: string,
  due: string | null,
  bodyText?: string,
): Promise<void> {
  const row = await fetchTaskRow(env, taskId);
  if (!row) throw new Error(`updateTaskFromReply: task not found (${taskId})`);

  const updates: Record<string, unknown> = {};

  const currentPriority = row.priority ?? "medium";
  if ((PRIORITY_ORDER[priority] ?? 1) < (PRIORITY_ORDER[currentPriority] ?? 1)) {
    updates.priority = priority;
  }

  if (due) {
    const dueDate = due.slice(0, 10);
    const currentDue = row.due?.slice(0, 10) ?? null;
    if (!currentDue || dueDate < currentDue) {
      updates.due = dueDate;
    }
  }

  const section = buildBodySection(bodyText ?? "", "📧 返信メール");
  if (section) {
    updates.body = appendBodySection(row.body ?? "", section);
  }

  if (Object.keys(updates).length) {
    await updateTaskRow(env, taskId, updates);
  }

  for (const sub of subtasks) {
    await addSubtask(env, taskId, {
      title: sub.title,
      due: sub.due,
      priority: sub.priority,
      icon: sub.icon,
      source: "Gmail",
      sourceUrl: row.source_url ?? undefined,
    });
  }
}
