CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  growth_asset_id TEXT NOT NULL REFERENCES growth_assets(id) ON DELETE CASCADE,
  goal_id TEXT NOT NULL REFERENCES growth_goals(id) ON DELETE CASCADE,
  media_kind TEXT NOT NULL CHECK (media_kind IN ('image','video')),
  format TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  duration_seconds INTEGER,
  provider TEXT NOT NULL DEFAULT 'jarvis_renderer',
  model TEXT,
  prompt TEXT NOT NULL,
  spec_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'render_queued',
  storage_key TEXT,
  public_id TEXT NOT NULL UNIQUE,
  bytes INTEGER NOT NULL DEFAULT 0,
  render_attempts INTEGER NOT NULL DEFAULT 0,
  lease_until TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  approved_at TEXT,
  published_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_media_assets_status_created ON media_assets(status, created_at);
CREATE INDEX IF NOT EXISTS idx_media_assets_growth ON media_assets(growth_asset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS channel_connections (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL UNIQUE,
  connection_type TEXT NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'not_connected',
  account_label TEXT,
  last_sync_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO channel_connections (id, provider, connection_type, capabilities_json) VALUES
  ('connection_google_drive', 'google_drive', 'storage', '["asset_archive","model_warehouse"]'),
  ('connection_instagram', 'instagram', 'publishing_analytics', '["publish","analytics"]'),
  ('connection_linkedin', 'linkedin', 'publishing_analytics', '["publish","analytics"]'),
  ('connection_x', 'x', 'publishing_analytics', '["publish","analytics"]'),
  ('connection_youtube', 'youtube', 'publishing_analytics', '["publish","analytics"]'),
  ('connection_product_analytics', 'product_analytics', 'analytics', '["installs","activation","revenue"]');

INSERT INTO jobs (id, type, priority, payload, status, scheduled_at, max_attempts)
SELECT lower(hex(randomblob(16))), 'media_production', 90,
  json_object('growthAssetId', id, 'reason', 'media_phase_bootstrap'),
  'queued', datetime('now'), 3
FROM growth_assets a
WHERE a.status = 'ready_to_publish'
  AND NOT EXISTS (
    SELECT 1 FROM media_assets m WHERE m.growth_asset_id = a.id AND m.status != 'deleted'
  );
