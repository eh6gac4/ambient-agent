export interface Env {
  AGENT_KV: KVNamespace;
  AGENT_DB: D1Database;
  GEMINI_API_KEY: string;
  NOTION_TOKEN: string;
  NOTION_TASKS_DB_ID: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  ALERT_TOKEN: string;
  OWNTRACKS_TOKEN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REFRESH_TOKEN: string;
  OPERATING_START_HOUR?: string;
  OPERATING_END_HOUR?: string;
  DAILY_BRIEFING_HOUR?: string;
  TASK_REMINDER_HOURS?: string;
  COST_REPORT_HOUR?: string;
  GMAIL_TASK_LABEL?: string;
  GMAIL_ACCOUNT_INDEX?: string;
  NOTION_SUBITEM_PARENT_PROP?: string;
  GITHUB_PAT?: string;
  GITHUB_REPO?: string;
  QUIET_HOURS_START?: string;
  QUIET_HOURS_END?: string;
}

// ─── Geofence ────────────────────────────────────────────────────────────────

/** アクション指定: 文字列(パラメータなし)またはオブジェクト形式。 */
export type GeofenceActionSpec =
  | string
  | ({ action: string } & Record<string, unknown>);

/** ジオフェンスリージョンの定義。KV `geofence:regions` に JSON 配列で保存。 */
export interface Region {
  /** 一意な識別子 (例: "home", "office", "gym") */
  id: string;
  /** 緯度 */
  lat: number;
  /** 経度 */
  lon: number;
  /** 判定半径 (メートル) */
  radius_m: number;
  /** 圏内に入ったときに実行するアクション */
  onEnter?: GeofenceActionSpec;
  /** 圏外に出たときに実行するアクション */
  onLeave?: GeofenceActionSpec;
}

/** ジオフェンスアクション実行時のコンテキスト。 */
export interface GeofenceContext {
  regionId: string;
  transition: "enter" | "leave";
  params: Record<string, unknown>;
  location: { lat: number; lon: number; tst: number };
}

export interface Task {
  title: string;
  due: string | null;
  priority: "high" | "medium" | "low";
  status: string;
  location: string | null;
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
  icon?: string;
}

export interface ExtractedTask {
  title: string;
  due: string | null;
  priority: "high" | "medium" | "low";
  icon?: string;
}

export interface EmailAnalysis {
  summary: string;
  /** タスク一覧に表示するための簡潔なタイトル。メール件名より要点が分かる形を期待する。 */
  task_title?: string;
  tasks: ExtractedTask[];
}

export interface UsageEntry {
  date: string;
  job: string;
  inputTokens: number;
  outputTokens: number;
  response?: string;
}

export interface CalendarEvent {
  summary: string;
  start: string;
}
