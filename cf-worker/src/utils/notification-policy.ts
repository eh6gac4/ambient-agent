import type { Task } from "../types.js";

/**
 * 送信タイミングのバリデーション。
 * 指定された時間帯（デフォルト 22:00〜07:00）は false（送信スキップ）を返す。
 */
export function shouldSendBriefing(
  now: Date,
  config?: { quietHoursStart?: number; quietHoursEnd?: number }
): boolean {
  const start = config?.quietHoursStart ?? 22;
  const end = config?.quietHoursEnd ?? 7;
  const hours = now.getHours();

  if (start === end) {
    return true; // quiet hours はなしとみなす
  }

  let isQuiet = false;
  if (start > end) {
    isQuiet = hours >= start || hours < end;
  } else {
    isQuiet = hours >= start && hours < end;
  }

  return !isQuiet;
}

/**
 * タスクの配列から、指定された location に関連するタスクのみをフィルタリングして返す。
 */
export function filterTasksForLocation<T extends { location: string | null }>(tasks: T[], location: string): T[] {
  const locLower = location.toLowerCase();
  let targetLocations = [locLower];
  if (locLower === "home" || locLower === "家" || locLower === "自宅") {
    targetLocations = ["home", "家", "自宅"];
  } else if (locLower === "office" || locLower === "オフィス" || locLower === "会社" || locLower === "職場") {
    targetLocations = ["office", "オフィス", "会社", "職場"];
  }

  return tasks.filter((t) => {
    if (!t.location) return false;
    return targetLocations.includes(t.location.toLowerCase());
  });
}
