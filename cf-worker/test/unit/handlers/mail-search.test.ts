import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchMail } from "../../../src/handlers/mail-search.js";
import { createMockEnv } from "../../helpers/mocks.js";

vi.mock("../../../src/storage/d1.js", () => ({
  searchEmails: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../src/clients/gmail-api.js", () => ({
  searchMessages: vi.fn().mockResolvedValue([]),
  getMessageHeaders: vi.fn(),
  parseMessage: vi.fn(),
}));

vi.mock("../../../src/clients/telegram.js", () => ({
  escapeMd: (t: string) => t,
}));

function hit(subject: string, receivedAt = 1_756_000_000) {
  return {
    subject,
    senderEmail: "keiri@example.com",
    gmailUrl: "https://mail.google.com/mail/u/0/#all/t1",
    receivedAt,
    body: "お世話になります。3月分の請求書を添付します。",
  };
}

describe("searchMail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns usage text for blank input", async () => {
    const env = createMockEnv();
    const { searchEmails } = await import("../../../src/storage/d1.js");

    expect(await searchMail(env, "   ")).toContain("使い方");
    expect(searchEmails).not.toHaveBeenCalled();
  });

  it("searches archived mail with parsed keywords", async () => {
    const env = createMockEnv();
    const { searchEmails } = await import("../../../src/storage/d1.js");
    const { searchMessages } = await import("../../../src/clients/gmail-api.js");

    (searchEmails as ReturnType<typeof vi.fn>).mockResolvedValue([
      hit("請求書の送付"),
      hit("請求書の再送"),
      hit("請求書について"),
    ]);

    const out = await searchMail(env, '"請求書 3月" 経理');
    expect(searchEmails).toHaveBeenCalledWith(env, ["請求書 3月", "経理"]);
    expect(out).toContain("保管メール (3件)");
    expect(out).toContain("請求書の送付");
    expect(out).toContain("3月分の請求書を添付します");
    // ヒットが十分にあるので Gmail 側は引かない
    expect(searchMessages).not.toHaveBeenCalled();
  });

  it("falls back to Gmail search when the archive has too few hits", async () => {
    const env = createMockEnv();
    const { searchEmails } = await import("../../../src/storage/d1.js");
    const { searchMessages, getMessageHeaders, parseMessage } = await import("../../../src/clients/gmail-api.js");

    (searchEmails as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (searchMessages as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "m1", threadId: "t1" }]);
    (getMessageHeaders as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (parseMessage as ReturnType<typeof vi.fn>).mockReturnValue({
      subject: "過去の請求書",
      body: "",
      senderEmail: "old@example.com",
      threadId: "t1",
      gmailUrl: "https://mail.google.com/mail/u/0/#all/t1",
    });

    const out = await searchMail(env, "請求書");
    expect(searchMessages).toHaveBeenCalledWith(env, "請求書", 5);
    expect(out).toContain("Gmail 検索の結果");
    expect(out).toContain("過去の請求書");
  });

  it("reports no results when both sources are empty", async () => {
    const env = createMockEnv();
    const { searchEmails } = await import("../../../src/storage/d1.js");
    const { searchMessages } = await import("../../../src/clients/gmail-api.js");
    (searchEmails as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (searchMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const out = await searchMail(env, "存在しない語");
    expect(out).toContain("該当するメールはありません");
  });

  it("keeps archived hits when the Gmail fallback fails", async () => {
    const env = createMockEnv();
    const { searchEmails } = await import("../../../src/storage/d1.js");
    const { searchMessages } = await import("../../../src/clients/gmail-api.js");

    (searchEmails as ReturnType<typeof vi.fn>).mockResolvedValue([hit("請求書の送付")]);
    (searchMessages as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("429"));

    const out = await searchMail(env, "請求書");
    expect(out).toContain("請求書の送付");
    expect(out).toContain("Gmail 側の検索に失敗しました");
  });
});
