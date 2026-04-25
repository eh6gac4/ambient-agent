import type { Env } from "../types.js";
import { getOpenTasks, escalatePriorityTasks } from "../clients/notion.js";
import { sendMessage } from "../clients/telegram.js";
import { fmtDue } from "./task-formatter.js";

const STALE_DAYS = 14;

export async function sendEscalationNotice(env: Env): Promise<void> {
  const escalated = await escalatePriorityTasks(env);
  if (!escalated.length) return;

  const lines = escalated.map((t) => `• ${t.title}（期限: ${fmtDue(t.due)}）`);
  await sendMessage(
    env,
    `*⬆️ 優先度を high に昇格しました (${escalated.length}件)*\n\n` + lines.join("\n"),
  );
}

export async function sendStaleTasksNotice(env: Env): Promise<void> {
  const tasks = await getOpenTasks(env);
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - STALE_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const stale = tasks.filter((t) => t.lastEdited && t.lastEdited <= cutoffStr);
  if (!stale.length) return;

  const lines = stale.map((t) => `• ${t.title}（最終更新: ${t.lastEdited}）`);
  await sendMessage(
    env,
    `*🕰 長期未更新タスク (${stale.length}件)*\n\n` +
      lines.join("\n") +
      "\n\n対応不要なら `/skip` で中止にしてください",
  );
}
