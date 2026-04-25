import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendMessage, escapeMd } from "../../../src/clients/telegram.js";
import { createMockEnv } from "../../helpers/mocks.js";

describe("escapeMd", () => {
  it("escapes Markdown special characters", () => {
    expect(escapeMd("hello *world*")).toBe("hello \\*world\\*");
    expect(escapeMd("code `snippet`")).toBe("code \\`snippet\\`");
    expect(escapeMd("[link]")).toBe("\\[link]");  // Python behavior: only [ is escaped, not ]
    expect(escapeMd("_italic_")).toBe("\\_italic\\_");
  });

  it("does not alter regular text", () => {
    expect(escapeMd("hello world")).toBe("hello world");
  });
});

describe("sendMessage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends a short message in one request", async () => {
    const env = createMockEnv();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendMessage(env, "Hello");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toBe("Hello");
    expect(body.chat_id).toBe("123456789");
    expect(body.parse_mode).toBe("Markdown");
  });

  it("splits messages longer than 4096 characters", async () => {
    const env = createMockEnv();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const longText = "A".repeat(5000);
    await sendMessage(env, longText);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when Telegram API returns error", async () => {
    const env = createMockEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    ));

    await expect(sendMessage(env, "test")).rejects.toThrow("401");
  });
});
