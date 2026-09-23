import type { Env } from "../env";
import { selectAIProvider } from "../ai/provider";

export async function runTrendScout(env: Env, jobId: string, payload: Record<string, unknown>): Promise<{ topics: string[]; assetsCreated: number }> {
  // Fetch Google Trends RSS for India
  const response = await fetch("https://trends.google.com/trends/trendingsearches/daily/rss?geo=IN", {
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  const xml = await response.text();
  
  // Quick and dirty regex to extract titles from RSS items
  const titleRegex = /<title>([^<]+)<\/title>/g;
  let match: RegExpExecArray | null = null;
  const titles: string[] = [];
  while ((match = titleRegex.exec(xml)) !== null) {
    const matchedTitle = match[1];
    if (matchedTitle && matchedTitle !== "Daily Search Trends") {
      titles.push(matchedTitle);
    }
  }
  
  const topTopics: string[] = titles.slice(0, 3);
  if (topTopics.length === 0) throw new Error("No trending topics found");

  const goalId = typeof payload.goalId === "string" ? payload.goalId : "goal_agency_v1";
  const goal = await env.DB.prepare("SELECT * FROM growth_goals WHERE id = ?").bind(goalId).first<{ name: string; objective: string; offer: string }>();
  if (!goal) throw new Error("Goal not found");

  const provider = selectAIProvider(env);
  const prompt = `You are a viral video strategist for ${goal.name}. 
The current trending topics are: ${topTopics.join(", ")}.
Your objective is: ${goal.objective}
Your offer is: ${goal.offer}

Create 3 short-form video scripts (YouTube Shorts / TikTok) that connect these trending topics to our offer.
1. A 15-second script (fast paced, high energy hook)
2. A 30-second script (educational, storytelling)
3. A 60-second script (deep dive, strong call to action)

Format your response as valid JSON matching this schema:
{
  "videos": [
    {
      "duration": 15,
      "title": "string",
      "hook": "string",
      "script": "string (include visual cues like [0-3s] Show X)",
      "cta": "string"
    }
  ]
}
Ensure exactly 3 videos (15, 30, 60 seconds). Return ONLY valid JSON without markdown wrapping.`;

  const runId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO agent_runs (id, role, job_id, provider, model, prompt_version, input_summary, started_at)
    VALUES (?, 'trend_scout', ?, ?, ?, 'TREND_SCOUT_V1', ?, ?)`)
    .bind(runId, jobId, provider.name, env.NVIDIA_MODEL, `Trending topics: ${topTopics.join(", ")}`, new Date().toISOString()).run();

  let generatedText = "";
  try {
    generatedText = await provider.generateText(
      "You are a viral video strategist. Return ONLY valid JSON matching the requested schema without markdown wrapping.",
      prompt
    );
    if (generatedText.startsWith("\`\`\`json")) {
      generatedText = generatedText.replace(/\`\`\`json/g, "").replace(/\`\`\`/g, "").trim();
    } else if (generatedText.startsWith("\`\`\`")) {
      generatedText = generatedText.replace(/\`\`\`/g, "").trim();
    }
    
    const parsed = JSON.parse(generatedText) as { videos: any[] };
    const statements = [];
    for (const video of parsed.videos) {
      const assetId = crypto.randomUUID();
      statements.push(env.DB.prepare(
        `INSERT INTO growth_assets (id, goal_id, job_id, asset_type, channel, title, hook, body, cta, production_notes, source_urls_json, status)
         VALUES (?, ?, ?, 'youtube_short_script', 'YouTube Shorts', ?, ?, ?, ?, ?, '[]', 'draft')`
      ).bind(assetId, goalId, jobId, video.title, video.hook, video.script, video.cta, `Trend scout generated ${video.duration}s video`));
      
      statements.push(env.DB.prepare(
        `INSERT INTO jobs (id, type, priority, payload, status, scheduled_at) VALUES (?, 'media_production', 90, ?, 'queued', datetime('now'))`
      ).bind(crypto.randomUUID(), JSON.stringify({ growthAssetId: assetId })));
    }
    
    await env.DB.batch(statements);
    await env.DB.prepare("UPDATE agent_runs SET completed_at = ?, output_summary = ?, success = 1 WHERE id = ?")
      .bind(new Date().toISOString(), `Generated ${parsed.videos.length} videos from trends`, runId).run();
      
    return { topics: topTopics, assetsCreated: parsed.videos.length };
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    await env.DB.prepare("UPDATE agent_runs SET completed_at = ?, success = 0, error = ? WHERE id = ?")
      .bind(new Date().toISOString(), failure.slice(0, 1500), runId).run();
    
    const assetId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO growth_assets (id, goal_id, job_id, asset_type, channel, title, hook, body, cta, production_notes, source_urls_json, status)
         VALUES (?, ?, ?, 'youtube_short_script', 'YouTube Shorts', ?, ?, ?, ?, ?, '[]', 'draft')`
      ).bind(assetId, goalId, jobId, `Fallback 15s Video`, `Trend failed, but we still build apps!`, `[0-15s] Pitch the service directly.`, `DM us!`, `Fallback 15s video`),
      env.DB.prepare(
        `INSERT INTO jobs (id, type, priority, payload, status, scheduled_at) VALUES (?, 'media_production', 90, ?, 'queued', datetime('now'))`
      ).bind(crypto.randomUUID(), JSON.stringify({ growthAssetId: assetId }))
    ]);
    return { topics: topTopics, assetsCreated: 1 };
  }
}
