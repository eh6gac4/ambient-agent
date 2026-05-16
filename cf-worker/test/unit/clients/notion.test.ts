import { describe, it, expect, vi, beforeEach } from "vitest";
import { addTask, getOpenTasks, completeTask, cancelTask, updateTaskDue, escalatePriorityTasks, sanitizeEmoji } from "../../../src/clients/notion.js";
import { createMockEnv } from "../../helpers/mocks.js";
import notionFixtures from "../../fixtures/notion-tasks.json" assert { type: "json" };

describe("addTask", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a task page with required properties", async () => {
    const env = createMockEnv();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(notionFixtures.createResponse), { status: 200 })),
    );

    const id = await addTask(env, { title: "テストタスク", priority: "high", source: "Gmail" });
    expect(id).toBe("page-new-001");
  });

  it("sets Due property when due date provided", async () => {
    const env = createMockEnv();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(notionFixtures.createResponse), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await addTask(env, { title: "期限付きタスク", due: "2026-05-01", priority: "medium" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.properties.Due.date.start).toBe("2026-05-01");
  });

  it("appends checklist as to_do blocks when provided", async () => {
    const env = createMockEnv();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(notionFixtures.createResponse), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await addTask(env, { title: "チェックリスト付き" }, ["項目1", "項目2"]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.children).toHaveLength(2);
    expect(body.children[0].type).toBe("to_do");
    expect(body.children[0].to_do.rich_text[0].text.content).toBe("項目1");
  });

  it("appends email body blocks after checklist when bodyText provided", async () => {
    const env = createMockEnv();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(notionFixtures.createResponse), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await addTask(env, { title: "メール本文付き" }, ["項目1"], "これはメール本文です。");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.children).toHaveLength(4);
    expect(body.children[0].type).toBe("to_do");
    expect(body.children[1].type).toBe("divider");
    expect(body.children[2].type).toBe("heading_3");
    expect(body.children[2].heading_3.rich_text[0].text.content).toBe("📧 メール本文");
    expect(body.children[3].type).toBe("paragraph");
    expect(body.children[3].paragraph.rich_text[0].text.content).toBe("これはメール本文です。");
  });

  it("splits long email body into multiple paragraph blocks of 2000 chars each", async () => {
    const env = createMockEnv();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(notionFixtures.createResponse), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const longBody = "あ".repeat(4500);
    await addTask(env, { title: "長文メール" }, [], longBody);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const paragraphs = body.children.filter((b: { type: string }) => b.type === "paragraph");
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0].paragraph.rich_text[0].text.content.length).toBe(2000);
    expect(paragraphs[1].paragraph.rich_text[0].text.content.length).toBe(2000);
    expect(paragraphs[2].paragraph.rich_text[0].text.content.length).toBe(500);
  });

  it("truncates email body over 10000 chars with notice", async () => {
    const env = createMockEnv();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(notionFixtures.createResponse), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const hugeBody = "x".repeat(15000);
    await addTask(env, { title: "超長文" }, [], hugeBody);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const paragraphs = body.children.filter((b: { type: string }) => b.type === "paragraph");
    const lastChunk = paragraphs[paragraphs.length - 1].paragraph.rich_text[0].text.content;
    expect(lastChunk).toContain("…(以下省略)");
  });

  it("sets page icon when icon is provided", async () => {
    const env = createMockEnv();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(notionFixtures.createResponse), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await addTask(env, { title: "絵文字アイコン付き", icon: "📩" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.icon).toEqual({ type: "emoji", emoji: "📩" });
  });

  it("omits icon field when not provided", async () => {
    const env = createMockEnv();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(notionFixtures.createResponse), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await addTask(env, { title: "アイコンなし" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.icon).toBeUndefined();
  });

  it("drops invalid icon and still creates the task (no 400 from Notion)", async () => {
    const env = createMockEnv();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(notionFixtures.createResponse), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    // LLM が絵文字でなく説明文を返したケース
    const id = await addTask(env, { title: "不正アイコン", icon: "📩 返信" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.icon).toBeUndefined();
    expect(body.properties).toBeDefined();
    expect(id).toBe(notionFixtures.createResponse.id);
  });

  it("does not append body blocks when bodyText is empty", async () => {
    const env = createMockEnv();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(notionFixtures.createResponse), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await addTask(env, { title: "本文なし" }, ["項目1"], "");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.children).toHaveLength(1);
    expect(body.children[0].type).toBe("to_do");
  });
});

describe("getOpenTasks", () => {
  it("returns tasks with parsed properties", async () => {
    const env = createMockEnv();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data_sources: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(notionFixtures.queryResponse), { status: 200 })),
    );

    const tasks = await getOpenTasks(env);
    expect(tasks).toHaveLength(3);
    expect(tasks[0].title).toBe("プロジェクト資料を確認する");
    expect(tasks[0].priority).toBe("high");
    expect(tasks[0].due).toBe("2026-04-30");
    expect(tasks[0].pageId).toBe("page-001");
  });

  it("uses data_sources.query when data_source_id is available", async () => {
    const env = createMockEnv();
    await env.AGENT_KV.put("notion:data_source_id", "ds-id-001");

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(notionFixtures.queryResponse), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getOpenTasks(env);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/data_sources/ds-id-001/query");
  });

  it("falls back to databases.query when data_sources.query fails", async () => {
    const env = createMockEnv();
    await env.AGENT_KV.put("notion:data_source_id", "ds-id-001");

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(notionFixtures.queryResponse), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const tasks = await getOpenTasks(env);
    expect(tasks).toHaveLength(3);
    const fallbackUrl = fetchMock.mock.calls[1][0] as string;
    expect(fallbackUrl).toContain(`/databases/${env.NOTION_TASKS_DB_ID}/query`);
  });
});

describe("completeTask / cancelTask", () => {
  it("updates status to 完了", async () => {
    const env = createMockEnv();
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await completeTask(env, "page-001");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.properties.Status.status.name).toBe("完了");
  });

  it("updates status to 中止", async () => {
    const env = createMockEnv();
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await cancelTask(env, "page-001");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.properties.Status.status.name).toBe("中止");
  });
});

describe("updateTaskDue", () => {
  it("sets Due date", async () => {
    const env = createMockEnv();
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await updateTaskDue(env, "page-001", "2026-06-01");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.properties.Due.date.start).toBe("2026-06-01");
  });
});

describe("escalatePriorityTasks", () => {
  it("escalates medium tasks due within 3 days", async () => {
    const env = createMockEnv();
    const today = new Date();
    const dueSoon = new Date(today);
    dueSoon.setDate(dueSoon.getDate() + 2);
    const dueStr = dueSoon.toISOString().slice(0, 10);

    const escalatableTask = {
      id: "page-escalate",
      url: "",
      last_edited_time: today.toISOString(),
      properties: {
        "タイトル": { title: [{ text: { content: "緊急タスク" } }] },
        Due: { date: { start: dueStr } },
        Priority: { select: { name: "medium" } },
        Status: { status: { name: "未着手" } },
      },
    };

    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data_sources: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [escalatableTask] }), { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 })),
    );

    const escalated = await escalatePriorityTasks(env);
    expect(escalated).toHaveLength(1);
    expect(escalated[0].title).toBe("緊急タスク");
  });
});

describe("sanitizeEmoji", () => {
  it("keeps a plain single emoji", () => {
    expect(sanitizeEmoji("📩")).toBe("📩");
  });

  it("keeps emoji with variation selector / ZWJ sequence / skin tone / flag / keycap", () => {
    expect(sanitizeEmoji("✋️")).toBe("✋️");
    expect(sanitizeEmoji("🧑‍💻")).toBe("🧑‍💻");
    expect(sanitizeEmoji("👍🏽")).toBe("👍🏽");
    expect(sanitizeEmoji("🇯🇵")).toBe("🇯🇵");
    expect(sanitizeEmoji("1️⃣")).toBe("1️⃣");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeEmoji("  📅 ")).toBe("📅");
  });

  it("drops non-emoji / mixed / empty input", () => {
    expect(sanitizeEmoji(undefined)).toBeUndefined();
    expect(sanitizeEmoji("")).toBeUndefined();
    expect(sanitizeEmoji("   ")).toBeUndefined();
    expect(sanitizeEmoji("返信")).toBeUndefined();
    expect(sanitizeEmoji("task")).toBeUndefined();
    expect(sanitizeEmoji("📩 返信")).toBeUndefined();
    expect(sanitizeEmoji(":email:")).toBeUndefined();
    expect(sanitizeEmoji("9".repeat(20))).toBeUndefined();
  });
});
