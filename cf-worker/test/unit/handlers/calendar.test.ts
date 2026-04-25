import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendDueSoonNotice } from "../../../src/handlers/calendar.js";
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
