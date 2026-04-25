export interface Env {
  AGENT_KV: KVNamespace;
  AGENT_DB: D1Database;
  ANTHROPIC_API_KEY: string;
  NOTION_TOKEN: string;
  NOTION_TASKS_DB_ID: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REFRESH_TOKEN: string;
  OPERATING_START_HOUR?: string;
  OPERATING_END_HOUR?: string;
  DAILY_BRIEFING_HOUR?: string;
  TASK_REMINDER_HOURS?: string;
  COST_REPORT_HOUR?: string;
  GMAIL_TASK_LABEL?: string;
}

export interface Task {
  title: string;
  due: string | null;
  priority: "high" | "medium" | "low";
  status: string;
  lastEdited: string | null;
  url: string;
  pageId: string;
}

export interface TaskInput {
  title: string;
  due?: string | null;
  priority?: "high" | "medium" | "low";
  source?: string;
  sourceUrl?: string;
}

export interface ExtractedTask {
  title: string;
  due: string | null;
  priority: "high" | "medium" | "low";
}

export interface EmailAnalysis {
  summary: string;
  tasks: ExtractedTask[];
}

export interface UsageEntry {
  date: string;
  job: string;
  inputTokens: number;
  outputTokens: number;
}

export interface CalendarEvent {
  summary: string;
  start: string;
}
