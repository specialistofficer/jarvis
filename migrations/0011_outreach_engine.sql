CREATE TABLE IF NOT EXISTS outreach_campaigns (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS outreach_leads (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  website_url TEXT NOT NULL,
  contact_email TEXT,
  seo_issues TEXT,
  personalized_pitch TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
