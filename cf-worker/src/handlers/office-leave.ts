import type { Env } from "../types.js";
import { selectOfficeLeaveNotifications, type HomeArrivalNotification } from "../clients/gemini.js";
import { runNotificationTrigger } from "./notification-trigger.js";
import { filterTasksForLocation } from "../utils/notification-policy.js";
import { jstNow } from "../utils/jst.js";
import { insertAppLog } from "../storage/d1.js";

export async function handleOfficeLeave(env: Env): Promise<HomeArrivalNotification[]> {
  const now = jstNow();
  const hour = now.getHours();

  // 16時より前の場合は、ランチや中抜けなどの一時的な外出とみなして退社通知をスキップ
  if (hour < 16) {
    await insertAppLog(env, "info", "Office leave skipped due to early hour (lunch/break)", { hour });
    return [];
  }

  return runNotificationTrigger(
    env,
    async (env, tasks, currentJstDatetime) => {
      // 1. AIによるピックアップ
      const aiPicked = await selectOfficeLeaveNotifications(env, tasks, currentJstDatetime);

      // 2. Locationプロパティが「オフィス」関連のものを強制抽出
      const locationMatched = filterTasksForLocation(tasks, "office").map((t) => ({
        title: t.title,
        priority: (t.priority === "high" || t.priority === "medium" || t.priority === "low" ? t.priority : "medium") as "high" | "medium" | "low",
      }));

      // 重複排除（タイトルの一致で判定）
      const merged = [...locationMatched];
      for (const t of aiPicked) {
        if (!merged.some((m) => m.title === t.title)) {
          merged.push(t);
        }
      }
      return merged;
    },
    "🏢 *退社通知*"
  );
}
