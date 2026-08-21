import { opportunityActionSchema } from "@jarvis/types";
import { z } from "zod";
import type { Env } from "../env";
import { getTodaySummary, listOpportunities } from "../db/repository";
import { enqueueJob, executeJobById, runHeartbeat } from "../jobs/runner";
import { createSessionToken, founderEmail, hashPassword, validateFounderCredentials } from "../auth";
import { assistantHistory, cancelAssistantAction, chatWithAssistant, confirmAssistantAction, pendingAssistantProposal } from "../assistant";

const ruleSchema = z.object({
  rule: z.string().min(5).max(1000),
  scope: z.string().min(2).max(100).default("global"),
  priority: z.number().int().min(0).max(100).default(50),
});

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(256),
});

const assistantChatSchema = z.object({
  message: z.string().trim().min(1).max(2000),
});

const researchRequestSchema = z.object({
  topic: z.string().trim().min(10).max(300),
  opportunityId: z.string().trim().min(1).optional(),
  queries: z.array(z.string().trim().min(3).max(100)).max(5).optional(),
});

const growthStartSchema = z.object({
  goalId: z.string().trim().min(1).default("goal_clothmatics_growth_v1"),
});

const growthAssetActionSchema = z.object({
  action: z.enum(["approve", "reject", "mark_published", "delete"]),
  externalUrl: z.string().url().max(1000).optional(),
});

const growthMetricSchema = z.object({
  goalId: z.string().trim().min(1),
  assetId: z.string().trim().min(1).optional(),
  metricDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  channel: z.string().trim().min(2).max(80),
  impressions: z.number().int().nonnegative().default(0),
  views: z.number().int().nonnegative().default(0),
  clicks: z.number().int().nonnegative().default(0),
  installs: z.number().int().nonnegative().default(0),
  leads: z.number().int().nonnegative().default(0),
  revenueInr: z.number().nonnegative().default(0),
  notes: z.string().trim().max(1000).optional(),
});

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

async function parseBody(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) throw new Error("Expected application/json body");
  return request.json();
}

async function handleOpportunityAction(env: Env, id: string, request: Request): Promise<Response> {
  const input = opportunityActionSchema.parse(await parseBody(request));
  const existing = await env.DB.prepare(
    "SELECT id, venture_id, title, summary, analysis_json FROM opportunities WHERE id = ?",
  ).bind(id).first<{ id: string; venture_id: string | null; title: string; summary: string; analysis_json: string }>();
  if (!existing) return json({ error: "Opportunity not found" }, { status: 404 });

  const status = {
    promote: "candidate",
    reject: "rejected",
    deep_research: "researching",
    duplicate: "archived",
  }[input.action];
  const decisionId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      "UPDATE opportunities SET status = ?, founder_note = COALESCE(?, founder_note), updated_at = datetime('now') WHERE id = ?",
    ).bind(status, input.note ?? null, id),
    env.DB.prepare(
      `INSERT INTO decisions (id, decision_type, subject_type, subject_id, reasoning_summary, decision, confidence)
       VALUES (?, 'founder_action', 'opportunity', ?, ?, ?, 100)`,
    ).bind(decisionId, id, input.note ?? `Founder selected ${input.action}.`, input.action),
  ];

  if (input.action === "promote") {
    const analysis = JSON.parse(existing.analysis_json) as { killCondition?: string };
    statements.push(env.DB.prepare(
      `INSERT INTO projects (id, venture_id, opportunity_id, name, description, status, objective, success_metric, kill_condition)
       SELECT ?, ?, ?, ?, ?, 'proposed', ?, 'Founder must define a measurable validation metric.', ?
       WHERE NOT EXISTS (SELECT 1 FROM projects WHERE opportunity_id = ?)`,
    ).bind(
      crypto.randomUUID(), existing.venture_id, id, existing.title, existing.summary,
      `Validate: ${existing.title}`, analysis.killCondition ?? "Founder must define a kill condition.", id,
    ));
  }

  if (input.action === "deep_research") {
    statements.push(env.DB.prepare(
      `INSERT INTO jobs (id, type, priority, payload, status, scheduled_at, max_attempts)
       VALUES (?, 'research_brief', 95, ?, 'queued', datetime('now'), 3)`,
    ).bind(crypto.randomUUID(), JSON.stringify({
      opportunityId: id,
      topic: `${existing.title}: ${existing.summary}`,
      queries: [existing.title, "digital closet app", "wardrobe organizer"],
    })));
  }

  await env.DB.batch(statements);
  return json({ ok: true, id, status });
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  try {
    if (request.method === "POST" && path === "/api/auth/login") {
      const configuredEmail = founderEmail(env);
      if (!configuredEmail || !env.FOUNDER_PASSWORD_HASH || !env.SESSION_SIGNING_SECRET) {
        return json({ error: "Founder login is not configured" }, { status: 503 });
      }
      const input = loginSchema.parse(await parseBody(request));
      const identifier = await hashPassword(request.headers.get("CF-Connecting-IP") ?? "unknown");
      const attempt = await env.DB.prepare(
        "SELECT failed_count, window_started_at, blocked_until FROM login_attempts WHERE identifier_hash = ?",
      ).bind(identifier).first<{ failed_count: number; window_started_at: string; blocked_until: string | null }>();
      if (attempt?.blocked_until && Date.parse(`${attempt.blocked_until}Z`) > Date.now()) {
        return json({ error: "Too many login attempts. Try again later." }, { status: 429 });
      }

      const valid = await validateFounderCredentials(env, input.email, input.password);
      if (!valid) {
        const windowExpired = !attempt || Date.parse(`${attempt.window_started_at}Z`) < Date.now() - 15 * 60 * 1000;
        const failedCount = windowExpired ? 1 : attempt.failed_count + 1;
        const blockedUntil = failedCount >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19) : null;
        await env.DB.prepare(
          `INSERT INTO login_attempts (identifier_hash, failed_count, window_started_at, blocked_until, updated_at)
           VALUES (?, ?, datetime('now'), ?, datetime('now'))
           ON CONFLICT(identifier_hash) DO UPDATE SET
             failed_count = excluded.failed_count,
             window_started_at = CASE WHEN ? THEN datetime('now') ELSE login_attempts.window_started_at END,
             blocked_until = excluded.blocked_until,
             updated_at = datetime('now')`,
        ).bind(identifier, failedCount, blockedUntil, windowExpired ? 1 : 0).run();
        return json({ error: "Invalid email or password" }, { status: 401 });
      }

      await env.DB.prepare("DELETE FROM login_attempts WHERE identifier_hash = ?").bind(identifier).run();
      return json({ token: await createSessionToken(env, input.email), email: configuredEmail, expiresInSeconds: 604800 });
    }
    if (request.method === "GET" && path === "/api/health") {
      return json({ ok: true, service: "jarvis-api", environment: env.ENVIRONMENT, costPolicy: { allowPaidSpend: false, maxCostInr: 0 } });
    }
    if (request.method === "GET" && path === "/api/today") {
      return json(await getTodaySummary(env.DB));
    }
    if (request.method === "GET" && path === "/api/assistant/history") {
      const [messages, proposal] = await Promise.all([assistantHistory(env), pendingAssistantProposal(env)]);
      return json({ messages, proposal });
    }
    if (request.method === "POST" && path === "/api/assistant/chat") {
      const input = assistantChatSchema.parse(await parseBody(request));
      return json(await chatWithAssistant(env, input.message));
    }
    const assistantActionMatch = path.match(/^\/api\/assistant\/actions\/([^/]+)\/(confirm|cancel)$/);
    if (request.method === "POST" && assistantActionMatch?.[1] && assistantActionMatch[2]) {
      const id = decodeURIComponent(assistantActionMatch[1]);
      return json(assistantActionMatch[2] === "confirm"
        ? await confirmAssistantAction(env, id)
        : await cancelAssistantAction(env, id));
    }
    if (request.method === "GET" && path === "/api/system/overview") {
      const [settings, jobCounts, jobs, agentRuns, opportunityCounts, latestReport, latestDeliverables] = await Promise.all([
        env.DB.prepare("SELECT key, value, updated_at FROM system_settings ORDER BY key").all<Record<string, unknown>>(),
        env.DB.prepare("SELECT status, COUNT(*) AS count FROM jobs GROUP BY status").all<Record<string, unknown>>(),
        env.DB.prepare(
          `SELECT id, type, priority, status, scheduled_at, started_at, completed_at, attempt_count,
            max_attempts, last_error, result_summary, updated_at FROM jobs
           ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'deferred' THEN 2 ELSE 3 END,
             scheduled_at ASC LIMIT 100`,
        ).all<Record<string, unknown>>(),
        env.DB.prepare(
          `SELECT id, role, job_id, provider, model, prompt_version, output_summary, started_at,
            completed_at, success, error FROM agent_runs ORDER BY started_at DESC LIMIT 25`,
        ).all<Record<string, unknown>>(),
        env.DB.prepare("SELECT status, COUNT(*) AS count FROM opportunities GROUP BY status").all<Record<string, unknown>>(),
        env.DB.prepare("SELECT report_type, period_start, summary, created_at FROM reports ORDER BY created_at DESC LIMIT 1")
          .first<Record<string, unknown>>(),
        env.DB.prepare("SELECT id, deliverable_type, title, status, summary, source_count, created_at FROM deliverables ORDER BY created_at DESC LIMIT 5")
          .all<Record<string, unknown>>(),
      ]);
      const nextHeartbeat = new Date();
      nextHeartbeat.setUTCMinutes(0, 0, 0);
      nextHeartbeat.setUTCHours(nextHeartbeat.getUTCHours() + 1);
      return json({
        serverNow: new Date().toISOString(),
        timezone: "UTC",
        heartbeat: {
          cron: "0 * * * *",
          frequency: "Every hour",
          nextRunAt: nextHeartbeat.toISOString(),
          behavior: "Checks the persistent queue and processes at most one due job.",
        },
        recurringWork: [
          { type: "research_brief", name: "Sourced Market Research", cadence: "Every 24 hours after completion", purpose: "Collect public sources and produce a cited research brief with a verdict and validation experiment." },
          { type: "learning_review", name: "Learning Engine", cadence: "Every 24 hours after completion", purpose: "Compare completed experiment predictions with actual results and store reusable lessons." },
          { type: "daily_report", name: "Daily Founder Brief", cadence: "Every 24 hours after completion", purpose: "Refresh the concise executive report without using AI allowance." },
          { type: "research_opportunity", name: "Strategist Decision", cadence: "After a sourced brief is completed", purpose: "Turn cited research into a candidate, more-research, or reject decision." },
          { type: "growth_plan", name: "Growth Factory", cadence: "On founder request or a new campaign", purpose: "Create posts, a short-video script, distribution leads and a measurable experiment from evidence." },
          { type: "growth_review", name: "Growth Review", cadence: "Every 24 hours", purpose: "Compare asset metrics, identify winners or failures, and update the growth goal." },
        ],
        settings: settings.results,
        jobCounts: jobCounts.results,
        jobs: jobs.results,
        recentAgentRuns: agentRuns.results,
        opportunityCounts: opportunityCounts.results,
        latestReport: latestReport ?? null,
        latestDeliverables: latestDeliverables.results,
        provider: { name: "NVIDIA API", model: env.NVIDIA_MODEL, freeAllowanceConfirmed: env.NVIDIA_FREE_ALLOWANCE_REMAINING === "true" },
        costPolicy: { allowPaidSpend: false, maxCostInr: 0 },
      });
    }
    if (request.method === "GET" && path === "/api/opportunities") {
      return json({ opportunities: await listOpportunities(env.DB) });
    }
    if (request.method === "GET" && path === "/api/deliverables") {
      const result = await env.DB.prepare("SELECT * FROM deliverables ORDER BY created_at DESC LIMIT 50").all();
      return json({ deliverables: result.results });
    }
    if (request.method === "POST" && path === "/api/deliverables/research") {
      const input = researchRequestSchema.parse(await parseBody(request));
      if (input.opportunityId) {
        const exists = await env.DB.prepare("SELECT id FROM opportunities WHERE id = ?").bind(input.opportunityId).first();
        if (!exists) return json({ error: "Opportunity not found" }, { status: 404 });
      }
      const jobId = await enqueueJob(env.DB, "research_brief", input, 95);
      return json({ ok: true, jobId, message: "Sourced research queued. Jarvis will collect evidence before writing a verdict." }, { status: 201 });
    }
    if (request.method === "GET" && path === "/api/growth/overview") {
      const [goal, assets, leads, metrics, reviews, experiments, totals] = await Promise.all([
        env.DB.prepare("SELECT * FROM growth_goals WHERE status = 'active' ORDER BY created_at ASC LIMIT 1").first<Record<string, unknown>>(),
        env.DB.prepare("SELECT * FROM growth_assets WHERE status != 'deleted' ORDER BY created_at DESC LIMIT 60").all<Record<string, unknown>>(),
        env.DB.prepare("SELECT * FROM growth_leads ORDER BY created_at DESC LIMIT 40").all<Record<string, unknown>>(),
        env.DB.prepare("SELECT * FROM growth_metrics ORDER BY metric_date DESC, created_at DESC LIMIT 100").all<Record<string, unknown>>(),
        env.DB.prepare("SELECT * FROM growth_reviews ORDER BY created_at DESC LIMIT 12").all<Record<string, unknown>>(),
        env.DB.prepare(`SELECT e.*, p.name AS project_name FROM experiments e JOIN projects p ON p.id = e.project_id
          WHERE p.objective LIKE 'Growth goal %' ORDER BY COALESCE(e.started_at, e.completed_at) DESC LIMIT 10`).all<Record<string, unknown>>(),
        env.DB.prepare(`SELECT COALESCE(SUM(impressions),0) impressions, COALESCE(SUM(views),0) views,
          COALESCE(SUM(clicks),0) clicks, COALESCE(SUM(installs),0) installs,
          COALESCE(SUM(leads),0) leads, COALESCE(SUM(revenue_inr),0) revenue_inr FROM growth_metrics`).first<Record<string, unknown>>(),
      ]);
      return json({ goal: goal ?? null, assets: assets.results, leads: leads.results, metrics: metrics.results, reviews: reviews.results, experiments: experiments.results, totals: totals ?? {} });
    }
    if (request.method === "POST" && path === "/api/growth/start") {
      const input = growthStartSchema.parse(await parseBody(request));
      const goal = await env.DB.prepare("SELECT id FROM growth_goals WHERE id = ? AND status = 'active'").bind(input.goalId).first<{ id: string }>();
      if (!goal) return json({ error: "Active growth goal not found" }, { status: 404 });
      const jobId = await enqueueJob(env.DB, "growth_plan", { goalId: goal.id, reason: "founder_growth_hq" }, 100);
      return json({ ok: true, jobId, message: "Growth Factory queued: posts, video script, leads and experiment will be created for founder review." }, { status: 201 });
    }
    const growthAssetMatch = path.match(/^\/api\/growth\/assets\/([^/]+)\/action$/);
    if (request.method === "POST" && growthAssetMatch?.[1]) {
      const id = decodeURIComponent(growthAssetMatch[1]);
      const input = growthAssetActionSchema.parse(await parseBody(request));
      const status = input.action === "approve" ? "ready_to_publish"
        : input.action === "reject" ? "rejected"
          : input.action === "delete" ? "deleted" : "published";
      const result = await env.DB.prepare(
        `UPDATE growth_assets SET status = ?, external_url = COALESCE(?, external_url),
          published_at = CASE WHEN ? = 'published' THEN datetime('now') ELSE published_at END, updated_at = datetime('now')
         WHERE id = ? AND NOT (? = 'deleted' AND status = 'published') RETURNING id, title, status`,
      ).bind(status, input.externalUrl ?? null, status, id, status).first<Record<string, unknown>>();
      if (!result) {
        const existing = await env.DB.prepare("SELECT status FROM growth_assets WHERE id = ?").bind(id).first<{ status: string }>();
        return existing?.status === "published"
          ? json({ error: "A published asset cannot be deleted until its external post is handled." }, { status: 409 })
          : json({ error: "Growth asset not found" }, { status: 404 });
      }
      await env.DB.prepare(`INSERT INTO decisions (id, decision_type, subject_type, subject_id, reasoning_summary, decision, confidence)
        VALUES (?, 'growth_asset_action', 'growth_asset', ?, ?, ?, 100)`)
        .bind(crypto.randomUUID(), id, `Founder selected ${input.action}.`, input.action).run();
      return json({ ok: true, asset: result });
    }
    if (request.method === "POST" && path === "/api/growth/metrics") {
      const input = growthMetricSchema.parse(await parseBody(request));
      const goal = await env.DB.prepare("SELECT id FROM growth_goals WHERE id = ?").bind(input.goalId).first();
      if (!goal) return json({ error: "Growth goal not found" }, { status: 404 });
      if (input.assetId) {
        const asset = await env.DB.prepare("SELECT id FROM growth_assets WHERE id = ? AND goal_id = ?").bind(input.assetId, input.goalId).first();
        if (!asset) return json({ error: "Asset does not belong to this growth goal" }, { status: 400 });
      }
      const id = crypto.randomUUID();
      await env.DB.prepare(`INSERT INTO growth_metrics (id, goal_id, asset_id, metric_date, channel, impressions, views, clicks, installs, leads, revenue_inr, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, input.goalId, input.assetId ?? null, input.metricDate, input.channel, input.impressions, input.views, input.clicks, input.installs, input.leads, input.revenueInr, input.notes ?? null).run();
      return json({ ok: true, id }, { status: 201 });
    }
    if (request.method === "POST" && path === "/api/growth/review") {
      const input = growthStartSchema.parse(await parseBody(request));
      const jobId = await enqueueJob(env.DB, "growth_review", { goalId: input.goalId, reason: "founder_growth_review" }, 95);
      return json({ ok: true, jobId, message: "Growth performance review queued." }, { status: 201 });
    }

    const actionMatch = path.match(/^\/api\/opportunities\/([^/]+)\/action$/);
    if (request.method === "POST" && actionMatch?.[1]) {
      return handleOpportunityAction(env, decodeURIComponent(actionMatch[1]), request);
    }

    if (request.method === "GET" && path === "/api/ventures") {
      const result = await env.DB.prepare("SELECT * FROM ventures ORDER BY created_at ASC").all();
      return json({ ventures: result.results });
    }
    if (request.method === "GET" && path === "/api/projects") {
      const result = await env.DB.prepare("SELECT * FROM projects ORDER BY created_at DESC").all();
      return json({ projects: result.results });
    }
    if (request.method === "GET" && path === "/api/jobs") {
      const result = await env.DB.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100").all();
      return json({ jobs: result.results });
    }
    if (request.method === "GET" && path === "/api/learnings") {
      const result = await env.DB.prepare("SELECT * FROM learnings ORDER BY created_at DESC").all();
      return json({ learnings: result.results });
    }
    if (request.method === "GET" && path === "/api/resources") {
      const result = await env.DB.prepare("SELECT * FROM resources ORDER BY provider").all();
      return json({ resources: result.results });
    }
    if (request.method === "GET" && path === "/api/reports") {
      const result = await env.DB.prepare("SELECT * FROM reports ORDER BY created_at DESC LIMIT 100").all();
      return json({ reports: result.results });
    }
    if (request.method === "GET" && path === "/api/rules") {
      const result = await env.DB.prepare("SELECT * FROM founder_rules ORDER BY priority DESC, created_at DESC").all();
      return json({ rules: result.results });
    }
    if (request.method === "POST" && path === "/api/rules") {
      const input = ruleSchema.parse(await parseBody(request));
      const id = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO founder_rules (id, rule, scope, priority) VALUES (?, ?, ?, ?)",
      ).bind(id, input.rule, input.scope, input.priority).run();
      return json({ ok: true, id }, { status: 201 });
    }
    if (request.method === "POST" && path === "/api/system/status") {
      const input = z.object({ status: z.enum(["running", "paused"]) }).parse(await parseBody(request));
      await env.DB.prepare(
        `INSERT INTO system_settings (key, value, updated_at) VALUES ('system_status', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).bind(input.status).run();
      return json({ ok: true, status: input.status });
    }
    if (request.method === "POST" && path === "/api/system/run-heartbeat") {
      return json({ ok: true, ...(await runHeartbeat(env)) });
    }
    if (request.method === "POST" && path === "/api/dev/run-scout") {
      if (env.ENVIRONMENT === "production") return json({ error: "Not available in production" }, { status: 404 });
      if (!env.DEV_TRIGGER_TOKEN) return json({ error: "DEV_TRIGGER_TOKEN is not configured" }, { status: 503 });
      if (request.headers.get("x-dev-token") !== env.DEV_TRIGGER_TOKEN) return json({ error: "Unauthorized" }, { status: 401 });
      const jobId = await enqueueJob(env.DB, "scout", { reason: "manual_dev_trigger" }, 100);
      await executeJobById(env, jobId);
      return json({ ok: true, jobId });
    }

    return json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json({ error: "Validation failed", issues: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error(JSON.stringify({ event: "api_error", path, method: request.method, error: message }));
    return json({ error: message }, { status: 500 });
  }
}
