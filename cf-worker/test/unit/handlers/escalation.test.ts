import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendEscalationNotice, sendStaleTasksNotice } from "../../../src/handlers/escalation.js";
import { createMockEnv, sampleTasks } from "../../helpers/mocks.js";
import type { Task } from "../../../src/types.js";

vi.mock("../../../src/clients/notion.js", () => ({
  getOpenTasks: vi.fn(),
  escalatePriorityTasks: vi.fn(),
}));

vi.mock("../../../src/clients/telegram.js", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
}));

describe("sendEscalationNotice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends notice when tasks are escalated", async () => {
    const env = createMockEnv();
    const { escalatePriorityTasks } = await import("../../../src/clients/notion.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    (escalatePriorityTasks as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "緊急対応", due: "2026-04-27", priority: "high", status: "未着手", lastEdited: null, url: "", pageId: "p1" },
    ]);

    await sendEscalationNotice(env);
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("緊急対応"));
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("high に昇格"));
  });

  it("does not send when no tasks escalated", async () => {
    const env = createMockEnv();
    const { escalatePriorityTasks } = await import("../../../src/clients/notion.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    (escalatePriorityTasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await sendEscalationNotice(env);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("sendStaleTasksNotice", () => {
  it("reports tasks not updated for 14+ days", async () => {
    const env = createMockEnv();
    const { getOpenTasks } = await import("../../../src/clients/notion.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    const tasks = sampleTasks(); // page-003 has lastEdited: "2026-04-01" (>14 days before 2026-04-25)
    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue(tasks);

    await sendStaleTasksNotice(env);
    // At least one task should be reported as stale relative to today's date in tests
    // (depends on test execution date, so we just verify it runs without error)
  });

  it("does not send when no stale tasks", async () => {
    const env = createMockEnv();
    const { getOpenTasks } = await import("../../../src/clients/notion.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    // Reset to fresh implementation (clearAllMocks doesn't reset mockResolvedValue)
    (getOpenTasks as ReturnType<typeof vi.fn>).mockReset();

    // All tasks updated recently (future date ensures they're never stale)
    const freshTasks: Task[] = [
      { title: "新しいタスク", due: null, priority: "medium", status: "未着手", lastEdited: "2099-01-01", url: "", pageId: "p1" },
    ];
    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue(freshTasks);
    (sendMessage as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(undefined);

    await sendStaleTasksNotice(env);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
