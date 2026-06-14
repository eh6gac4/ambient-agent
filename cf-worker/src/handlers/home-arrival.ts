import type { Env } from "../types.js";
import { getOpenTasks } from "../clients/notion.js";
import { selectHomeArrivalNotifications, type HomeArrivalNotification } from "../clients/anthropic.js";
import { sendMessage } from "../clients/telegram.js";
import { isHoliday } from "../utils/holiday.js";

function buildTelegramMessage(notifications: HomeArrivalNotification[]): string {
  const priorityIcon: Record<string, string> = { high: "🔴", medium: "🟡", low: "🟢" };
  const lines = notifications.map((n) => `${priorityIcon[n.priority] ?? "•"} ${n.title}`);
  return `🏠 *帰宅通知*\n\n${lines.join("\n")}`;
}

export async function handleHomeArrival(env: Env): Promise<HomeArrivalNotification[]> {
  if (await isHoliday()) return [];

  const tasks = await getOpenTasks(env);
  if (tasks.length === 0) return [];

  const jstDatetime = new Date().toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const notifications = await selectHomeArrivalNotifications(env, tasks, jstDatetime);
  if (notifications.length > 0) {
    await sendMessage(env, buildTelegramMessage(notifications));
  }

  return notifications;
}
