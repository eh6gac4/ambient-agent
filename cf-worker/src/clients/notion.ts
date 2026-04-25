import type { Env, Task, TaskInput, ExtractedTask } from "../types.js";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const DATA_SOURCE_KV_KEY = "notion:data_source_id";

const STATUS_PENDING = "未着手";
const STATUS_IN_PROGRESS_GROUP = ["進行中", "確認中", "一時中断"];
const STATUS_DONE = "完了";
const STATUS_CANCELLED = "中止";

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Notion-Version": NOTION_VERSION,
  };
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

export async function addTask(env: Env, task: TaskInput, checklist?: string[]): Promise<string | null> {
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

  const body: Record<string, unknown> = {
    parent: { database_id: env.NOTION_TASKS_DB_ID },
    properties,
  };

  if (checklist?.length) {
    body.children = checklist.map((item) => ({
      object: "block",
      type: "to_do",
      to_do: {
        rich_text: [{ type: "text", text: { content: item } }],
        checked: false,
      },
    }));
  }

  const resp = await fetch(`${NOTION_API}/pages`, {
    method: "POST",
    headers: headers(env.NOTION_TOKEN),
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Notion addTask failed: ${resp.status}`);
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
  checklist: string[],
  priority: string,
  due: string | null,
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

  if (checklist.length) {
    await fetch(`${NOTION_API}/blocks/${pageId}/children`, {
      method: "PATCH",
      headers: headers(env.NOTION_TOKEN),
      body: JSON.stringify({
        children: checklist.map((item) => ({
          object: "block",
          type: "to_do",
          to_do: {
            rich_text: [{ type: "text", text: { content: item } }],
            checked: false,
          },
        })),
      }),
    });
  }
}
