import type { Env } from "../types.js";
import { getTodaysEvents } from "../clients/gcal-api.js";
import { getOpenTasks } from "../clients/notion.js";
import { summarizeDay } from "../clients/anthropic.js";
import { sendMessage } from "../clients/telegram.js";
import { getDailyUsage } from "../storage/kv.js";

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

export async function sendDailyBriefing(env: Env): Promise<void> {
  const [events, tasks] = await Promise.all([getTodaysEvents(env), getOpenTasks(env)]);

  const todayStr = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }))
    .toISOString()
    .slice(0, 10);
  const overdue = tasks.filter((t) => t.due && t.due.slice(0, 10) < todayStr);

  const summary = await summarizeDay(env, events, tasks, overdue);
  const dateStr = jstDateStr();
  await sendMessage(env, `*📅 日次ブリーフィング ${dateStr}*\n\n${summary}`);
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
