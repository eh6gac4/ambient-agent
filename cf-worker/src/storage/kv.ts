import type { Env, Task, UsageEntry } from "../types.js";

// Telegram
export async function getTelegramOffset(env: Env): Promise<number> {
  const val = await env.AGENT_KV.get("telegram:offset");
  return val ? parseInt(val, 10) : 0;
}

export async function setTelegramOffset(env: Env, offset: number): Promise<void> {
  await env.AGENT_KV.put("telegram:offset", String(offset));
}

export async function getTaskCache(env: Env): Promise<Task[]> {
  const val = await env.AGENT_KV.get<Task[]>("telegram:task_cache", "json");
  return val ?? [];
}

export async function setTaskCache(env: Env, tasks: Task[]): Promise<void> {
  await env.AGENT_KV.put("telegram:task_cache", JSON.stringify(tasks));
}

// No-task senders blocklist
export async function getNoTaskSenders(env: Env): Promise<Set<string>> {
  const val = await env.AGENT_KV.get("no_task_senders");
  if (!val) return new Set();
  return new Set(
    val
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export async function addNoTaskSender(env: Env, email: string): Promise<void> {
  const senders = await getNoTaskSenders(env);
  senders.add(email.toLowerCase());
  await env.AGENT_KV.put("no_task_senders", [...senders].sort().join("\n"));
}

export async function removeNoTaskSender(env: Env, email: string): Promise<boolean> {
  const senders = await getNoTaskSenders(env);
  if (!senders.has(email.toLowerCase())) return false;
  senders.delete(email.toLowerCase());
  await env.AGENT_KV.put("no_task_senders", [...senders].sort().join("\n"));
  return true;
}

// Usage tracking
export async function recordUsage(env: Env, job: string, inputTokens: number, outputTokens: number): Promise<void> {
  const dateStr = new Date().toISOString().slice(0, 10);
  const key = `usage:${dateStr}`;
  const existing = (await env.AGENT_KV.get<UsageEntry[]>(key, "json")) ?? [];
  existing.push({ date: dateStr, job, inputTokens, outputTokens });
  await env.AGENT_KV.put(key, JSON.stringify(existing), { expirationTtl: 30 * 86400 });
}

export async function getDailyUsage(env: Env, dateStr: string): Promise<UsageEntry[]> {
  return (await env.AGENT_KV.get<UsageEntry[]>(`usage:${dateStr}`, "json")) ?? [];
}
