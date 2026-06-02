import { describe, it, expect } from "vitest";
import { parseMessage } from "../../../src/clients/gmail-api.js";

function b64url(input: Uint8Array): string {
  let bin = "";
  for (const b of input) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function utf8B64Url(text: string): string {
  return b64url(new TextEncoder().encode(text));
}

describe("parseMessage body decoding", () => {
  it("decodes UTF-8 Japanese body via TextDecoder (no mojibake)", () => {
    const body = "長 俊貴 様\nヤマト運輸をご利用いただきありがとうございます。";
    const msg = {
      id: "m1",
      threadId: "t1",
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "Subject", value: "件名サンプル" },
          { name: "From", value: "Sender <s@example.com>" },
          { name: "Content-Type", value: 'text/plain; charset="UTF-8"' },
        ],
        body: { data: utf8B64Url(body) },
      },
    };
    const parsed = parseMessage(msg as never);
    expect(parsed.body).toBe(body);
    expect(parsed.subject).toBe("件名サンプル");
  });

  it("falls back to UTF-8 when charset header is missing", () => {
    const body = "テスト本文です";
    const msg = {
      id: "m2",
      threadId: "t2",
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "Subject", value: "x" },
          { name: "From", value: "x@example.com" },
        ],
        body: { data: utf8B64Url(body) },
      },
    };
    expect(parseMessage(msg as never).body).toBe(body);
  });

  it("recurses into multipart and decodes nested text/plain part", () => {
    const body = "multipart 本文";
    const msg = {
      id: "m3",
      threadId: "t3",
      payload: {
        mimeType: "multipart/alternative",
        headers: [
          { name: "Subject", value: "multi" },
          { name: "From", value: "x@example.com" },
        ],
        parts: [
          {
            mimeType: "text/html",
            headers: [{ name: "Content-Type", value: "text/html; charset=UTF-8" }],
            body: { data: utf8B64Url("<p>HTML</p>") },
          },
          {
            mimeType: "text/plain",
            headers: [{ name: "Content-Type", value: "text/plain; charset=UTF-8" }],
            body: { data: utf8B64Url(body) },
          },
        ],
      },
    };
    expect(parseMessage(msg as never).body).toBe(body);
  });

  it("falls back to text/html (tag-stripped) when no text/plain part exists", () => {
    const html =
      "<html><head><style>p{color:red}</style></head><body>" +
      "<p>請求書の件です。</p><div>支払期限は&nbsp;6/30&nbsp;まで&amp;要確認。</div>" +
      "<br>よろしくお願いします。</body></html>";
    const msg = {
      id: "m5",
      threadId: "t5",
      payload: {
        mimeType: "multipart/alternative",
        headers: [
          { name: "Subject", value: "請求書" },
          { name: "From", value: "biller <b@example.com>" },
        ],
        parts: [
          {
            mimeType: "text/html",
            headers: [{ name: "Content-Type", value: "text/html; charset=UTF-8" }],
            body: { data: utf8B64Url(html) },
          },
        ],
      },
    };
    const parsed = parseMessage(msg as never);
    expect(parsed.body).toBe("請求書の件です。\n支払期限は 6/30 まで&要確認。\n\nよろしくお願いします。");
  });

  it("decodes numeric and hex HTML entities in html fallback", () => {
    const html = "<p>&#26716;&#x4E95;</p>"; // 桜井
    const msg = {
      id: "m6",
      threadId: "t6",
      payload: {
        mimeType: "text/html",
        headers: [
          { name: "Subject", value: "x" },
          { name: "From", value: "x@example.com" },
        ],
        body: { data: utf8B64Url(html) },
      },
    };
    expect(parseMessage(msg as never).body).toBe("桜井");
  });

  it("prefers text/plain over text/html when both are present", () => {
    const plain = "プレーン本文";
    const msg = {
      id: "m7",
      threadId: "t7",
      payload: {
        mimeType: "multipart/alternative",
        headers: [
          { name: "Subject", value: "x" },
          { name: "From", value: "x@example.com" },
        ],
        parts: [
          {
            mimeType: "text/html",
            headers: [{ name: "Content-Type", value: "text/html; charset=UTF-8" }],
            body: { data: utf8B64Url("<p>HTML 本文</p>") },
          },
          {
            mimeType: "text/plain",
            headers: [{ name: "Content-Type", value: "text/plain; charset=UTF-8" }],
            body: { data: utf8B64Url(plain) },
          },
        ],
      },
    };
    expect(parseMessage(msg as never).body).toBe(plain);
  });

  it("decodes as UTF-8 even when Content-Type declares charset=ISO-2022-JP (Gmail normalizes body to UTF-8)", () => {
    // Gmail API は元メールの charset に関係なく body.data を UTF-8 バイト列で返すが、
    // Content-Type ヘッダは元メールの宣言値（例: ISO-2022-JP）が残る。
    // charset を信用して ISO-2022-JP デコーダに通すと UTF-8 バイト列が壊れるため、常に UTF-8 で読む。
    const body = "利用者ID　0017902933　様\r\nまもなく下記の資料の返却期限日となりますので、お知らせいたします。";
    const msg = {
      id: "m4",
      threadId: "t4",
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "Subject", value: "x" },
          { name: "From", value: "x@example.com" },
          { name: "Content-Type", value: "text/plain; charset=ISO-2022-JP" },
        ],
        body: { data: utf8B64Url(body) },
      },
    };
    expect(parseMessage(msg as never).body).toBe(body);
  });
});
