import type { Env } from "../types.js";
import { selectOfficeLeaveNotifications, type HomeArrivalNotification } from "../clients/gemini.js";
import { runNotificationTrigger } from "./notification-trigger.js";

export async function handleOfficeLeave(env: Env): Promise<HomeArrivalNotification[]> {
  return runNotificationTrigger(env, selectOfficeLeaveNotifications, "🏢 *退社通知*");
}
