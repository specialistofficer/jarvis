import type { Env } from "../env";

export async function generateDailyReport(env: Env): Promise<{ reportId: string; created: boolean }> {
  const today = new Date().toISOString().slice(0, 10);
  const existing = await env.DB.prepare("SELECT id FROM reports WHERE report_type = 'daily' AND period_start = ? LIMIT 1")
    .bind(today).first<{ id: string }>();

  const [status, jobs, opportunities, clothmatics, experiments, learnings, decisions] = await Promise.all([
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
       WHERE venture_id = 'venture_clothmatics' ORDER BY updated_at DESC LIMIT 3`,
    ).all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT e.status, e.hypothesis, e.expected_result, e.actual_result, p.name AS project_name
       FROM experiments e JOIN projects p ON p.id = e.project_id ORDER BY COALESCE(e.completed_at, e.started_at) DESC LIMIT 10`,
    ).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT title, lesson, confidence FROM learnings WHERE active = 1 ORDER BY created_at DESC LIMIT 5")
      .all<Record<string, unknown>>(),
    env.DB.prepare("SELECT decision_type, decision, reasoning_summary, confidence FROM decisions ORDER BY created_at DESC LIMIT 8")
      .all<Record<string, unknown>>(),
  ]);

  const best = opportunities.results[0];
  const summary = best
    ? `Top current opportunity: ${String(best.title)} (score ${String(best.overall_score)}, confidence ${String(best.confidence_score)}).`
    : "No opportunity cleared our validation threshold today.";
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
