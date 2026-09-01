-- Archived Gmail messages (180-day retention, powers /mail substring search)
CREATE TABLE IF NOT EXISTS emails (
  message_id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  body TEXT NOT NULL,
  gmail_url TEXT NOT NULL,
  received_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_emails_received_at ON emails(received_at);
