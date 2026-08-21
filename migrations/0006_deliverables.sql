CREATE TABLE IF NOT EXISTS deliverables (
  id TEXT PRIMARY KEY,
  deliverable_type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  summary TEXT NOT NULL,
  content_markdown TEXT NOT NULL,
  content_json TEXT NOT NULL DEFAULT '{}',
  source_count INTEGER NOT NULL DEFAULT 0,
  related_opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_deliverables_created ON deliverables(created_at DESC);

UPDATE jobs
SET status = 'cancelled', result_summary = 'Replaced by sourced research brief pipeline', updated_at = datetime('now')
WHERE type = 'scout' AND status IN ('queued', 'deferred');

INSERT OR IGNORE INTO jobs (id, type, priority, payload, status, scheduled_at, max_attempts)
SELECT
  'job_initial_sourced_research',
  'research_brief',
  95,
  json_object(
    'topic', 'AI wardrobe and digital closet apps: real user problems, existing alternatives, monetization and zero-cost validation',
    'opportunityId', id,
    'queries', json_array('AI wardrobe app', 'digital closet app', 'wardrobe organizer')
  ),
  'queued',
  datetime('now'),
  3
FROM opportunities
WHERE status NOT IN ('rejected', 'archived')
ORDER BY overall_score DESC
LIMIT 1;
