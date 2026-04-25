import { vi } from "vitest";
import type { Env, Task } from "../../src/types.js";

// ─── In-memory KV mock ───────────────────────────────────────────────────────

export function createMockKV(): KVNamespace {
  const store = new Map<string, string>();

  return {
    async get(key: string, type?: string) {
      const val = store.get(key) ?? null;
      if (val === null) return null;
      if (type === "json") return JSON.parse(val);
      return val;
    },
    async put(key: string, value: string | ArrayBuffer, options?: { expirationTtl?: number }) {
      store.set(key, typeof value === "string" ? value : "");
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true, cursor: "" };
    },
    async getWithMetadata(key: string) {
      return { value: store.get(key) ?? null, metadata: null };
    },
  } as unknown as KVNamespace;
}

// ─── In-memory D1 mock ───────────────────────────────────────────────────────

export function createMockD1(): D1Database {
  const tables: Record<string, Record<string, unknown>[]> = {
    gmail_thread_map: [],
    task_sender_map: [],
    calendar_sync: [],
    processed_messages: [],
  };

  const stub = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              return null as T | null;
            },
            async all<T>() {
              return { results: [] as T[], success: true, meta: {} };
            },
            async run() {
              return { success: true, meta: {} };
            },
          };
        },
        async first<T>() {
          return null as T | null;
        },
        async all<T>() {
          return { results: [] as T[], success: true, meta: {} };
        },
        async run() {
          return { success: true, meta: {} };
        },
      };
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    async batch() {
      return [];
    },
  };

  return stub as unknown as D1Database;
}

// ─── Mock Env ────────────────────────────────────────────────────────────────

export function createMockEnv(overrides: Partial<Env> = {}): Env {
  return {
    AGENT_KV: createMockKV(),
    AGENT_DB: createMockD1(),
    ANTHROPIC_API_KEY: "test-anthropic-key",
    NOTION_TOKEN: "test-notion-token",
    NOTION_TASKS_DB_ID: "test-db-id",
    TELEGRAM_BOT_TOKEN: "test-bot-token",
    TELEGRAM_CHAT_ID: "123456789",
    GOOGLE_CLIENT_ID: "test-client-id",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
    GOOGLE_REFRESH_TOKEN: "test-refresh-token",
    OPERATING_START_HOUR: "8",
    OPERATING_END_HOUR: "21",
    ...overrides,
  };
}

// ─── Mock fetch helper ───────────────────────────────────────────────────────

export function mockFetch(responses: Array<{ url?: RegExp | string; response: unknown; status?: number }>) {
  let index = 0;
  return vi.fn(async (url: string) => {
    const match = responses[index] ?? responses[responses.length - 1];
    index++;
    return new Response(JSON.stringify(match.response), {
      status: match.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

// ─── Sample tasks ────────────────────────────────────────────────────────────

export function sampleTasks(): Task[] {
  return [
    {
      title: "プロジェクト資料を確認する",
      due: "2026-04-30",
      priority: "high",
      status: "未着手",
      lastEdited: "2026-04-20",
      url: "https://notion.so/page-001",
      pageId: "page-001",
    },
    {
      title: "週次レポートを提出する",
      due: "2026-04-25",
      priority: "medium",
      status: "進行中",
      lastEdited: "2026-04-10",
      url: "https://notion.so/page-002",
      pageId: "page-002",
    },
    {
      title: "古いタスク",
      due: null,
      priority: "low",
      status: "未着手",
      lastEdited: "2026-04-01",
      url: "https://notion.so/page-003",
      pageId: "page-003",
    },
  ];
}
