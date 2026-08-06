import type { Env } from "../types.js";
import type { HomeArrivalNotification } from "../clients/gemini.js";
import { runNotificationTrigger } from "./notification-trigger.js";
import { filterTasksForLocation } from "../utils/notification-policy.js";

export async function handleHomeArrival(env: Env): Promise<HomeArrivalNotification[]> {
  return runNotificationTrigger(
    env,
    async (_env, tasks) => {
      // Locationプロパティが「家」関連のものを強制抽出
      // (Gemini によるAIピックアップは API コスト削減のため停止済み)
      return filterTasksForLocation(tasks, "home").map((t) => ({
        title: t.title,
        priority: (t.priority === "high" || t.priority === "medium" || t.priority === "low" ? t.priority : "medium") as "high" | "medium" | "low",
      }));
    },
    "🏠 *帰宅通知*"
  );
}
