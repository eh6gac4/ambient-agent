import type { Env } from "../types.js";
import { searchAiNews } from "../clients/gemini.js";
import { sendMessage } from "../clients/telegram.js";

export async function deliverMorningAiNews(env: Env): Promise<void> {
  const newsContent = await searchAiNews(env);
  await sendMessage(env, newsContent);
}
