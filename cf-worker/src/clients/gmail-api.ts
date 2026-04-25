import type { Env } from "../types.js";
import { getAccessToken } from "./google-auth.js";

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

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function parseHeaders(payload: GmailPayload): Record<string, string> {
  return Object.fromEntries(payload.headers.map((h) => [h.name, h.value]));
}

function isCalendarInvite(payload: GmailPayload): boolean {
  if (payload.mimeType.startsWith("text/calendar")) return true;
  return (payload.parts ?? []).some(isCalendarInvite);
}

function extractBody(payload: GmailPayload): string {
  if (payload.mimeType === "text/plain") {
    const data = payload.body?.data ?? "";
    try {
      return atob(data.replace(/-/g, "+").replace(/_/g, "/"));
    } catch {
      return "";
    }
  }
  for (const part of payload.parts ?? []) {
    const result = extractBody(part);
    if (result) return result;
  }
  return "";
}

function extractEmail(sender: string): string {
  if (sender.includes("<") && sender.includes(">")) {
    return sender.split("<")[1].replace(">", "").trim().toLowerCase();
  }
  return sender.trim().toLowerCase();
}

export async function listAllMessages(env: Env): Promise<Array<{ id: string; threadId: string }>> {
  const token = await getAccessToken(env);
  const messages: Array<{ id: string; threadId: string }> = [];
  let pageToken: string | undefined;

  while (messages.length < MAX_MESSAGES_PER_RUN) {
    const batch = Math.min(100, MAX_MESSAGES_PER_RUN - messages.length);
    const params = new URLSearchParams({ q: GMAIL_QUERY, maxResults: String(batch) });
    if (pageToken) params.set("pageToken", pageToken);

    const resp = await fetch(`${BASE}/messages?${params}`, { headers: authHeader(token) });
    if (!resp.ok) throw new Error(`Gmail list messages failed: ${resp.status}`);

    const data = await resp.json<{
      messages?: Array<{ id: string; threadId: string }>;
      nextPageToken?: string;
    }>();
    messages.push(...(data.messages ?? []));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return messages;
}

export async function getMessage(env: Env, msgId: string): Promise<GmailMessage> {
  const token = await getAccessToken(env);
  const resp = await fetch(`${BASE}/messages/${msgId}?format=full`, {
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
