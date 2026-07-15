import type { Env } from "../types.js";
import { getOpenTasks, escalatePriorityTasks, promoteBacklogTasks } from "../clients/notion.js";
import { sendMessage } from "../clients/telegram.js";
import { fmtDue, getTaskLink } from "./task-formatter.js";
import { jstNow } from "../utils/jst.js";

const STALE_DAYS = 14;

export async function getEscalationNoticeText(env: Env): Promise<string | null> {
  const escalated = await escalatePriorityTasks(env);
  if (!escalated.length) return null;

  const lines = escalated.map((t) => `• ${getTaskLink(t.title, t.pageId)}（期限: ${fmtDue(t.due)}）`);
  return `*⬆️ 優先度を high に昇格しました (${escalated.length}件)*\n\n` + lines.join("\n");
}

export async function getBacklogPromotionNoticeText(env: Env): Promise<string | null> {
  const promoted = await promoteBacklogTasks(env);
  if (!promoted.length) return null;

  const lines = promoted.map((t) => `• ${getTaskLink(t.title, t.pageId)}（期限: ${fmtDue(t.due)}）`);
  return `*📥 バックログから未着手に昇格しました (${promoted.length}件)*\n\n` + lines.join("\n");
}

export async function sendStaleTasksNotice(env: Env): Promise<void> {
  const tasks = await getOpenTasks(env);
  const now = jstNow();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - STALE_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const stale = tasks.filter((t) => t.lastEdited && t.lastEdited <= cutoffStr);
  if (!stale.length) return;

  const lines = stale.map((t) => `• ${getTaskLink(t.title, t.pageId)}（最終更新: ${t.lastEdited}）`);
  await sendMessage(
    env,
    `*🕰 長期未更新タスク (${stale.length}件)*\n\n` +
      lines.join("\n") +
      "\n\n対応不要なら `/skip` で中止にしてください",
  );
}
