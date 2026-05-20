import type { Env, CalendarEvent, Task } from "../types.js";
import { getTodaysEvents } from "../clients/gcal-api.js";
import { getOpenTasks } from "../clients/notion.js";
import { summarizeDay } from "../clients/anthropic.js";
import { sendMessage } from "../clients/telegram.js";
import { getDailyUsage, takeEmailDigest } from "../storage/kv.js";

const PRICE_INPUT_PER_M = 0.8;
const PRICE_OUTPUT_PER_M = 4.0;

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
  const lines = events.map((e) => `• ${formatEventTime(e.start)} ${e.summary || "(タイトルなし)"}`);
  return `*🗓 今日の予定 (${events.length}件)*\n${lines.join("\n")}`;
}

function formatOverdueSection(overdue: Task[]): string {
  if (!overdue.length) return "";
  const icon = { high: "🔴", medium: "🟡", low: "🟢" } as const;
  const lines = overdue.map((t) => `• ${icon[t.priority]} ${t.title} (${formatDueShort(t.due)})`);
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
      lines.push(`• ${t.title}${due}`);
    }
  }
  return `*✅ 未完了タスク (${tasks.length}件)*\n${lines.join("\n")}`;
}

export async function sendDailyBriefing(env: Env): Promise<void> {
  const [events, tasks] = await Promise.all([getTodaysEvents(env), getOpenTasks(env)]);

  const todayStr = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }))
    .toISOString()
    .slice(0, 10);
  const overdue = tasks.filter((t) => t.due && t.due.slice(0, 10) < todayStr);
  const openTasks = tasks.filter((t) => !overdue.includes(t));

  const summary = await summarizeDay(env, events, openTasks, overdue);
  const dateStr = jstDateStr();

  const sections = [
    `*📅 日次ブリーフィング ${dateStr}*`,
    summary.trim(),
    formatEventsSection(events),
    formatOverdueSection(overdue),
    formatTasksSection(openTasks),
  ].filter(Boolean);

  await sendMessage(env, sections.join("\n\n"));
}

export async function sendCostReport(env: Env): Promise<void> {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const entries = await getDailyUsage(env, yesterdayStr);

  if (!entries.length) {
    await sendMessage(env, `*💰 コストレポート ${yesterdayStr}*\n\nClaude API の呼び出しはありませんでした。`);
    return;
  }

  let totalInput = 0;
  let totalOutput = 0;
  const byJob: Record<string, { input: number; output: number; calls: number }> = {};

  for (const e of entries) {
    totalInput += e.inputTokens;
    totalOutput += e.outputTokens;
    const j = (byJob[e.job] ??= { input: 0, output: 0, calls: 0 });
    j.input += e.inputTokens;
    j.output += e.outputTokens;
    j.calls++;
  }

  const lines = [
    `*💰 コストレポート ${yesterdayStr}*\n`,
    `合計: $${calcCost(totalInput, totalOutput).toFixed(4)} USD`,
    `API呼び出し: ${entries.length}回`,
    `入力トークン: ${totalInput.toLocaleString()}`,
    `出力トークン: ${totalOutput.toLocaleString()}`,
    "",
    "*ジョブ別内訳*",
    ...Object.entries(byJob).map(
      ([job, s]) => `• \`${job}\`: ${s.calls}回 / $${calcCost(s.input, s.output).toFixed(4)}`,
    ),
  ];

  await sendMessage(env, lines.join("\n"));
}

export async function sendEmailDigest(env: Env): Promise<void> {
  const { taskLines, archivedLines } = await takeEmailDigest(env);
  if (!taskLines.length && !archivedLines.length) return;

  const sections: string[] = [];
  if (taskLines.length) sections.push("✅ *タスク登録*\n" + taskLines.join("\n"));
  if (archivedLines.length) sections.push("📦 *アーカイブ済み*\n" + archivedLines.join("\n"));
  await sendMessage(env, "*📧 メール処理サマリ*\n\n" + sections.join("\n\n"));
}
