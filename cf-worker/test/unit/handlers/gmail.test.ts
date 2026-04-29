import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkGmail, learnFromCancelled } from "../../../src/handlers/gmail.js";
import { createMockEnv } from "../../helpers/mocks.js";
import gmailFixtures from "../../fixtures/gmail-messages.json" assert { type: "json" };

vi.mock("../../../src/clients/gmail-api.js", () => ({
  listAllMessages: vi.fn(),
  getMessage: vi.fn(),
  parseMessage: vi.fn(),
  isCalendarInvite: vi.fn().mockReturnValue(false),
  archiveMessage: vi.fn().mockResolvedValue(undefined),
  addLabel: vi.fn().mockResolvedValue(undefined),
  getOrCreateLabel: vi.fn().mockResolvedValue("label-id-001"),
}));

vi.mock("../../../src/clients/anthropic.js", () => ({
  analyzeEmail: vi.fn(),
}));

vi.mock("../../../src/clients/notion.js", () => ({
  addTask: vi.fn(),
  updateTaskFromReply: vi.fn(),
  getTaskStatus: vi.fn(),
}));

vi.mock("../../../src/clients/telegram.js", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  escapeMd: (t: string) => t,
}));

vi.mock("../../../src/storage/d1.js", () => ({
  getThreadMapEntry: vi.fn(),
  setThreadMapEntry: vi.fn().mockResolvedValue(undefined),
  getSenderForTask: vi.fn(),
  setSenderForTask: vi.fn().mockResolvedValue(undefined),
  deleteSenderMapEntry: vi.fn().mockResolvedValue(undefined),
  getAllSenderMap: vi.fn().mockResolvedValue(new Map()),
  isProcessed: vi.fn().mockResolvedValue(false),
  markProcessed: vi.fn().mockResolvedValue(undefined),
  cleanOldProcessed: vi.fn().mockResolvedValue(undefined),
}));

describe("checkGmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a new task for new thread", async () => {
    const env = createMockEnv();
    const { listAllMessages, getMessage, parseMessage } = await import("../../../src/clients/gmail-api.js");
    const { analyzeEmail } = await import("../../../src/clients/anthropic.js");
    const { addTask } = await import("../../../src/clients/notion.js");
    const { getThreadMapEntry } = await import("../../../src/storage/d1.js");

    (listAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "msg-001", threadId: "thread-001" }]);
    (getMessage as ReturnType<typeof vi.fn>).mockResolvedValue(gmailFixtures.newEmail);
    (parseMessage as ReturnType<typeof vi.fn>).mockReturnValue({
      subject: "プロジェクトの進捗確認",
      body: "内容",
      senderEmail: "tanaka@example.com",
      threadId: "thread-001",
      gmailUrl: "https://mail.google.com/mail/u/0/#search/rfc822msgid:",
    });
    (analyzeEmail as ReturnType<typeof vi.fn>).mockResolvedValue({
      summary: "進捗確認の依頼",
      tasks: [{ title: "進捗を報告する", priority: "high", due: "2026-04-30" }],
    });
    (getThreadMapEntry as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (addTask as ReturnType<typeof vi.fn>).mockResolvedValue("page-new-001");

    await checkGmail(env);
    expect(addTask).toHaveBeenCalledTimes(1);
    expect(addTask).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ title: "プロジェクトの進捗確認", source: "Gmail" }),
      ["進捗を報告する"],
      "内容",
    );
  });

  it("updates existing task for reply email (same threadId)", async () => {
    const env = createMockEnv();
    const { listAllMessages, getMessage, parseMessage } = await import("../../../src/clients/gmail-api.js");
    const { analyzeEmail } = await import("../../../src/clients/anthropic.js");
    const { addTask, updateTaskFromReply } = await import("../../../src/clients/notion.js");
    const { getThreadMapEntry } = await import("../../../src/storage/d1.js");

    (listAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "msg-003", threadId: "thread-001" }]);
    (getMessage as ReturnType<typeof vi.fn>).mockResolvedValue(gmailFixtures.replyEmail);
    (parseMessage as ReturnType<typeof vi.fn>).mockReturnValue({
      subject: "Re: プロジェクト",
      body: "返信内容",
      senderEmail: "tanaka@example.com",
      threadId: "thread-001",
      gmailUrl: "https://mail.google.com/",
    });
    (analyzeEmail as ReturnType<typeof vi.fn>).mockResolvedValue({
      summary: "追加確認依頼",
      tasks: [{ title: "追加確認を実施する", priority: "medium", due: null }],
    });
    (getThreadMapEntry as ReturnType<typeof vi.fn>).mockResolvedValue("existing-page-id");

    await checkGmail(env);
    expect(updateTaskFromReply).toHaveBeenCalledWith(
      env,
      "existing-page-id",
      ["追加確認を実施する"],
      "medium",
      null,
      "返信内容",
    );
    expect(addTask).not.toHaveBeenCalled();
  });

  it("skips blocked senders", async () => {
    const env = createMockEnv();
    await env.AGENT_KV.put("no_task_senders", "spam@example.com");

    const { listAllMessages, getMessage, parseMessage } = await import("../../../src/clients/gmail-api.js");
    const { analyzeEmail } = await import("../../../src/clients/anthropic.js");
    const { addTask } = await import("../../../src/clients/notion.js");

    (listAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "msg-spam", threadId: "thread-spam" }]);
    (getMessage as ReturnType<typeof vi.fn>).mockResolvedValue(gmailFixtures.newEmail);
    (parseMessage as ReturnType<typeof vi.fn>).mockReturnValue({
      subject: "スパム",
      body: "",
      senderEmail: "spam@example.com",
      threadId: "thread-spam",
      gmailUrl: "",
    });

    await checkGmail(env);
    expect(analyzeEmail).not.toHaveBeenCalled();
    expect(addTask).not.toHaveBeenCalled();
  });

  it("skips already-processed messages", async () => {
    const env = createMockEnv();
    const { listAllMessages } = await import("../../../src/clients/gmail-api.js");
    const { isProcessed } = await import("../../../src/storage/d1.js");
    const { analyzeEmail } = await import("../../../src/clients/anthropic.js");

    (listAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "msg-already-done", threadId: "t1" }]);
    (isProcessed as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    await checkGmail(env);
    expect(analyzeEmail).not.toHaveBeenCalled();
  });

  it("skips calendar invite emails", async () => {
    const env = createMockEnv();
    const { listAllMessages, getMessage, isCalendarInvite } = await import("../../../src/clients/gmail-api.js");
    const { analyzeEmail } = await import("../../../src/clients/anthropic.js");

    (listAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "msg-cal", threadId: "t-cal" }]);
    (getMessage as ReturnType<typeof vi.fn>).mockResolvedValue(gmailFixtures.calendarInvite);
    (isCalendarInvite as ReturnType<typeof vi.fn>).mockReturnValue(true);

    await checkGmail(env);
    expect(analyzeEmail).not.toHaveBeenCalled();
  });

  it("does nothing when no new messages", async () => {
    const env = createMockEnv();
    const { listAllMessages } = await import("../../../src/clients/gmail-api.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    (listAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await checkGmail(env);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("breaks loop on subrequest limit error and skips Telegram if no work done", async () => {
    const env = createMockEnv();
    const { listAllMessages, getMessage } = await import("../../../src/clients/gmail-api.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");
    const { isProcessed } = await import("../../../src/storage/d1.js");

    (isProcessed as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (listAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "msg-a", threadId: "t-a" },
      { id: "msg-b", threadId: "t-b" },
    ]);
    (getMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Too many subrequests by single Worker invocation"));

    await checkGmail(env);
    // Only first message attempted; loop breaks; no Telegram (nothing accumulated)
    expect(getMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("continues loop on per-message non-limit errors", async () => {
    const env = createMockEnv();
    const { listAllMessages, getMessage, parseMessage, isCalendarInvite } = await import("../../../src/clients/gmail-api.js");
    const { analyzeEmail } = await import("../../../src/clients/anthropic.js");
    const { addTask } = await import("../../../src/clients/notion.js");
    const { getThreadMapEntry, isProcessed } = await import("../../../src/storage/d1.js");

    (isCalendarInvite as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (isProcessed as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (listAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "msg-bad", threadId: "t-bad" },
      { id: "msg-good", threadId: "t-good" },
    ]);
    (getMessage as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("transient parse error"))
      .mockResolvedValueOnce(gmailFixtures.newEmail);
    (parseMessage as ReturnType<typeof vi.fn>).mockReturnValue({
      subject: "ok",
      body: "本文",
      senderEmail: "ok@example.com",
      threadId: "t-good",
      gmailUrl: "https://mail.google.com/",
    });
    (analyzeEmail as ReturnType<typeof vi.fn>).mockResolvedValue({
      summary: "要約",
      tasks: [{ title: "やる", priority: "medium", due: null }],
    });
    (getThreadMapEntry as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (addTask as ReturnType<typeof vi.fn>).mockResolvedValue("page-good");

    await checkGmail(env);
    expect(addTask).toHaveBeenCalledTimes(1);
  });

  it("silent mode accumulates digest to KV and skips Telegram", async () => {
    const env = createMockEnv();
    const { listAllMessages, getMessage, parseMessage, isCalendarInvite } = await import("../../../src/clients/gmail-api.js");
    const { analyzeEmail } = await import("../../../src/clients/anthropic.js");
    const { addTask } = await import("../../../src/clients/notion.js");
    const { getThreadMapEntry, isProcessed } = await import("../../../src/storage/d1.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    (isCalendarInvite as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (isProcessed as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (listAllMessages as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "msg-silent", threadId: "t-silent" }]);
    (getMessage as ReturnType<typeof vi.fn>).mockResolvedValue(gmailFixtures.newEmail);
    (parseMessage as ReturnType<typeof vi.fn>).mockReturnValue({
      subject: "サイレント件名",
      body: "本文",
      senderEmail: "silent@example.com",
      threadId: "t-silent",
      gmailUrl: "https://mail.google.com/",
    });
    (analyzeEmail as ReturnType<typeof vi.fn>).mockResolvedValue({
      summary: "要約",
      tasks: [{ title: "サイレントタスク", priority: "medium", due: null }],
    });
    (getThreadMapEntry as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (addTask as ReturnType<typeof vi.fn>).mockResolvedValue("page-silent");

    await checkGmail(env, { silent: true });

    expect(sendMessage).not.toHaveBeenCalled();
    const digest = await env.AGENT_KV.get<{ taskLines: string[]; archivedLines: string[] }>(
      "email_digest:pending",
      "json",
    );
    expect(digest?.taskLines.length).toBe(1);
    expect(digest?.taskLines[0]).toContain("サイレント件名");
  });
});

describe("learnFromCancelled", () => {
  it("adds cancelled task sender to blocklist", async () => {
    const env = createMockEnv();
    const { getAllSenderMap } = await import("../../../src/storage/d1.js");
    const { getTaskStatus } = await import("../../../src/clients/notion.js");
    const { sendMessage } = await import("../../../src/clients/telegram.js");

    (getAllSenderMap as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Map([["page-cancelled", "newsletter@example.com"]]),
    );
    (getTaskStatus as ReturnType<typeof vi.fn>).mockResolvedValue("中止");

    await learnFromCancelled(env);

    const senders = await env.AGENT_KV.get("no_task_senders");
    expect(senders).toContain("newsletter@example.com");
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("newsletter@example.com"));
  });

  it("removes completed task from sender_map without adding to blocklist", async () => {
    const env = createMockEnv();
    const { getAllSenderMap, deleteSenderMapEntry } = await import("../../../src/storage/d1.js");
    const { getTaskStatus } = await import("../../../src/clients/notion.js");

    (getAllSenderMap as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Map([["page-done", "friend@example.com"]]),
    );
    (getTaskStatus as ReturnType<typeof vi.fn>).mockResolvedValue("完了");

    await learnFromCancelled(env);

    // Completed task sender should NOT be added to blocklist
    const { getNoTaskSenders: getBlocklist } = await import("../../../src/storage/kv.js");
    const senders = await getBlocklist(env);
    expect(senders.has("friend@example.com")).toBe(false);
    expect(deleteSenderMapEntry).toHaveBeenCalledWith(env, "page-done");
  });
});
