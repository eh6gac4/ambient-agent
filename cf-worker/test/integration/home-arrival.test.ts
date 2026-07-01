import { describe, it, expect, vi, beforeEach } from "vitest";
import worker from "../../src/index.js";
import { createMockEnv, sampleTasks } from "../helpers/mocks.js";

vi.mock("../../src/utils/holiday.js", () => ({
  isHoliday: vi.fn().mockResolvedValue(false),
}));

vi.mock("../../src/clients/notion.js", () => ({
  getOpenTasks: vi.fn(),
}));

vi.mock("../../src/clients/gemini.js", () => ({
  selectHomeArrivalNotifications: vi.fn(),
}));

vi.mock("../../src/clients/telegram.js", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  getFileUrl: vi.fn(),
  escapeMd: (t: string) => t,
}));

function homeArrivalRequest(token?: string): Request {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return new Request("https://example.com/home-arrival", { method: "GET", headers });
}

describe("/home-arrival ingress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects request without token (401)", async () => {
    const env = createMockEnv();
    const { sendMessage } = await import("../../src/clients/telegram.js");

    const resp = await worker.fetch(homeArrivalRequest(), env);
    expect(resp.status).toBe(401);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("rejects request with wrong token (401)", async () => {
    const env = createMockEnv();
    const resp = await worker.fetch(homeArrivalRequest("wrong-token"), env);
    expect(resp.status).toBe(401);
  });

  it("returns notifications JSON when tasks exist", async () => {
    const env = createMockEnv();
    const { getOpenTasks } = await import("../../src/clients/notion.js");
    const { selectHomeArrivalNotifications } = await import("../../src/clients/gemini.js");
    const { sendMessage } = await import("../../src/clients/telegram.js");

    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue(sampleTasks());
    (selectHomeArrivalNotifications as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "子どもの宿題を確認", priority: "high" },
    ]);

    const resp = await worker.fetch(homeArrivalRequest(env.ALERT_TOKEN), env);
    expect(resp.status).toBe(200);
    const body = await resp.json<{ notifications: unknown[] }>();
    expect(body.notifications).toHaveLength(1);
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("帰宅通知"));
  });

  it("returns empty array and skips Telegram when no tasks", async () => {
    const env = createMockEnv();
    const { getOpenTasks } = await import("../../src/clients/notion.js");
    const { sendMessage } = await import("../../src/clients/telegram.js");

    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const resp = await worker.fetch(homeArrivalRequest(env.ALERT_TOKEN), env);
    expect(resp.status).toBe(200);
    const body = await resp.json<{ notifications: unknown[] }>();
    expect(body.notifications).toHaveLength(0);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("returns 500 with empty notifications when handler throws", async () => {
    const env = createMockEnv();
    const { getOpenTasks } = await import("../../src/clients/notion.js");

    (getOpenTasks as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Notion error"));

    const resp = await worker.fetch(homeArrivalRequest(env.ALERT_TOKEN), env);
    expect(resp.status).toBe(500);
    const body = await resp.json<{ notifications: unknown[] }>();
    expect(body.notifications).toHaveLength(0);
  });
});
