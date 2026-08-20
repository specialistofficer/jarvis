import { learningOutputSchema } from "@jarvis/types";
import type { Env } from "../env";
import { selectAIProvider } from "../ai/provider";
import { buildLearningPrompt, LEARNING_PROMPT_VERSION, LEARNING_SYSTEM_PROMPT } from "../ai/prompts";

export async function runLearningReview(env: Env, jobId: string): Promise<{ reviewed: number }> {
  const experiment = await env.DB.prepare(
    `SELECT e.*, p.venture_id FROM experiments e JOIN projects p ON p.id = e.project_id
     WHERE e.status = 'completed' AND e.actual_result IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM learnings l WHERE l.source_experiment_id = e.id)
     ORDER BY e.completed_at ASC LIMIT 1`,
  ).first<Record<string, unknown>>();
  if (!experiment) return { reviewed: 0 };

  const provider = selectAIProvider(env);
  const runId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO agent_runs (id, role, job_id, provider, model, prompt_version, input_summary, started_at)
     VALUES (?, 'learning', ?, ?, ?, ?, ?, ?)`,
  ).bind(runId, jobId, provider.name, env.NVIDIA_MODEL, LEARNING_PROMPT_VERSION, `Experiment ${String(experiment.id)}`, new Date().toISOString()).run();

  try {
    const generated = await provider.generateStructured({
      system: LEARNING_SYSTEM_PROMPT,
      prompt: buildLearningPrompt(experiment),
      schema: learningOutputSchema,
      temperature: 0.1,
    });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO learnings (id, category, title, observation, lesson, source_experiment_id, confidence, applies_to)
         VALUES (?, 'experiment', ?, ?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), generated.data.title, generated.data.observation, generated.data.lesson, String(experiment.id), generated.data.confidence, generated.data.appliesTo),
      env.DB.prepare("UPDATE agent_runs SET output_summary = ?, tokens_or_usage = ?, completed_at = ?, success = 1 WHERE id = ?")
        .bind(generated.data.lesson, JSON.stringify(generated.usage), new Date().toISOString(), runId),
    ]);
    return { reviewed: 1 };
  } catch (error) {
    await env.DB.prepare("UPDATE agent_runs SET completed_at = ?, success = 0, error = ? WHERE id = ?")
      .bind(new Date().toISOString(), error instanceof Error ? error.message.slice(0, 1500) : String(error).slice(0, 1500), runId).run();
    throw error;
  }
}
