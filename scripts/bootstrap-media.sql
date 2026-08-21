INSERT INTO media_assets (
  id, growth_asset_id, goal_id, media_kind, format, width, height,
  duration_seconds, provider, prompt, spec_json, status, public_id
)
SELECT
  lower(hex(randomblob(16))),
  a.id,
  a.goal_id,
  CASE WHEN a.asset_type LIKE '%video%' OR a.channel LIKE '%youtube%' THEN 'video' ELSE 'image' END,
  CASE WHEN a.asset_type LIKE '%video%' OR a.channel LIKE '%youtube%' THEN 'video/mp4' ELSE 'image/png' END,
  CASE WHEN a.asset_type LIKE '%video%' OR a.channel LIKE '%youtube%' THEN 1080 WHEN a.channel IN ('linkedin','seo') THEN 1200 ELSE 1080 END,
  CASE WHEN a.asset_type LIKE '%video%' OR a.channel LIKE '%youtube%' THEN 1920 WHEN a.channel IN ('linkedin','seo') THEN 628 ELSE 1080 END,
  CASE WHEN a.asset_type LIKE '%video%' OR a.channel LIKE '%youtube%' THEN 30 ELSE NULL END,
  'jarvis_renderer',
  'Premium editorial fashion campaign media for ClothMatics. ' || a.hook,
  json_object(
    'title', a.title,
    'hook', a.hook,
    'body', a.body,
    'cta', a.cta,
    'channel', a.channel,
    'productionNotes', a.production_notes,
    'brand', 'ClothMatics'
  ),
  'render_queued',
  lower(hex(randomblob(16)))
FROM growth_assets a
WHERE a.status = 'ready_to_publish'
  AND NOT EXISTS (
    SELECT 1 FROM media_assets m
    WHERE m.growth_asset_id = a.id AND m.status != 'deleted'
  );
