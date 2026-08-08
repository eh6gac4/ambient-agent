import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  analyzeEmail,
  extractTasksFromText,
  extractTasksFromUrlContent,
  pickTaskTitle,
} from "../../../src/clients/gemini.js";
import { createMockEnv } from "../../helpers/mocks.js";
import geminiFixtures from "../../fixtures/gemini-responses.json" with { type: "json" };

describe("analyzeEmail", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns summary and tasks from valid response", async () => {
    const env = createMockEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify(geminiFixtures.analyzeEmailResponse), { status: 200 }),
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
      new Response(JSON.stringify(geminiFixtures.analyzeEmailNoTasksResponse), { status: 200 }),
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
      new Response(JSON.stringify(geminiFixtures.extractTasksResponse), { status: 200 }),
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
  it("passes URL as subject to Gemini", async () => {
    const env = createMockEnv();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(geminiFixtures.extractTasksResponse), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await extractTasksFromUrlContent(env, "https://example.com/task", "コンテンツ");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.contents[0].parts[0].text).toContain("https://example.com/task");
  });
});
