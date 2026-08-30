import { describe, it, expect, vi, beforeEach } from "vitest";
import { getDueSoonNoticeText, syncTaskCalendarEvent, syncCalendar } from "../../../src/handlers/calendar.js";
import { createMockEnv } from "../../helpers/mocks.js";
import type { Task } from "../../../src/types.js";

vi.mock("../../../src/clients/tasks.js", () => ({
  getOpenTasks: vi.fn(),
}));

// sendMessage のみモックし、escapeMd は実装をそのまま使う（エスケープを検証するため）
vi.mock("../../../src/clients/telegram.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/clients/telegram.js")>()),
  sendMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/clients/gcal-api.js", () => ({
  getTodaysEvents: vi.fn().mockResolvedValue([]),
  insertEvent: vi.fn().mockResolvedValue("event-id"),
  deleteEvent: vi.fn().mockResolvedValue(undefined),
  updateEventDateTime: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../../src/storage/d1.js", () => ({
  getAllCalendarSync: vi.fn().mockResolvedValue(new Map()),
  getCalendarSync: vi.fn().mockResolvedValue(null),
  setCalendarSync: vi.fn().mockResolvedValue(undefined),
  deleteCalendarSync: vi.fn().mockResolvedValue(undefined),
}));

describe("getDueSoonNoticeText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends notice for tasks due today and tomorrow", async () => {
    const env = createMockEnv();
    const { getOpenTasks } = await import("../../../src/clients/tasks.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
    const today = now.toISOString().slice(0, 10);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    const tasks: Task[] = [
      { title: "今日期限タスク", due: today, priority: "high", status: "未着手", location: null, lastEdited: null, url: "", pageId: "p1" },
      { title: "明日期限タスク", due: tomorrowStr, priority: "medium", status: "未着手", location: null, lastEdited: null, url: "", pageId: "p2" },
      { title: "来週のタスク", due: "2099-01-01", priority: "low", status: "未着手", location: null, lastEdited: null, url: "", pageId: "p3" },
    ];

    const text = getDueSoonNoticeText(tasks);
    expect(text).toContain("今日期限タスク");
    expect(text).toContain("明日期限タスク");
    expect(text).not.toContain("来週のタスク");
  });

  it("escapes Markdown special characters in task titles", async () => {
    const env = createMockEnv();
    const { getOpenTasks } = await import("../../../src/clients/tasks.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
    const today = now.toISOString().slice(0, 10);

    const tasks: Task[] = [
      { title: "請求書_確認 *重要*", due: today, priority: "high", status: "未着手", location: null, lastEdited: null, url: "", pageId: "p1" },
    ];

    const text = getDueSoonNoticeText(tasks);
    expect(text).toContain("請求書\\_確認 \\*重要\\*");
  });

  it("does not send when no tasks due soon", async () => {
    const env = createMockEnv();
    const { getOpenTasks } = await import("../../../src/clients/tasks.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    const tasks: Task[] = [
      { title: "来月のタスク", due: "2099-01-01", priority: "low", status: "未着手", location: null, lastEdited: null, url: "", pageId: "p1" },
    ];

    const text = getDueSoonNoticeText(tasks);
    expect(text).toBeNull();
  });
});

describe("syncTaskCalendarEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a timed event and stores the full due as the dedup key (no prior record)", async () => {
    const env = createMockEnv();
    const { insertEvent, deleteEvent } = await import("../../../src/clients/gcal-api.js");
    const { getCalendarSync, setCalendarSync } = await import("../../../src/storage/d1.js");
    (getCalendarSync as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await syncTaskCalendarEvent(env, { pageId: "p1", title: "歯医者", due: "2099-05-17T17:00:00" });

    expect(deleteEvent).not.toHaveBeenCalled();
    expect(insertEvent).toHaveBeenCalledWith(env, "歯医者", "2099-05-17T17:00:00");
    expect(setCalendarSync).toHaveBeenCalledWith(env, "p1", "event-id", "2099-05-17T17:00:00");
  });

  it("skips entirely when the task has no due", async () => {
    const env = createMockEnv();
    const { insertEvent } = await import("../../../src/clients/gcal-api.js");
    const { setCalendarSync } = await import("../../../src/storage/d1.js");

    await syncTaskCalendarEvent(env, { pageId: "p1", title: "no due", due: null });

    expect(insertEvent).not.toHaveBeenCalled();
    expect(setCalendarSync).not.toHaveBeenCalled();
  });

  it("early-returns when the existing record matches the effective due", async () => {
    const env = createMockEnv();
    const { insertEvent, deleteEvent } = await import("../../../src/clients/gcal-api.js");
    const { getCalendarSync, setCalendarSync } = await import("../../../src/storage/d1.js");
    (getCalendarSync as ReturnType<typeof vi.fn>).mockResolvedValue({
      eventId: "ev-old",
      calendarDate: "2099-05-17T17:00:00",
    });

    await syncTaskCalendarEvent(env, { pageId: "p1", title: "歯医者", due: "2099-05-17T17:00:00" });

    expect(deleteEvent).not.toHaveBeenCalled();
    expect(insertEvent).not.toHaveBeenCalled();
    expect(setCalendarSync).not.toHaveBeenCalled();
  });

  it("PATCHes the existing event when only the time changes on the same date (preserves event metadata)", async () => {
    const env = createMockEnv();
    const { insertEvent, deleteEvent, updateEventDateTime } = await import("../../../src/clients/gcal-api.js");
    const { getCalendarSync, setCalendarSync } = await import("../../../src/storage/d1.js");
    // legacy row stored date-only
    (getCalendarSync as ReturnType<typeof vi.fn>).mockResolvedValue({
      eventId: "ev-old",
      calendarDate: "2099-05-17",
    });
    (updateEventDateTime as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    await syncTaskCalendarEvent(env, { pageId: "p1", title: "歯医者", due: "2099-05-17T17:00:00" });

    expect(updateEventDateTime).toHaveBeenCalledWith(env, "ev-old", "2099-05-17T17:00:00");
    expect(deleteEvent).not.toHaveBeenCalled();
    expect(insertEvent).not.toHaveBeenCalled();
    expect(setCalendarSync).toHaveBeenCalledWith(env, "p1", "ev-old", "2099-05-17T17:00:00");
  });

  it("falls back to recreate when PATCH returns false (event already gone)", async () => {
    const env = createMockEnv();
    const { insertEvent, deleteEvent, updateEventDateTime } = await import("../../../src/clients/gcal-api.js");
    const { getCalendarSync, setCalendarSync } = await import("../../../src/storage/d1.js");
    (getCalendarSync as ReturnType<typeof vi.fn>).mockResolvedValue({
      eventId: "ev-stale",
      calendarDate: "2099-05-17",
    });
    (updateEventDateTime as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    await syncTaskCalendarEvent(env, { pageId: "p1", title: "歯医者", due: "2099-05-17T17:00:00" });

    expect(updateEventDateTime).toHaveBeenCalledWith(env, "ev-stale", "2099-05-17T17:00:00");
    expect(deleteEvent).toHaveBeenCalledWith(env, "ev-stale");
    expect(insertEvent).toHaveBeenCalledWith(env, "歯医者", "2099-05-17T17:00:00");
    expect(setCalendarSync).toHaveBeenCalledWith(env, "p1", "event-id", "2099-05-17T17:00:00");
  });

  it("moves an overdue task to today (date-only)", async () => {
    const env = createMockEnv();
    const { insertEvent } = await import("../../../src/clients/gcal-api.js");
    const { getCalendarSync, setCalendarSync } = await import("../../../src/storage/d1.js");
    (getCalendarSync as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const today = new Date().toISOString().slice(0, 10);
    await syncTaskCalendarEvent(env, { pageId: "p1", title: "期限切れ", due: "2000-01-01T09:00:00" });

    expect(insertEvent).toHaveBeenCalledWith(env, "期限切れ", today);
    expect(setCalendarSync).toHaveBeenCalledWith(env, "p1", "event-id", today);
  });
});

describe("syncCalendar (delegates to syncTaskCalendarEvent)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates one event for a single due task with an empty sync store", async () => {
    const env = createMockEnv();
    const { getOpenTasks } = await import("../../../src/clients/tasks.js");
    const { insertEvent } = await import("../../../src/clients/gcal-api.js");
    const { getAllCalendarSync, getCalendarSync, setCalendarSync } = await import("../../../src/storage/d1.js");
    (getAllCalendarSync as ReturnType<typeof vi.fn>).mockResolvedValue(new Map());
    (getCalendarSync as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "予定タスク", due: "2099-06-01T10:00:00", priority: "medium", status: "未着手", location: null, lastEdited: null, url: "", pageId: "p1" },
    ]);

    await syncCalendar(env);

    expect(insertEvent).toHaveBeenCalledTimes(1);
    expect(insertEvent).toHaveBeenCalledWith(env, "予定タスク", "2099-06-01T10:00:00");
    expect(setCalendarSync).toHaveBeenCalledWith(env, "p1", "event-id", "2099-06-01T10:00:00");
  });
});
