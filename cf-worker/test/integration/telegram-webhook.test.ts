import { describe, it, expect, vi, beforeEach } from "vitest";
import worker from "../../src/index.js";
import { createMockEnv, sampleTasks } from "../helpers/mocks.js";
import telegramFixtures from "../fixtures/telegram-updates.json" with { type: "json" };

vi.mock("../../src/clients/tasks.js", () => ({
  getOpenTasks: vi.fn().mockResolvedValue([]),
  addTask: vi.fn().mockResolvedValue("page-new"),
  completeTask: vi.fn().mockResolvedValue(undefined),
  cancelTask: vi.fn().mockResolvedValue(undefined),
  updateTaskDue: vi.fn().mockResolvedValue(undefined),
  uploadTaskImage: vi.fn().mockResolvedValue({ id: "att-001", key: "tasks/attachments/att-001/telegram.jpg", name: "telegram.jpg", contentType: "image/jpeg", size: 1024 }),
}));

vi.mock("../../src/clients/telegram.js", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  getFileUrl: vi.fn(),
  escapeMd: (t: string) => t,
}));

vi.mock("../../src/clients/gemini.js", () => ({
  analyzeEmail: vi.fn(),
  extractTasksFromText: vi.fn().mockResolvedValue([]),
  extractTasksFromUrlContent: vi.fn().mockResolvedValue([]),
  analyzeImage: vi.fn().mockResolvedValue({ summary: "", tasks: [] }),
  summarizeDay: vi.fn().mockResolvedValue("ブリーフィング"),
}));

vi.mock("../../src/handlers/calendar.js", () => ({
  deleteCalendarEventForTask: vi.fn().mockResolvedValue(undefined),
  syncCalendar: vi.fn().mockResolvedValue(undefined),
  getTodaysEvents: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/handlers/briefing.js", () => ({
  sendDailyBriefing: vi.fn().mockResolvedValue(undefined),
  sendWeeklyCostReport: vi.fn().mockResolvedValue(undefined),
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
  saveEmail: vi.fn().mockResolvedValue(undefined),
  cleanOldEmails: vi.fn().mockResolvedValue(undefined),
  searchEmails: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/clients/gmail-api.js", () => ({
  listAllMessages: vi.fn().mockResolvedValue([]),
  searchMessages: vi.fn().mockResolvedValue([]),
  getMessage: vi.fn(),
  getMessageHeaders: vi.fn(),
  parseMessage: vi.fn(),
  isCalendarInvite: vi.fn().mockReturnValue(false),
  archiveMessage: vi.fn().mockResolvedValue(undefined),
  addLabel: vi.fn().mockResolvedValue(undefined),
  getOrCreateLabel: vi.fn().mockResolvedValue("label-id-001"),
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
    const { addTask } = await import("../../src/clients/tasks.js");
    const { sendMessage } = await import("../../src/clients/telegram.js");

    const resp = await worker.fetch(webhookRequest(telegramFixtures.addCommand), env);
    expect(resp.status).toBe(200);
    expect(addTask).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ title: "資料を確認する" }),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      env,
      expect.stringContaining("https://todo.eh6gac4.work/?task=page-new"),
    );
  });

  it("/tasks sends task list", async () => {
    const env = createMockEnv();
    const { getOpenTasks } = await import("../../src/clients/tasks.js");
    const { sendMessage } = await import("../../src/clients/telegram.js");
    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue(sampleTasks());

    const resp = await worker.fetch(webhookRequest(telegramFixtures.tasksCommand), env);
    expect(resp.status).toBe(200);
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("タスク一覧"));
  });

  it("/mail searches archived mail by substring", async () => {
    const env = createMockEnv();
    const { searchEmails } = await import("../../src/storage/d1.js");
    const { sendMessage } = await import("../../src/clients/telegram.js");
    (searchEmails as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        subject: "請求書の送付",
        senderEmail: "keiri@example.com",
        gmailUrl: "https://mail.google.com/mail/u/0/#all/t1",
        receivedAt: 1_756_000_000,
        body: "3月分の請求書を添付します",
      },
    ]);

    const update = { update_id: 1010, message: { message_id: 10, chat: { id: 123456789 }, text: "/mail 請求書 3月" } };
    const resp = await worker.fetch(webhookRequest(update), env);

    expect(resp.status).toBe(200);
    expect(searchEmails).toHaveBeenCalledWith(env, ["請求書", "3月"]);
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("請求書の送付"));
  });

  it("/mail without keywords replies with usage", async () => {
    const env = createMockEnv();
    const { searchEmails } = await import("../../src/storage/d1.js");
    const { sendMessage } = await import("../../src/clients/telegram.js");

    const update = { update_id: 1011, message: { message_id: 11, chat: { id: 123456789 }, text: "/mail" } };
    const resp = await worker.fetch(webhookRequest(update), env);

    expect(resp.status).toBe(200);
    expect(searchEmails).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("使い方"));
  });

  it("ignores messages from wrong chat ID", async () => {
    const env = createMockEnv();
    const { sendMessage } = await import("../../src/clients/telegram.js");

    await worker.fetch(webhookRequest(telegramFixtures.wrongChatMessage), env);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("returns OK even if handler throws", async () => {
    const env = createMockEnv();
    const { addTask } = await import("../../src/clients/tasks.js");
    (addTask as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Notion error"));

    const resp = await worker.fetch(webhookRequest(telegramFixtures.addCommand), env);
    expect(resp.status).toBe(200);
  });
});
