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

  it("retries as plain text when Markdown parsing fails", async () => {
    const env = createMockEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: can't parse entities" }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendMessage(env, "壊れた *Markdown");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(firstBody.parse_mode).toBe("Markdown");
    // 再送はプレーンテキスト（parse_mode なし）で、本文はそのまま届く
    expect(retryBody.parse_mode).toBeUndefined();
    expect(retryBody.text).toBe("壊れた *Markdown");
  });

  it("does not retry on non-parse 400 errors", async () => {
    const env = createMockEnv();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ description: "Bad Request: chat not found" }), { status: 400 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendMessage(env, "test")).rejects.toThrow("chat not found");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws when the plain-text retry also fails", async () => {
    const env = createMockEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ description: "can't parse entities" }), { status: 400 }),
      )
      .mockResolvedValueOnce(new Response("Internal Server Error", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendMessage(env, "test")).rejects.toThrow("plain retry");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
