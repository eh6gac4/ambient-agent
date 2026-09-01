import { describe, it, expect } from "vitest";
import {
  getThreadMapEntry,
  setThreadMapEntry,
  getSenderForTask,
  setSenderForTask,
  deleteSenderMapEntry,
  getAllSenderMap,
  getCalendarSync,
  setCalendarSync,
  deleteCalendarSync,
  getAllCalendarSync,
  isProcessed,
  markProcessed,
  cleanOldProcessed,
  saveEmail,
  searchEmails,
} from "../../../src/storage/d1.js";
import { createMockEnv, createMockD1 } from "../../helpers/mocks.js";

// These tests use the mock D1 which returns null/empty by default.
// The real behavior is tested via integration tests with miniflare.

describe("gmail_thread_map (mock D1)", () => {
  it("returns null for missing thread", async () => {
    const env = createMockEnv();
    expect(await getThreadMapEntry(env, "thread-nonexistent")).toBeNull();
  });
});

describe("task_sender_map (mock D1)", () => {
  it("returns null for missing pageId", async () => {
    const env = createMockEnv();
    expect(await getSenderForTask(env, "page-nonexistent")).toBeNull();
  });

  it("getAllSenderMap returns empty map when no entries", async () => {
    const env = createMockEnv();
    const map = await getAllSenderMap(env);
    expect(map.size).toBe(0);
  });
});

describe("calendar_sync (mock D1)", () => {
  it("returns null for missing pageId", async () => {
    const env = createMockEnv();
    expect(await getCalendarSync(env, "page-nonexistent")).toBeNull();
  });

  it("getAllCalendarSync returns empty map when no entries", async () => {
    const env = createMockEnv();
    const map = await getAllCalendarSync(env);
    expect(map.size).toBe(0);
  });
});

describe("processed_messages (mock D1)", () => {
  it("isProcessed returns false for unknown message", async () => {
    const env = createMockEnv();
    expect(await isProcessed(env, "msg-unknown")).toBe(false);
  });
});

describe("emails", () => {
  it("saveEmail truncates the body at 20,000 chars", async () => {
    const capture: Array<{ sql: string; binds: unknown[] }> = [];
    const env = createMockEnv({ AGENT_DB: createMockD1({ capture }) });

    await saveEmail(env, {
      messageId: "msg-1",
      subject: "件名",
      senderEmail: "a@example.com",
      body: "あ".repeat(25000),
      gmailUrl: "https://mail.google.com/",
    });

    expect(capture[0].sql).toContain("INSERT OR REPLACE INTO emails");
    expect(capture[0].binds[0]).toBe("msg-1");
    expect((capture[0].binds[3] as string).length).toBe(20000);
  });

  it("searchEmails ANDs keywords and binds the limit last", async () => {
    const capture: Array<{ sql: string; binds: unknown[] }> = [];
    const env = createMockEnv({ AGENT_DB: createMockD1({ capture }) });

    await searchEmails(env, ["請求書", "3月"], 5);

    expect(capture[0].sql).toContain("ORDER BY received_at DESC LIMIT ?");
    expect(capture[0].sql).toContain("ESCAPE '\\'");
    // 抜粋用に本文の先頭だけを持ち出す
    expect(capture[0].sql).toContain("substr(body, 1, 4000)");
    expect(capture[0].binds).toEqual([
      "%請求書%", "%請求書%", "%請求書%",
      "%3月%", "%3月%", "%3月%",
      5,
    ]);
  });

  it("searchEmails maps rows to the handler-facing shape", async () => {
    const env = createMockEnv({
      AGENT_DB: createMockD1({
        rows: [
          {
            subject: "請求書の送付",
            sender_email: "keiri@example.com",
            body: "お世話になります。3月分の請求書を添付します。",
            gmail_url: "https://mail.google.com/x",
            received_at: 1_756_000_000,
          },
        ],
      }),
    });

    const results = await searchEmails(env, ["請求書"]);
    expect(results).toEqual([
      {
        subject: "請求書の送付",
        senderEmail: "keiri@example.com",
        gmailUrl: "https://mail.google.com/x",
        receivedAt: 1_756_000_000,
        body: "お世話になります。3月分の請求書を添付します。",
      },
    ]);
  });

  it("searchEmails returns empty without querying when no keywords", async () => {
    const capture: Array<{ sql: string; binds: unknown[] }> = [];
    const env = createMockEnv({ AGENT_DB: createMockD1({ capture }) });

    expect(await searchEmails(env, [])).toEqual([]);
    expect(capture).toHaveLength(0);
  });
});
