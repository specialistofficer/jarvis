import type { Env } from "../env";
import { DeferredJobError } from "../errors";
import { runScoutJob } from "./scout";
import { runStrategistJob } from "./strategist";
import { runLearningReview } from "./learning";
import { generateDailyReport } from "./report";
import { runResearchBrief } from "./research";

interface JobRow {
  id: string;
  type: string;
  payload: string;
  attempt_count: number;
  max_attempts: number;
}

export async function enqueueJob(
  db: D1Database,
  type: string,
  payload: Record<string, unknown> = {},
  priority = 50,
  scheduledAt = new Date(),
): Promise<string> {
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO jobs (id, type, priority, payload, status, scheduled_at, max_attempts)
     VALUES (?, ?, ?, ?, 'queued', ?, 3)`,
  ).bind(id, type, priority, JSON.stringify(payload), scheduledAt.toISOString()).run();
  return id;
}

async function acquireDueJob(db: D1Database): Promise<JobRow | null> {
  return db.prepare(
    `UPDATE jobs SET status = 'running', started_at = datetime('now'), locked_at = datetime('now'),
      attempt_count = attempt_count + 1, updated_at = datetime('now')
     WHERE id = (
       SELECT id FROM jobs WHERE status = 'queued' AND scheduled_at <= datetime('now')
       ORDER BY priority DESC, scheduled_at ASC LIMIT 1
     ) AND status = 'queued'
     RETURNING id, type, payload, attempt_count, max_attempts`,
  ).first<JobRow>();
}

export async function executeJobById(env: Env, id: string): Promise<void> {
  const job = await env.DB.prepare(
    `UPDATE jobs SET status = 'running', started_at = datetime('now'), locked_at = datetime('now'),
      attempt_count = attempt_count + 1, updated_at = datetime('now')
     WHERE id = ? AND status = 'queued'
     RETURNING id, type, payload, attempt_count, max_attempts`,
  ).bind(id).first<JobRow>();
  if (!job) throw new Error("Job could not be acquired");
  await executeAcquiredJob(env, job);
}

async function executeAcquiredJob(env: Env, job: JobRow): Promise<void> {
  const start = Date.now();
  try {
    const payload = JSON.parse(job.payload) as Record<string, unknown>;
    let resultSummary: string;
    if (job.type === "scout") {
      const result = await runScoutJob(env, job.id);
      resultSummary = `Scanned for opportunities: saved ${result.inserted} new and skipped ${result.duplicates} duplicate${result.duplicates === 1 ? "" : "s"}.`;
    } else if (job.type === "research_brief") {
      const result = await runResearchBrief(env, job.id, payload);
      resultSummary = `Created “${result.title}” from ${result.sourceCount} public sources. Verdict: ${result.verdict.replaceAll("_", " ")}.`;
    } else if (job.type === "research_opportunity") {
      const result = await runStrategistJob(env, job.id, payload);
      resultSummary = `Strategist recommendation: ${result.recommendation.replaceAll("_", " ")}. ${result.rationale}`;
    } else if (job.type === "learning_review") {
      const result = await runLearningReview(env, job.id);
      resultSummary = result.reviewed > 0
        ? `Reviewed ${result.reviewed} completed experiment and saved a reusable learning.`
        : "Checked completed experiments; no new experiment result was available to learn from.";
    } else if (job.type === "daily_report") {
      const result = await generateDailyReport(env);
      resultSummary = result.created
        ? "Created today's founder brief from current jobs, opportunities, experiments, learnings and decisions."
        : "Refreshed today's founder brief with the latest operating data.";
    }
    else throw new Error(`Unknown job type: ${job.type}`);

    await env.DB.prepare(
      "UPDATE jobs SET status = 'completed', result_summary = ?, completed_at = datetime('now'), last_error = NULL, updated_at = datetime('now') WHERE id = ?",
    ).bind(resultSummary, job.id).run();
    await scheduleNextRecurringJob(env.DB, job.type, job.id, payload);
    console.log(JSON.stringify({ event: "job_complete", jobId: job.id, type: job.type, durationMs: Date.now() - start, success: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof DeferredJobError) {
      await env.DB.prepare(
        `UPDATE jobs SET status = 'deferred', scheduled_at = datetime('now', '+1 hour'),
          attempt_count = MAX(attempt_count - 1, 0), last_error = ?, updated_at = datetime('now') WHERE id = ?`,
      ).bind(message.slice(0, 1500), job.id).run();
    } else if (job.attempt_count < job.max_attempts) {
      const delayMinutes = Math.min(60, 5 * 2 ** Math.max(0, job.attempt_count - 1));
      await env.DB.prepare(
        `UPDATE jobs SET status = 'queued', scheduled_at = datetime('now', ?), last_error = ?, updated_at = datetime('now') WHERE id = ?`,
      ).bind(`+${delayMinutes} minutes`, message.slice(0, 1500), job.id).run();
    } else {
      await env.DB.prepare(
        "UPDATE jobs SET status = 'failed', last_error = ?, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      ).bind(message.slice(0, 1500), job.id).run();
    }
    console.error(JSON.stringify({ event: "job_complete", jobId: job.id, type: job.type, durationMs: Date.now() - start, success: false, error: message }));
    throw error;
  }
}

async function scheduleNextRecurringJob(db: D1Database, completedType: string, completedId: string, originalPayload: Record<string, unknown>): Promise<void> {
  const recurring: Record<string, { priority: number; reason: string }> = {
    research_brief: { priority: 70, reason: "daily_sourced_research" },
    learning_review: { priority: 55, reason: "daily_learning_review" },
    daily_report: { priority: 45, reason: "daily_report" },
  };
  const config = recurring[completedType];
  if (!config) return;
  await db.prepare(
    `INSERT INTO jobs (id, type, priority, payload, status, scheduled_at, max_attempts)
     SELECT ?, ?, ?, ?, 'queued', datetime('now', '+24 hours'), 3
     WHERE NOT EXISTS (
       SELECT 1 FROM jobs WHERE type = ? AND status IN ('queued', 'running', 'deferred') AND id <> ?
     )`,
  ).bind(
    crypto.randomUUID(), completedType, config.priority,
    JSON.stringify(completedType === "research_brief" ? { ...originalPayload, reason: config.reason } : { reason: config.reason }),
    completedType, completedId,
  ).run();
}

export async function runHeartbeat(env: Env): Promise<{ processed: boolean }> {
  const setting = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'system_status'")
    .first<{ value: string }>();
  if (setting?.value === "paused") return { processed: false };

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE jobs SET status = 'queued', scheduled_at = datetime('now'), locked_at = NULL,
        last_error = 'Recovered stale running lease', updated_at = datetime('now')
       WHERE status = 'running' AND locked_at <= datetime('now', '-10 minutes')`,
    ),
    env.DB.prepare(
      `UPDATE agent_runs SET completed_at = datetime('now'), error = 'Worker ended before the provider returned'
       WHERE success = 0 AND completed_at IS NULL AND datetime(started_at) <= datetime('now', '-10 minutes')`,
    ),
  ]);
  await env.DB.prepare(
    `UPDATE jobs SET status = 'queued', updated_at = datetime('now')
     WHERE status = 'deferred' AND scheduled_at <= datetime('now')`,
  ).run();
  const job = await acquireDueJob(env.DB);
  if (!job) return { processed: false };
  try {
    await executeAcquiredJob(env, job);
  } catch (error) {
    if (!(error instanceof DeferredJobError)) throw error;
  }
  return { processed: true };
}
