import { describe, it, expect, beforeEach } from "vitest";
import {
  addTask,
  addSubtask,
  getOpenTasks,
  completeTask,
  cancelTask,
  updateTaskDue,
  updateTaskFromReply,
  getTaskStatus,
  getTaskTitleAndDue,
  escalatePriorityTasks,
  promoteBacklogTasks,
  uploadTaskImage,
  sanitizeEmoji,
} from "../../../src/clients/tasks.js";
import type { Env } from "../../../src/types.js";
import { setupTaskStore, seedTask, dateOffset } from "../../helpers/task-store.js";

let env: Env;

beforeEach(async () => {
  env = await setupTaskStore();
});

async function row(id: string): Promise<Record<string, unknown>> {
  const r = await env.TASKS_DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
  return (r ?? {}) as Record<string, unknown>;
}

describe("addTask", () => {
  it("inserts a task row with the required columns", async () => {
    const id = await addTask(env, { title: "テストタスク", priority: "high", source: "Gmail" });
    expect(id).toBeTruthy();

    const task = await row(id!);
    expect(task.title).toBe("テストタスク");
    expect(task.status).toBe("未着手");
    expect(task.priority).toBe("high");
    expect(task.source).toBe("Gmail");
    // 移行済みタスクと区別するため、D1 で新規作成したタスクの notion_url は空文字。
    expect(task.notion_url).toBe("");
  });

  it("defaults priority to medium and source to Telegram", async () => {
    const id = await addTask(env, { title: "既定値" });
    const task = await row(id!);
    expect(task.priority).toBe("medium");
    expect(task.source).toBe("Telegram");
  });

  it("stores a date-only due as-is", async () => {
    const id = await addTask(env, { title: "期限付きタスク", due: "2026-05-01", priority: "medium" });
    expect((await row(id!)).due).toBe("2026-05-01");
  });

  it("stores a datetime due with the JST offset the todo app expects", async () => {
    const id = await addTask(env, { title: "時刻付き", due: "2026-05-21T10:30" });
    expect((await row(id!)).due).toBe("2026-05-21T10:30:00.000+09:00");
  });

  it("keeps a due that already carries an offset", async () => {
    const id = await addTask(env, { title: "オフセット付き", due: "2026-05-21T10:30:00.000+09:00" });
    expect((await row(id!)).due).toBe("2026-05-21T10:30:00.000+09:00");
  });

  it("stores sourceUrl", async () => {
    const id = await addTask(env, { title: "URL 付き", source: "Gmail", sourceUrl: "https://mail.google.com/x" });
    expect((await row(id!)).source_url).toBe("https://mail.google.com/x");
  });

  it("creates subtasks linked by a parent relation", async () => {
    const parentId = await addTask(
      env,
      { title: "親タスク", source: "Gmail", sourceUrl: "https://mail.google.com/x" },
      [
        { title: "項目1", priority: "high", due: "2026-05-21", icon: "📩" },
        { title: "項目2", priority: "medium", due: null },
      ],
    );

    const subs = await env.TASKS_DB.prepare(
      `SELECT t.* FROM tasks t
         JOIN task_relations r ON r.from_id = t.id AND r.type = 'parent'
        WHERE r.to_id = ?
        ORDER BY t.title`,
    )
      .bind(parentId)
      .all<Record<string, unknown>>();

    expect(subs.results).toHaveLength(2);
    expect(subs.results[0].title).toBe("項目1");
    expect(subs.results[0].priority).toBe("high");
    expect(subs.results[0].due).toBe("2026-05-21");
    expect(subs.results[0].icon_value).toBe("📩");
    // 親から source / sourceUrl を引き継ぐ
    expect(subs.results[0].source).toBe("Gmail");
    expect(subs.results[0].source_url).toBe("https://mail.google.com/x");
    expect(subs.results[1].title).toBe("項目2");
    expect(subs.results[1].due).toBeNull();
  });

  it("appends the email body as a markdown section", async () => {
    const id = await addTask(env, { title: "メール本文付き" }, undefined, "これはメール本文です。");
    const body = (await row(id!)).body as string;
    expect(body).toContain("### 📧 メール本文");
    expect(body).toContain("これはメール本文です。");
  });

  it("truncates an email body over 10000 chars with a notice", async () => {
    const id = await addTask(env, { title: "超長文" }, undefined, "x".repeat(15000));
    const body = (await row(id!)).body as string;
    expect(body).toContain("…(以下省略)");
    expect(body.length).toBeLessThan(11000);
  });

  it("leaves body empty when there is no email body", async () => {
    const id = await addTask(env, { title: "本文なし" }, undefined, "");
    expect((await row(id!)).body).toBe("");
  });

  it("stores a valid emoji icon", async () => {
    const id = await addTask(env, { title: "絵文字アイコン付き", icon: "📩" });
    const task = await row(id!);
    expect(task.icon_type).toBe("emoji");
    expect(task.icon_value).toBe("📩");
  });

  it("drops an invalid icon and still creates the task", async () => {
    // LLM が絵文字でなく説明文を返したケース
    const id = await addTask(env, { title: "不正アイコン", icon: "📩 返信" });
    const task = await row(id!);
    expect(task.icon_type).toBeNull();
    expect(task.icon_value).toBeNull();
    expect(task.title).toBe("不正アイコン");
  });

  it("registers an uploaded image as an attachment row", async () => {
    const attachment = {
      id: crypto.randomUUID(),
      key: "tasks/attachments/x/telegram.jpg",
      name: "telegram.jpg",
      contentType: "image/jpeg",
      size: 1024,
    };
    const id = await addTask(env, { title: "画像付き" }, undefined, undefined, attachment);

    const att = await env.TASKS_DB.prepare("SELECT * FROM task_attachments WHERE task_id = ?")
      .bind(id)
      .first<Record<string, unknown>>();
    expect(att?.r2_key).toBe(attachment.key);
    expect(att?.name).toBe("telegram.jpg");
    expect(att?.content_type).toBe("image/jpeg");
    expect(att?.size).toBe(1024);
    expect(att?.sort_order).toBe(0);
  });
});

describe("uploadTaskImage", () => {
  it("puts the image into R2 and returns its descriptor", async () => {
    const data = new ArrayBuffer(512);
    const attachment = await uploadTaskImage(env, data, "image/png", "telegram-1.png");
    expect(attachment).not.toBeNull();
    expect(attachment!.key).toContain("telegram-1.png");

    const object = await env.TASK_ATTACHMENTS!.get(attachment!.key);
    expect(object).not.toBeNull();
    expect((await object!.arrayBuffer()).byteLength).toBe(512);
  });

  it("returns null for a file over the 20 MB limit", async () => {
    const attachment = await uploadTaskImage(env, new ArrayBuffer(21 * 1024 * 1024), "image/png", "big.png");
    expect(attachment).toBeNull();
  });

  it("returns null when the R2 binding is missing", async () => {
    const attachment = await uploadTaskImage(
      { ...env, TASK_ATTACHMENTS: undefined },
      new ArrayBuffer(8),
      "image/png",
      "x.png",
    );
    expect(attachment).toBeNull();
  });
});

describe("addSubtask", () => {
  it("creates a task linked to its parent", async () => {
    await seedTask(env, { id: "parent-1", title: "親" });
    const id = await addSubtask(env, "parent-1", {
      title: "サブ",
      priority: "high",
      due: "2026-05-21T10:30",
      icon: "📩",
      source: "Gmail",
    });

    expect(id).toBeTruthy();
    const task = await row(id!);
    expect(task.due).toBe("2026-05-21T10:30:00.000+09:00");
    expect(task.icon_value).toBe("📩");

    const rel = await env.TASKS_DB.prepare(
      "SELECT * FROM task_relations WHERE from_id = ? AND to_id = ? AND type = 'parent'",
    )
      .bind(id, "parent-1")
      .first();
    expect(rel).not.toBeNull();
  });

  it("returns null instead of throwing when the parent does not exist", async () => {
    const id = await addSubtask(env, "missing-parent", { title: "子" });
    expect(id).toBeNull();
  });
});

describe("getOpenTasks", () => {
  it("returns open tasks with mapped fields and skips closed ones", async () => {
    await seedTask(env, {
      id: "page-001",
      title: "プロジェクト資料を確認する",
      priority: "high",
      due: "2026-04-30",
      location: "オフィス",
      lastEdited: "2026-04-20T09:00:00.000Z",
    });
    await seedTask(env, { id: "page-002", title: "進行中タスク", status: "進行中" });
    await seedTask(env, { id: "page-003", title: "完了タスク", status: "完了" });
    await seedTask(env, { id: "page-004", title: "バックログ", status: "バックログ" });

    const tasks = await getOpenTasks(env);
    expect(tasks.map((t) => t.pageId).sort()).toEqual(["page-001", "page-002"]);

    const first = tasks.find((t) => t.pageId === "page-001")!;
    expect(first.title).toBe("プロジェクト資料を確認する");
    expect(first.priority).toBe("high");
    expect(first.due).toBe("2026-04-30");
    expect(first.location).toBe("オフィス");
    expect(first.lastEdited).toBe("2026-04-20");
  });

  it("returns an empty array when there are no open tasks", async () => {
    expect(await getOpenTasks(env)).toEqual([]);
  });
});

describe("completeTask / cancelTask", () => {
  it("updates status to 完了", async () => {
    await seedTask(env, { id: "page-001" });
    await completeTask(env, "page-001");
    expect((await row("page-001")).status).toBe("完了");
  });

  it("updates status to 中止", async () => {
    await seedTask(env, { id: "page-001" });
    await cancelTask(env, "page-001");
    expect((await row("page-001")).status).toBe("中止");
  });

  it("throws when the task does not exist", async () => {
    await expect(completeTask(env, "missing")).rejects.toThrow();
    await expect(cancelTask(env, "missing")).rejects.toThrow();
  });
});

describe("updateTaskDue", () => {
  it("sets the due date", async () => {
    await seedTask(env, { id: "page-001" });
    await updateTaskDue(env, "page-001", "2026-06-01");
    expect((await row("page-001")).due).toBe("2026-06-01");
  });

  it("throws when the task does not exist", async () => {
    await expect(updateTaskDue(env, "missing", "2026-06-01")).rejects.toThrow();
  });
});

describe("getTaskStatus / getTaskTitleAndDue", () => {
  it("reads status and title/due", async () => {
    await seedTask(env, { id: "page-001", title: "見積を送る", status: "中止", due: "2026-06-01" });
    expect(await getTaskStatus(env, "page-001")).toBe("中止");
    expect(await getTaskTitleAndDue(env, "page-001")).toEqual({ title: "見積を送る", due: "2026-06-01" });
  });

  it("returns null for a deleted task", async () => {
    expect(await getTaskStatus(env, "missing")).toBeNull();
    expect(await getTaskTitleAndDue(env, "missing")).toBeNull();
  });
});

describe("escalatePriorityTasks", () => {
  it("escalates medium tasks due within 3 days", async () => {
    await seedTask(env, { id: "page-escalate", title: "緊急タスク", due: dateOffset(2) });
    await seedTask(env, { id: "page-later", title: "先のタスク", due: dateOffset(10) });
    await seedTask(env, { id: "page-high", title: "既に high", priority: "high", due: dateOffset(1) });
    await seedTask(env, { id: "page-done", title: "完了", status: "完了", due: dateOffset(1) });
    await seedTask(env, { id: "page-nodue", title: "期限なし", due: null });

    const escalated = await escalatePriorityTasks(env);
    expect(escalated.map((t) => t.title)).toEqual(["緊急タスク"]);
    expect((await row("page-escalate")).priority).toBe("high");
    expect((await row("page-later")).priority).toBe("medium");
  });

  it("ignores tasks whose due already passed", async () => {
    await seedTask(env, { id: "page-overdue", due: dateOffset(-1) });
    expect(await escalatePriorityTasks(env)).toHaveLength(0);
  });
});

describe("promoteBacklogTasks", () => {
  it("promotes backlog tasks due within 3 days to 未着手", async () => {
    await seedTask(env, { id: "page-promote", title: "下書きレビュー", status: "バックログ", due: dateOffset(2) });
    await seedTask(env, { id: "page-overdue", title: "期限切れ", status: "バックログ", due: dateOffset(-5) });
    await seedTask(env, { id: "page-far", title: "先", status: "バックログ", due: dateOffset(10) });
    await seedTask(env, { id: "page-nodue", title: "期限なし", status: "バックログ", due: null });

    const promoted = await promoteBacklogTasks(env);
    expect(promoted.map((t) => t.title).sort()).toEqual(["下書きレビュー", "期限切れ"]);
    expect((await row("page-promote")).status).toBe("未着手");
    expect((await row("page-far")).status).toBe("バックログ");
    expect((await row("page-nodue")).status).toBe("バックログ");
  });

  it("returns empty when no backlog tasks are eligible", async () => {
    expect(await promoteBacklogTasks(env)).toHaveLength(0);
  });
});

describe("updateTaskFromReply", () => {
  it("raises priority only when the reply is more urgent", async () => {
    await seedTask(env, { id: "page-001", priority: "medium" });
    await updateTaskFromReply(env, "page-001", "high", null);
    expect((await row("page-001")).priority).toBe("high");

    await updateTaskFromReply(env, "page-001", "low", null);
    expect((await row("page-001")).priority).toBe("high");
  });

  it("moves the due date up but never back", async () => {
    await seedTask(env, { id: "page-001", due: "2026-06-10" });
    await updateTaskFromReply(env, "page-001", "medium", "2026-06-01");
    expect((await row("page-001")).due).toBe("2026-06-01");

    await updateTaskFromReply(env, "page-001", "medium", "2026-06-20");
    expect((await row("page-001")).due).toBe("2026-06-01");
  });

  it("appends the reply body without creating any new task", async () => {
    await seedTask(env, {
      id: "page-001",
      body: "---\n\n### 📧 メール本文\n\n最初の本文",
    });

    await updateTaskFromReply(env, "page-001", "high", null, "返信の本文です。");

    const body = (await row("page-001")).body as string;
    expect(body).toContain("最初の本文");
    expect(body).toContain("### 📧 返信メール");
    expect(body).toContain("返信の本文です。");

    // 返信では子タスクを一切作らない
    const count = await env.TASKS_DB.prepare("SELECT COUNT(*) AS n FROM tasks").first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("throws when the task no longer exists", async () => {
    await expect(updateTaskFromReply(env, "missing", "high", null)).rejects.toThrow();
  });
});

describe("sanitizeEmoji", () => {
  it("keeps a plain single emoji", () => {
    expect(sanitizeEmoji("📩")).toBe("📩");
  });

  it("keeps emoji with variation selector / ZWJ sequence / skin tone / flag / keycap", () => {
    expect(sanitizeEmoji("✋️")).toBe("✋️");
    expect(sanitizeEmoji("🧑‍💻")).toBe("🧑‍💻");
    expect(sanitizeEmoji("👍🏽")).toBe("👍🏽");
    expect(sanitizeEmoji("🇯🇵")).toBe("🇯🇵");
    expect(sanitizeEmoji("1️⃣")).toBe("1️⃣");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeEmoji("  📅 ")).toBe("📅");
  });

  it("drops non-emoji / mixed / empty input", () => {
    expect(sanitizeEmoji(undefined)).toBeUndefined();
    expect(sanitizeEmoji("")).toBeUndefined();
    expect(sanitizeEmoji("   ")).toBeUndefined();
    expect(sanitizeEmoji("返信")).toBeUndefined();
    expect(sanitizeEmoji("task")).toBeUndefined();
    expect(sanitizeEmoji("📩 返信")).toBeUndefined();
    expect(sanitizeEmoji(":email:")).toBeUndefined();
    expect(sanitizeEmoji("9".repeat(20))).toBeUndefined();
  });
});
