import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendDailyBriefing } from "../../../src/handlers/briefing.js";
import { createMockEnv } from "../../helpers/mocks.js";

vi.mock("../../../src/clients/gcal-api.js", () => ({
  getTodaysEvents: vi.fn(),
}));

vi.mock("../../../src/clients/notion.js", () => ({
  getOpenTasks: vi.fn(),
}));

vi.mock("../../../src/clients/anthropic.js", () => ({
  summarizeDay: vi.fn(),
}));

// sendMessage のみモックし、escapeMd は実装をそのまま使う（エスケープを検証するため）
vi.mock("../../../src/clients/telegram.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/clients/telegram.js")>()),
  sendMessage: vi.fn().mockResolvedValue(undefined),
}));

describe("sendDailyBriefing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("escapes Markdown special characters in summary, event names and task titles", async () => {
    const env = createMockEnv();
    const { getTodaysEvents } = await import("../../../src/clients/gcal-api.js");
    const { getOpenTasks } = await import("../../../src/clients/notion.js");
    const { summarizeDay } = await import("../../../src/clients/anthropic.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    (getTodaysEvents as ReturnType<typeof vi.fn>).mockResolvedValue([
      { summary: "MTG_設計 *確認*", start: "2099-01-01T10:00:00+09:00" },
    ]);
    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "資料_作成 *急ぎ*", due: null, priority: "high", status: "未着手", lastEdited: null, url: "", pageId: "p1" },
    ]);
    (summarizeDay as ReturnType<typeof vi.fn>).mockResolvedValue("今日は *忙しい* 一日_です");

    await sendDailyBriefing(env);

    const sent = (sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    // Claude サマリ・予定名・タスクタイトルがすべてエスケープされている
    expect(sent).toContain("今日は \\*忙しい\\* 一日\\_です");
    expect(sent).toContain("MTG\\_設計 \\*確認\\*");
    expect(sent).toContain("資料\\_作成 \\*急ぎ\\*");
    // ヘッダの装飾 * は素のまま（壊れていない）
    expect(sent).toContain("*📅 日次ブリーフィング");
  });

  it("escapes overdue task titles", async () => {
    const env = createMockEnv();
    const { getTodaysEvents } = await import("../../../src/clients/gcal-api.js");
    const { getOpenTasks } = await import("../../../src/clients/notion.js");
    const { summarizeDay } = await import("../../../src/clients/anthropic.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    (getTodaysEvents as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "期限切れ_タスク", due: "2000-01-01", priority: "high", status: "未着手", lastEdited: null, url: "", pageId: "p1" },
    ]);
    (summarizeDay as ReturnType<typeof vi.fn>).mockResolvedValue("プレーンな要約");

    await sendDailyBriefing(env);

    const sent = (sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(sent).toContain("期限切れ\\_タスク");
  });
});
