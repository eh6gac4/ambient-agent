import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleTelegramWebhook } from "../../../src/handlers/telegram.js";
import { createMockEnv, sampleTasks } from "../../helpers/mocks.js";
import telegramFixtures from "../../fixtures/telegram-updates.json" assert { type: "json" };

vi.mock("../../../src/clients/notion.js", () => ({
  getOpenTasks: vi.fn(),
  addTask: vi.fn().mockResolvedValue("page-new"),
  completeTask: vi.fn().mockResolvedValue(undefined),
  cancelTask: vi.fn().mockResolvedValue(undefined),
  updateTaskDue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/clients/telegram.js", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  getFileUrl: vi.fn(),
  escapeMd: (t: string) => t,
}));

vi.mock("../../../src/handlers/calendar.js", () => ({
  deleteCalendarEventForTask: vi.fn().mockResolvedValue(undefined),
  getTodaysEvents: vi.fn().mockResolvedValue([]),
  syncCalendar: vi.fn().mockResolvedValue(undefined),
  sendDueSoonNotice: vi.fn().mockResolvedValue(undefined),
  sendTaskReminder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/handlers/briefing.js", () => ({
  sendDailyBriefing: vi.fn().mockResolvedValue(undefined),
  sendCostReport: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/clients/anthropic.js", () => ({
  extractTasksFromText: vi.fn().mockResolvedValue([{ title: "テストタスク", due: null, priority: "medium" }]),
  extractTasksFromUrlContent: vi.fn().mockResolvedValue([]),
  extractTasksFromImage: vi.fn().mockResolvedValue([]),
  summarizeDay: vi.fn().mockResolvedValue("今日のブリーフィング"),
}));

vi.mock("../../../src/storage/d1.js", () => ({
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

describe("handleTelegramWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ignores messages from wrong chat", async () => {
    const env = createMockEnv();
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    await handleTelegramWebhook(env, telegramFixtures.wrongChatMessage);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("ignores updates with no message", async () => {
    const env = createMockEnv();
    await handleTelegramWebhook(env, { update_id: 999 });
    // should not throw
  });

  it("/add command creates a task", async () => {
    const env = createMockEnv();
    const { addTask } = await import("../../../src/clients/notion.js");

    await handleTelegramWebhook(env, telegramFixtures.addCommand);
    expect(addTask).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ title: "資料を確認する", source: "Telegram" }),
    );
  });

  it("/tasks command fetches open tasks and caches them", async () => {
    const env = createMockEnv();
    const { getOpenTasks } = await import("../../../src/clients/notion.js");
    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue(sampleTasks());

    await handleTelegramWebhook(env, telegramFixtures.tasksCommand);
    expect(getOpenTasks).toHaveBeenCalledWith(env);
  });

  it("/done command without prior /tasks sends guidance message", async () => {
    const env = createMockEnv();
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    // Empty cache → should send hint message
    await handleTelegramWebhook(env, telegramFixtures.doneCommand);
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("/tasks"));
  });

  it("/due validates date format", async () => {
    const env = createMockEnv();
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    const badDueUpdate = {
      update_id: 9999,
      message: { message_id: 99, chat: { id: 123456789 }, text: "/due 1 not-a-date" },
    };
    await handleTelegramWebhook(env, badDueUpdate);
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("YYYY-MM-DD"));
  });
});
