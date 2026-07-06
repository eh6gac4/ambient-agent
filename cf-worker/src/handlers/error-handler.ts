import type { Env } from "../types.js";
import { sendMessage } from "../clients/telegram.js";
import { analyzeError } from "../clients/gemini.js";
import { createIssue } from "../clients/github.js";

export async function reportError(env: Env, context: string, err: unknown): Promise<void> {
  const errorMessage = err instanceof Error ? err.stack || err.message : String(err);
  console.error(`[${context}] Error:`, err);

  let analysis = "（AI分析に失敗しました）";
  try {
    analysis = await analyzeError(env, context, errorMessage);
  } catch (geminiErr) {
    console.error("reportError: Gemini analysis failed", geminiErr);
  }

  const issueTitle = `[Error] ${context}`;
  const issueBody = `## コンテキスト\n\`${context}\`\n\n## エラー内容\n\`\`\`\n${errorMessage}\n\`\`\`\n\n## AI 分析・提案\n${analysis}`;
  
  let issueUrlStr = "";
  if (env.GITHUB_PAT && env.GITHUB_REPO) {
    const issueUrl = await createIssue(env, issueTitle, issueBody);
    if (issueUrl) {
      issueUrlStr = `\n\n*Issue:* ${issueUrl}`;
    }
  }

  const msg = `⚠️ *Ambient Agent エラー*\nコンテキスト: \`${context}\`\n\n*エラー内容:*\n\`\`\`\n${errorMessage.slice(0, 1000)}\n\`\`\`\n\n*AI分析・提案:*\n${analysis}${issueUrlStr}`;
  
  try {
    await sendMessage(env, msg);
  } catch (telegramErr) {
    console.error("reportError: Telegram notification failed", telegramErr);
  }
}
