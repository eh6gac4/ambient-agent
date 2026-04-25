import type { Env } from "../types.js";
import { listAllMessages, getMessage, parseMessage, isCalendarInvite, archiveMessage, addLabel, getOrCreateLabel } from "../clients/gmail-api.js";
import { analyzeEmail } from "../clients/anthropic.js";
import { addTask, updateTaskFromReply, getTaskStatus } from "../clients/notion.js";
import { sendMessage, escapeMd } from "../clients/telegram.js";
import {
  getThreadMapEntry,
  setThreadMapEntry,
  getSenderForTask,
  setSenderForTask,
  deleteSenderMapEntry,
  getAllSenderMap,
  isProcessed,
  markProcessed,
  cleanOldProcessed,
} from "../storage/d1.js";
import { getNoTaskSenders, addNoTaskSender } from "../storage/kv.js";

export async function checkGmail(env: Env): Promise<void> {
  await cleanOldProcessed(env);

  const messages = await listAllMessages(env);
  if (!messages.length) return;

  const noTaskSenders = await getNoTaskSenders(env);
  const taskLabelName = env.GMAIL_TASK_LABEL ?? "タスク登録済み";
  const taskLabelId = await getOrCreateLabel(env, taskLabelName);

  const taskLines: string[] = [];
  const archivedLines: string[] = [];

  for (const meta of messages) {
    if (await isProcessed(env, meta.id)) continue;

    const msg = await getMessage(env, meta.id);

    if (isCalendarInvite(msg.payload)) {
      await archiveMessage(env, meta.id);
      await markProcessed(env, meta.id);
      continue;
    }

    const { subject, body, senderEmail, threadId, gmailUrl } = parseMessage(msg, env);

    if (noTaskSenders.has(senderEmail)) {
      await archiveMessage(env, meta.id);
      await markProcessed(env, meta.id);
      continue;
    }

    const analysis = await analyzeEmail(env, subject, body);
    const { summary, tasks } = analysis;

    if (tasks.length) {
      const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
      const best = tasks.reduce((a, b) =>
        (priorityOrder[a.priority] ?? 1) <= (priorityOrder[b.priority] ?? 1) ? a : b,
      );
      const dues = tasks.map((t) => t.due).filter((d): d is string => Boolean(d)).sort();
      const checklist = tasks.map((t) => t.title);

      const existingPageId = await getThreadMapEntry(env, threadId);

      if (existingPageId) {
        await updateTaskFromReply(env, existingPageId, checklist, best.priority, dues[0] ?? null);
        if (taskLabelId) await addLabel(env, meta.id, taskLabelId);
        taskLines.push(
          `• *${escapeMd(subject)}*（更新）\n  ${escapeMd(summary)}\n  → ${checklist.map(escapeMd).join("、")}\n  [📧 Gmail で開く](${gmailUrl})`,
        );
      } else {
        const pageId = await addTask(
          env,
          { title: subject, due: dues[0] ?? null, priority: best.priority, source: "Gmail", sourceUrl: gmailUrl },
          checklist,
        );
        if (pageId) {
          if (threadId) await setThreadMapEntry(env, threadId, pageId);
          await setSenderForTask(env, pageId, senderEmail);
          if (taskLabelId) await addLabel(env, meta.id, taskLabelId);
        }
        taskLines.push(
          `• *${escapeMd(subject)}*\n  ${escapeMd(summary)}\n  → ${checklist.map(escapeMd).join("、")}\n  [📧 Gmail で開く](${gmailUrl})`,
        );
      }
    } else {
      archivedLines.push(`• *${escapeMd(subject)}*\n  ${escapeMd(summary)}`);
    }

    await archiveMessage(env, meta.id);
    await markProcessed(env, meta.id);
  }

  if (!taskLines.length && !archivedLines.length) return;

  const sections: string[] = [];
  if (taskLines.length) sections.push("✅ *タスク登録*\n" + taskLines.join("\n"));
  if (archivedLines.length) sections.push("📦 *アーカイブ済み*\n" + archivedLines.join("\n"));
  await sendMessage(env, "*📧 メール処理完了*\n\n" + sections.join("\n\n"));
}

export async function learnFromCancelled(env: Env): Promise<void> {
  const senderMap = await getAllSenderMap(env);
  if (!senderMap.size) return;

  const noTaskSenders = await getNoTaskSenders(env);
  const learned: string[] = [];

  for (const [pageId, senderEmail] of senderMap) {
    const status = await getTaskStatus(env, pageId);
    if (status === "中止") {
      if (!noTaskSenders.has(senderEmail)) {
        await addNoTaskSender(env, senderEmail);
        noTaskSenders.add(senderEmail);
        learned.push(senderEmail);
      }
      await deleteSenderMapEntry(env, pageId);
    } else if (status === null || status === "完了") {
      await deleteSenderMapEntry(env, pageId);
    }
  }

  if (learned.length) {
    await sendMessage(env, "📚 *送信者ブロックを学習しました*\n\n" + learned.map((s) => `• \`${s}\``).join("\n"));
  }
}
