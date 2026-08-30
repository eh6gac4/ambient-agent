import type { Env } from "../types.js";
import { listAllMessages, getMessage, parseMessage, isCalendarInvite, archiveMessage, addLabel, getOrCreateLabel } from "../clients/gmail-api.js";
import { analyzeEmail, pickTaskTitle } from "../clients/gemini.js";
import { addTask, updateTaskFromReply, getTaskStatus, getTaskTitleAndDue } from "../clients/tasks.js";
import { sendMessage, escapeMd } from "../clients/telegram.js";
import { taskLink } from "./telegram.js";
import { syncTaskCalendarEventSafe } from "./calendar.js";
import { bestPriorityTask } from "../utils/task.js";
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
import { getNoTaskSenders, addNoTaskSender, appendEmailDigest } from "../storage/kv.js";

function isSubrequestLimitError(err: unknown): boolean {
  return String(err).includes("Too many subrequests");
}

export interface CheckGmailOptions {
  /** When true, accumulate results to KV instead of sending Telegram immediately. */
  silent?: boolean;
}

export async function checkGmail(env: Env, options: CheckGmailOptions = {}): Promise<void> {
  await cleanOldProcessed(env);

  const messages = await listAllMessages(env);
  if (!messages.length) return;

  const noTaskSenders = await getNoTaskSenders(env);
  const taskLabelName = env.GMAIL_TASK_LABEL ?? "タスク登録済み";
  const taskLabelId = await getOrCreateLabel(env, taskLabelName);

  const taskLines: string[] = [];
  const archivedLines: string[] = [];

  for (const meta of messages) {
    try {
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
      const taskTitle = pickTaskTitle(analysis, subject);

      if (tasks.length) {
        const best = bestPriorityTask(tasks);
        const dues = tasks.map((t) => t.due).filter((d): d is string => Boolean(d)).sort();

        const existingPageId = await getThreadMapEntry(env, threadId);

        if (existingPageId) {
          await updateTaskFromReply(env, existingPageId, best.priority, dues[0] ?? null, body);
          if (taskLabelId) await addLabel(env, meta.id, taskLabelId);
          // updateTaskFromReply で Due が前倒しされた場合に備えてタスクストアの最新値で同期
          const latest = await getTaskTitleAndDue(env, existingPageId);
          if (latest) {
            await syncTaskCalendarEventSafe(env, { pageId: existingPageId, title: latest.title, due: latest.due });
          }
          taskLines.push(
            `• *${escapeMd(taskTitle)}*（更新）\n  ${escapeMd(summary)}\n  ${taskLink(existingPageId)}`,
          );
        } else {
          const pageId = await addTask(
            env,
            { title: taskTitle, due: dues[0] ?? null, priority: best.priority, icon: best.icon, source: "Gmail", sourceUrl: gmailUrl },
            undefined,
            body,
          );
          if (pageId) {
            if (threadId) await setThreadMapEntry(env, threadId, pageId);
            await setSenderForTask(env, pageId, senderEmail);
            if (taskLabelId) await addLabel(env, meta.id, taskLabelId);
            await syncTaskCalendarEventSafe(env, { pageId, title: taskTitle, due: dues[0] ?? null });
          }
          const link = pageId ? taskLink(pageId) : `[📧 Gmail で開く](${gmailUrl})`;
          taskLines.push(
            `• *${escapeMd(taskTitle)}*\n  ${escapeMd(summary)}\n  ${link}`,
          );
        }
      } else {
        archivedLines.push(`• *${escapeMd(taskTitle)}*\n  ${escapeMd(summary)}`);
      }

      await archiveMessage(env, meta.id);
      await markProcessed(env, meta.id);
    } catch (err) {
      if (isSubrequestLimitError(err)) {
        console.warn("checkGmail: subrequest limit hit, deferring remaining messages");
        break;
      }
      console.error(`checkGmail: failed to process message ${meta.id}:`, err);
    }
  }

  if (!taskLines.length && !archivedLines.length) return;

  if (options.silent) {
    await appendEmailDigest(env, { taskLines, archivedLines });
    return;
  }

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
