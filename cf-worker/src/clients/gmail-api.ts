import type { Env } from "../types.js";
import { getAccessToken, authHeader } from "./google-auth.js";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_QUERY = "is:unread in:inbox -category:promotions";
const MAX_MESSAGES_PER_RUN = 200;

interface GmailMessage {
  id: string;
  threadId: string;
  payload: GmailPayload;
}

interface GmailPayload {
  headers: Array<{ name: string; value: string }>;
  mimeType: string;
  body?: { data?: string };
  parts?: GmailPayload[];
}

function parseHeaders(payload: GmailPayload): Record<string, string> {
  return Object.fromEntries(payload.headers.map((h) => [h.name, h.value]));
}

function isCalendarInvite(payload: GmailPayload): boolean {
  if (payload.mimeType.startsWith("text/calendar")) return true;
  return (payload.parts ?? []).some(isCalendarInvite);
}

// Gmail API は body.data を元メールの charset に関係なく UTF-8 へ正規化して返すため、
// Content-Type ヘッダの charset= は無視して常に UTF-8 でデコードする。
const UTF8_DECODER = new TextDecoder("utf-8");

function decodeBase64Url(data: string): string {
  const binary = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return UTF8_DECODER.decode(bytes);
}

function decodePart(payload: GmailPayload): string {
  const data = payload.body?.data ?? "";
  if (!data) return "";
  try {
    return decodeBase64Url(data);
  } catch {
    return "";
  }
}

// MIME ツリーを再帰的に探索し、最初に見つかった指定 mimeType パートの本文を返す。
function extractByMime(payload: GmailPayload, mimeType: string): string {
  if (payload.mimeType === mimeType) return decodePart(payload);
  for (const part of payload.parts ?? []) {
    const result = extractByMime(part, mimeType);
    if (result) return result;
  }
  return "";
}

const HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

// HTML 本文を LLM に渡せるプレーンテキストへ簡易変換する。
// Workers 環境では cheerio/jsdom が重いため、正規表現ベースの軽量ストリッパで処理する。
function stripHtml(html: string): string {
  return html
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, "") // 不可視ブロックを除去
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n") // ブロック要素末尾を改行に
    .replace(/<[^>]+>/g, "") // 残りのタグを除去
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&[a-z]+;/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? m)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// text/plain を優先し、無ければ text/html をタグ除去してフォールバックする。
function extractBody(payload: GmailPayload): string {
  const plain = extractByMime(payload, "text/plain");
  if (plain) return plain;
  const html = extractByMime(payload, "text/html");
  if (html) return stripHtml(html);
  return "";
}

function extractEmail(sender: string): string {
  if (sender.includes("<") && sender.includes(">")) {
    return sender.split("<")[1].replace(">", "").trim().toLowerCase();
  }
  return sender.trim().toLowerCase();
}

/** messages.list を 1 ページぶん叩く。ID とページトークンだけを返す。 */
async function fetchMessageIds(
  token: string,
  query: string,
  maxResults: number,
  pageToken?: string,
): Promise<{ messages: Array<{ id: string; threadId: string }>; nextPageToken?: string }> {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  if (pageToken) params.set("pageToken", pageToken);

  const resp = await fetch(`${BASE}/messages?${params}`, { headers: authHeader(token) });
  if (!resp.ok) throw new Error(`Gmail list messages failed: ${resp.status}`);

  const data = await resp.json<{
    messages?: Array<{ id: string; threadId: string }>;
    nextPageToken?: string;
  }>();
  return { messages: data.messages ?? [], nextPageToken: data.nextPageToken };
}

export async function listAllMessages(env: Env): Promise<Array<{ id: string; threadId: string }>> {
  const token = await getAccessToken(env);
  const messages: Array<{ id: string; threadId: string }> = [];
  let pageToken: string | undefined;

  while (messages.length < MAX_MESSAGES_PER_RUN) {
    const batch = Math.min(100, MAX_MESSAGES_PER_RUN - messages.length);
    const page = await fetchMessageIds(token, GMAIL_QUERY, batch, pageToken);
    messages.push(...page.messages);
    pageToken = page.nextPageToken;
    if (!pageToken) break;
  }

  return messages;
}

/**
 * 任意のクエリで Gmail を検索する。Gmail 側の検索は語の前方一致である点に注意。
 * 取り込み対象の抽出（listAllMessages）とは別用途。
 */
export async function searchMessages(
  env: Env,
  query: string,
  limit: number,
): Promise<Array<{ id: string; threadId: string }>> {
  const token = await getAccessToken(env);
  const page = await fetchMessageIds(token, query, limit);
  return page.messages;
}

export async function getMessage(env: Env, msgId: string): Promise<GmailMessage> {
  return fetchMessage(env, msgId, "full");
}

/** 件名・送信者だけが必要なときの軽量版（本文を転送しない）。 */
export async function getMessageHeaders(env: Env, msgId: string): Promise<GmailMessage> {
  return fetchMessage(env, msgId, "metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Message-ID");
}

async function fetchMessage(env: Env, msgId: string, format: string): Promise<GmailMessage> {
  const token = await getAccessToken(env);
  const resp = await fetch(`${BASE}/messages/${msgId}?format=${format}`, {
    headers: authHeader(token),
  });
  if (!resp.ok) throw new Error(`Gmail getMessage failed: ${resp.status}`);
  return resp.json<GmailMessage>();
}

export function parseMessage(msg: GmailMessage, env?: Env): { subject: string; body: string; senderEmail: string; threadId: string; gmailUrl: string } {
  const headers = parseHeaders(msg.payload);
  const subject = headers["Subject"] ?? "(件名なし)";
  const body = extractBody(msg.payload);
  const senderEmail = extractEmail(headers["From"] ?? "");
  const threadId = msg.threadId ?? "";

  const accountIndex = env?.GMAIL_ACCOUNT_INDEX ?? "0";
  const messageIdHeader = headers["Message-ID"] ?? "";
  const gmailUrl = messageIdHeader
    ? `https://mail.google.com/mail/u/${accountIndex}/#search/rfc822msgid:${encodeURIComponent(messageIdHeader)}`
    : `https://mail.google.com/mail/u/${accountIndex}/#all/${threadId}`;

  return { subject, body, senderEmail, threadId, gmailUrl };
}

export { isCalendarInvite };

export async function archiveMessage(env: Env, msgId: string): Promise<void> {
  const token = await getAccessToken(env);
  const resp = await fetch(`${BASE}/messages/${msgId}/modify`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
  });
  if (!resp.ok) throw new Error(`Gmail archive failed: ${resp.status}`);
}

export async function addLabel(env: Env, msgId: string, labelId: string): Promise<void> {
  const token = await getAccessToken(env);
  await fetch(`${BASE}/messages/${msgId}/modify`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify({ addLabelIds: [labelId] }),
  });
}

export async function getOrCreateLabel(env: Env, labelName: string): Promise<string | null> {
  const cacheKey = `gmail:label:${labelName}`;
  const cached = await env.AGENT_KV.get(cacheKey);
  if (cached) return cached;

  const token = await getAccessToken(env);
  const listResp = await fetch(`${BASE}/labels`, { headers: authHeader(token) });
  if (!listResp.ok) return null;

  const data = await listResp.json<{ labels: Array<{ id: string; name: string }> }>();
  const existing = data.labels.find((l) => l.name === labelName);
  if (existing) {
    await env.AGENT_KV.put(cacheKey, existing.id, { expirationTtl: 3600 });
    return existing.id;
  }

  const createResp = await fetch(`${BASE}/labels`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify({ name: labelName }),
  });
  if (!createResp.ok) return null;

  const newLabel = await createResp.json<{ id: string }>();
  await env.AGENT_KV.put(cacheKey, newLabel.id, { expirationTtl: 3600 });
  return newLabel.id;
}
