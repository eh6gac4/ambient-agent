import type { Env } from "../types.js";
import { selectHomeArrivalNotifications, type HomeArrivalNotification } from "../clients/anthropic.js";
import { runNotificationTrigger } from "./notification-trigger.js";

export async function handleHomeArrival(env: Env): Promise<HomeArrivalNotification[]> {
  return runNotificationTrigger(env, selectHomeArrivalNotifications, "🏠 *帰宅通知*");
}
