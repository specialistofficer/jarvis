import { strategistOutputSchema } from "@jarvis/types";
import type { Env } from "../env";
import { selectAIProvider } from "../ai/provider";
import { buildStrategistPrompt, STRATEGIST_PROMPT_VERSION, STRATEGIST_SYSTEM_PROMPT } from "../ai/prompts";
import { listActiveFounderRules } from "../db/repository";

export async function runStrategistJob(env: Env, jobId: string, payload: Record<string, unknown>): Promise<{ recommendation: string; rationale: string; status: string }> {
  const opportunityId = typeof payload.opportunityId === "string" ? payload.opportunityId : null;
  if (!opportunityId) throw new Error("research_opportunity job is missing opportunityId");

  const opportunity = await env.DB.prepare("SELECT * FROM opportunities WHERE id = ?")
    .bind(opportunityId).first<Record<string, unknown>>();
  if (!opportunity) throw new Error("Opportunity no longer exists");

  const deliverableId = typeof payload.deliverableId === "string" ? payload.deliverableId : null;
  const [rules, learningRows, research] = await Promise.all([
    listActiveFounderRules(env.DB),
    env.DB.prepare("SELECT title, lesson, confidence, applies_to FROM learnings WHERE active = 1 ORDER BY confidence DESC, created_at DESC LIMIT 12")
      .all<Record<string, unknown>>(),
    deliverableId
      ? env.DB.prepare("SELECT title, summary, content_json, source_count FROM deliverables WHERE id = ?").bind(deliverableId).first<Record<string, unknown>>()
      : env.DB.prepare("SELECT title, summary, content_json, source_count FROM deliverables WHERE related_opportunity_id = ? ORDER BY created_at DESC LIMIT 1").bind(opportunityId).first<Record<string, unknown>>(),
  ]);
  const provider = selectAIProvider(env);
  const runId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO agent_runs (id, role, job_id, provider, model, prompt_version, input_summary, started_at)
     VALUES (?, 'strategist', ?, ?, ?, ?, ?, ?)`,
  ).bind(
    runId, jobId, provider.name, env.NVIDIA_MODEL, STRATEGIST_PROMPT_VERSION,
    `Opportunity ${opportunityId}; ${rules.length} rules; ${learningRows.results.length} learnings`, new Date().toISOString(),
  ).run();

  try {
    const generated = await provider.generateStructured({
      system: STRATEGIST_SYSTEM_PROMPT,
      prompt: buildStrategistPrompt(opportunity, rules, learningRows.results, research ?? null),
      schema: strategistOutputSchema,
      temperature: 0.1,
    });
    const status = generated.data.recommendation === "candidate"
      ? "candidate"
      : generated.data.recommendation === "reject" ? "rejected" : "researching";
    const decisionId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const experimentId = crypto.randomUUID();
    const statements: D1PreparedStatement[] = [
      env.DB.prepare("UPDATE opportunities SET status = ?, confidence_score = MIN(confidence_score, ?), updated_at = datetime('now') WHERE id = ?")
        .bind(status, generated.data.confidence, opportunityId),
      env.DB.prepare(
        `INSERT INTO decisions (id, decision_type, subject_type, subject_id, reasoning_summary, decision, confidence)
         VALUES (?, 'strategist_evaluation', 'opportunity', ?, ?, ?, ?)`,
      ).bind(decisionId, opportunityId, generated.data.rationale, generated.data.recommendation, generated.data.confidence),
      env.DB.prepare(
        "UPDATE agent_runs SET output_summary = ?, tokens_or_usage = ?, completed_at = ?, success = 1 WHERE id = ?",
      ).bind(`${generated.data.recommendation}: ${generated.data.rationale}`.slice(0, 1200), JSON.stringify(generated.usage), new Date().toISOString(), runId),
    ];

    if (generated.data.recommendation === "candidate") {
      statements.push(env.DB.prepare(
        `INSERT INTO projects (id, venture_id, opportunity_id, name, description, status, objective, success_metric, kill_condition)
         SELECT ?, venture_id, id, title, summary, 'proposed', ?, ?, ? FROM opportunities
         WHERE id = ? AND NOT EXISTS (SELECT 1 FROM projects WHERE opportunity_id = ?)`,
      ).bind(projectId, generated.data.validationExperiment.hypothesis, generated.data.validationExperiment.successMetric, generated.data.validationExperiment.killCondition, opportunityId, opportunityId));
      statements.push(env.DB.prepare(
        `INSERT INTO experiments (id, project_id, hypothesis, method, success_metric, kill_condition, expected_result, status)
         SELECT ?, id, ?, ?, ?, ?, ?, 'planned' FROM projects WHERE opportunity_id = ?
         AND NOT EXISTS (SELECT 1 FROM experiments WHERE project_id = projects.id AND status IN ('planned', 'running'))`,
      ).bind(experimentId, generated.data.validationExperiment.hypothesis, generated.data.validationExperiment.method, generated.data.validationExperiment.successMetric, generated.data.validationExperiment.killCondition, generated.data.validationExperiment.successMetric, opportunityId));
    }
    await env.DB.batch(statements);
    return { recommendation: generated.data.recommendation, rationale: generated.data.rationale, status };
  } catch (error) {
    await env.DB.prepare("UPDATE agent_runs SET completed_at = ?, success = 0, error = ? WHERE id = ?")
      .bind(new Date().toISOString(), error instanceof Error ? error.message.slice(0, 1500) : String(error).slice(0, 1500), runId).run();
    throw error;
  }
}
