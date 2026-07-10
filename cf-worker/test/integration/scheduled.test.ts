import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockEnv } from "../helpers/mocks.js";

// Import the default export (Worker) from index.ts
import worker from "../../src/index.js";

vi.mock("../../src/utils/holiday.js", () => ({
  isHoliday: vi.fn().mockResolvedValue(false),
}));

// Mock all job handlers
vi.mock("../../src/handlers/gmail.js", () => ({
  checkGmail: vi.fn().mockResolvedValue(undefined),
  learnFromCancelled: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/handlers/calendar.js", () => ({
  syncCalendar: vi.fn().mockResolvedValue(undefined),
  sendTaskReminder: vi.fn().mockResolvedValue(undefined),
  deleteCalendarEventForTask: vi.fn().mockResolvedValue(undefined),
  getTodaysEvents: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/handlers/briefing.js", () => ({
  sendDailyBriefing: vi.fn().mockResolvedValue(undefined),
  sendWeeklyCostReport: vi.fn().mockResolvedValue(undefined),
  getEmailDigestText: vi.fn().mockResolvedValue(""),
}));

vi.mock("../../src/handlers/escalation.js", () => ({
  getBacklogPromotionNoticeText: vi.fn().mockResolvedValue(""),
  getEscalationNoticeText: vi.fn().mockResolvedValue(""),
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

  it("dispatches learnFromCancelled for 20 20 * * *", async () => {
    const env = createMockEnv();
    const { learnFromCancelled } = await import("../../src/handlers/gmail.js");

    await worker.scheduled(makeScheduledEvent("20 20 * * *"), env);
    expect(learnFromCancelled).toHaveBeenCalledWith(env);
  });

  it("20 20 * * * (morning_prep) runs learnFromCancelled and calendar (no gmail)", async () => {
    const env = createMockEnv();
    const { checkGmail, learnFromCancelled } = await import("../../src/handlers/gmail.js");
    const { syncCalendar } = await import("../../src/handlers/calendar.js");

    await worker.scheduled(makeScheduledEvent("20 20 * * *"), env);
    expect(checkGmail).not.toHaveBeenCalled();
    expect(syncCalendar).toHaveBeenCalledWith(env);
  });

  it("30 22-23,0-12 * * * (hourly_gmail) runs checkGmail in silent mode and syncs calendar", async () => {
    const env = createMockEnv();
    const { checkGmail } = await import("../../src/handlers/gmail.js");
    const { syncCalendar } = await import("../../src/handlers/calendar.js");

    await worker.scheduled(makeScheduledEvent("30 22-23,0-12 * * *"), env);
    expect(checkGmail).toHaveBeenCalledWith(env, { silent: true });
    expect(syncCalendar).toHaveBeenCalledWith(env);
  });

  it("30 20 * * * (morning_briefing) runs briefing", async () => {
    const env = createMockEnv();
    const { sendDailyBriefing } = await import("../../src/handlers/briefing.js");

    await worker.scheduled(makeScheduledEvent("30 20 * * *"), env);
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
    const { syncCalendar } = await import("../../src/handlers/calendar.js");
    const { sendMessage } = await import("../../src/clients/telegram.js");

    (syncCalendar as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("API timeout"));

    await worker.scheduled(makeScheduledEvent("20 20 * * *"), env);
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("エラー"));
  });

  it("logs warning for unknown cron expression", async () => {
    const env = createMockEnv();
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await worker.scheduled(makeScheduledEvent("0 0 1 1 *"), env);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown cron"), "0 0 1 1 *");
  });
});

describe("scheduled handler - holiday skip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips morningBriefing on holiday", async () => {
    const env = createMockEnv();
    const { isHoliday } = await import("../../src/utils/holiday.js");
    const { sendDailyBriefing } = await import("../../src/handlers/briefing.js");

    (isHoliday as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    await worker.scheduled(makeScheduledEvent("30 20 * * *"), env);
    expect(sendDailyBriefing).not.toHaveBeenCalled();
  });

  it("skips morningPrep on holiday", async () => {
    const env = createMockEnv();
    const { isHoliday } = await import("../../src/utils/holiday.js");
    const { syncCalendar } = await import("../../src/handlers/calendar.js");

    (isHoliday as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    await worker.scheduled(makeScheduledEvent("50 22 * * *"), env);
    expect(syncCalendar).not.toHaveBeenCalled();
  });

  it("skips sendTaskReminder on holiday", async () => {
    const env = createMockEnv();
    const { isHoliday } = await import("../../src/utils/holiday.js");
    const { sendTaskReminder } = await import("../../src/handlers/calendar.js");

    (isHoliday as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    await worker.scheduled(makeScheduledEvent("0 4 * * *"), env);
    expect(sendTaskReminder).not.toHaveBeenCalled();
  });

  it("skips sendStaleTasksNotice on holiday", async () => {
    const env = createMockEnv();
    const { isHoliday } = await import("../../src/utils/holiday.js");
    const { sendStaleTasksNotice } = await import("../../src/handlers/escalation.js");

    (isHoliday as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    await worker.scheduled(makeScheduledEvent("0 0 * * 1"), env);
    expect(sendStaleTasksNotice).not.toHaveBeenCalled();
  });

  it("still runs hourlyGmail on holiday (silent background job)", async () => {
    const env = createMockEnv();
    const { isHoliday } = await import("../../src/utils/holiday.js");
    const { checkGmail } = await import("../../src/handlers/gmail.js");

    (isHoliday as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    await worker.scheduled(makeScheduledEvent("30 22-23,0-12 * * *"), env);
    expect(checkGmail).toHaveBeenCalledWith(env, { silent: true });
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
