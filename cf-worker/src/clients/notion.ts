import type { Env, Task, TaskInput, ExtractedTask } from "../types.js";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const DATA_SOURCE_KV_KEY = "notion:data_source_id";

const STATUS_PENDING = "未着手";
const STATUS_IN_PROGRESS_GROUP = ["進行中", "確認中", "一時中断"];
const STATUS_DONE = "完了";
const STATUS_CANCELLED = "中止";
const STATUS_BACKLOG = "バックログ";

const EMAIL_BODY_MAX_CHARS = 10000;
const NOTION_RICH_TEXT_MAX = 2000;

// LLM が "返信" や "📩 返信" のような非絵文字/混在文字列を返すと
// Notion の icon.emoji が 400 で拒否され、タスク登録ごと失敗する。
// 絵文字（ZWJ シーケンス・肌色修飾・国旗・キーキャップ含む）のみ通し、
// それ以外は undefined を返して icon を付けずに登録を継続させる。
const EMOJI_ALLOWED_RE =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|[\u200D\uFE0F\u20E3#*0-9])+$/u;
const EMOJI_REQUIRED_RE = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20E3]/u;

export function sanitizeEmoji(icon?: string): string | undefined {
  if (!icon) return undefined;
  const trimmed = icon.trim();
  if (!trimmed || trimmed.length > 16) return undefined;
  if (!EMOJI_ALLOWED_RE.test(trimmed)) return undefined;
  if (!EMOJI_REQUIRED_RE.test(trimmed)) return undefined;
  return trimmed;
}

function buildEmailBodyBlocks(bodyText: string, headingLabel: string): Array<Record<string, unknown>> {
  const trimmed = bodyText.trim();
  if (!trimmed) return [];

  const truncated = trimmed.length > EMAIL_BODY_MAX_CHARS
    ? trimmed.slice(0, EMAIL_BODY_MAX_CHARS) + "\n\n…(以下省略)"
    : trimmed;

  const chunks: string[] = [];
  for (let i = 0; i < truncated.length; i += NOTION_RICH_TEXT_MAX) {
    chunks.push(truncated.slice(i, i + NOTION_RICH_TEXT_MAX));
  }

  return [
    { object: "block", type: "divider", divider: {} },
    {
      object: "block",
      type: "heading_3",
      heading_3: { rich_text: [{ type: "text", text: { content: headingLabel } }] },
    },
    ...chunks.map((chunk) => ({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: [{ type: "text", text: { content: chunk } }] },
    })),
  ];
}

function buildImageBlocks(uploadId: string | undefined): Array<Record<string, unknown>> {
  if (!uploadId) return [];
  return [
    {
      object: "block",
      type: "image",
      image: { type: "file_upload", file_upload: { id: uploadId } },
    },
  ];
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Notion-Version": NOTION_VERSION,
  };
}

function getSubitemParentProp(env: Env): string {
  return env.NOTION_SUBITEM_PARENT_PROP ?? "親アイテム";
}

async function getDataSourceId(env: Env): Promise<string | null> {
  const cached = await env.AGENT_KV.get(DATA_SOURCE_KV_KEY);
  if (cached) return cached;

  const resp = await fetch(`${NOTION_API}/databases/${env.NOTION_TASKS_DB_ID}`, {
    headers: headers(env.NOTION_TOKEN),
  });
  if (!resp.ok) return null;

  const db = await resp.json<{ data_sources?: Array<{ id: string }> }>();
  const sources = db.data_sources ?? [];
  if (!sources.length) return null;

  const id = sources[0].id;
  await env.AGENT_KV.put(DATA_SOURCE_KV_KEY, id, { expirationTtl: 86400 });
  return id;
}

async function queryDB(env: Env, filter: Record<string, unknown>): Promise<{ results: unknown[] }> {
  const dsId = await getDataSourceId(env);
  if (dsId) {
    const resp = await fetch(`${NOTION_API}/data_sources/${dsId}/query`, {
      method: "POST",
      headers: headers(env.NOTION_TOKEN),
      body: JSON.stringify({ filter }),
    });
    if (resp.ok) return resp.json();
  }

  // fallback to databases.query
  const resp = await fetch(`${NOTION_API}/databases/${env.NOTION_TASKS_DB_ID}/query`, {
    method: "POST",
    headers: headers(env.NOTION_TOKEN),
    body: JSON.stringify({ filter }),
  });
  if (!resp.ok) throw new Error(`Notion query failed: ${resp.status}`);
  return resp.json();
}

function parseTaskPage(page: Record<string, unknown>): Task {
  const props = (page.properties ?? {}) as Record<string, unknown>;

  const titleArr = ((props["タイトル"] as Record<string, unknown> | undefined)?.title as Array<{ text: { content: string } }> | undefined) ?? [];
  const title = titleArr[0]?.text.content ?? "";

  const dueObj = (props["Due"] as Record<string, unknown> | undefined)?.date as { start: string } | undefined;
  const due = dueObj?.start ?? null;

  const priorityObj = (props["Priority"] as Record<string, unknown> | undefined)?.select as { name: string } | undefined;
  const priority = (priorityObj?.name ?? "medium") as Task["priority"];

  const statusObj = (props["Status"] as Record<string, unknown> | undefined)?.status as { name: string } | undefined;
  const status = statusObj?.name ?? STATUS_PENDING;

  const lastEdited = typeof page.last_edited_time === "string" ? page.last_edited_time.slice(0, 10) : null;

  return {
    title,
    due,
    priority,
    status,
    lastEdited,
    url: (page.url as string) ?? "",
    pageId: (page.id as string) ?? "",
  };
}

export async function uploadImageToNotion(
  env: Env,
  imageData: ArrayBuffer,
  mediaType: string,
  filename: string,
): Promise<string | null> {
  const MAX_BYTES = 20 * 1024 * 1024;
  if (imageData.byteLength > MAX_BYTES) return null;

  try {
    const createResp = await fetch(`${NOTION_API}/file_uploads`, {
      method: "POST",
      headers: headers(env.NOTION_TOKEN),
      body: JSON.stringify({}),
    });
    if (!createResp.ok) return null;
    const created = await createResp.json<{ id: string; upload_url: string }>();
    if (!created.id || !created.upload_url) return null;

    const form = new FormData();
    form.append("file", new Blob([imageData], { type: mediaType }), filename);

    const sendResp = await fetch(created.upload_url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
      },
      body: form,
    });
    if (!sendResp.ok) return null;

    return created.id;
  } catch {
    return null;
  }
}

function buildTaskProperties(env: Env, task: TaskInput, parentPageId?: string): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    "タイトル": { title: [{ text: { content: task.title } }] },
    Status: { status: { name: STATUS_PENDING } },
    Source: { rich_text: [{ text: { content: task.source ?? "Telegram" } }] },
  };

  if (task.sourceUrl) {
    properties["SourceURL"] = { url: task.sourceUrl };
  }

  if (task.due) {
    const notionDue = task.due.includes("T") ? task.due + "+09:00" : task.due;
    properties["Due"] = { date: { start: notionDue } };
  }

  const priority = task.priority ?? "medium";
  if (["high", "medium", "low"].includes(priority)) {
    properties["Priority"] = { select: { name: priority } };
  }

  if (parentPageId) {
    properties[getSubitemParentProp(env)] = { relation: [{ id: parentPageId }] };
  }

  return properties;
}

export async function addTask(
  env: Env,
  task: TaskInput,
  subtasks?: ExtractedTask[],
  bodyText?: string,
  imageUploadId?: string,
): Promise<string | null> {
  const body: Record<string, unknown> = {
    parent: { database_id: env.NOTION_TASKS_DB_ID },
    properties: buildTaskProperties(env, task),
  };

  const emoji = sanitizeEmoji(task.icon);
  if (emoji) {
    body.icon = { type: "emoji", emoji };
  }

  const bodyBlocks = buildEmailBodyBlocks(bodyText ?? "", "📧 メール本文");
  const imageBlocks = buildImageBlocks(imageUploadId);
  const children = [...bodyBlocks, ...imageBlocks];
  if (children.length) {
    body.children = children;
  }

  const resp = await fetch(`${NOTION_API}/pages`, {
    method: "POST",
    headers: headers(env.NOTION_TOKEN),
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Notion addTask failed: ${resp.status}`);
  const page = await resp.json<{ id: string }>();
  const pageId = page.id ?? null;

  if (pageId && subtasks?.length) {
    for (const sub of subtasks) {
      await addSubtask(env, pageId, {
        title: sub.title,
        due: sub.due,
        priority: sub.priority,
        icon: sub.icon,
        source: task.source,
        sourceUrl: task.sourceUrl,
      });
    }
  }

  return pageId;
}

export async function addSubtask(
  env: Env,
  parentPageId: string,
  task: TaskInput,
): Promise<string | null> {
  const body: Record<string, unknown> = {
    parent: { database_id: env.NOTION_TASKS_DB_ID },
    properties: buildTaskProperties(env, task, parentPageId),
  };

  const emoji = sanitizeEmoji(task.icon);
  if (emoji) {
    body.icon = { type: "emoji", emoji };
  }

  const resp = await fetch(`${NOTION_API}/pages`, {
    method: "POST",
    headers: headers(env.NOTION_TOKEN),
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    console.warn(`Notion addSubtask failed for parent=${parentPageId}: ${resp.status}`);
    return null;
  }
  const page = await resp.json<{ id: string }>();
  return page.id ?? null;
}

export async function getOpenTasks(env: Env): Promise<Task[]> {
  const statusFilters = [STATUS_PENDING, ...STATUS_IN_PROGRESS_GROUP].map((s) => ({
    property: "Status",
    status: { equals: s },
  }));
  const result = await queryDB(env, { or: statusFilters });
  return (result.results as Record<string, unknown>[]).map(parseTaskPage);
}

export async function escalatePriorityTasks(env: Env): Promise<Task[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);
  const deadline = new Date(today);
  deadline.setDate(deadline.getDate() + 3);
  const deadlineStr = deadline.toISOString().slice(0, 10);

  const statusFilters = [STATUS_PENDING, ...STATUS_IN_PROGRESS_GROUP].map((s) => ({
    property: "Status",
    status: { equals: s },
  }));

  const result = await queryDB(env, {
    and: [
      { or: statusFilters },
      { property: "Priority", select: { equals: "medium" } },
      { property: "Due", date: { on_or_before: deadlineStr } },
      { property: "Due", date: { on_or_after: todayStr } },
    ],
  });

  const escalated: Task[] = [];
  for (const page of result.results as Record<string, unknown>[]) {
    const task = parseTaskPage(page);
    await fetch(`${NOTION_API}/pages/${task.pageId}`, {
      method: "PATCH",
      headers: headers(env.NOTION_TOKEN),
      body: JSON.stringify({ properties: { Priority: { select: { name: "high" } } } }),
    });
    escalated.push(task);
  }
  return escalated;
}

// バックログに退避してあるタスクのうち、due が今から 3 日以内 (過去 due 含む) に
// 入っているものを未着手に昇格させる。締切のないバックログ (due=null) は対象外。
export async function promoteBacklogTasks(env: Env): Promise<Task[]> {
  const today = new Date();
  const deadline = new Date(today);
  deadline.setDate(deadline.getDate() + 3);
  const deadlineStr = deadline.toISOString().slice(0, 10);

  const result = await queryDB(env, {
    and: [
      { property: "Status", status: { equals: STATUS_BACKLOG } },
      { property: "Due", date: { on_or_before: deadlineStr } },
    ],
  });

  const promoted: Task[] = [];
  for (const page of result.results as Record<string, unknown>[]) {
    const task = parseTaskPage(page);
    await fetch(`${NOTION_API}/pages/${task.pageId}`, {
      method: "PATCH",
      headers: headers(env.NOTION_TOKEN),
      body: JSON.stringify({ properties: { Status: { status: { name: STATUS_PENDING } } } }),
    });
    promoted.push(task);
  }
  return promoted;
}

export async function completeTask(env: Env, pageId: string): Promise<void> {
  const resp = await fetch(`${NOTION_API}/pages/${pageId}`, {
    method: "PATCH",
    headers: headers(env.NOTION_TOKEN),
    body: JSON.stringify({ properties: { Status: { status: { name: STATUS_DONE } } } }),
  });
  if (!resp.ok) throw new Error(`completeTask failed: ${resp.status}`);
}

export async function cancelTask(env: Env, pageId: string): Promise<void> {
  const resp = await fetch(`${NOTION_API}/pages/${pageId}`, {
    method: "PATCH",
    headers: headers(env.NOTION_TOKEN),
    body: JSON.stringify({ properties: { Status: { status: { name: STATUS_CANCELLED } } } }),
  });
  if (!resp.ok) throw new Error(`cancelTask failed: ${resp.status}`);
}

export async function getTaskStatus(env: Env, pageId: string): Promise<string | null> {
  const resp = await fetch(`${NOTION_API}/pages/${pageId}`, {
    headers: headers(env.NOTION_TOKEN),
  });
  if (!resp.ok) return null;
  const page = await resp.json<{ archived?: boolean; properties?: Record<string, unknown> }>();
  if (page.archived) return null;
  const statusObj = (page.properties?.["Status"] as Record<string, unknown> | undefined)?.status as { name: string } | undefined;
  return statusObj?.name ?? null;
}

export async function getTaskTitleAndDue(
  env: Env,
  pageId: string,
): Promise<{ title: string; due: string | null } | null> {
  const resp = await fetch(`${NOTION_API}/pages/${pageId}`, {
    headers: headers(env.NOTION_TOKEN),
  });
  if (!resp.ok) return null;
  const page = await resp.json<{ archived?: boolean; properties?: Record<string, unknown> }>();
  if (page.archived) return null;
  const props = (page.properties ?? {}) as Record<string, unknown>;
  const titleArr = ((props["タイトル"] as Record<string, unknown> | undefined)?.title as Array<{ text: { content: string } }> | undefined) ?? [];
  const title = titleArr[0]?.text.content ?? "";
  const dueObj = (props["Due"] as Record<string, unknown> | undefined)?.date as { start: string } | undefined;
  return { title, due: dueObj?.start ?? null };
}

export async function updateTaskDue(env: Env, pageId: string, due: string): Promise<void> {
  const resp = await fetch(`${NOTION_API}/pages/${pageId}`, {
    method: "PATCH",
    headers: headers(env.NOTION_TOKEN),
    body: JSON.stringify({ properties: { Due: { date: { start: due } } } }),
  });
  if (!resp.ok) throw new Error(`updateTaskDue failed: ${resp.status}`);
}

export async function updateTaskFromReply(
  env: Env,
  pageId: string,
  subtasks: ExtractedTask[],
  priority: string,
  due: string | null,
  bodyText?: string,
): Promise<void> {
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };

  const pageResp = await fetch(`${NOTION_API}/pages/${pageId}`, {
    headers: headers(env.NOTION_TOKEN),
  });
  if (!pageResp.ok) throw new Error(`updateTaskFromReply: page fetch failed: ${pageResp.status}`);
  const page = await pageResp.json<{ properties: Record<string, unknown> }>();
  const props = page.properties;

  const currentPriority = ((props["Priority"] as Record<string, unknown> | undefined)?.select as { name: string } | undefined)?.name ?? "medium";
  const currentDueObj = (props["Due"] as Record<string, unknown> | undefined)?.date as { start: string } | undefined;
  const currentDue = currentDueObj?.start?.slice(0, 10) ?? null;
  const sourceUrlObj = props["SourceURL"] as { url?: string } | undefined;
  const inheritedSourceUrl = sourceUrlObj?.url ?? undefined;

  const updates: Record<string, unknown> = {};

  if ((priorityOrder[priority] ?? 1) < (priorityOrder[currentPriority] ?? 1)) {
    updates["Priority"] = { select: { name: priority } };
  }

  if (due) {
    const dueDate = due.slice(0, 10);
    if (!currentDue || dueDate < currentDue) {
      updates["Due"] = { date: { start: dueDate } };
    }
  }

  if (Object.keys(updates).length) {
    await fetch(`${NOTION_API}/pages/${pageId}`, {
      method: "PATCH",
      headers: headers(env.NOTION_TOKEN),
      body: JSON.stringify({ properties: updates }),
    });
  }

  const bodyBlocks = buildEmailBodyBlocks(bodyText ?? "", "📧 返信メール");
  if (bodyBlocks.length) {
    await fetch(`${NOTION_API}/blocks/${pageId}/children`, {
      method: "PATCH",
      headers: headers(env.NOTION_TOKEN),
      body: JSON.stringify({ children: bodyBlocks }),
    });
  }

  for (const sub of subtasks) {
    await addSubtask(env, pageId, {
      title: sub.title,
      due: sub.due,
      priority: sub.priority,
      icon: sub.icon,
      source: "Gmail",
      sourceUrl: inheritedSourceUrl,
    });
  }
}
