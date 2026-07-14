import type { Env } from "../types.js";
import { getOpenTasks } from "../clients/notion.js";
import type { HomeArrivalNotification } from "../clients/gemini.js";
import { sendMessage } from "../clients/telegram.js";
import { isHoliday } from "../utils/holiday.js";
import { jstDateTimeStr } from "../utils/jst.js";
import { PRIORITY_ICON } from "../utils/task.js";
import { insertAppLog } from "../storage/d1.js";

type SelectFn = (
  env: Env,
  tasks: Array<{ title: string; priority: string; due: string | null; status: string; location: string | null }>,
  currentJstDatetime: string,
) => Promise<HomeArrivalNotification[]>;

function buildTelegramMessage(header: string, notifications: HomeArrivalNotification[]): string {
  const lines = notifications.map((n) => `${PRIORITY_ICON[n.priority] ?? "•"} ${n.title}`);
  return `${header}\n\n${lines.join("\n")}`;
}

/**
 * 帰宅・退社など「ある場所を離れた」タイミング共通の通知フロー。
 * 祝日はスキップ、未完了タスクが無ければ何もしない。LLM が通知を選んだら
 * Telegram に送信する。header は通知の見出し（例: "🏠 *帰宅通知*"）。
 */
export async function runNotificationTrigger(
  env: Env,
  select: SelectFn,
  header: string,
): Promise<HomeArrivalNotification[]> {
  if (await isHoliday()) {
    const msg = { event: "notification_trigger", header, result: "skipped_holiday" };
    await insertAppLog(env, "info", "Notification skipped due to holiday", msg);
    return [];
  }

  const tasks = await getOpenTasks(env);
  if (tasks.length === 0) {
    const msg = { event: "notification_trigger", header, result: "sent_empty_no_tasks" };
    await insertAppLog(env, "info", "Notification sent empty (no tasks)", msg);
    await sendMessage(env, `${header}\n\n該当するタスクはありません。お疲れ様でした！`);
    return [];
  }

  const notifications = await select(env, tasks, jstDateTimeStr());
  if (notifications.length > 0) {
    const msg = { event: "notification_trigger", header, result: "sent", count: notifications.length };
    await insertAppLog(env, "info", "Notification sent successfully", msg);
    await sendMessage(env, buildTelegramMessage(header, notifications));
  } else {
    const msg = { event: "notification_trigger", header, result: "sent_empty_no_selection" };
    await insertAppLog(env, "info", "Notification sent empty (no selection)", msg);
    await sendMessage(env, `${header}\n\n該当するタスクはありません。お疲れ様でした！`);
  }

  return notifications;
}
