import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import worker from "../../src/index.js";
import { createMockEnv } from "../helpers/mocks.js";
import { runNotificationTrigger } from "../../src/handlers/notification-trigger.js";

// Mock external clients to isolate integration pathways
vi.mock("../../src/clients/gcal-api.js", () => ({
  getTodaysEvents: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/clients/notion.js", () => ({
  getOpenTasks: vi.fn(),
  escalatePriorityTasks: vi.fn().mockResolvedValue([]),
  promoteBacklogTasks: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/clients/gemini.js", () => ({
  selectHomeArrivalNotifications: vi.fn(),
  selectOfficeLeaveNotifications: vi.fn(),
  summarizeDay: vi.fn().mockResolvedValue("E2E Gemini Summary"),
}));

vi.mock("../../src/clients/telegram.js", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  escapeMd: (t: string) => t.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&"),
  getFileUrl: vi.fn(),
}));

function makeScheduledEvent(cron: string): ScheduledEvent {
  return {
    cron,
    scheduledTime: Date.now(),
    type: "scheduled",
    waitUntil: vi.fn(),
    noRetry: vi.fn(),
  } as unknown as ScheduledEvent;
}

function mockHolidaysApi(holidays: Record<string, string>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url.includes("holidays-jp.github.io")) {
        return Promise.resolve(
          new Response(JSON.stringify(holidays), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.resolve(new Response("", { status: 404 }));
    })
  );
}

// 常設の基準時刻（平日 20:30 JST = UTC 11:30、2026年6月15日月曜日）
const WEEKDAY_UTC_MS = Date.UTC(2026, 5, 15, 11, 30, 0);

function mockDateNow(ms: number) {
  vi.useFakeTimers();
  vi.setSystemTime(ms);
}

describe("E2E Workflow - Location-based Task Filtering", () => {
  const env = createMockEnv();

  const mockTasks = [
    { title: "Buy milk", priority: "high", location: "home", due: null, status: "未着手", url: "", pageId: "p1" },
    { title: "Clean room", priority: "medium", location: "自宅", due: null, status: "未着手", url: "", pageId: "p2" },
    { title: "Water plants", priority: "low", location: "家", due: null, status: "未着手", url: "", pageId: "p3" },
    { title: "Write report", priority: "high", location: "office", due: null, status: "未着手", url: "", pageId: "p4" },
    { title: "Attend meeting", priority: "medium", location: "オフィス", due: null, status: "未着手", url: "", pageId: "p5" },
    { title: "Clean desk", priority: "low", location: "会社", due: null, status: "未着手", url: "", pageId: "p6" },
    { title: "Buy coffee", priority: "low", location: "職場", due: null, status: "未着手", url: "", pageId: "p7" },
    { title: "Read book", priority: "medium", location: null, due: null, status: "未着手", url: "", pageId: "p8" },
    { title: "Buy groceries", priority: "medium", location: "Home", due: null, status: "未着手", url: "", pageId: "p9" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockDateNow(WEEKDAY_UTC_MS);
    mockHolidaysApi({}); // Not a holiday
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("handles home-arrival trigger: extracts home tasks, case-insensitive (Gemini selection stopped)", async () => {
    const { getOpenTasks } = await import("../../src/clients/notion.js");
    const { sendMessage } = await import("../../src/clients/telegram.js");

    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue(mockTasks);

    const req = new Request("https://example.com/home-arrival", {
      method: "GET",
      headers: { Authorization: `Bearer ${env.ALERT_TOKEN}` },
    });

    const resp = await worker.fetch(req, env);
    expect(resp.status).toBe(200);

    const body = await resp.json<{ notifications: Array<{ title: string; priority: string }> }>();

    // Expected home arrival notifications (Location プロパティ一致のみ、Gemini 選定は停止済み):
    // 1. Buy milk (home)
    // 2. Clean room (自宅)
    // 3. Water plants (家)
    // 4. Buy groceries (Home - case insensitive)
    expect(body.notifications).toHaveLength(4);
    const titles = body.notifications.map((n) => n.title);
    expect(titles).toContain("Buy milk");
    expect(titles).toContain("Clean room");
    expect(titles).toContain("Water plants");
    expect(titles).toContain("Buy groceries");

    // Verify Telegram message was sent
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("帰宅通知"));
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("Buy milk"));
  });

  it("handles office-leave trigger: extracts office tasks, case-insensitive (Gemini selection stopped)", async () => {
    const { getOpenTasks } = await import("../../src/clients/notion.js");
    const { sendMessage } = await import("../../src/clients/telegram.js");

    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue(mockTasks);

    const req = new Request("https://example.com/office-leave", {
      method: "GET",
      headers: { Authorization: `Bearer ${env.ALERT_TOKEN}` },
    });

    const resp = await worker.fetch(req, env);
    expect(resp.status).toBe(200);

    const body = await resp.json<{ notifications: Array<{ title: string; priority: string }> }>();

    // Expected office leave notifications (Location プロパティ一致のみ、Gemini 選定は停止済み):
    // 1. Write report (office)
    // 2. Attend meeting (オフィス)
    // 3. Clean desk (会社)
    // 4. Buy coffee (職場)
    expect(body.notifications).toHaveLength(4);
    const titles = body.notifications.map((n) => n.title);
    expect(titles).toContain("Write report");
    expect(titles).toContain("Attend meeting");
    expect(titles).toContain("Clean desk");
    expect(titles).toContain("Buy coffee");

    // Verify Telegram message was sent
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("退社通知"));
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("Write report"));
  });

  it("sends a proper Telegram notification when no tasks are found", async () => {
    const { getOpenTasks } = await import("../../src/clients/notion.js");
    const { sendMessage } = await import("../../src/clients/telegram.js");

    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const req = new Request("https://example.com/home-arrival", {
      method: "GET",
      headers: { Authorization: `Bearer ${env.ALERT_TOKEN}` },
    });

    const resp = await worker.fetch(req, env);
    expect(resp.status).toBe(200);
    const body = await resp.json<{ notifications: unknown[] }>();
    expect(body.notifications).toHaveLength(0);

    // Verify Telegram notification was sent indicating no tasks
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("該当するタスクはありません"));
  });
});

describe("E2E Integration - Separation of Judgment Logic", () => {
  const env = createMockEnv();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDateNow(WEEKDAY_UTC_MS);
    mockHolidaysApi({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("runNotificationTrigger coordinates APIs and calls injected selection function", async () => {
    const { getOpenTasks } = await import("../../src/clients/notion.js");
    const { sendMessage } = await import("../../src/clients/telegram.js");

    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "Task A", priority: "high", location: null, due: null, status: "未着手", url: "", pageId: "p1" },
      { title: "Task B", priority: "low", location: null, due: null, status: "未着手", url: "", pageId: "p2" },
    ]);

    const mockSelect = vi.fn().mockResolvedValue([
      { title: "Task A", priority: "high" },
    ]);

    const result = await runNotificationTrigger(env, mockSelect, "⚡ *Custom Trigger*");

    // Assert the injected select function is called with env, tasks list, and date string
    expect(mockSelect).toHaveBeenCalledWith(env, expect.any(Array), expect.any(String));
    expect(mockSelect.mock.calls[0][1]).toHaveLength(2);

    // Assert that the result matches the output of the select function
    expect(result).toEqual([{ title: "Task A", priority: "high" }]);

    // Assert Telegram notification was sent
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("Custom Trigger"));
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("🔴 [Task A]"));
  });
});
