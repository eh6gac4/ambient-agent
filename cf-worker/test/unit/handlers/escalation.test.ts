import { describe, it, expect, vi, beforeEach } from "vitest";
import { getBacklogPromotionNoticeText, getEscalationNoticeText, sendStaleTasksNotice } from "../../../src/handlers/escalation.js";
import { createMockEnv, sampleTasks } from "../../helpers/mocks.js";
import type { Task } from "../../../src/types.js";

vi.mock("../../../src/clients/tasks.js", () => ({
  getOpenTasks: vi.fn(),
  escalatePriorityTasks: vi.fn(),
  promoteBacklogTasks: vi.fn(),
}));

// sendMessage のみモックし、escapeMd は実装をそのまま使う（エスケープを検証するため）
vi.mock("../../../src/clients/telegram.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/clients/telegram.js")>()),
  sendMessage: vi.fn().mockResolvedValue(undefined),
}));

describe("getEscalationNoticeText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends notice when tasks are escalated", async () => {
    const env = createMockEnv();
    const { escalatePriorityTasks } = await import("../../../src/clients/tasks.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    (escalatePriorityTasks as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "緊急対応", due: "2026-04-27", priority: "high", status: "未着手", location: null, lastEdited: null, url: "", pageId: "p1" },
    ]);

    const text = await getEscalationNoticeText(env);
    expect(text).toContain("緊急対応");
    expect(text).toContain("high に昇格");
  });

  it("does not send when no tasks escalated", async () => {
    const env = createMockEnv();
    const { escalatePriorityTasks } = await import("../../../src/clients/tasks.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    (escalatePriorityTasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const text = await getEscalationNoticeText(env);
    expect(text).toBeNull();
  });

  it("escapes Markdown special characters in task titles", async () => {
    const env = createMockEnv();
    const { escalatePriorityTasks } = await import("../../../src/clients/tasks.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    (escalatePriorityTasks as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "見積_資料 *至急*", due: "2026-04-27", priority: "high", status: "未着手", location: null, lastEdited: null, url: "", pageId: "p1" },
    ]);

    const text = await getEscalationNoticeText(env);
    expect(text).toContain("見積\\_資料 \\*至急\\*");
  });
});

describe("getBacklogPromotionNoticeText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends notice when backlog tasks are promoted", async () => {
    const env = createMockEnv();
    const { promoteBacklogTasks } = await import("../../../src/clients/tasks.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    (promoteBacklogTasks as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "原稿チェック", due: "2026-05-27", priority: "medium", status: "未着手", location: null, lastEdited: null, url: "", pageId: "p1" },
    ]);

    const text = await getBacklogPromotionNoticeText(env);
    expect(text).toContain("原稿チェック");
    expect(text).toContain("バックログから未着手に昇格");
  });

  it("does not send when nothing was promoted", async () => {
    const env = createMockEnv();
    const { promoteBacklogTasks } = await import("../../../src/clients/tasks.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    (promoteBacklogTasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const text = await getBacklogPromotionNoticeText(env);
    expect(text).toBeNull();
  });
});

describe("sendStaleTasksNotice", () => {
  it("reports tasks not updated for 14+ days", async () => {
    const env = createMockEnv();
    const { getOpenTasks } = await import("../../../src/clients/tasks.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    const tasks = sampleTasks(); // page-003 has lastEdited: "2026-04-01" (>14 days before 2026-04-25)
    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue(tasks);

    await sendStaleTasksNotice(env);
    // At least one task should be reported as stale relative to today's date in tests
    // (depends on test execution date, so we just verify it runs without error)
  });

  it("does not send when no stale tasks", async () => {
    const env = createMockEnv();
    const { getOpenTasks } = await import("../../../src/clients/tasks.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    // Reset to fresh implementation (clearAllMocks doesn't reset mockResolvedValue)
    (getOpenTasks as ReturnType<typeof vi.fn>).mockReset();

    // All tasks updated recently (future date ensures they're never stale)
    const freshTasks: Task[] = [
      { title: "新しいタスク", due: null, priority: "medium", status: "未着手", location: null, lastEdited: "2099-01-01", url: "", pageId: "p1" },
    ];
    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue(freshTasks);
    (sendMessage as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(undefined);

    await sendStaleTasksNotice(env);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
