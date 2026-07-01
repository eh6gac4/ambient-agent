import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendDailyBriefing, getEmailDigestText } from "../../../src/handlers/briefing.js";
import { createMockEnv } from "../../helpers/mocks.js";

vi.mock("../../../src/clients/gcal-api.js", () => ({
  getTodaysEvents: vi.fn(),
}));

vi.mock("../../../src/clients/notion.js", () => ({
  getOpenTasks: vi.fn(),
  escalatePriorityTasks: vi.fn().mockResolvedValue([]),
  promoteBacklogTasks: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../src/clients/gemini.js", () => ({
  summarizeDay: vi.fn(),
}));

vi.mock("../../../src/storage/kv.js", () => ({
  takeEmailDigest: vi.fn().mockResolvedValue({ taskLines: [], archivedLines: [] }),
  getDailyUsage: vi.fn(),
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
    const { summarizeDay } = await import("../../../src/clients/gemini.js");
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
    // Gemini サマリ・予定名・タスクタイトルがすべてエスケープされている
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
    const { summarizeDay } = await import("../../../src/clients/gemini.js");
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

describe("getEmailDigestText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("displays count and dashboard link only — no per-task details", async () => {
    const env = createMockEnv();
    const { takeEmailDigest } = await import("../../../src/storage/kv.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    (takeEmailDigest as ReturnType<typeof vi.fn>).mockResolvedValue({
      taskLines: [
        "• *会議の準備*\n  会議資料を作成\n  → 資料作成、レビュー依頼\n  [🔗 アプリで開く](https://todo.eh6gac4.work/?task=p1)",
        "• *レポート提出*\n  週次レポート\n  → 提出\n  [🔗 アプリで開く](https://todo.eh6gac4.work/?task=p2)",
        "• *コードレビュー*\n  PR レビュー\n  → 確認\n  [🔗 アプリで開く](https://todo.eh6gac4.work/?task=p3)",
      ],
      archivedLines: [],
    });

    const text = await getEmailDigestText(env);

    expect(text).not.toBeNull();
    expect(text).toContain("✅ *タスク登録*: 3件");
    expect(text).toContain("[🔗 ダッシュボードで確認](https://todo.eh6gac4.work)");
    // 個別タスクの件名やサブタスクが含まれていないこと
    expect(text).not.toContain("会議の準備");
    expect(text).not.toContain("レポート提出");
    expect(text).not.toContain("コードレビュー");
    // アーカイブセクションは出さない
    expect(text).not.toContain("アーカイブ済み");
  });

  it("shows only archive section when no tasks were registered", async () => {
    const env = createMockEnv();
    const { takeEmailDigest } = await import("../../../src/storage/kv.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    (takeEmailDigest as ReturnType<typeof vi.fn>).mockResolvedValue({
      taskLines: [],
      archivedLines: ["• *通知メール*\n  自動通知", "• *ニュースレター*\n  購読しているメルマガ"],
    });

    const text = await getEmailDigestText(env);

    expect(text).not.toContain("✅ *タスク登録*");
    expect(text).toContain("📦 *アーカイブ済み*");
    expect(text).toContain("通知メール");
    expect(text).toContain("ニュースレター");
  });

  it("includes both sections in order when tasks and archives coexist", async () => {
    const env = createMockEnv();
    const { takeEmailDigest } = await import("../../../src/storage/kv.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    (takeEmailDigest as ReturnType<typeof vi.fn>).mockResolvedValue({
      taskLines: ["• *仕事メール*\n  ..."],
      archivedLines: ["• *通知*\n  ..."],
    });

    const text = await getEmailDigestText(env);

    const taskIdx = text!.indexOf("✅ *タスク登録*: 1件");
    const archiveIdx = text!.indexOf("📦 *アーカイブ済み*");
    expect(taskIdx).toBeGreaterThan(-1);
    expect(archiveIdx).toBeGreaterThan(taskIdx);
  });

  it("does not send a message when digest is empty", async () => {
    const env = createMockEnv();
    const { takeEmailDigest } = await import("../../../src/storage/kv.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    (takeEmailDigest as ReturnType<typeof vi.fn>).mockResolvedValue({
      taskLines: [],
      archivedLines: [],
    });

    const text = await getEmailDigestText(env);

    expect(text).toBeNull();
  });
});
