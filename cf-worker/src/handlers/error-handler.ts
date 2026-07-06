import type { Env } from "../types.js";
import { sendMessage } from "../clients/telegram.js";
import { analyzeError } from "../clients/gemini.js";

export async function reportError(env: Env, context: string, err: unknown): Promise<void> {
  const errorMessage = err instanceof Error ? err.stack || err.message : String(err);
  console.error(`[${context}] Error:`, err);

  let analysis = "（AI分析に失敗しました）";
  try {
    analysis = await analyzeError(env, context, errorMessage);
  } catch (geminiErr) {
    console.error("reportError: Gemini analysis failed", geminiErr);
  }

  const msg = `⚠️ *Ambient Agent エラー*\nコンテキスト: \`${context}\`\n\n*エラー内容:*\n\`\`\`\n${errorMessage.slice(0, 1000)}\n\`\`\`\n\n*AI分析・提案:*\n${analysis}`;
  
  try {
    await sendMessage(env, msg);
  } catch (telegramErr) {
    console.error("reportError: Telegram notification failed", telegramErr);
  }
}
