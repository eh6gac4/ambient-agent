import type { Env } from "../types.js";
import { selectOfficeLeaveNotifications, type HomeArrivalNotification } from "../clients/gemini.js";
import { runNotificationTrigger } from "./notification-trigger.js";

export async function handleOfficeLeave(env: Env): Promise<HomeArrivalNotification[]> {
  return runNotificationTrigger(
    env,
    async (env, tasks, currentJstDatetime) => {
      // 1. AIによるピックアップ
      const aiPicked = await selectOfficeLeaveNotifications(env, tasks, currentJstDatetime);

      // 2. Locationプロパティが「オフィス」関連のもの（"office", "オフィス", "会社", "職場"）を強制抽出
      const officeLocations = ["office", "オフィス", "会社", "職場"];
      const locationMatched = tasks
        .filter((t) => t.location && officeLocations.includes(t.location.toLowerCase()))
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
    "🏢 *退社通知*"
  );
}
