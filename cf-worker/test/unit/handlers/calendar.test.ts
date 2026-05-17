import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendDueSoonNotice, syncTaskCalendarEvent, syncCalendar } from "../../../src/handlers/calendar.js";
import { createMockEnv } from "../../helpers/mocks.js";
import type { Task } from "../../../src/types.js";

vi.mock("../../../src/clients/notion.js", () => ({
  getOpenTasks: vi.fn(),
}));

vi.mock("../../../src/clients/telegram.js", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/clients/gcal-api.js", () => ({
  getTodaysEvents: vi.fn().mockResolvedValue([]),
  insertEvent: vi.fn().mockResolvedValue("event-id"),
  deleteEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/storage/d1.js", () => ({
  getAllCalendarSync: vi.fn().mockResolvedValue(new Map()),
  getCalendarSync: vi.fn().mockResolvedValue(null),
  setCalendarSync: vi.fn().mockResolvedValue(undefined),
  deleteCalendarSync: vi.fn().mockResolvedValue(undefined),
}));

describe("sendDueSoonNotice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends notice for tasks due today and tomorrow", async () => {
    const env = createMockEnv();
    const { getOpenTasks } = await import("../../../src/clients/notion.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
    const today = now.toISOString().slice(0, 10);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    const tasks: Task[] = [
      { title: "今日期限タスク", due: today, priority: "high", status: "未着手", lastEdited: null, url: "", pageId: "p1" },
      { title: "明日期限タスク", due: tomorrowStr, priority: "medium", status: "未着手", lastEdited: null, url: "", pageId: "p2" },
      { title: "来週のタスク", due: "2099-01-01", priority: "low", status: "未着手", lastEdited: null, url: "", pageId: "p3" },
    ];
    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue(tasks);

    await sendDueSoonNotice(env);
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("今日期限タスク"));
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("明日期限タスク"));
    expect(sendMessage).toHaveBeenCalledWith(env, expect.not.stringContaining("来週のタスク"));
  });

  it("does not send when no tasks due soon", async () => {
    const env = createMockEnv();
    const { getOpenTasks } = await import("../../../src/clients/notion.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "来月のタスク", due: "2099-01-01", priority: "low", status: "未着手", lastEdited: null, url: "", pageId: "p1" },
    ]);

    await sendDueSoonNotice(env);
    expect(sendMessage).not.toHaveBeenCalled();
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

  it("re-creates the event when only the time changes on the same date (dedup regression)", async () => {
    const env = createMockEnv();
    const { insertEvent, deleteEvent } = await import("../../../src/clients/gcal-api.js");
    const { getCalendarSync, setCalendarSync } = await import("../../../src/storage/d1.js");
    // legacy row stored date-only
    (getCalendarSync as ReturnType<typeof vi.fn>).mockResolvedValue({
      eventId: "ev-old",
      calendarDate: "2099-05-17",
    });

    await syncTaskCalendarEvent(env, { pageId: "p1", title: "歯医者", due: "2099-05-17T17:00:00" });

    expect(deleteEvent).toHaveBeenCalledWith(env, "ev-old");
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
    const { getOpenTasks } = await import("../../../src/clients/notion.js");
    const { insertEvent } = await import("../../../src/clients/gcal-api.js");
    const { getAllCalendarSync, getCalendarSync, setCalendarSync } = await import("../../../src/storage/d1.js");
    (getAllCalendarSync as ReturnType<typeof vi.fn>).mockResolvedValue(new Map());
    (getCalendarSync as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "予定タスク", due: "2099-06-01T10:00:00", priority: "medium", status: "未着手", lastEdited: null, url: "", pageId: "p1" },
    ]);

    await syncCalendar(env);

    expect(insertEvent).toHaveBeenCalledTimes(1);
    expect(insertEvent).toHaveBeenCalledWith(env, "予定タスク", "2099-06-01T10:00:00");
    expect(setCalendarSync).toHaveBeenCalledWith(env, "p1", "event-id", "2099-06-01T10:00:00");
  });
});
