import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleHomeArrival } from "../../../src/handlers/home-arrival.js";
import { createMockEnv, sampleTasks } from "../../helpers/mocks.js";
import type { Task } from "../../../src/types.js";

vi.mock("../../../src/utils/holiday.js", () => ({
  isHoliday: vi.fn().mockResolvedValue(false),
}));

vi.mock("../../../src/clients/tasks.js", () => ({
  getOpenTasks: vi.fn(),
}));

vi.mock("../../../src/clients/telegram.js", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    sendMessage: vi.fn().mockResolvedValue(undefined),
  };
});

function homeTasks(): Task[] {
  return sampleTasks().map((t, i) => ({ ...t, location: i === 0 ? "home" : t.location }));
}

describe("handleHomeArrival", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when no open tasks", async () => {
    const env = createMockEnv();
    const { getOpenTasks } = await import("../../../src/clients/tasks.js");

    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await handleHomeArrival(env);
    expect(result).toEqual([]);
  });

  it("sends Telegram message for Location-matched (home) tasks", async () => {
    const env = createMockEnv();
    const { getOpenTasks } = await import("../../../src/clients/tasks.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue(homeTasks());

    const result = await handleHomeArrival(env);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe(homeTasks()[0].title);

    const message = (sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(message).toContain("🏠");
    expect(message).toContain(homeTasks()[0].title);
  });

  it("sends empty-tasks message when no Location-matched tasks", async () => {
    const env = createMockEnv();
    const { getOpenTasks } = await import("../../../src/clients/tasks.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue(sampleTasks());

    const result = await handleHomeArrival(env);
    expect(result).toEqual([]);
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("該当するタスクはありません"));
  });

  it("returns empty array on holiday without calling any downstream", async () => {
    const env = createMockEnv();
    const { isHoliday } = await import("../../../src/utils/holiday.js");
    const { getOpenTasks } = await import("../../../src/clients/tasks.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    (isHoliday as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    const result = await handleHomeArrival(env);
    expect(result).toEqual([]);
    expect(getOpenTasks).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
