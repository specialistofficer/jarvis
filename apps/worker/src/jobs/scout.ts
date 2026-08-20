import { scoutOutputSchema } from "@jarvis/types";
import type { Env } from "../env";
import { selectAIProvider } from "../ai/provider";
import { buildScoutPrompt, SCOUT_PROMPT_VERSION, SCOUT_SYSTEM_PROMPT } from "../ai/prompts";
import { listActiveFounderRules, listPriorOpportunityTitles, storeOpportunity } from "../db/repository";

export async function runScoutJob(env: Env, jobId: string): Promise<{ inserted: number; duplicates: number }> {
  const provider = selectAIProvider(env);
  const [founderRules, priorTitles] = await Promise.all([
    listActiveFounderRules(env.DB),
    listPriorOpportunityTitles(env.DB),
  ]);
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO agent_runs
      (id, role, job_id, provider, model, prompt_version, input_summary, started_at)
     VALUES (?, 'scout', ?, ?, ?, ?, ?, ?)`,
  ).bind(
    runId, jobId, provider.name, env.NVIDIA_MODEL, SCOUT_PROMPT_VERSION,
    `${founderRules.length} founder rules; ${priorTitles.length} prior opportunities`, startedAt,
  ).run();

  try {
    const generated = await provider.generateStructured({
      system: SCOUT_SYSTEM_PROMPT,
      prompt: buildScoutPrompt(founderRules, priorTitles),
      schema: scoutOutputSchema,
      temperature: 0.2,
    });
    let inserted = 0;
    let duplicates = 0;
    for (const opportunity of generated.data.opportunities) {
      const result = await storeOpportunity(env.DB, opportunity, `${provider.name}:${generated.model}`);
      if (result.inserted) inserted += 1;
      else duplicates += 1;
    }

    await env.DB.prepare(
      `UPDATE agent_runs SET output_summary = ?, tokens_or_usage = ?, completed_at = ?, success = 1 WHERE id = ?`,
    ).bind(
      `${inserted} inserted; ${duplicates} duplicates`, JSON.stringify(generated.usage),
      new Date().toISOString(), runId,
    ).run();
    console.log(JSON.stringify({ event: "agent_run", jobId, role: "scout", provider: provider.name, success: true, inserted, duplicates }));
    return { inserted, duplicates };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(
      "UPDATE agent_runs SET completed_at = ?, success = 0, error = ? WHERE id = ?",
    ).bind(new Date().toISOString(), message.slice(0, 1500), runId).run();
    console.error(JSON.stringify({ event: "agent_run", jobId, role: "scout", provider: provider.name, success: false, error: message }));
    throw error;
  }
}
