PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ventures (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  primary_goal TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  venture_id TEXT REFERENCES ventures(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  problem TEXT NOT NULL,
  target_user TEXT NOT NULL,
  opportunity_type TEXT NOT NULL,
  source TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  analysis_json TEXT NOT NULL DEFAULT '{}',
  demand_score REAL NOT NULL,
  revenue_score REAL NOT NULL,
  distribution_score REAL NOT NULL,
  competition_score REAL NOT NULL,
  differentiation_score REAL NOT NULL,
  build_effort_score REAL NOT NULL,
  zero_cost_score REAL NOT NULL,
  strategic_value_score REAL NOT NULL,
  confidence_score REAL NOT NULL,
  overall_score REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'discovered',
  founder_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_opportunities_status_score ON opportunities(status, overall_score DESC);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_url TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  captured_at TEXT NOT NULL DEFAULT (datetime('now')),
  confidence REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  venture_id TEXT REFERENCES ventures(id) ON DELETE SET NULL,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  objective TEXT NOT NULL,
  success_metric TEXT NOT NULL,
  kill_condition TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  hypothesis TEXT NOT NULL,
  method TEXT NOT NULL,
  success_metric TEXT NOT NULL,
  kill_condition TEXT NOT NULL,
  expected_result TEXT,
  actual_result TEXT,
  status TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 50,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',
  scheduled_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  locked_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs(status, scheduled_at, priority DESC);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_summary TEXT NOT NULL,
  output_summary TEXT,
  tokens_or_usage TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  decision_type TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  reasoning_summary TEXT NOT NULL,
  decision TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS learnings (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  observation TEXT NOT NULL,
  lesson TEXT NOT NULL,
  source_experiment_id TEXT REFERENCES experiments(id) ON DELETE SET NULL,
  confidence REAL NOT NULL,
  applies_to TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS founder_rules (
  id TEXT PRIMARY KEY,
  rule TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  priority INTEGER NOT NULL DEFAULT 50,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  plan_type TEXT NOT NULL,
  free_only INTEGER NOT NULL DEFAULT 1,
  current_usage TEXT NOT NULL DEFAULT 'unknown',
  usage_limit TEXT NOT NULL DEFAULT 'unknown',
  reset_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  manual_execution_required INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  report_type TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  content_json TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO ventures (id, name, description, type, status, primary_goal)
VALUES (
  'venture_clothmatics',
  'ClothMatics',
  'Mobile AI fashion and wardrobe application.',
  'mobile_app',
  'active',
  'Increase real users, activation and retention; discover monetization, valuable product improvements and sustainable acquisition channels.'
);

INSERT OR IGNORE INTO founder_rules (id, rule, scope, priority)
VALUES ('rule_zero_spend', 'Do not execute any action that can incur paid usage.', 'global', 100);

INSERT OR IGNORE INTO system_settings (key, value) VALUES ('system_status', 'running');
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('allow_paid_spend', 'false');
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('max_cost_inr', '0');

INSERT OR IGNORE INTO resources (id, provider, resource_type, plan_type, free_only, enabled, notes)
VALUES
  ('resource_nvidia', 'NVIDIA API', 'ai_inference', 'existing_access', 1, 1, 'Calls require an explicit free-allowance confirmation.'),
  ('resource_cloudflare_workers', 'Cloudflare Workers', 'compute', 'free', 1, 1, 'Hourly cron and API runtime.'),
  ('resource_cloudflare_d1', 'Cloudflare D1', 'database', 'free', 1, 1, 'Structured Jarvis memory.'),
  ('resource_github', 'GitHub Actions', 'automation', 'free', 1, 1, 'Free allowance varies by repository visibility.'),
  ('resource_drive', 'Google Drive', 'asset_storage', 'existing_access', 1, 1, 'Future large-asset warehouse; references only in D1.');

INSERT OR IGNORE INTO resources (id, provider, resource_type, plan_type, free_only, enabled, manual_execution_required, notes)
VALUES
  ('resource_google_ai_pro', 'Google AI Pro', 'premium_generation', 'consumer_subscription', 1, 1, 1, 'No programmable API entitlement assumed.'),
  ('resource_google_flow', 'Google Flow', 'premium_generation', 'consumer_subscription', 1, 1, 1, 'Founder manually executes queued prompts.');

INSERT OR IGNORE INTO jobs (id, type, priority, payload, status, scheduled_at, max_attempts)
VALUES ('job_initial_scout', 'scout', 80, '{"reason":"initial_seed"}', 'queued', datetime('now'), 3);
