INSERT INTO ventures (id, name, description, type, status, primary_goal) 
VALUES (
  'venture_tech_agency', 
  'Jarvis Tech Agency', 
  'A development agency pitching custom paid apps, utility tools, websites, and MVPs to generate revenue.', 
  'service_business',
  'active',
  'Acquire paid software development clients and generate revenue.'
)
ON CONFLICT(id) DO UPDATE SET 
  description = excluded.description,
  type = excluded.type,
  status = 'active',
  primary_goal = excluded.primary_goal;

INSERT INTO growth_goals (id, venture_id, name, objective, audience, offer, primary_metric, target_value, channels_json, status)
VALUES (
  'goal_agency_v1',
  'venture_tech_agency',
  'Tech Agency Lead Gen',
  'Acquire paid clients for custom utility apps, MVP development, and websites.',
  'Founders, business owners, and creators needing technical solutions without coding themselves.',
  'Fast, high-quality custom software development that generates revenue.',
  'qualified_leads',
  10,
  '["youtube_shorts", "instagram", "linkedin", "x"]',
  'active'
)
ON CONFLICT(id) DO UPDATE SET status = 'active';

UPDATE growth_goals SET status = 'paused' WHERE id = 'goal_clothmatics_growth_v1';
