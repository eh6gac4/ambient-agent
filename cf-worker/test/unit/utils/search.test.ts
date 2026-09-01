import { describe, it, expect } from "vitest";
import { parseKeywords, escapeLike, buildEmailSearchQuery, extractSnippet } from "../../../src/utils/search.js";

describe("parseKeywords", () => {
  it("splits on whitespace", () => {
    expect(parseKeywords("請求書 3月")).toEqual(["請求書", "3月"]);
  });

  it("treats a quoted phrase as one keyword", () => {
    expect(parseKeywords('"月次 報告" 確認')).toEqual(["月次 報告", "確認"]);
  });

  it("drops empty input and stray whitespace", () => {
    expect(parseKeywords("   ")).toEqual([]);
    expect(parseKeywords('  a   ""  b ')).toEqual(["a", "b"]);
  });

  it("caps the keyword count at 5", () => {
    expect(parseKeywords("a b c d e f g")).toHaveLength(5);
  });
});

describe("escapeLike", () => {
  it("escapes LIKE wildcards and the escape character itself", () => {
    expect(escapeLike("50%")).toBe("50\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("c:\\tmp")).toBe("c:\\\\tmp");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeLike("請求書")).toBe("請求書");
  });
});

describe("buildEmailSearchQuery", () => {
  it("ANDs one clause per keyword with three binds each", () => {
    const { where, binds } = buildEmailSearchQuery(["請求書", "3月"]);
    expect(where.split(" AND ")).toHaveLength(2);
    expect(where).toContain("subject LIKE ? ESCAPE '\\'");
    expect(where).toContain("body LIKE ? ESCAPE '\\'");
    expect(where).toContain("sender_email LIKE ? ESCAPE '\\'");
    expect(binds).toEqual(["%請求書%", "%請求書%", "%請求書%", "%3月%", "%3月%", "%3月%"]);
  });

  it("wraps escaped keywords in substring wildcards", () => {
    const { binds } = buildEmailSearchQuery(["50%"]);
    expect(binds).toEqual(["%50\\%%", "%50\\%%", "%50\\%%"]);
  });
});

describe("extractSnippet", () => {
  it("centers the snippet on the first matching keyword", () => {
    const body = "あ".repeat(200) + "請求書" + "い".repeat(200);
    const snippet = extractSnippet(body, ["請求書"], 10);
    expect(snippet).toBe("…" + "あ".repeat(10) + "請求書" + "い".repeat(7) + "…");
  });

  it("falls back to the head of the body when nothing matches", () => {
    const snippet = extractSnippet("本文の先頭です", ["該当なし"], 10);
    expect(snippet).toBe("本文の先頭です");
  });

  it("collapses whitespace and returns empty for blank bodies", () => {
    expect(extractSnippet("a\n\n  b", [], 10)).toBe("a b");
    expect(extractSnippet("   \n ", ["x"])).toBe("");
  });

  it("matches case-insensitively", () => {
    expect(extractSnippet("Invoice attached", ["invoice"], 20)).toBe("Invoice attached");
  });
});
