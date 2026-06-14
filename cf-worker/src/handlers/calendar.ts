import type { Env, Task } from "../types.js";
import { getTodaysEvents, insertEvent, deleteEvent, updateEventDateTime } from "../clients/gcal-api.js";
import { getOpenTasks } from "../clients/notion.js";
import { sendMessage, escapeMd } from "../clients/telegram.js";
import { formatTaskList, fmtDue } from "./task-formatter.js";
import { getCalendarSync, setCalendarSync, deleteCalendarSync, getAllCalendarSync } from "../storage/d1.js";
import { jstNow } from "../utils/jst.js";

export async function syncCalendar(env: Env): Promise<void> {
  const tasks = await getOpenTasks(env);
  const pendingIds = new Set(tasks.map((t) => t.pageId));
  const store = await getAllCalendarSync(env);

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

  // Sync pending tasks (same code path as the immediate-creation flow)
  for (const task of tasks) {
    await syncTaskCalendarEvent(env, task);
  }
}

/**
 * 1 タスク分のカレンダーイベントを作成/更新する。
 * 翌朝の syncCalendar cron とタスク作成時の即時同期で共通利用する。
 * dedup キーは「カレンダー上の実日時 (eventDue)」単位。日付のみだと
 * 同一日付で時刻だけ変わった際に古い時刻のまま取り残される不具合を防ぐ。
 */
export async function syncTaskCalendarEvent(
  env: Env,
  task: Pick<Task, "pageId" | "title" | "due">,
): Promise<void> {
  if (!task.due) return;

  const today = new Date().toISOString().slice(0, 10);
  const dueDate = task.due.slice(0, 10);
  const isOverdue = dueDate < today;
  const targetDate = isOverdue ? today : dueDate;
  const eventDue = isOverdue ? targetDate : task.due;

  const record = await getCalendarSync(env, task.pageId);
  if (record && record.calendarDate === eventDue) return;

  // 既存イベントがあれば PATCH で日時だけ差し替え（イベント ID と Calendar 側のメモを保持）
  if (record?.eventId) {
    try {
      const ok = await updateEventDateTime(env, record.eventId, eventDue);
      if (ok) {
        await setCalendarSync(env, task.pageId, record.eventId, eventDue);
        return;
      }
    } catch (err) {
      console.warn("updateEventDateTime failed, falling back to recreate:", err);
    }
    // PATCH が 404/410 や失敗のときは作り直しにフォールバック
    try {
      await deleteEvent(env, record.eventId);
    } catch {
      // ignore
    }
  }

  const eventId = await insertEvent(env, task.title, eventDue);
  if (eventId) {
    await setCalendarSync(env, task.pageId, eventId, eventDue);
  }
}

/**
 * タスク作成直後にハンドラから呼ぶ即時同期。
 * カレンダー/D1 の失敗がタスク作成・ユーザー応答を壊さないよう throw しない。
 */
export async function syncTaskCalendarEventSafe(
  env: Env,
  task: { pageId: string; title: string; due: string | null },
): Promise<void> {
  if (!task.due) return;
  try {
    await syncTaskCalendarEvent(env, task);
  } catch (err) {
    console.error("immediate calendar sync failed:", err);
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
  const now = jstNow();
  const today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  const dueToday = tasks.filter((t) => t.due && t.due.slice(0, 10) === today);
  const dueTomorrow = tasks.filter((t) => t.due && t.due.slice(0, 10) === tomorrowStr);

  if (!dueToday.length && !dueTomorrow.length) return;

  const sections: string[] = [];
  if (dueToday.length) {
    sections.push(
      `*📅 今日期限 (${dueToday.length}件)*\n` + dueToday.map((t) => `• ${escapeMd(t.title)}`).join("\n"),
    );
  }
  if (dueTomorrow.length) {
    sections.push(
      `*📅 明日期限 (${dueTomorrow.length}件)*\n` + dueTomorrow.map((t) => `• ${escapeMd(t.title)}`).join("\n"),
    );
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
