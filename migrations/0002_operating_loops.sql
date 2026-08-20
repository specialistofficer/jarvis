INSERT OR IGNORE INTO jobs (id, type, priority, payload, status, scheduled_at, max_attempts)
VALUES
  ('job_initial_learning_review', 'learning_review', 55, '{"reason":"initial_seed"}', 'queued', datetime('now'), 3),
  ('job_initial_daily_report', 'daily_report', 45, '{"reason":"initial_seed"}', 'queued', datetime('now'), 3);

INSERT OR IGNORE INTO system_settings (key, value) VALUES ('strategist_enabled', 'true');
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('learning_enabled', 'true');
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('reports_enabled', 'true');
