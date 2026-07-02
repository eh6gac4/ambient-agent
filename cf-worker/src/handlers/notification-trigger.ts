import type { Env } from "../types.js";
import { getOpenTasks } from "../clients/notion.js";
import type { HomeArrivalNotification } from "../clients/gemini.js";
import { sendMessage } from "../clients/telegram.js";
import { isHoliday } from "../utils/holiday.js";
import { jstDateTimeStr } from "../utils/jst.js";
import { PRIORITY_ICON } from "../utils/task.js";

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
    console.log(JSON.stringify({ event: "notification_trigger", header, result: "skipped_holiday" }));
    return [];
  }

  const tasks = await getOpenTasks(env);
  if (tasks.length === 0) {
    console.log(JSON.stringify({ event: "notification_trigger", header, result: "skipped_no_tasks" }));
    return [];
  }

  const notifications = await select(env, tasks, jstDateTimeStr());
  if (notifications.length > 0) {
    console.log(JSON.stringify({ event: "notification_trigger", header, result: "sent", count: notifications.length }));
    await sendMessage(env, buildTelegramMessage(header, notifications));
  } else {
    console.log(JSON.stringify({ event: "notification_trigger", header, result: "skipped_no_selection" }));
  }

  return notifications;
}
