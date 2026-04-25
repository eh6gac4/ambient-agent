import type { Env, CalendarEvent } from "../types.js";
import { getAccessToken } from "./google-auth.js";

const BASE = "https://www.googleapis.com/calendar/v3/calendars/primary";

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export async function getTodaysEvents(env: Env): Promise<CalendarEvent[]> {
  const token = await getAccessToken(env);

  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 0);

  const jstOffset = "+09:00";
  const timeMin = start.toISOString().slice(0, 19) + jstOffset;
  const timeMax = end.toISOString().slice(0, 19) + jstOffset;

  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
  });

  const resp = await fetch(`${BASE}/events?${params}`, { headers: authHeader(token) });
  if (!resp.ok) throw new Error(`Google Calendar list failed: ${resp.status}`);

  const data = await resp.json<{
    items: Array<{
      summary?: string;
      start: { dateTime?: string; date?: string };
    }>;
  }>();

  return (data.items ?? []).map((e) => ({
    summary: e.summary ?? "",
    start: e.start.dateTime ?? e.start.date ?? "",
  }));
}

export async function insertEvent(env: Env, title: string, due: string): Promise<string | null> {
  const token = await getAccessToken(env);

  let body: Record<string, unknown>;
  if (due.includes("T")) {
    const startDt = new Date(due);
    const endDt = new Date(startDt.getTime() + 60 * 60 * 1000);
    body = {
      summary: title,
      start: { dateTime: startDt.toISOString(), timeZone: "Asia/Tokyo" },
      end: { dateTime: endDt.toISOString(), timeZone: "Asia/Tokyo" },
    };
  } else {
    body = {
      summary: title,
      start: { date: due },
      end: { date: due },
    };
  }

  const resp = await fetch(`${BASE}/events`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) return null;
  const event = await resp.json<{ id: string }>();
  return event.id ?? null;
}

export async function deleteEvent(env: Env, eventId: string): Promise<void> {
  const token = await getAccessToken(env);
  await fetch(`${BASE}/events/${eventId}`, {
    method: "DELETE",
    headers: authHeader(token),
  });
}
