import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockEnv } from "../helpers/mocks.js";

// Import the default export (Worker) from index.ts
import worker from "../../src/index.js";

// Mock all job handlers
vi.mock("../../src/handlers/gmail.js", () => ({
  checkGmail: vi.fn().mockResolvedValue(undefined),
  learnFromCancelled: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/handlers/calendar.js", () => ({
  syncCalendar: vi.fn().mockResolvedValue(undefined),
  sendDueSoonNotice: vi.fn().mockResolvedValue(undefined),
  sendTaskReminder: vi.fn().mockResolvedValue(undefined),
  deleteCalendarEventForTask: vi.fn().mockResolvedValue(undefined),
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

vi.mock("../../src/clients/telegram.js", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  escapeMd: (t: string) => t,
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

describe("scheduled handler - cron dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches learnFromCancelled for 50 22 * * *", async () => {
    const env = createMockEnv();
    const { learnFromCancelled } = await import("../../src/handlers/gmail.js");

    await worker.scheduled(makeScheduledEvent("50 22 * * *"), env);
    expect(learnFromCancelled).toHaveBeenCalledWith(env);
  });

  it("dispatches checkGmail for 55 22 * * *", async () => {
    const env = createMockEnv();
    const { checkGmail } = await import("../../src/handlers/gmail.js");

    await worker.scheduled(makeScheduledEvent("55 22 * * *"), env);
    expect(checkGmail).toHaveBeenCalledWith(env);
  });

  it("dispatches syncCalendar for 57 22 * * *", async () => {
    const env = createMockEnv();
    const { syncCalendar } = await import("../../src/handlers/calendar.js");

    await worker.scheduled(makeScheduledEvent("57 22 * * *"), env);
    expect(syncCalendar).toHaveBeenCalledWith(env);
  });

  it("dispatches sendDailyBriefing for 0 23 * * *", async () => {
    const env = createMockEnv();
    const { sendDailyBriefing } = await import("../../src/handlers/briefing.js");

    await worker.scheduled(makeScheduledEvent("0 23 * * *"), env);
    expect(sendDailyBriefing).toHaveBeenCalledWith(env);
  });

  it("dispatches sendStaleTasksNotice for 0 0 * * 1", async () => {
    const env = createMockEnv();
    const { sendStaleTasksNotice } = await import("../../src/handlers/escalation.js");

    await worker.scheduled(makeScheduledEvent("0 0 * * 1"), env);
    expect(sendStaleTasksNotice).toHaveBeenCalledWith(env);
  });

  it("sends error notification to Telegram when job throws", async () => {
    const env = createMockEnv();
    const { checkGmail } = await import("../../src/handlers/gmail.js");
    const { sendMessage } = await import("../../src/clients/telegram.js");

    (checkGmail as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("API timeout"));

    await worker.scheduled(makeScheduledEvent("55 22 * * *"), env);
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("エラー"));
  });

  it("logs warning for unknown cron expression", async () => {
    const env = createMockEnv();
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await worker.scheduled(makeScheduledEvent("0 0 1 1 *"), env);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown cron"), "0 0 1 1 *");
  });
});

describe("fetch handler", () => {
  it("responds to POST /webhook with OK", async () => {
    const env = createMockEnv();
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ update_id: 1 }),
    });
    const resp = await worker.fetch(req, env);
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe("OK");
  });

  it("responds to unknown paths with 200", async () => {
    const env = createMockEnv();
    const req = new Request("https://example.com/health");
    const resp = await worker.fetch(req, env);
    expect(resp.status).toBe(200);
  });
});
