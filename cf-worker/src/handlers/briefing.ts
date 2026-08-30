import type { Env, CalendarEvent, Task } from "../types.js";
import { getTodaysEvents } from "../clients/gcal-api.js";
import { getOpenTasks } from "../clients/tasks.js";
import { summarizeDay } from "../clients/gemini.js";
import { sendMessage, escapeMd } from "../clients/telegram.js";
import { getDailyUsage, takeEmailDigest } from "../storage/kv.js";
import { PRIORITY_ICON } from "../utils/task.js";
import { jstNow, toDateStr } from "../utils/jst.js";
import { shouldSendBriefing } from "../utils/notification-policy.js";
import { getEscalationNoticeText, getBacklogPromotionNoticeText } from "./escalation.js";
import { getDueSoonNoticeText } from "./calendar.js";
import { getTaskLink } from "./task-formatter.js";

const PRICE_INPUT_PER_M = 1.5;
const PRICE_OUTPUT_PER_M = 9.0;

function calcCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * PRICE_INPUT_PER_M + (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_M;
}

function jstDateStr(): string {
  return new Date().toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).replace(/\//g, "-");
}

function formatEventTime(start: string): string {
  if (!start.includes("T")) return "終日";
  return new Date(start).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDueShort(due: string | null): string {
  if (!due) return "";
  const [, m, d] = due.slice(0, 10).split("-");
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
}

function formatEventsSection(events: CalendarEvent[]): string {
  if (!events.length) return "*🗓 今日の予定*\n（なし）";
  const lines = events.map(
    (e) => `• ${formatEventTime(e.start)} ${e.summary ? escapeMd(e.summary) : "(タイトルなし)"}`,
  );
  return `*🗓 今日の予定 (${events.length}件)*\n${lines.join("\n")}`;
}

function formatOverdueSection(overdue: Task[]): string {
  if (!overdue.length) return "";
  const lines = overdue.map((t) => `• ${PRIORITY_ICON[t.priority]} ${getTaskLink(t.title, t.pageId)} (${formatDueShort(t.due)})`);
  return `*⚠️ 期限切れ (${overdue.length}件)*\n${lines.join("\n")}`;
}

function formatTasksSection(tasks: Task[]): string {
  if (!tasks.length) return "*✅ 未完了タスク*\n（なし）";
  const grouped: Record<"high" | "medium" | "low", Task[]> = { high: [], medium: [], low: [] };
  for (const t of tasks) grouped[t.priority].push(t);

  const labels = { high: "🔴 *High*", medium: "🟡 *Medium*", low: "🟢 *Low*" } as const;
  const lines: string[] = [];
  for (const p of ["high", "medium", "low"] as const) {
    if (!grouped[p].length) continue;
    lines.push(labels[p]);
    for (const t of grouped[p]) {
      const due = t.due ? ` (〜${formatDueShort(t.due)})` : "";
      lines.push(`• ${getTaskLink(t.title, t.pageId)}${due}`);
    }
  }
  return `*✅ 未完了タスク (${tasks.length}件)*\n${lines.join("\n")}`;
}

export async function sendDailyBriefing(env: Env): Promise<void> {
  const now = jstNow();
  const config = {
    quietHoursStart: env.QUIET_HOURS_START ? parseInt(env.QUIET_HOURS_START, 10) : undefined,
    quietHoursEnd: env.QUIET_HOURS_END ? parseInt(env.QUIET_HOURS_END, 10) : undefined,
  };
  if (!shouldSendBriefing(now, config)) {
    console.log("Skipping daily briefing due to quiet hours");
    return;
  }
  // 1. タスクストア/KV updates that we want to notify about
  const [escalationText, backlogText, emailDigestText] = await Promise.all([
    getEscalationNoticeText(env),
    getBacklogPromotionNoticeText(env),
    getEmailDigestText(env),
  ]);

  // 2. Fetch the latest state (after escalations)
  const [events, tasks] = await Promise.all([getTodaysEvents(env), getOpenTasks(env)]);

  const todayStr = toDateStr(jstNow());
  const overdue = tasks.filter((t) => t.due && t.due.slice(0, 10) < todayStr);
  const openTasks = tasks.filter((t) => !overdue.includes(t));

  const summary = await summarizeDay(env, events, openTasks, overdue);
  const dateStr = jstDateStr();
  
  const dueSoonText = getDueSoonNoticeText(tasks);

  const sections = [
    `*📅 日次ブリーフィング ${dateStr}*`,
    escapeMd(summary.trim()),
    formatEventsSection(events),
    backlogText,
    escalationText,
    dueSoonText,
    formatOverdueSection(overdue),
    formatTasksSection(openTasks),
    emailDigestText,
  ].filter(Boolean);

  await sendMessage(env, sections.join("\n\n"));
}

export async function sendWeeklyCostReport(env: Env): Promise<void> {
  const now = jstNow();
  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;
  const byJob: Record<string, { input: number; output: number; calls: number; cost: number }> = {};
  let totalCalls = 0;

  for (let i = 1; i <= 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dStr = d.toISOString().slice(0, 10);
    const entries = await getDailyUsage(env, dStr);
    
    // 無料枠の判定 (1500リクエスト/日 以下なら無料)
    const isFree = entries.length <= 1500;

    for (const e of entries) {
      totalInput += e.inputTokens;
      totalOutput += e.outputTokens;
      const j = (byJob[e.job] ??= { input: 0, output: 0, calls: 0, cost: 0 });
      j.input += e.inputTokens;
      j.output += e.outputTokens;
      j.calls++;
      totalCalls++;

      if (!isFree) {
        const c = calcCost(e.inputTokens, e.outputTokens);
        totalCost += c;
        j.cost += c;
      }
    }
  }

  if (totalCalls === 0) {
    await sendMessage(env, `*💰 週間コストレポート*\n\n直近7日間の Gemini API の呼び出しはありませんでした。`);
    return;
  }

  const isAllFree = totalCost === 0;

  const lines = [
    `*💰 週間コストレポート*\n`,
    `合計: ${isAllFree ? "無料枠内 ($0)" : `$${totalCost.toFixed(4)} USD`}`,
    `API呼び出し: ${totalCalls}回`,
    `入力トークン: ${totalInput.toLocaleString()}`,
    `出力トークン: ${totalOutput.toLocaleString()}`,
    "",
    "*ジョブ別内訳*",
    ...Object.entries(byJob)
      .sort((a, b) => b[1].calls - a[1].calls)
      .map(([job, s]) => {
        const costStr = s.cost > 0 ? `$${s.cost.toFixed(4)}` : "$0";
        return `• \`${job}\`: ${s.calls}回 / ${costStr}`;
      }),
  ];

  await sendMessage(env, lines.join("\n"));
}

export async function getEmailDigestText(env: Env): Promise<string | null> {
  const { taskLines, archivedLines } = await takeEmailDigest(env);
  if (!taskLines.length && !archivedLines.length) return null;

  const sections: string[] = [];
  if (taskLines.length) {
    sections.push(
      `✅ *タスク登録*: ${taskLines.length}件\n[🔗 ダッシュボードで確認](https://todo.eh6gac4.work)`,
    );
  }
  if (archivedLines.length) sections.push("📦 *アーカイブ済み*\n" + archivedLines.join("\n"));
  return "*📧 メール処理サマリ*\n\n" + sections.join("\n\n");
}
