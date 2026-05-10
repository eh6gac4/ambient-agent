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
