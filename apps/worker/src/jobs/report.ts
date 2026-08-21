import type { Env } from "../env";

export async function generateDailyReport(env: Env): Promise<{ reportId: string; created: boolean }> {
  const today = new Date().toISOString().slice(0, 10);
  const existing = await env.DB.prepare("SELECT id FROM reports WHERE report_type = 'daily' AND period_start = ? LIMIT 1")
    .bind(today).first<{ id: string }>();

  const [status, jobs, opportunities, clothmatics, experiments, learnings, decisions, deliverables, growthGoal, growthAssets, growthTotals, growthReview] = await Promise.all([
    env.DB.prepare("SELECT value FROM system_settings WHERE key = 'system_status'").first<{ value: string }>(),
    env.DB.prepare(
      `SELECT status, COUNT(*) AS count FROM jobs WHERE date(updated_at) = date('now') GROUP BY status`,
    ).all<{ status: string; count: number }>(),
    env.DB.prepare(
      `SELECT id, title, summary, overall_score, confidence_score, status FROM opportunities
       WHERE status NOT IN ('rejected', 'archived') ORDER BY overall_score DESC LIMIT 5`,
    ).all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT title, summary, overall_score, confidence_score, status FROM opportunities
       WHERE venture_id = 'venture_tech_agency' ORDER BY updated_at DESC LIMIT 3`,
    ).all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT e.status, e.hypothesis, e.expected_result, e.actual_result, p.name AS project_name
       FROM experiments e JOIN projects p ON p.id = e.project_id ORDER BY COALESCE(e.completed_at, e.started_at) DESC LIMIT 10`,
    ).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT title, lesson, confidence FROM learnings WHERE active = 1 ORDER BY created_at DESC LIMIT 5")
      .all<Record<string, unknown>>(),
    env.DB.prepare("SELECT decision_type, decision, reasoning_summary, confidence FROM decisions ORDER BY created_at DESC LIMIT 8")
      .all<Record<string, unknown>>(),
    env.DB.prepare(
      "SELECT id, deliverable_type, title, status, summary, source_count, created_at FROM deliverables ORDER BY created_at DESC LIMIT 5",
    ).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT name, objective, primary_metric, target_value, current_value, status FROM growth_goals WHERE status = 'active' LIMIT 1").first<Record<string, unknown>>(),
    env.DB.prepare("SELECT status, COUNT(*) count FROM growth_assets WHERE status != 'deleted' GROUP BY status").all<Record<string, unknown>>(),
    env.DB.prepare("SELECT COALESCE(SUM(impressions),0) impressions, COALESCE(SUM(clicks),0) clicks, COALESCE(SUM(installs),0) installs, COALESCE(SUM(leads),0) leads, COALESCE(SUM(revenue_inr),0) revenue_inr FROM growth_metrics").first<Record<string, unknown>>(),
    env.DB.prepare("SELECT summary, recommendations_json, created_at FROM growth_reviews ORDER BY created_at DESC LIMIT 1").first<Record<string, unknown>>(),
  ]);

  const best = opportunities.results[0];
  const latestDeliverable = deliverables.results[0];
  const summary = latestDeliverable
    ? `Latest useful output: ${String(latestDeliverable.title)} — ${String(latestDeliverable.summary)}`
    : best
      ? `No sourced deliverable yet. Top unvalidated opportunity: ${String(best.title)} (score ${String(best.overall_score)}, confidence ${String(best.confidence_score)}).`
      : "No sourced deliverable or validated opportunity exists yet.";
  const content = {
    title: "JARVIS DAILY BRIEF",
    date: today,
    systemStatus: status?.value ?? "unknown",
    workCompleted: jobs.results,
    bestOpportunities: opportunities.results,
    clothmatics: clothmatics.results,
    experiments: experiments.results,
    whatWeLearned: learnings.results,
    whatChangedInOurThinking: decisions.results,
    latestDeliverables: deliverables.results,
    growthEngine: { goal: growthGoal ?? null, assetCounts: growthAssets.results, totals: growthTotals ?? {}, latestReview: growthReview ?? null },
    recommendedNextActions: best
      ? ["Close the highest-impact evidence gap before promotion.", "Prefer a measurable INR 0 validation experiment."]
      : ["Continue focused evidence collection; do not generate filler ideas."],
    needsFounderDecision: opportunities.results.filter((item) => item.status === "candidate"),
  };
  if (existing) {
    await env.DB.prepare(
      "UPDATE reports SET period_end = ?, content_json = ?, summary = ?, created_at = datetime('now') WHERE id = ?",
    ).bind(today, JSON.stringify(content), summary, existing.id).run();
    return { reportId: existing.id, created: false };
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO reports (id, report_type, period_start, period_end, content_json, summary)
     VALUES (?, 'daily', ?, ?, ?, ?)`,
  ).bind(id, today, today, JSON.stringify(content), summary).run();
  return { reportId: id, created: true };
}
