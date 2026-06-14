import { describe, it, expect } from "vitest";
import { jstNow, jstDateStr, jstDateTimeStr, toDateStr } from "../../../src/utils/jst.js";

describe("jst utils", () => {
  it("jstDateStr returns YYYY-MM-DD", () => {
    expect(jstDateStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("jstDateStr matches sv-SE Asia/Tokyo formatting", () => {
    const expected = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    expect(jstDateStr()).toBe(expected);
  });

  it("jstDateTimeStr contains date and HH:MM (24h)", () => {
    const s = jstDateTimeStr();
    expect(s).toMatch(/\d{4}/);
    expect(s).toMatch(/\d{2}:\d{2}/);
  });

  it("jstNow returns a Date", () => {
    expect(jstNow()).toBeInstanceOf(Date);
    expect(Number.isNaN(jstNow().getTime())).toBe(false);
  });

  it("toDateStr returns the UTC date portion of a Date", () => {
    const d = new Date("2026-06-14T15:30:00.000Z");
    expect(toDateStr(d)).toBe("2026-06-14");
  });
});
