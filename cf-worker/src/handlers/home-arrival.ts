import type { Env } from "../types.js";
import { selectHomeArrivalNotifications, type HomeArrivalNotification } from "../clients/gemini.js";
import { runNotificationTrigger } from "./notification-trigger.js";

export async function handleHomeArrival(env: Env): Promise<HomeArrivalNotification[]> {
  return runNotificationTrigger(
    env,
    async (env, tasks, currentJstDatetime) => {
      // 1. AIによるピックアップ
      const aiPicked = await selectHomeArrivalNotifications(env, tasks, currentJstDatetime);

      // 2. Locationプロパティが「家」関連のもの（"home", "家", "自宅"）を強制抽出
      const homeLocations = ["home", "家", "自宅"];
      const locationMatched = tasks
        .filter((t) => t.location && homeLocations.includes(t.location.toLowerCase()))
        .map((t) => ({
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
    "🏠 *帰宅通知*"
  );
}
