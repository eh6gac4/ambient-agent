import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fmtDue, sortTasks, formatTaskList } from "../../../src/handlers/task-formatter.js";
import { sampleTasks } from "../../helpers/mocks.js";
import type { Task } from "../../../src/types.js";

describe("fmtDue", () => {
  it("returns empty string for null", () => {
    expect(fmtDue(null)).toBe("");
  });

  it("returns 今日 for today's date", () => {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
    const today = now.toISOString().slice(0, 10);
    expect(fmtDue(today)).toBe("今日");
  });

  it("returns 明日 for tomorrow", () => {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(fmtDue(tomorrow.toISOString().slice(0, 10))).toBe("明日");
  });

  it("returns 明後日 for two days from now", () => {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
    const dayAfterTomorrow = new Date(now);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
    expect(fmtDue(dayAfterTomorrow.toISOString().slice(0, 10))).toBe("明後日");
  });

  it("returns formatted date string for far future dates", () => {
    expect(fmtDue("2030-12-25")).toMatch(/2030年12月25日/);
  });
});

describe("sortTasks", () => {
  it("sorts by status → priority → due date", () => {
    const tasks: Task[] = [
      { title: "C", due: "2026-05-01", priority: "low", status: "未着手", lastEdited: null, url: "", pageId: "c" },
      { title: "A", due: "2026-04-25", priority: "high", status: "未着手", lastEdited: null, url: "", pageId: "a" },
      { title: "B", due: "2026-04-30", priority: "medium", status: "進行中", lastEdited: null, url: "", pageId: "b" },
    ];

    const sorted = sortTasks(tasks);
    // 未着手 comes before 進行中 (STATUS_ORDER)
    expect(sorted[0].title).toBe("A"); // high priority, earlier due
    expect(sorted[1].title).toBe("C"); // low priority
    expect(sorted[2].title).toBe("B"); // 進行中 status
  });

  it("sorts tasks without due date after tasks with due date", () => {
    const tasks: Task[] = [
      { title: "No Due", due: null, priority: "high", status: "未着手", lastEdited: null, url: "", pageId: "x" },
      { title: "Has Due", due: "2026-04-20", priority: "high", status: "未着手", lastEdited: null, url: "", pageId: "y" },
    ];

    const sorted = sortTasks(tasks);
    expect(sorted[0].title).toBe("Has Due");
  });
});

describe("formatTaskList", () => {
  it("includes priority icons and status headers", () => {
    const tasks = sampleTasks();
    const result = formatTaskList(tasks);
    expect(result).toContain("🔴");  // high priority icon
    expect(result).toContain("📋 未着手");
    expect(result).toContain("▶️ 進行中");
  });

  it("includes numbered prefix when numbered=true", () => {
    const tasks = sampleTasks().slice(0, 1);
    const result = formatTaskList(tasks, true);
    expect(result).toContain("1. ");
  });

  it("uses bullet prefix when numbered=false", () => {
    const tasks = sampleTasks().slice(0, 1);
    const result = formatTaskList(tasks, false);
    expect(result).toContain("• ");
    expect(result).not.toContain("1. ");
  });

  it("wraps title in notion-tasks app link using pageId", () => {
    const tasks = sampleTasks().slice(0, 1);
    const result = formatTaskList(tasks);
    expect(result).toContain("[プロジェクト資料を確認する](https://todo.eh6gac4.work/?task=page-001)");
  });

  it("falls back to plain title when pageId is empty", () => {
    const tasks: Task[] = [
      { title: "リンクなし", due: null, priority: "medium", status: "未着手", lastEdited: null, url: "", pageId: "" },
    ];
    const result = formatTaskList(tasks);
    expect(result).toContain("リンクなし");
    expect(result).not.toContain("](");
  });

  it("escapes ] in title within link text", () => {
    const tasks: Task[] = [
      { title: "タスク[1]", due: null, priority: "medium", status: "未着手", lastEdited: null, url: "https://notion.so/p", pageId: "abc123" },
    ];
    const result = formatTaskList(tasks);
    expect(result).toContain("[タスク[1\\]](https://todo.eh6gac4.work/?task=abc123)");
  });
});
