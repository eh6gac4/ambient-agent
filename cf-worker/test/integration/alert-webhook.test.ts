import { describe, it, expect, vi, beforeEach } from "vitest";
import worker from "../../src/index.js";
import { createMockEnv } from "../helpers/mocks.js";

vi.mock("../../src/clients/telegram.js", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  getFileUrl: vi.fn(),
  escapeMd: (t: string) => t,
}));

function alertRequest(body: unknown, token?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return new Request("https://example.com/alert", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("/alert ingress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects request without token (401, no notify)", async () => {
    const env = createMockEnv();
    const { sendMessage } = await import("../../src/clients/telegram.js");

    const resp = await worker.fetch(alertRequest({ title: "x" }), env);
    expect(resp.status).toBe(401);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("rejects request with wrong token (401)", async () => {
    const env = createMockEnv();
    const resp = await worker.fetch(alertRequest({ title: "x" }, "wrong"), env);
    expect(resp.status).toBe(401);
  });

  it("accepts normalized down payload and notifies Telegram", async () => {
    const env = createMockEnv();
    const { sendMessage } = await import("../../src/clients/telegram.js");

    const resp = await worker.fetch(
      alertRequest(
        { source: "uptime-kuma", status: "down", title: "nginx", detail: "Connection refused" },
        env.ALERT_TOKEN,
      ),
      env,
    );
    expect(resp.status).toBe(200);
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("nginx"));
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("🔴"));
  });

  it("uses green icon for recovery (up) status", async () => {
    const env = createMockEnv();
    const { sendMessage } = await import("../../src/clients/telegram.js");

    await worker.fetch(
      alertRequest({ source: "beszel", status: "up", title: "host", detail: "recovered" }, env.ALERT_TOKEN),
      env,
    );
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("🟢"));
  });

  it("falls back to Uptime Kuma native payload shape", async () => {
    const env = createMockEnv();
    const { sendMessage } = await import("../../src/clients/telegram.js");

    await worker.fetch(
      alertRequest(
        { heartbeat: { status: 0 }, monitor: { name: "beszel-agent" }, msg: "down" },
        env.ALERT_TOKEN,
      ),
      env,
    );
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("beszel-agent"));
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("🔴"));
  });

  it("returns OK even if notify throws", async () => {
    const env = createMockEnv();
    const { sendMessage } = await import("../../src/clients/telegram.js");
    (sendMessage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Telegram error"));

    const resp = await worker.fetch(
      alertRequest({ source: "uptime-kuma", title: "x" }, env.ALERT_TOKEN),
      env,
    );
    expect(resp.status).toBe(200);
  });
});
