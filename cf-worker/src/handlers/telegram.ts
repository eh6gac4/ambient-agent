import type { Env } from "../types.js";
import { sendMessage, getFileUrl } from "../clients/telegram.js";
import { addTask, getOpenTasks, completeTask, cancelTask, updateTaskDue } from "../clients/notion.js";
import { extractTasksFromText, extractTasksFromUrlContent, extractTasksFromImage } from "../clients/anthropic.js";
import { getSenderForTask } from "../storage/d1.js";
import { getTaskCache, setTaskCache, getNoTaskSenders, addNoTaskSender, removeNoTaskSender } from "../storage/kv.js";
import { deleteCalendarEventForTask } from "./calendar.js";
import { formatTaskList, sortTasks } from "./task-formatter.js";
import { sendDailyBriefing } from "./briefing.js";

const URL_PATTERN = /https?:\/\/\S+/;
const OPERATING_START_HOUR = 8;
const OPERATING_END_HOUR = 21;

function getJstHour(): number {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" })).getHours();
}

function extractTextFromHtml(html: string): string {
  return html
    .replace(/<(script|style|nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, "\n")
    .trim();
}

async function handleCommand(env: Env, text: string): Promise<void> {
  const [rawCommand, ...rest] = text.trim().split(/\s+/);
  const command = rawCommand.toLowerCase();
  const arg = rest.join(" ").trim();

  switch (command) {
    case "/tasks": {
      const tasks = await getOpenTasks(env);
      if (!tasks.length) {
        await sendMessage(env, "✅ 未着手のタスクはありません");
        return;
      }
      const sorted = sortTasks(tasks);
      await setTaskCache(env, sorted);
      const body = formatTaskList(tasks, true);
      await sendMessage(env, `*📋 タスク一覧 (${sorted.length}件)*${body}\n\n\`/done <番号>\` で完了にできます`);
      return;
    }

    case "/done": {
      if (!/^\d+$/.test(arg)) {
        await sendMessage(env, "使い方: `/done 2`（番号は `/tasks` で確認）");
        return;
      }
      const index = parseInt(arg, 10) - 1;
      const tasks = await getTaskCache(env);
      if (!tasks.length) {
        await sendMessage(env, "先に `/tasks` でタスク一覧を取得してください");
        return;
      }
      if (index < 0 || index >= tasks.length) {
        await sendMessage(env, `番号が範囲外です（1〜${tasks.length}）`);
        return;
      }
      const task = tasks[index];
      await completeTask(env, task.pageId);
      await deleteCalendarEventForTask(env, task.pageId);
      await sendMessage(env, `✅ 完了にしました\n\n*${task.title}*`);
      return;
    }

    case "/add": {
      if (!arg) {
        await sendMessage(env, "使い方: `/add 〇〇を確認する`");
        return;
      }
      await addTask(env, { title: arg, source: "Telegram", priority: "medium" });
      await sendMessage(env, `✅ タスクを追加しました\n\n*${arg}*`);
      return;
    }

    case "/skip": {
      if (!/^\d+$/.test(arg)) {
        await sendMessage(env, "使い方: `/skip 2`（番号は `/tasks` で確認）");
        return;
      }
      const index = parseInt(arg, 10) - 1;
      const tasks = await getTaskCache(env);
      if (!tasks.length) {
        await sendMessage(env, "先に `/tasks` でタスク一覧を取得してください");
        return;
      }
      if (index < 0 || index >= tasks.length) {
        await sendMessage(env, `番号が範囲外です（1〜${tasks.length}）`);
        return;
      }
      const task = tasks[index];
      await cancelTask(env, task.pageId);
      await deleteCalendarEventForTask(env, task.pageId);
      const sender = await getSenderForTask(env, task.pageId);
      if (sender) {
        await addNoTaskSender(env, sender);
        await sendMessage(
          env,
          `🚫 タスクを中止にしました\n\n*${task.title}*\n\n\`${sender}\` からのメールは今後タスク登録しません`,
        );
      } else {
        await sendMessage(env, `🚫 タスクを中止にしました\n\n*${task.title}*`);
      }
      return;
    }

    case "/due": {
      const parts = arg.split(/\s+/, 2);
      if (parts.length !== 2 || !/^\d+$/.test(parts[0])) {
        await sendMessage(env, "使い方: `/due 2 2026-03-25`（番号は `/tasks` で確認）");
        return;
      }
      const index = parseInt(parts[0], 10) - 1;
      const dueStr = parts[1];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueStr) || isNaN(Date.parse(dueStr))) {
        await sendMessage(env, "日付は `YYYY-MM-DD` 形式で指定してください");
        return;
      }
      const tasks = await getTaskCache(env);
      if (!tasks.length) {
        await sendMessage(env, "先に `/tasks` でタスク一覧を取得してください");
        return;
      }
      if (index < 0 || index >= tasks.length) {
        await sendMessage(env, `番号が範囲外です（1〜${tasks.length}）`);
        return;
      }
      const task = tasks[index];
      await updateTaskDue(env, task.pageId, dueStr);
      await sendMessage(env, `📅 期限を更新しました\n\n*${task.title}*\n→ ${dueStr}`);
      return;
    }

    case "/briefing": {
      await sendMessage(env, "⏳ ブリーフィングを生成中...");
      await sendDailyBriefing(env);
      return;
    }

    case "/blocklist": {
      const senders = await getNoTaskSenders(env);
      if (!senders.size) {
        await sendMessage(env, "ブロック中の送信者はいません");
      } else {
        const lines = [...senders].sort().map((s) => `• \`${s}\``).join("\n");
        await sendMessage(
          env,
          `*🚫 ブロック中の送信者 (${senders.size}件)*\n\n${lines}\n\n解除: \`/unblock メールアドレス\``,
        );
      }
      return;
    }

    case "/unblock": {
      if (!arg) {
        await sendMessage(env, "使い方: `/unblock email@example.com`");
        return;
      }
      if (await removeNoTaskSender(env, arg)) {
        await sendMessage(env, `✅ \`${arg}\` のブロックを解除しました`);
      } else {
        await sendMessage(env, `\`${arg}\` はブロックリストにありません\n\n\`/blocklist\` で確認できます`);
      }
      return;
    }

    case "/help": {
      await sendMessage(
        env,
        "*使えるコマンド*\n\n" +
          "`/tasks` — タスク一覧\n" +
          "`/done <番号>` — タスクを完了にする\n" +
          "`/skip <番号>` — タスクを中止にし、送信者をブロック\n" +
          "`/blocklist` — ブロック中の送信者一覧\n" +
          "`/unblock <メール>` — 送信者のブロックを解除\n" +
          "`/add <タスク名>` — タスクを追加\n" +
          "`/due <番号> <日付>` — 期限を変更（例: `/due 3 2026-03-25`）\n" +
          "`/briefing` — 今すぐブリーフィングを実行\n\n" +
          "URL・テキスト・転送メッセージ・画像を送るとタスクを自動抽出します",
      );
      return;
    }

    default:
      await sendMessage(
        env,
        "使えるコマンド:\n`/tasks` — タスク一覧\n`/done <番号>` — 完了にする\n`/add <タスク名>` — タスクを追加\n`/due <番号> <日付>` — 期限を変更\n`/briefing` — 今すぐブリーフィング",
      );
  }
}

async function handlePhoto(env: Env, message: Record<string, unknown>): Promise<void> {
  const photos = message.photo as Array<{ file_id: string; file_size: number }>;
  const largest = photos.reduce((a, b) => (a.file_size > b.file_size ? a : b));

  const fileUrl = await getFileUrl(env, largest.file_id);
  const imgResp = await fetch(fileUrl);
  if (!imgResp.ok) {
    await sendMessage(env, `⚠️ 画像の取得に失敗しました`);
    return;
  }

  const ext = fileUrl.split(".").pop()?.toLowerCase() ?? "jpg";
  const mediaType = ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" } as Record<string, string>)[ext] ?? "image/jpeg";

  await sendMessage(env, "⏳ 画像からタスクを抽出中...");
  const tasks = await extractTasksFromImage(env, await imgResp.arrayBuffer(), mediaType);
  if (tasks.length) {
    for (const task of tasks) {
      await addTask(env, { ...task, source: "Telegram" });
    }
    await sendMessage(env, "✅ タスクを登録しました\n\n" + tasks.map((t) => `• ${t.title}`).join("\n"));
  } else {
    await sendMessage(env, "ℹ️ タスクは見つかりませんでした");
  }
}

async function handleUrl(env: Env, url: string): Promise<void> {
  let content = "";
  let pageTitle = url;
  try {
    const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (resp.ok) {
      const html = await resp.text();
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      pageTitle = titleMatch ? titleMatch[1].trim() : url;
      content = extractTextFromHtml(html);
    }
  } catch {
    // proceed with empty content
  }

  const tasks = await extractTasksFromUrlContent(env, url, content);
  const finalTasks = tasks.length ? tasks : [{ title: `${pageTitle}を確認する`, due: null, priority: "medium" as const }];

  for (const task of finalTasks) {
    await addTask(env, { ...task, source: "URL", sourceUrl: url });
  }
  await sendMessage(env, "✅ タスクを登録しました\n\n" + finalTasks.map((t) => `• ${t.title}`).join("\n"));
}

export async function handleTelegramWebhook(env: Env, body: unknown): Promise<void> {
  const update = body as { message?: Record<string, unknown> };
  const message = update.message;
  if (!message) return;

  const chatId = String((message.chat as Record<string, unknown>)?.id ?? "");
  if (chatId !== env.TELEGRAM_CHAT_ID) return;

  const text = ((message.text as string) ?? "").trim();
  const hasPhoto = Boolean(message.photo);

  if (!text && !hasPhoto) return;

  if (text.startsWith("/")) {
    await handleCommand(env, text);
    return;
  }

  const startHour = parseInt(env.OPERATING_START_HOUR ?? "8", 10);
  const endHour = parseInt(env.OPERATING_END_HOUR ?? "21", 10);
  const hour = getJstHour();
  if (hour < startHour || hour >= endHour) {
    await sendMessage(env, `🌙 夜間はタスク抽出を停止中です（${startHour}:00-${endHour}:00 に受け付けます）`);
    return;
  }

  if (hasPhoto) {
    await handlePhoto(env, message);
    return;
  }

  const urlMatch = URL_PATTERN.exec(text);
  if (urlMatch) {
    await handleUrl(env, urlMatch[0]);
    return;
  }

  const isForwarded = Boolean(message.forward_origin ?? message.forward_from ?? message.forward_from_chat);
  const subject = isForwarded ? "転送メッセージ" : "Telegram メッセージ";
  const tasks = await extractTasksFromText(env, "extract_tasks", subject, text);
  if (tasks.length) {
    for (const task of tasks) {
      await addTask(env, { ...task, source: "Telegram" });
    }
    await sendMessage(env, "✅ タスクを登録しました\n\n" + tasks.map((t) => `• ${t.title}`).join("\n"));
  } else {
    await sendMessage(env, "ℹ️ タスクは見つかりませんでした");
  }
}
