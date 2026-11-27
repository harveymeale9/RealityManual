CREATE TABLE IF NOT EXISTS email_open_tracking (
  email_id TEXT PRIMARY KEY,
  email_type TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  open_observed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_email_open_tracking_type_sent
  ON email_open_tracking(email_type, sent_at);
