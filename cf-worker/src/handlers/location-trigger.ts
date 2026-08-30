import type { Env, GeofenceContext, HomeArrivalNotification } from "../types.js";
import { runNotificationTrigger } from "./notification-trigger.js";

/**
 * ジオフェンスに突入 (enter) した際に、タスクの Location が
 * 突入したエリア (regionId あるいは params.location) と一致するタスクがあれば通知する。
 */
export async function handleLocationTrigger(
  env: Env,
  ctx: GeofenceContext
): Promise<HomeArrivalNotification[]> {
  // onLeave では通知しない
  if (ctx.transition !== "enter") {
    return [];
  }

  // params.locationName が指定されていればそれを使用し、なければ regionId を使う
  const targetLocation = String(ctx.params.locationName ?? ctx.regionId);
  const header = `📍 *${targetLocation} 到着通知*`;

  return runNotificationTrigger(
    env,
    async (_env, tasks, _currentJstDatetime) => {
      const matched = tasks.filter((t) => t.location === targetLocation);
      return matched.map((t) => ({
        title: t.title,
        priority: t.priority as "high" | "medium" | "low",
        reason: `Location matched: ${targetLocation}`,
      }));
    },
    header
  );
}
