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
  const citations = sources.slice(0, 2).map((source) => source.url);
  const leadSources = sources.slice(0, 4);
  while (leadSources.length < 2) leadSources.push({ title: `Direct ${goal.audience} interview target`, url: "" });
  return growthPackSchema.parse({
    strategySummary: `Use a measurable problem-first content campaign for ${goal.name}. The content should help the target audience make one better wardrobe decision, route qualified people to ClothMatics, and treat clicks or installs—not post volume—as the outcome. Begin with manual publishing so each channel can be validated before any connector is authorized.`,
    targetAudience: goal.audience,
    messagingAngle: `Your wardrobe already contains useful answers; ClothMatics should help people see and act on them instead of pushing generic fashion inspiration.`,
    contentPillars: [
      "Practical wardrobe decisions people can test immediately",
      "Common closet mistakes and their measurable cost",
      "Behind-the-scenes evidence from building a useful wardrobe assistant",
    ],
    assets: [
      {
        assetType: "instagram_post", channel: "instagram", title: "The hidden cost of a full wardrobe",
        hook: "A full wardrobe can still leave you feeling like you have nothing to wear.",
        body: "The problem is often not the number of clothes. It is that you cannot see which pieces work together, which ones repeat the same job, and what is actually missing. Before buying anything this week, pick ten items you wear most and list the outfits they already create. ClothMatics is being built to make that decision easier using your own wardrobe—not generic trend advice.",
        cta: "Comment with the wardrobe decision that wastes the most time for you, or try ClothMatics when the founder adds the verified app link.",
        productionNotes: "Create a five-slide carousel: problem, duplicate-use example, ten-item exercise, expected insight, ClothMatics CTA. Use an original screen recording or simple text graphics.", sourceUrls: citations,
      },
      {
        assetType: "linkedin_post", channel: "linkedin", title: "We are validating the decision before the AI",
        hook: "Most wardrobe apps start with features. We are starting with a repeated decision.",
        body: "For ClothMatics, the important question is not whether AI can recognize clothes. It is whether people repeatedly need help deciding what to wear, what they already own, or what not to buy. Our next experiment is deliberately small: ten qualified users, one narrow wardrobe decision, and a seven-day repeat-use measure. If the behavior does not repeat, the feature does not deserve to be built.",
        cta: "If you actively organize your wardrobe and are willing to test one workflow, reply with the decision you repeat most often.",
        productionNotes: "Publish as a founder build-in-public post. Keep the experiment numbers visible and avoid unsupported market-size claims.", sourceUrls: citations,
      },
      {
        assetType: "x_thread", channel: "x", title: "Five-post wardrobe validation thread",
        hook: "We are not building another generic AI closet app.",
        body: "1/ We are testing one question: which wardrobe decision do people repeat often enough to need help?\n\n2/ Possible answers: what to wear, what matches, what is missing, or what not to buy.\n\n3/ Feature excitement is not demand. Repeat behavior is.\n\n4/ So our test is ten target users and one manually delivered outcome.\n\n5/ If fewer than two repeat it in seven days, we change the problem—not the marketing story.",
        cta: "Reply with the last wardrobe decision that took you more than five minutes.",
        productionNotes: "Post manually as a numbered thread. Record replies by problem category in Jarvis metrics notes.", sourceUrls: citations,
      },
      {
        assetType: "youtube_short_script", channel: "youtube_shorts", title: "Why more clothes do not solve nothing-to-wear",
        hook: "If your wardrobe is full but you still have nothing to wear, buying more may be the wrong fix.",
        body: "[0–3s] Show an overfilled wardrobe. Voice: A full closet can still create zero clear outfits.\n[3–12s] Show ten frequently worn items. Voice: Pick the ten pieces you actually wear and count how many outfits they create.\n[12–22s] Show duplicates or isolated pieces. Voice: The gap is often visibility, not inventory.\n[22–30s] Show ClothMatics concept screen. Voice: We are building ClothMatics to help you understand your own wardrobe before you buy more.",
        cta: "Comment ‘wardrobe’ with the decision you want the app to solve first.",
        productionNotes: "9:16 vertical, 30 seconds, captions on every line. This is a script/storyboard; founder records or generates the video manually before publishing.", sourceUrls: citations,
      },
      {
        assetType: "blog_brief", channel: "seo", title: "Digital wardrobe audit before buying clothes",
        hook: "A practical, evidence-led guide to finding wardrobe gaps without buying first.",
        body: "Outline: define a wardrobe gap; inventory by real-life routine; identify duplicates; build outfit combinations from frequently worn items; list true missing functions; run a seven-day no-buy test; explain how a digital wardrobe can reduce decision friction. Include a transparent ClothMatics validation section and invite readers to test one workflow.",
        cta: "Join the ClothMatics validation group or use the verified product link once configured.",
        productionNotes: "Target problem-intent queries, not broad fashion volume. Add original examples and screenshots before publishing.", sourceUrls: citations,
      },
    ],
    distributionLeads: leadSources.map((source, index) => ({
      leadType: index < 2 ? "customer_signal" : "community",
      name: source.title.slice(0, 180), sourceUrl: source.url || null,
      whyRelevant: source.url ? "This public record appeared in the sourced wardrobe-market scan and may reveal an existing user, builder, product, or discussion connected to the problem." : "A direct interview target is needed because public research alone cannot validate repeat usage.",
      nextAction: source.url ? "Review the source manually, identify the relevant person or community, and record a specific non-spam outreach hypothesis before contact." : "Recruit one opted-in target user and ask about the last three real wardrobe decisions.",
    })),
    experiment: {
      hypothesis: "Problem-first organic content will produce at least ten qualified responses or product-link clicks before thirty posts are published.",
      method: "Publish the approved assets manually across selected channels, use one consistent tagged product link, and record impressions, clicks, installs, leads and revenue by asset in Jarvis.",
      successMetric: "At least ten qualified responses or clicks and at least three attributed installs from the first five approved assets.",
      killCondition: "Change the message or channel if five published assets generate fewer than three qualified responses or clicks and zero installs.",
    },
    evidenceLimits: ["Public market records do not prove ClothMatics conversion or retention.", "No publishing or product analytics connector is configured, so attribution requires founder-entered metrics.", "Draft assets must be reviewed for product accuracy and platform policy before publishing."],
  });
}

function renderGrowthPack(pack: GrowthPack): string {
  return `# ClothMatics Growth Pack\n\n## Strategy\n${pack.strategySummary}\n\n**Audience:** ${pack.targetAudience}\n\n**Message:** ${pack.messagingAngle}\n\n## Content pillars\n${pack.contentPillars.map((item) => `- ${item}`).join("\n")}\n\n## Ready-to-review assets\n${pack.assets.map((asset, index) => `### ${index + 1}. ${asset.title} — ${asset.channel}\n**Hook:** ${asset.hook}\n\n${asset.body}\n\n**CTA:** ${asset.cta}\n\n**Production:** ${asset.productionNotes}`).join("\n\n")}\n\n## Distribution leads\n${pack.distributionLeads.map((lead) => `- ${lead.name}: ${lead.whyRelevant} Next: ${lead.nextAction}`).join("\n")}\n\n## Growth experiment\n- Hypothesis: ${pack.experiment.hypothesis}\n- Method: ${pack.experiment.method}\n- Success: ${pack.experiment.successMetric}\n- Kill: ${pack.experiment.killCondition}\n\n## Limits\n${pack.evidenceLimits.map((item) => `- ${item}`).join("\n")}`;
}

export async function runGrowthPlan(env: Env, jobId: string, payload: Record<string, unknown>): Promise<{ goalId: string; assetCount: number; leadCount: number; fallback: boolean }> {
  const requestedGoalId = typeof payload.goalId === "string" ? payload.goalId : "goal_clothmatics_growth_v1";
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
      system: "You are Jarvis Growth Factory. Create a small, measurable organic growth pack for ClothMatics. Use only supplied evidence URLs; never invent facts, metrics, testimonials, product capabilities or links. Assets are drafts requiring founder approval. Do not claim they were published. Prefer useful problem-led content over generic promotion. Video output is a script/storyboard, not a generated video. All experiments must cost INR 0. Return only JSON matching the requested schema.",
      prompt: `GROWTH GOAL:\n${JSON.stringify(goal)}\n\nFOUNDER RULES:\n${JSON.stringify(rules)}\n\nPRIOR LEARNINGS:\n${JSON.stringify(learnings.results)}\n\nALLOWED RESEARCH SOURCES:\n${JSON.stringify(sources)}\n\nReturn: strategySummary, targetAudience, messagingAngle, 3-5 contentPillars, 4-6 assets with assetType/channel/title/hook/body/cta/productionNotes/sourceUrls, 2-6 distributionLeads, experiment, and evidenceLimits. Create at least one YouTube short script and one social post.`,
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
  const goalId = typeof payload.goalId === "string" ? payload.goalId : "goal_clothmatics_growth_v1";
  const [goal, totals, assets, metricCount] = await Promise.all([
    env.DB.prepare("SELECT * FROM growth_goals WHERE id = ?").bind(goalId).first<GrowthGoalRow>(),
    env.DB.prepare(`SELECT COALESCE(SUM(impressions),0) impressions, COALESCE(SUM(views),0) views, COALESCE(SUM(clicks),0) clicks,
      COALESCE(SUM(installs),0) installs, COALESCE(SUM(leads),0) leads, COALESCE(SUM(revenue_inr),0) revenue_inr
      FROM growth_metrics WHERE goal_id = ?`).bind(goalId).first<Record<string, number>>(),
    env.DB.prepare(`SELECT a.id, a.title, a.channel, COALESCE(SUM(m.clicks),0) clicks, COALESCE(SUM(m.installs),0) installs,
      COALESCE(SUM(m.leads),0) leads FROM growth_assets a LEFT JOIN growth_metrics m ON m.asset_id = a.id
      WHERE a.goal_id = ? GROUP BY a.id ORDER BY installs DESC, clicks DESC LIMIT 10`).bind(goalId).all<Record<string, unknown>>(),
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
