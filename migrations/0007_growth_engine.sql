CREATE TABLE IF NOT EXISTS growth_goals (
  id TEXT PRIMARY KEY,
  venture_id TEXT REFERENCES ventures(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  objective TEXT NOT NULL,
  audience TEXT NOT NULL,
  offer TEXT NOT NULL,
  primary_metric TEXT NOT NULL,
  target_value REAL NOT NULL DEFAULT 0,
  current_value REAL NOT NULL DEFAULT 0,
  channels_json TEXT NOT NULL DEFAULT '[]',
  deadline TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS growth_assets (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES growth_goals(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  asset_type TEXT NOT NULL,
  channel TEXT NOT NULL,
  title TEXT NOT NULL,
  hook TEXT NOT NULL,
  body TEXT NOT NULL,
  cta TEXT NOT NULL,
  production_notes TEXT NOT NULL,
  source_urls_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  external_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_growth_assets_goal_status ON growth_assets(goal_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS growth_leads (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES growth_goals(id) ON DELETE CASCADE,
  lead_type TEXT NOT NULL,
  name TEXT NOT NULL,
  source_url TEXT,
  why_relevant TEXT NOT NULL,
  next_action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS growth_metrics (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES growth_goals(id) ON DELETE CASCADE,
  asset_id TEXT REFERENCES growth_assets(id) ON DELETE SET NULL,
  metric_date TEXT NOT NULL,
  channel TEXT NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  installs INTEGER NOT NULL DEFAULT 0,
  leads INTEGER NOT NULL DEFAULT 0,
  revenue_inr REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_growth_metrics_goal_date ON growth_metrics(goal_id, metric_date DESC);

CREATE TABLE IF NOT EXISTS growth_reviews (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES growth_goals(id) ON DELETE CASCADE,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  summary TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  winners_json TEXT NOT NULL DEFAULT '[]',
  failures_json TEXT NOT NULL DEFAULT '[]',
  recommendations_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO growth_goals (
  id, venture_id, name, objective, audience, offer, primary_metric,
  target_value, channels_json, deadline, status
) VALUES (
  'goal_clothmatics_growth_v1',
  'venture_clothmatics',
  'ClothMatics Organic Growth',
  'Acquire qualified ClothMatics users through evidence-led organic content and measurable distribution experiments.',
  'People who struggle to organize their wardrobe, decide what to wear, or avoid unnecessary clothing purchases.',
  'A simpler way to understand and use the clothes already in your wardrobe.',
  'installs',
  100,
  '["instagram","youtube_shorts","linkedin","x"]',
  date('now', '+30 days'),
  'active'
);

INSERT OR IGNORE INTO jobs (id, type, priority, payload, status, scheduled_at, max_attempts)
VALUES (
  'job_initial_growth_pack',
  'growth_plan',
  100,
  '{"goalId":"goal_clothmatics_growth_v1","reason":"initial_growth_engine"}',
  'queued',
  datetime('now'),
  3
);
