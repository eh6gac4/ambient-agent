import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleHomeArrival } from "../../../src/handlers/home-arrival.js";
import { createMockEnv, sampleTasks } from "../../helpers/mocks.js";

vi.mock("../../../src/clients/notion.js", () => ({
  getOpenTasks: vi.fn(),
}));

vi.mock("../../../src/clients/anthropic.js", () => ({
  selectHomeArrivalNotifications: vi.fn(),
}));

vi.mock("../../../src/clients/telegram.js", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
}));

describe("handleHomeArrival", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array without calling Claude when no open tasks", async () => {
    const env = createMockEnv();
    const { getOpenTasks } = await import("../../../src/clients/notion.js");
    const { selectHomeArrivalNotifications } = await import("../../../src/clients/anthropic.js");

    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await handleHomeArrival(env);
    expect(result).toEqual([]);
    expect(selectHomeArrivalNotifications).not.toHaveBeenCalled();
  });

  it("passes tasks to Claude and sends Telegram message with priority icons", async () => {
    const env = createMockEnv();
    const { getOpenTasks } = await import("../../../src/clients/notion.js");
    const { selectHomeArrivalNotifications } = await import("../../../src/clients/anthropic.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue(sampleTasks());
    (selectHomeArrivalNotifications as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "子どもの宿題を確認", priority: "high" },
      { title: "夕食の買い物", priority: "medium" },
      { title: "洗濯物を取り込む", priority: "low" },
    ]);

    const result = await handleHomeArrival(env);

    expect(result).toHaveLength(3);
    expect(selectHomeArrivalNotifications).toHaveBeenCalledWith(env, sampleTasks(), expect.any(String));

    const message = (sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(message).toContain("🏠");
    expect(message).toContain("🔴");
    expect(message).toContain("🟡");
    expect(message).toContain("🟢");
    expect(message).toContain("子どもの宿題を確認");
  });

  it("skips Telegram when Claude returns no notifications", async () => {
    const env = createMockEnv();
    const { getOpenTasks } = await import("../../../src/clients/notion.js");
    const { selectHomeArrivalNotifications } = await import("../../../src/clients/anthropic.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue(sampleTasks());
    (selectHomeArrivalNotifications as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await handleHomeArrival(env);
    expect(result).toEqual([]);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("passes JST datetime string to Claude", async () => {
    const env = createMockEnv();
    const { getOpenTasks } = await import("../../../src/clients/notion.js");
    const { selectHomeArrivalNotifications } = await import("../../../src/clients/anthropic.js");

    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue(sampleTasks());
    (selectHomeArrivalNotifications as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await handleHomeArrival(env);

    const jstArg = (selectHomeArrivalNotifications as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
    // JST datetime should contain year/month/day and time
    expect(jstArg).toMatch(/\d{4}/);
    expect(jstArg).toMatch(/\d{2}:\d{2}/);
  });
});
