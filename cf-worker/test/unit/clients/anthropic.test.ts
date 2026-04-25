import { describe, it, expect, vi, beforeEach } from "vitest";
import { analyzeEmail, extractTasksFromText, extractTasksFromUrlContent } from "../../../src/clients/anthropic.js";
import { createMockEnv } from "../../helpers/mocks.js";
import claudeFixtures from "../../fixtures/claude-responses.json" assert { type: "json" };

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
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].title).toBe("プロジェクト進捗を報告する");
    expect(result.tasks[0].priority).toBe("high");
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
