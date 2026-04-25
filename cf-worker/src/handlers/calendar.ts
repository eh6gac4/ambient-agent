import type { Env } from "../types.js";
import { getTodaysEvents, insertEvent, deleteEvent } from "../clients/gcal-api.js";
import { getOpenTasks } from "../clients/notion.js";
import { sendMessage } from "../clients/telegram.js";
import { formatTaskList, fmtDue } from "./task-formatter.js";
import { getCalendarSync, setCalendarSync, deleteCalendarSync, getAllCalendarSync } from "../storage/d1.js";

export async function syncCalendar(env: Env): Promise<void> {
  const tasks = await getOpenTasks(env);
  const pendingIds = new Set(tasks.map((t) => t.pageId));
  const store = await getAllCalendarSync(env);

  const today = new Date().toISOString().slice(0, 10);

  // Remove events for completed/deleted tasks
  for (const [pageId, { eventId }] of store) {
    if (pendingIds.has(pageId)) continue;
    try {
      await deleteEvent(env, eventId);
    } catch {
      // ignore deletion errors (event may already be gone)
    }
    await deleteCalendarSync(env, pageId);
  }

  // Sync pending tasks
  for (const task of tasks) {
    if (!task.due) continue;
    const dueDate = task.due.slice(0, 10);
    const isOverdue = dueDate < today;
    const targetDate = isOverdue ? today : dueDate;

    const record = store.get(task.pageId);
    if (record?.calendarDate === targetDate) continue;

    if (record?.eventId) {
      try {
        await deleteEvent(env, record.eventId);
      } catch {
        // ignore
      }
    }

    const eventDue = isOverdue ? targetDate : task.due;
    const eventId = await insertEvent(env, task.title, eventDue);
    if (eventId) {
      await setCalendarSync(env, task.pageId, eventId, targetDate);
    }
  }
}

export async function deleteCalendarEventForTask(env: Env, pageId: string): Promise<void> {
  const record = await getCalendarSync(env, pageId);
  if (!record) return;
  try {
    await deleteEvent(env, record.eventId);
  } catch {
    // ignore
  }
  await deleteCalendarSync(env, pageId);
}

export async function sendDueSoonNotice(env: Env): Promise<void> {
  const tasks = await getOpenTasks(env);
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  const dueToday = tasks.filter((t) => t.due && t.due.slice(0, 10) === today);
  const dueTomorrow = tasks.filter((t) => t.due && t.due.slice(0, 10) === tomorrowStr);

  if (!dueToday.length && !dueTomorrow.length) return;

  const sections: string[] = [];
  if (dueToday.length) {
    sections.push(`*📅 今日期限 (${dueToday.length}件)*\n` + dueToday.map((t) => `• ${t.title}`).join("\n"));
  }
  if (dueTomorrow.length) {
    sections.push(`*📅 明日期限 (${dueTomorrow.length}件)*\n` + dueTomorrow.map((t) => `• ${t.title}`).join("\n"));
  }
  await sendMessage(env, "*⏰ 期限間近タスク*\n\n" + sections.join("\n\n"));
}

export async function sendTaskReminder(env: Env): Promise<void> {
  const tasks = await getOpenTasks(env);
  if (!tasks.length) return;
  const body = formatTaskList(tasks);
  await sendMessage(env, `*📋 未完了タスク (${tasks.length}件)*${body}`);
}

export { getTodaysEvents };
