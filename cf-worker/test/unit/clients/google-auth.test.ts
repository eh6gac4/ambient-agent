import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAccessToken } from "../../../src/clients/google-auth.js";
import { createMockEnv } from "../../helpers/mocks.js";

describe("getAccessToken", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns cached token when still valid", async () => {
    const env = createMockEnv();
    const cache = { token: "cached-token", expiresAt: Date.now() + 3_600_000 };
    await env.AGENT_KV.put("google:access_token", JSON.stringify(cache));

    const token = await getAccessToken(env);
    expect(token).toBe("cached-token");
  });

  it("refreshes token when cache is missing", async () => {
    const env = createMockEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "new-token", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));

    const token = await getAccessToken(env);
    expect(token).toBe("new-token");
  });

  it("refreshes token when cached token is about to expire (within 60s)", async () => {
    const env = createMockEnv();
    const cache = { token: "old-token", expiresAt: Date.now() + 30_000 };
    await env.AGENT_KV.put("google:access_token", JSON.stringify(cache));

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "fresh-token", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));

    const token = await getAccessToken(env);
    expect(token).toBe("fresh-token");
  });

  it("throws when OAuth endpoint returns error", async () => {
    const env = createMockEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("invalid_grant", { status: 400 }),
    ));

    await expect(getAccessToken(env)).rejects.toThrow("400");
  });
});
