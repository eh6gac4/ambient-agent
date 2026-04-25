import type { Task } from "../types.js";

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
const PRIORITY_LABELS: Record<string, string> = { high: "🔴", medium: "🟡", low: "🟢" };
const STATUS_ORDER: Record<string, number> = { 未着手: 0, 進行中: 1, 確認中: 2, 一時中断: 3 };
const STATUS_LABELS: Record<string, string> = {
  未着手: "📋 未着手",
  進行中: "▶️ 進行中",
  確認中: "🔍 確認中",
  一時中断: "⏸ 一時中断",
};

const WEEKDAYS_JP = ["月", "火", "水", "木", "金", "土", "日"];

export function fmtDue(d: string | null): string {
  if (!d) return "";
  const due = new Date(d.slice(0, 10) + "T00:00:00+09:00");
  if (isNaN(due.getTime())) return d;

  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const delta = Math.round((due.getTime() - today.getTime()) / 86400000);

  if (delta === 0) return "今日";
  if (delta === 1) return "明日";
  if (delta === 2) return "明後日";
  if (delta >= 3 && delta < 14) {
    const weekday = WEEKDAYS_JP[due.getDay() === 0 ? 6 : due.getDay() - 1];
    const dueWeek = getWeekNumber(due);
    const todayWeek = getWeekNumber(today);
    const prefix = dueWeek === todayWeek ? "今週" : "来週";
    return `${prefix}${weekday}曜`;
  }

  // 文字列から直接パースしてタイムゾーンズレを防ぐ
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return `${y}年${m}月${day}日`;
}

function getWeekNumber(d: Date): number {
  const startOfYear = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const statusDiff = (STATUS_ORDER[a.status] ?? 0) - (STATUS_ORDER[b.status] ?? 0);
    if (statusDiff !== 0) return statusDiff;
    const priorityDiff = (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1);
    if (priorityDiff !== 0) return priorityDiff;
    return (a.due ?? "9999") < (b.due ?? "9999") ? -1 : 1;
  });
}

export function formatTaskList(tasks: Task[], numbered = false): string {
  const sorted = sortTasks(tasks);
  let currentStatus = "";
  const lines: string[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    if (t.status !== currentStatus) {
      currentStatus = t.status;
      lines.push(`\n*${STATUS_LABELS[t.status] ?? t.status}*`);
    }
    const due = t.due ? `（${fmtDue(t.due)}）` : "";
    const icon = PRIORITY_LABELS[t.priority] ?? "";
    const prefix = numbered ? `${i + 1}. ` : "• ";
    lines.push(`${prefix}${icon} ${t.title}${due}`);
  }
  return lines.join("\n");
}
