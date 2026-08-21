CREATE TABLE IF NOT EXISTS connection_secrets (
  connection_id TEXT PRIMARY KEY,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  expires_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (connection_id) REFERENCES channel_connections(id) ON DELETE CASCADE
);
