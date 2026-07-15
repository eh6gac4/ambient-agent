import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleOfficeLeave } from "../../../src/handlers/office-leave.js";
import { createMockEnv, sampleTasks } from "../../helpers/mocks.js";

vi.mock("../../../src/utils/holiday.js", () => ({
  isHoliday: vi.fn().mockResolvedValue(false),
}));

vi.mock("../../../src/clients/notion.js", () => ({
  getOpenTasks: vi.fn(),
}));

vi.mock("../../../src/clients/gemini.js", () => ({
  selectOfficeLeaveNotifications: vi.fn(),
}));

vi.mock("../../../src/clients/telegram.js", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    sendMessage: vi.fn().mockResolvedValue(undefined),
  };
});

describe("handleOfficeLeave", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array without calling Gemini when no open tasks", async () => {
    const env = createMockEnv();
    const { getOpenTasks } = await import("../../../src/clients/notion.js");
    const { selectOfficeLeaveNotifications } = await import("../../../src/clients/gemini.js");

    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await handleOfficeLeave(env);
    expect(result).toEqual([]);
    expect(selectOfficeLeaveNotifications).not.toHaveBeenCalled();
  });

  it("passes tasks to Gemini and sends Telegram message with priority icons", async () => {
    const env = createMockEnv();
    const { getOpenTasks } = await import("../../../src/clients/notion.js");
    const { selectOfficeLeaveNotifications } = await import("../../../src/clients/gemini.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue(sampleTasks());
    (selectOfficeLeaveNotifications as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "請求書を提出", priority: "high" },
      { title: "帰りに郵便局", priority: "medium" },
      { title: "資料の整理", priority: "low" },
    ]);

    const result = await handleOfficeLeave(env);

    expect(result).toHaveLength(3);
    expect(selectOfficeLeaveNotifications).toHaveBeenCalledWith(env, sampleTasks(), expect.any(String));

    const message = (sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(message).toContain("🏢");
    expect(message).toContain("🔴");
    expect(message).toContain("🟡");
    expect(message).toContain("🟢");
    expect(message).toContain("請求書を提出");
  });

  it("skips Telegram when Gemini returns no notifications", async () => {
    const env = createMockEnv();
    const { getOpenTasks } = await import("../../../src/clients/notion.js");
    const { selectOfficeLeaveNotifications } = await import("../../../src/clients/gemini.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue(sampleTasks());
    (selectOfficeLeaveNotifications as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await handleOfficeLeave(env);
    expect(result).toEqual([]);
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("該当するタスクはありません"));
  });

  it("returns empty array on holiday without calling any downstream", async () => {
    const env = createMockEnv();
    const { isHoliday } = await import("../../../src/utils/holiday.js");
    const { getOpenTasks } = await import("../../../src/clients/notion.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    (isHoliday as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    const result = await handleOfficeLeave(env);
    expect(result).toEqual([]);
    expect(getOpenTasks).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("passes JST datetime string to Gemini", async () => {
    const env = createMockEnv();
    const { getOpenTasks } = await import("../../../src/clients/notion.js");
    const { selectOfficeLeaveNotifications } = await import("../../../src/clients/gemini.js");

    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue(sampleTasks());
    (selectOfficeLeaveNotifications as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await handleOfficeLeave(env);

    const jstArg = (selectOfficeLeaveNotifications as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
    expect(jstArg).toMatch(/\d{4}/);
    expect(jstArg).toMatch(/\d{2}:\d{2}/);
  });
});
