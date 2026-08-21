import { growthPackSchema } from "@jarvis/types";
import type { GrowthPack } from "@jarvis/types";
import type { Env } from "../env";
import { selectAIProvider } from "../ai/provider";
import { listActiveFounderRules } from "../db/repository";

interface GrowthGoalRow {
  id: string;
  venture_id: string | null;
  name: string;
  objective: string;
  audience: string;
  offer: string;
  primary_metric: string;
  target_value: number;
  channels_json: string;
  deadline: string | null;
}

interface SourceRecord { title: string; url: string; sourceType?: string; snippet?: string; signal?: string }

function sourceRecords(row: { content_json: string } | null): SourceRecord[] {
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.content_json) as { sources?: Array<Record<string, unknown>> };
    return (parsed.sources ?? []).map((source) => ({
      title: String(source.title ?? "Public source").slice(0, 180),
      url: String(source.url ?? ""),
      sourceType: String(source.sourceType ?? "public"),
      snippet: String(source.snippet ?? "").slice(0, 500),
      signal: String(source.signal ?? "").slice(0, 200),
    })).filter((source) => source.url.startsWith("http")).slice(0, 20);
  } catch { return []; }
}

function fallbackGrowthPack(goal: GrowthGoalRow, sources: SourceRecord[]): GrowthPack {
  return growthPackSchema.parse({
    strategySummary: `Use a measurable problem-first content campaign for ${goal.name}. The content should pitch paid software development, utility apps, and websites to generate revenue, routing qualified people to our services.`,
    targetAudience: `Founders, businesses, and creators needing technical solutions, paid apps, or utilities.`,
    messagingAngle: `Don't waste time struggling with low-quality tools. We build custom, revenue-generating paid apps and websites fast.`,
    contentPillars: [
      "Showcasing high-quality utility apps we've built",
      "Explaining the ROI of a custom software solution",
      "Highlighting how fast we can ship a paid website or MVP"
    ],
    assets: [
      {
        assetType: "social_post", channel: "LinkedIn", title: "Why your business needs a custom utility app", hook: "Stop using 5 different SaaS tools when you could have one custom app.",
        body: "Most businesses leak money paying for bloated SaaS subscriptions. We build custom utility apps and paid websites tailored exactly to your workflow. You own the product, you keep the margins.",
        cta: "Comment 'BUILD' and we'll send you a zero-cost technical roadmap for your idea.",
        productionNotes: "Create a carousel showing SaaS cost comparison vs one-time custom app cost.", sourceUrls: []
      },
      {
        assetType: "video_script", channel: "YouTube Shorts", title: "We build revenue-generating apps", hook: "Want to launch a paid app but don't know how to code?",
        body: "[0–3s] Show a person struggling with code. Voice: Building an app is hard.\n[3–12s] Show a sleek dashboard. Voice: We build paid utility apps and websites that actually generate revenue.\n[12–22s] Show a Stripe notification. Voice: From concept to launch in weeks, not months.\n[22–30s] Show our agency logo. Voice: Let us build your next digital product.",
        cta: "Link in bio to get a quote.",
        productionNotes: "Fast-paced B-roll of coding, dashboards, and money notifications. Upbeat electronic background track.", sourceUrls: []
      }
    ],
    distributionLeads: [
      { leadType: "community", name: "LinkedIn Founders Group", whyRelevant: "High concentration of people needing MVPs.", nextAction: "Share a case study of a recent app build.", sourceUrl: null }
    ],
    experiment: {
      hypothesis: "Pitching 'we build paid apps' directly will generate at least 2 qualified leads.",
      method: "Publish the LinkedIn carousel and YouTube short. Track direct inbound DMs.",
      successMetric: "2 inbound DMs asking for a quote within 7 days.", killCondition: "Zero DMs or comments."
    },
    evidenceLimits: ["No publishing connector configured.", "Attribution requires manual entry."]
  });
}

function renderGrowthPack(pack: GrowthPack): string {
  return `# ClothMatics Growth Pack\n\n## Strategy\n${pack.strategySummary}\n\n**Audience:** ${pack.targetAudience}\n\n**Message:** ${pack.messagingAngle}\n\n## Content pillars\n${pack.contentPillars.map((item) => `- ${item}`).join("\n")}\n\n## Ready-to-review assets\n${pack.assets.map((asset, index) => `### ${index + 1}. ${asset.title} — ${asset.channel}\n**Hook:** ${asset.hook}\n\n${asset.body}\n\n**CTA:** ${asset.cta}\n\n**Production:** ${asset.productionNotes}`).join("\n\n")}\n\n## Distribution leads\n${pack.distributionLeads.map((lead) => `- ${lead.name}: ${lead.whyRelevant} Next: ${lead.nextAction}`).join("\n")}\n\n## Growth experiment\n- Hypothesis: ${pack.experiment.hypothesis}\n- Method: ${pack.experiment.method}\n- Success: ${pack.experiment.successMetric}\n- Kill: ${pack.experiment.killCondition}\n\n## Limits\n${pack.evidenceLimits.map((item) => `- ${item}`).join("\n")}`;
}

export async function runGrowthPlan(env: Env, jobId: string, payload: Record<string, unknown>): Promise<{ goalId: string; assetCount: number; leadCount: number; fallback: boolean }> {
  const requestedGoalId = typeof payload.goalId === "string" ? payload.goalId : "goal_agency_v1";
  const [goal, research, rules, learnings] = await Promise.all([
    env.DB.prepare("SELECT * FROM growth_goals WHERE id = ? AND status = 'active'").bind(requestedGoalId).first<GrowthGoalRow>(),
    env.DB.prepare("SELECT content_json FROM deliverables WHERE deliverable_type = 'research_brief' ORDER BY created_at DESC LIMIT 1").first<{ content_json: string }>(),
    listActiveFounderRules(env.DB),
    env.DB.prepare("SELECT title, lesson, confidence FROM learnings WHERE active = 1 ORDER BY created_at DESC LIMIT 8").all<Record<string, unknown>>(),
  ]);
  if (!goal) throw new Error("Active growth goal not found");
  const sources = sourceRecords(research ?? null);
  const provider = selectAIProvider(env);
  const runId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO agent_runs (id, role, job_id, provider, model, prompt_version, input_summary, started_at)
     VALUES (?, 'growth_factory', ?, ?, ?, 'GROWTH_PACK_V1', ?, ?)`,
  ).bind(runId, jobId, provider.name, env.NVIDIA_MODEL, `${goal.name}; ${sources.length} source records`, new Date().toISOString()).run();

  let pack: GrowthPack;
  let fallback = false;
  let failure: string | null = null;
  try {
    const generated = await provider.generateStructured({
      system: `You are Jarvis Growth Factory. Create a small, measurable organic growth pack for the goal: ${goal.name}. Use only supplied evidence URLs; never invent facts, metrics, testimonials, product capabilities or links. Assets are drafts requiring founder approval. Do not claim they were published. Prefer useful problem-led content over generic promotion. Video output is a script/storyboard, not a generated video. All experiments must cost INR 0. Return only JSON matching the requested schema.`,
      prompt: `GROWTH GOAL:\n${JSON.stringify(goal)}\n\nFOUNDER RULES:\n${JSON.stringify(rules)}\n\nPRIOR LEARNINGS:\n${JSON.stringify(learnings.results)}\n\nALLOWED RESEARCH SOURCES:\n${JSON.stringify(sources)}\n\nTask: You must create content assets (like videos, images, and posts) pitching paid apps, utility tools, websites, and development services to generate revenue. Provide realistic production notes for videos and detailed image prompts. Return: strategySummary, targetAudience, messagingAngle, 3-5 contentPillars, 4-6 assets with assetType/channel/title/hook/body/cta/productionNotes/sourceUrls, 2-6 distributionLeads, experiment, and evidenceLimits.`,
      schema: growthPackSchema, temperature: 0.2, maxTokens: 3600,
    });
    const allowedUrls = new Set(sources.map((source) => source.url));
    const claimed = generated.data.assets.flatMap((asset) => asset.sourceUrls)
      .concat(generated.data.distributionLeads.flatMap((lead) => lead.sourceUrl ? [lead.sourceUrl] : []));
    if (claimed.some((url) => !allowedUrls.has(url))) throw new Error("Growth pack cited a URL outside the verified source set");
    pack = generated.data;
    await env.DB.prepare("UPDATE agent_runs SET output_summary = ?, tokens_or_usage = ?, completed_at = ?, success = 1 WHERE id = ?")
      .bind(pack.strategySummary.slice(0, 1200), JSON.stringify(generated.usage), new Date().toISOString(), runId).run();
  } catch (error) {
    fallback = true; failure = error instanceof Error ? error.message : String(error);
    pack = fallbackGrowthPack(goal, sources);
    await env.DB.prepare("UPDATE agent_runs SET completed_at = ?, success = 0, error = ? WHERE id = ?")
      .bind(new Date().toISOString(), failure.slice(0, 1500), runId).run();
  }

  const statements: D1PreparedStatement[] = [];
  for (const asset of pack.assets) statements.push(env.DB.prepare(
    `INSERT INTO growth_assets (id, goal_id, job_id, asset_type, channel, title, hook, body, cta, production_notes, source_urls_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
  ).bind(crypto.randomUUID(), goal.id, jobId, asset.assetType, asset.channel, asset.title, asset.hook, asset.body, asset.cta, asset.productionNotes, JSON.stringify(asset.sourceUrls)));
  for (const lead of pack.distributionLeads) statements.push(env.DB.prepare(
    `INSERT INTO growth_leads (id, goal_id, lead_type, name, source_url, why_relevant, next_action)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), goal.id, lead.leadType, lead.name, lead.sourceUrl, lead.whyRelevant, lead.nextAction));
  const projectId = crypto.randomUUID();
  const experimentId = crypto.randomUUID();
  statements.push(env.DB.prepare(
    `INSERT INTO projects (id, venture_id, name, description, status, objective, success_metric, kill_condition)
     SELECT ?, ?, ?, ?, 'active', ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM projects WHERE objective = ?)`,
  ).bind(projectId, goal.venture_id, goal.name, pack.strategySummary, `Growth goal ${goal.id}: ${goal.objective}`, pack.experiment.successMetric, pack.experiment.killCondition, `Growth goal ${goal.id}: ${goal.objective}`));
  statements.push(env.DB.prepare(
    `INSERT INTO experiments (id, project_id, hypothesis, method, success_metric, kill_condition, expected_result, status, started_at)
     SELECT ?, id, ?, ?, ?, ?, ?, 'running', datetime('now') FROM projects WHERE objective = ?
     AND NOT EXISTS (SELECT 1 FROM experiments WHERE project_id = projects.id AND status IN ('planned','running'))`,
  ).bind(experimentId, pack.experiment.hypothesis, pack.experiment.method, pack.experiment.successMetric, pack.experiment.killCondition, pack.experiment.successMetric, `Growth goal ${goal.id}: ${goal.objective}`));
  const deliverableId = crypto.randomUUID();
  statements.push(env.DB.prepare(
    `INSERT INTO deliverables (id, deliverable_type, title, status, summary, content_markdown, content_json, source_count, job_id)
     VALUES (?, 'growth_pack', 'ClothMatics Growth Pack', ?, ?, ?, ?, ?, ?)`,
  ).bind(deliverableId, fallback ? "completed_with_limits" : "completed", pack.strategySummary, renderGrowthPack(pack), JSON.stringify({ mode: fallback ? "conservative_growth_pack" : "growth_pack", pack, synthesisError: failure }), sources.length, jobId));
  statements.push(env.DB.prepare(
    `INSERT INTO jobs (id, type, priority, payload, status, scheduled_at, max_attempts)
     SELECT ?, 'growth_review', 65, ?, 'queued', datetime('now', '+24 hours'), 3
     WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE type = 'growth_review' AND status IN ('queued','running','deferred'))`,
  ).bind(crypto.randomUUID(), JSON.stringify({ goalId: goal.id, reason: "post_growth_pack_review" })));
  await env.DB.batch(statements);
  return { goalId: goal.id, assetCount: pack.assets.length, leadCount: pack.distributionLeads.length, fallback };
}

export async function runGrowthReview(env: Env, payload: Record<string, unknown>): Promise<{ goalId: string; metricRows: number; summary: string }> {
  const goalId = typeof payload.goalId === "string" ? payload.goalId : "goal_agency_v1";
  const [goal, totals, assets, metricCount] = await Promise.all([
    env.DB.prepare("SELECT * FROM growth_goals WHERE id = ?").bind(goalId).first<GrowthGoalRow>(),
    env.DB.prepare(`SELECT COALESCE(SUM(impressions),0) impressions, COALESCE(SUM(views),0) views, COALESCE(SUM(clicks),0) clicks,
      COALESCE(SUM(installs),0) installs, COALESCE(SUM(leads),0) leads, COALESCE(SUM(revenue_inr),0) revenue_inr
      FROM growth_metrics WHERE goal_id = ?`).bind(goalId).first<Record<string, number>>(),
    env.DB.prepare(`SELECT a.id, a.title, a.channel, COALESCE(SUM(m.clicks),0) clicks, COALESCE(SUM(m.installs),0) installs,
      COALESCE(SUM(m.leads),0) leads FROM growth_assets a LEFT JOIN growth_metrics m ON m.asset_id = a.id
      WHERE a.goal_id = ? AND a.status != 'deleted' GROUP BY a.id ORDER BY installs DESC, clicks DESC LIMIT 10`).bind(goalId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT COUNT(*) count FROM growth_metrics WHERE goal_id = ?").bind(goalId).first<{ count: number }>(),
  ]);
  if (!goal) throw new Error("Growth goal not found");
  const metrics = totals ?? { impressions: 0, views: 0, clicks: 0, installs: 0, leads: 0, revenue_inr: 0 };
  const rows = metricCount?.count ?? 0;
  const clickRate = Number(metrics.impressions) > 0 ? Number(metrics.clicks) / Number(metrics.impressions) * 100 : 0;
  const installRate = Number(metrics.clicks) > 0 ? Number(metrics.installs) / Number(metrics.clicks) * 100 : 0;
  const summary = rows === 0
    ? "No performance data has been recorded. Jarvis cannot claim growth, identify a winning channel, or learn until published assets have metrics."
    : `Recorded ${Number(metrics.impressions)} impressions, ${Number(metrics.clicks)} clicks, ${Number(metrics.installs)} installs, ${Number(metrics.leads)} leads and ₹${Number(metrics.revenue_inr).toFixed(0)} revenue. Click rate ${clickRate.toFixed(2)}%; click-to-install ${installRate.toFixed(2)}%.`;
  const winners = assets.results.filter((asset) => Number(asset.installs) > 0 || Number(asset.clicks) > 0).slice(0, 3);
  const recommendations = rows === 0
    ? ["Publish one approved asset with a tagged link.", "Record impressions, clicks and installs against that exact asset."]
    : winners.length ? ["Repeat the winning message once before changing channels.", "Keep attribution per asset and stop formats that miss the kill condition."]
      : ["Change the hook or distribution target before producing more volume.", "Interview responders to verify the problem behind any engagement."];
  const reviewId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO growth_reviews (id, goal_id, period_start, period_end, summary, metrics_json, winners_json, failures_json, recommendations_json)
      VALUES (?, ?, date('now','-7 days'), date('now'), ?, ?, ?, ?, ?)`)
      .bind(reviewId, goalId, summary, JSON.stringify({ ...metrics, clickRate, installRate }), JSON.stringify(winners), JSON.stringify(winners.length ? [] : ["No asset has a measured positive signal yet."]), JSON.stringify(recommendations)),
    env.DB.prepare("UPDATE growth_goals SET current_value = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(Number(metrics[goal.primary_metric] ?? 0), goalId),
  ]);
  return { goalId, metricRows: rows, summary };
}
