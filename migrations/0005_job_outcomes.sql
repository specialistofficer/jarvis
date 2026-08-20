ALTER TABLE jobs ADD COLUMN result_summary TEXT;

UPDATE jobs
SET result_summary = CASE type
  WHEN 'scout' THEN COALESCE(
    (SELECT output_summary FROM agent_runs WHERE job_id = jobs.id AND success = 1 ORDER BY completed_at DESC LIMIT 1),
    'Opportunity Scout completed; no detailed result was recorded.'
  )
  WHEN 'research_opportunity' THEN COALESCE(
    (SELECT output_summary FROM agent_runs WHERE job_id = jobs.id AND success = 1 ORDER BY completed_at DESC LIMIT 1),
    'Strategist research completed; no detailed result was recorded.'
  )
  WHEN 'learning_review' THEN COALESCE(
    (SELECT output_summary FROM agent_runs WHERE job_id = jobs.id AND success = 1 ORDER BY completed_at DESC LIMIT 1),
    'Checked completed experiments; no new experiment result was available to learn from.'
  )
  WHEN 'daily_report' THEN 'Generated or refreshed the daily founder brief from current jobs, opportunities, experiments, learnings and decisions.'
  ELSE 'Job completed successfully.'
END
WHERE status = 'completed' AND result_summary IS NULL;
