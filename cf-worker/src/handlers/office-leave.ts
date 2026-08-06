import type { Env } from "../types.js";
import type { HomeArrivalNotification } from "../clients/gemini.js";
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
    async (_env, tasks) => {
      // Locationプロパティが「オフィス」関連のものを強制抽出
      // (Gemini によるAIピックアップは API コスト削減のため停止済み)
      return filterTasksForLocation(tasks, "office").map((t) => ({
        title: t.title,
        priority: (t.priority === "high" || t.priority === "medium" || t.priority === "low" ? t.priority : "medium") as "high" | "medium" | "low",
      }));
    },
    "🏢 *退社通知*"
  );
}
