// タスクの優先度に関する共通定数・ヘルパー。

/** 優先度の並び順（小さいほど高優先）。不明な優先度は medium 相当(1)として扱う。 */
export const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** 優先度に対応する絵文字アイコン。 */
export const PRIORITY_ICON: Record<string, string> = { high: "🔴", medium: "🟡", low: "🟢" };

/**
 * 最も優先度の高いタスクを返す（high > medium > low、不明は medium 相当）。
 * tasks は非空であること（空配列を渡すと reduce が例外を投げる）。
 */
export function bestPriorityTask<T extends { priority: string }>(tasks: T[]): T {
  return tasks.reduce((a, b) =>
    (PRIORITY_ORDER[a.priority] ?? 1) <= (PRIORITY_ORDER[b.priority] ?? 1) ? a : b,
  );
}
