import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  analyzeEmail,
  extractTasksFromText,
  extractTasksFromUrlContent,
  pickTaskTitle,
  selectHomeArrivalNotifications,
  selectOfficeLeaveNotifications,
} from "../../../src/clients/anthropic.js";
import { createMockEnv } from "../../helpers/mocks.js";
import claudeFixtures from "../../fixtures/claude-responses.json" with { type: "json" };

describe("analyzeEmail", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns summary and tasks from valid response", async () => {
    const env = createMockEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify(claudeFixtures.analyzeEmailResponse), { status: 200 }),
    ));

    const result = await analyzeEmail(env, "プロジェクトの進捗確認", "内容...");
    expect(result.summary).toContain("田中さん");
    expect(result.task_title).toBe("田中さんへのプロジェクト進捗報告");
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].title).toBe("プロジェクト進捗を報告する");
    expect(result.tasks[0].priority).toBe("high");
    expect(result.tasks[0].icon).toBe("📩");
  });

  it("returns empty tasks array for newsletters", async () => {
    const env = createMockEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify(claudeFixtures.analyzeEmailNoTasksResponse), { status: 200 }),
    ));

    const result = await analyzeEmail(env, "ニュースレター", "広告内容...");
    expect(result.tasks).toHaveLength(0);
  });

  it("handles malformed JSON response gracefully", async () => {
    const env = createMockEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        content: [{ type: "text", text: "このメールはタスクを必要としません。" }],
        usage: { input_tokens: 50, output_tokens: 10 },
      }), { status: 200 }),
    ));

    const result = await analyzeEmail(env, "件名", "本文");
    expect(result.tasks).toEqual([]);
    expect(typeof result.summary).toBe("string");
  });
});

describe("pickTaskTitle", () => {
  it("returns task_title when present and non-empty", () => {
    expect(pickTaskTitle({ task_title: "ACME社4月分請求書の支払い", summary: "", tasks: [] }, "【重要】請求書発行のご案内")).toBe(
      "ACME社4月分請求書の支払い",
    );
  });

  it("falls back to subject when task_title is missing", () => {
    expect(pickTaskTitle({ summary: "", tasks: [] }, "件名そのまま")).toBe("件名そのまま");
  });

  it("falls back to subject when task_title is whitespace only", () => {
    expect(pickTaskTitle({ task_title: "   ", summary: "", tasks: [] }, "件名そのまま")).toBe("件名そのまま");
  });
});

describe("extractTasksFromText", () => {
  it("extracts task list from response", async () => {
    const env = createMockEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify(claudeFixtures.extractTasksResponse), { status: 200 }),
    ));

    const tasks = await extractTasksFromText(env, "extract_tasks", "件名", "本文");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("プロジェクト資料を確認する");
    expect(tasks[0].due).toBe("2026-04-30");
    expect(tasks[0].icon).toBe("🔍");
  });

  it("returns empty array when no JSON list in response", async () => {
    const env = createMockEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        content: [{ type: "text", text: "タスクはありません。" }],
        usage: { input_tokens: 30, output_tokens: 5 },
      }), { status: 200 }),
    ));

    const tasks = await extractTasksFromText(env, "test", "件名", "本文");
    expect(tasks).toEqual([]);
  });
});

describe("extractTasksFromUrlContent", () => {
  it("passes URL as subject to Claude", async () => {
    const env = createMockEnv();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(claudeFixtures.extractTasksResponse), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await extractTasksFromUrlContent(env, "https://example.com/task", "コンテンツ");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain("https://example.com/task");
  });
});

describe("selectHomeArrivalNotifications / selectOfficeLeaveNotifications", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const tasks = [
    { title: "牛乳を買う", priority: "medium", due: "2026-06-14", status: "未着手" },
    { title: "請求書を提出", priority: "high", due: null, status: "進行中" },
  ];

  function stubArrayResponse(arr: unknown) {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        content: [{ type: "text", text: JSON.stringify(arr) }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("home arrival parses notifications and uses the home prompt", async () => {
    const env = createMockEnv();
    const fetchMock = stubArrayResponse([{ title: "牛乳を買う", priority: "medium" }]);

    const result = await selectHomeArrivalNotifications(env, tasks, "2026/06/14 19:00");
    expect(result).toEqual([{ title: "牛乳を買う", priority: "medium" }]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.system).toContain("帰宅");
    expect(body.messages[0].content).toContain("2026/06/14 19:00");
  });

  it("office leave parses notifications and uses the office prompt", async () => {
    const env = createMockEnv();
    const fetchMock = stubArrayResponse([{ title: "請求書を提出", priority: "high" }]);

    const result = await selectOfficeLeaveNotifications(env, tasks, "2026/06/14 18:00");
    expect(result).toEqual([{ title: "請求書を提出", priority: "high" }]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.system).toContain("退社");
  });

  it("returns empty array when response has no JSON array", async () => {
    const env = createMockEnv();
    stubArrayResponse(null); // serializes to "null", no [...] match
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        content: [{ type: "text", text: "通知すべきタスクはありません" }],
        usage: { input_tokens: 5, output_tokens: 2 },
      }), { status: 200 }),
    ));

    const result = await selectHomeArrivalNotifications(env, tasks, "2026/06/14 19:00");
    expect(result).toEqual([]);
  });
});
