import { describe, it, expect, vi, beforeEach } from "vitest";
import worker from "../../src/index.js";
import { createMockEnv, sampleTasks } from "../helpers/mocks.js";
import telegramFixtures from "../fixtures/telegram-updates.json" assert { type: "json" };

vi.mock("../../src/clients/notion.js", () => ({
  getOpenTasks: vi.fn().mockResolvedValue([]),
  addTask: vi.fn().mockResolvedValue("page-new"),
  completeTask: vi.fn().mockResolvedValue(undefined),
  cancelTask: vi.fn().mockResolvedValue(undefined),
  updateTaskDue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/clients/telegram.js", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  getFileUrl: vi.fn(),
  escapeMd: (t: string) => t,
}));

vi.mock("../../src/clients/anthropic.js", () => ({
  analyzeEmail: vi.fn(),
  extractTasksFromText: vi.fn().mockResolvedValue([]),
  extractTasksFromUrlContent: vi.fn().mockResolvedValue([]),
  extractTasksFromImage: vi.fn().mockResolvedValue([]),
  summarizeDay: vi.fn().mockResolvedValue("ブリーフィング"),
}));

vi.mock("../../src/handlers/calendar.js", () => ({
  deleteCalendarEventForTask: vi.fn().mockResolvedValue(undefined),
  syncCalendar: vi.fn().mockResolvedValue(undefined),
  sendDueSoonNotice: vi.fn().mockResolvedValue(undefined),
  sendTaskReminder: vi.fn().mockResolvedValue(undefined),
  getTodaysEvents: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/handlers/briefing.js", () => ({
  sendDailyBriefing: vi.fn().mockResolvedValue(undefined),
  sendCostReport: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/handlers/escalation.js", () => ({
  sendEscalationNotice: vi.fn().mockResolvedValue(undefined),
  sendStaleTasksNotice: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/storage/d1.js", () => ({
  getSenderForTask: vi.fn().mockResolvedValue(null),
  getThreadMapEntry: vi.fn().mockResolvedValue(null),
  setThreadMapEntry: vi.fn().mockResolvedValue(undefined),
  setSenderForTask: vi.fn().mockResolvedValue(undefined),
  deleteSenderMapEntry: vi.fn().mockResolvedValue(undefined),
  getAllSenderMap: vi.fn().mockResolvedValue(new Map()),
  isProcessed: vi.fn().mockResolvedValue(false),
  markProcessed: vi.fn().mockResolvedValue(undefined),
  cleanOldProcessed: vi.fn().mockResolvedValue(undefined),
  getCalendarSync: vi.fn().mockResolvedValue(null),
  setCalendarSync: vi.fn().mockResolvedValue(undefined),
  deleteCalendarSync: vi.fn().mockResolvedValue(undefined),
  getAllCalendarSync: vi.fn().mockResolvedValue(new Map()),
}));

function webhookRequest(update: unknown): Request {
  return new Request("https://example.com/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
}

describe("Telegram webhook E2E", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("/add creates task and responds OK", async () => {
    const env = createMockEnv();
    const { addTask } = await import("../../src/clients/notion.js");

    const resp = await worker.fetch(webhookRequest(telegramFixtures.addCommand), env);
    expect(resp.status).toBe(200);
    expect(addTask).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ title: "資料を確認する" }),
    );
  });

  it("/tasks sends task list", async () => {
    const env = createMockEnv();
    const { getOpenTasks } = await import("../../src/clients/notion.js");
    const { sendMessage } = await import("../../src/clients/telegram.js");
    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue(sampleTasks());

    const resp = await worker.fetch(webhookRequest(telegramFixtures.tasksCommand), env);
    expect(resp.status).toBe(200);
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("タスク一覧"));
  });

  it("ignores messages from wrong chat ID", async () => {
    const env = createMockEnv();
    const { sendMessage } = await import("../../src/clients/telegram.js");

    await worker.fetch(webhookRequest(telegramFixtures.wrongChatMessage), env);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("returns OK even if handler throws", async () => {
    const env = createMockEnv();
    const { addTask } = await import("../../src/clients/notion.js");
    (addTask as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Notion error"));

    const resp = await worker.fetch(webhookRequest(telegramFixtures.addCommand), env);
    expect(resp.status).toBe(200);
  });
});
