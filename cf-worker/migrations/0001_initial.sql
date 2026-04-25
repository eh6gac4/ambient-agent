-- Gmail thread ID → Notion page ID (deduplication for reply emails)
CREATE TABLE IF NOT EXISTS gmail_thread_map (
  thread_id TEXT PRIMARY KEY,
  notion_page_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Notion page ID → Gmail sender address (for blocklist learning)
CREATE TABLE IF NOT EXISTS task_sender_map (
  notion_page_id TEXT PRIMARY KEY,
  sender_email TEXT NOT NULL
);

-- Notion page ID → Google Calendar event ID
CREATE TABLE IF NOT EXISTS calendar_sync (
  notion_page_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  calendar_date TEXT NOT NULL
);

-- Processed Gmail message IDs (30-day retention, prevents reprocessing)
CREATE TABLE IF NOT EXISTS processed_messages (
  message_id TEXT PRIMARY KEY,
  processed_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_processed_messages_at ON processed_messages(processed_at);
