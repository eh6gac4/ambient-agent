import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isHoliday } from "../../../src/utils/holiday.js";

// 2026-01-01 (Thu) 00:00 UTC = 2026-01-01 09:00 JST (元日)
const JST_HOLIDAY_UTC_MS = Date.UTC(2025, 11, 31, 15, 0, 0); // 2026-01-01 00:00 JST
// 2026-06-13 (Sat) 00:00 UTC = 2026-06-13 09:00 JST (Saturday)
const JST_SATURDAY_UTC_MS = Date.UTC(2026, 5, 12, 15, 0, 0); // 2026-06-13 00:00 JST
// 2026-06-14 (Sun) 00:00 UTC = 2026-06-14 09:00 JST (Sunday)
const JST_SUNDAY_UTC_MS = Date.UTC(2026, 5, 13, 15, 0, 0); // 2026-06-14 00:00 JST
// 2026-06-15 (Mon) 00:00 UTC = 2026-06-15 09:00 JST (weekday, not a holiday)
const JST_MONDAY_UTC_MS = Date.UTC(2026, 5, 14, 15, 0, 0); // 2026-06-15 00:00 JST

function mockDateNow(ms: number) {
  vi.spyOn(Date, "now").mockReturnValue(ms);
}

describe("isHoliday", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true on Saturday (JST)", async () => {
    mockDateNow(JST_SATURDAY_UTC_MS);
    const result = await isHoliday();
    expect(result).toBe(true);
  });

  it("returns true on Sunday (JST)", async () => {
    mockDateNow(JST_SUNDAY_UTC_MS);
    const result = await isHoliday();
    expect(result).toBe(true);
  });

  it("returns true on Japanese public holiday (元日 2026-01-01)", async () => {
    mockDateNow(JST_HOLIDAY_UTC_MS);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ "2026-01-01": "元日", "2026-01-12": "成人の日" }), { status: 200 }),
      ),
    );
    const result = await isHoliday();
    expect(result).toBe(true);
  });

  it("returns false on a weekday that is not a public holiday", async () => {
    mockDateNow(JST_MONDAY_UTC_MS);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ "2026-01-01": "元日" }), { status: 200 }),
      ),
    );
    const result = await isHoliday();
    expect(result).toBe(false);
  });

  it("returns false when holiday API call fails (fail-open)", async () => {
    mockDateNow(JST_MONDAY_UTC_MS);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const result = await isHoliday();
    expect(result).toBe(false);
  });

  it("returns false when holiday API returns non-200", async () => {
    mockDateNow(JST_MONDAY_UTC_MS);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    const result = await isHoliday();
    expect(result).toBe(false);
  });
});
