import type { Env } from "../types.js";
import { searchAiNews } from "../clients/gemini.js";
import { sendMessage } from "../clients/telegram.js";

export async function deliverMorningAiNews(env: Env): Promise<void> {
  try {
    const newsContent = await searchAiNews(env);
    await sendMessage(env, newsContent);
  } catch (err) {
    console.error("Failed to deliver morning AI news:", err);
    await sendMessage(env, "ごめんな、AIニュースの検索中にエラー起きたみたいや。後でもう一回試してな！");
  }
}
