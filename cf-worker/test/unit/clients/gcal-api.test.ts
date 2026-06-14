import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getTodaysEvents,
  insertEvent,
  updateEventDateTime,
  deleteEvent,
} from "../../../src/clients/gcal-api.js";
import { createMockEnv } from "../../helpers/mocks.js";

vi.mock("../../../src/clients/google-auth.js", () => ({
  getAccessToken: vi.fn().mockResolvedValue("test-access-token"),
  authHeader: (token: string) => ({ Authorization: `Bearer ${token}` }),
}));

type FetchCall = { url: string; init?: RequestInit };

function stubFetch(responder: (call: FetchCall) => Response): {
  calls: FetchCall[];
  fn: ReturnType<typeof vi.fn>;
} {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return responder(call);
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fn };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("gcal-api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  describe("getTodaysEvents", () => {
    it("requests JST day window and maps items", async () => {
      const env = createMockEnv();
      const { calls } = stubFetch(() =>
        json({
          items: [
            { summary: "会議", start: { dateTime: "2026-06-14T10:00:00+09:00" } },
            { summary: "終日イベント", start: { date: "2026-06-14" } },
            { start: { dateTime: "2026-06-14T15:00:00+09:00" } },
          ],
        }),
      );

      const events = await getTodaysEvents(env);

      const url = calls[0].url;
      expect(url).toContain("singleEvents=true");
      expect(url).toContain("orderBy=startTime");
      // timeMin / timeMax carry the +09:00 JST offset (URL-encoded as %2B09%3A00)
      expect(url).toContain("timeMin=");
      expect(url).toContain("timeMax=");
      expect(url).toContain("%2B09%3A00");
      expect(calls[0].init?.headers).toMatchObject({ Authorization: "Bearer test-access-token" });

      expect(events).toEqual([
        { summary: "会議", start: "2026-06-14T10:00:00+09:00" },
        { summary: "終日イベント", start: "2026-06-14" },
        { summary: "", start: "2026-06-14T15:00:00+09:00" },
      ]);
    });

    it("returns empty array when items missing", async () => {
      const env = createMockEnv();
      stubFetch(() => json({}));
      expect(await getTodaysEvents(env)).toEqual([]);
    });

    it("throws on non-ok response", async () => {
      const env = createMockEnv();
      stubFetch(() => json({}, 500));
      await expect(getTodaysEvents(env)).rejects.toThrow("500");
    });
  });

  describe("insertEvent", () => {
    it("creates a timed event with 1h duration and Asia/Tokyo tz", async () => {
      const env = createMockEnv();
      const { calls } = stubFetch(() => json({ id: "evt-1" }));

      const id = await insertEvent(env, "打合せ", "2026-06-14T09:00");
      expect(id).toBe("evt-1");

      const body = JSON.parse(calls[0].init!.body as string);
      expect(body.summary).toBe("打合せ");
      expect(body.start.timeZone).toBe("Asia/Tokyo");
      expect(body.end.timeZone).toBe("Asia/Tokyo");
      expect(body.start.dateTime).toBeDefined();
      expect(body.end.dateTime).toBeDefined();
      const startMs = new Date(body.start.dateTime).getTime();
      const endMs = new Date(body.end.dateTime).getTime();
      expect(endMs - startMs).toBe(60 * 60 * 1000);
      expect(calls[0].init?.method).toBe("POST");
    });

    it("creates an all-day event when due has no time", async () => {
      const env = createMockEnv();
      const { calls } = stubFetch(() => json({ id: "evt-2" }));

      const id = await insertEvent(env, "締切", "2026-06-14");
      expect(id).toBe("evt-2");

      const body = JSON.parse(calls[0].init!.body as string);
      expect(body.start).toEqual({ date: "2026-06-14" });
      expect(body.end).toEqual({ date: "2026-06-14" });
    });

    it("returns null on non-ok response", async () => {
      const env = createMockEnv();
      stubFetch(() => json({}, 403));
      expect(await insertEvent(env, "x", "2026-06-14")).toBeNull();
    });
  });

  describe("updateEventDateTime", () => {
    it("returns true on success (timed)", async () => {
      const env = createMockEnv();
      const { calls } = stubFetch(() => json({ id: "evt-1" }));

      const ok = await updateEventDateTime(env, "evt-1", "2026-06-15T11:00");
      expect(ok).toBe(true);
      expect(calls[0].init?.method).toBe("PATCH");
      const body = JSON.parse(calls[0].init!.body as string);
      expect(body.start.timeZone).toBe("Asia/Tokyo");
      expect(body.summary).toBeUndefined();
    });

    it("returns true on success (all-day)", async () => {
      const env = createMockEnv();
      const { calls } = stubFetch(() => json({}));
      const ok = await updateEventDateTime(env, "evt-1", "2026-06-15");
      expect(ok).toBe(true);
      const body = JSON.parse(calls[0].init!.body as string);
      expect(body.start).toEqual({ date: "2026-06-15" });
      expect(body.end).toEqual({ date: "2026-06-15" });
    });

    it("returns false on 404", async () => {
      const env = createMockEnv();
      stubFetch(() => json({}, 404));
      expect(await updateEventDateTime(env, "evt-x", "2026-06-15")).toBe(false);
    });

    it("returns false on 410", async () => {
      const env = createMockEnv();
      stubFetch(() => json({}, 410));
      expect(await updateEventDateTime(env, "evt-x", "2026-06-15")).toBe(false);
    });

    it("throws on other non-ok status", async () => {
      const env = createMockEnv();
      stubFetch(() => json({}, 500));
      await expect(updateEventDateTime(env, "evt-x", "2026-06-15")).rejects.toThrow("500");
    });
  });

  describe("deleteEvent", () => {
    it("issues a DELETE to the event URL", async () => {
      const env = createMockEnv();
      const { calls } = stubFetch(() => new Response(null, { status: 204 }));

      await deleteEvent(env, "evt-1");
      expect(calls[0].url).toContain("/events/evt-1");
      expect(calls[0].init?.method).toBe("DELETE");
      expect(calls[0].init?.headers).toMatchObject({ Authorization: "Bearer test-access-token" });
    });
  });
});
