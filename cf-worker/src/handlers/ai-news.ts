import type { Env } from "../types.js";
import { sendMessage } from "../clients/telegram.js";

const MORNING_NEWS_URL = "https://asa-mobile.toshiki-cho-dev.workers.dev/";

export async function deliverMorningAiNews(env: Env): Promise<void> {
  await sendMessage(env, MORNING_NEWS_URL);
}
