import { z } from "zod";
import type { Env } from "./env";
import { selectAIProvider } from "./ai/provider";
import { getTodaySummary, listActiveFounderRules, listOpportunities } from "./db/repository";
import { enqueueJob, runHeartbeat } from "./jobs/runner";

const actionTypeSchema = z.enum([
  "pause_system",
  "resume_system",
  "run_heartbeat",
  "run_scout",
  "run_growth",
  "deep_research",
  "add_rule",
]);

const assistantDecisionSchema = z.object({
  reply: z.string().min(1).max(1800),
  action: z.object({
    type: actionTypeSchema,
    summary: z.string().min(3).max(300),
    rule: z.string().min(5).max(1000).optional(),
    opportunityId: z.string().optional(),
  }).nullable(),
});

type AssistantActionType = z.infer<typeof actionTypeSchema>;
type AssistantDecision = z.infer<typeof assistantDecisionSchema>;

export interface AssistantProposal {
  id: string;
  type: AssistantActionType;
  summary: string;
  expiresAt: string;
}

interface StoredAction {
  id: string;
  action_type: AssistantActionType;
  payload: string;
  summary: string;
  status: string;
  expires_at: string;
}

async function storeMessage(db: D1Database, role: "user" | "assistant", content: string): Promise<void> {
  await db.prepare("INSERT INTO assistant_messages (id, role, content) VALUES (?, ?, ?)")
    .bind(crypto.randomUUID(), role, content.slice(0, 4000)).run();
}

function actionSummary(type: AssistantActionType, detail?: string): string {
  const labels: Record<AssistantActionType, string> = {
    pause_system: "Pause all autonomous Jarvis jobs",
    resume_system: "Resume autonomous Jarvis jobs",
    run_heartbeat: "Run one due job now",
    run_scout: "Queue a new sourced market research run",
    run_growth: "Create a ClothMatics growth pack with posts, video script, leads and an experiment",
    deep_research: `Queue deep research${detail ? ` for ${detail}` : ""}`,
    add_rule: `Add permanent founder rule${detail ? `: ${detail}` : ""}`,
  };
  return labels[type];
}

function directDecision(message: string, topOpportunity?: { id: string; title: string } | null): AssistantDecision | null {
  const normalized = message.trim().toLowerCase();
  if (/\b(pause|stop)\b.*\b(system|jarvis|automation|jobs)\b/.test(normalized)) {
    return { reply: "Main autonomous work pause kar sakta hoon. Execute karne se pehle aapki confirmation chahiye.", action: { type: "pause_system", summary: actionSummary("pause_system") } };
  }
  if (/\b(resume|start)\b.*\b(system|jarvis|automation|jobs)\b/.test(normalized)) {
    return { reply: "Main autonomous work resume kar sakta hoon. Confirm karne par change apply hoga.", action: { type: "resume_system", summary: actionSummary("resume_system") } };
  }
  if (/\b(run|execute|process)\b.*\b(next|due|heartbeat|job)\b/.test(normalized)) {
    return { reply: "Main abhi queue check karke ek due job run kar sakta hoon. Confirm karein?", action: { type: "run_heartbeat", summary: actionSummary("run_heartbeat") } };
  }
  if (/\b(run|start|find|discover)\b.*\b(scout|opportunit)/.test(normalized)) {
    return { reply: "Main AI wardrobe market par fresh sourced research queue kar sakta hoon. Isme public links, verdict aur INR 0 validation experiment milega. Confirm karein?", action: { type: "run_scout", summary: actionSummary("run_scout") } };
  }
  if (/\b(create|generate|run|start|make)\b.*\b(growth|content|posts?|video|campaign)\b/.test(normalized)) {
    return { reply: "Main ClothMatics ke liye evidence-led growth pack bana sakta hoon: social posts, YouTube Shorts script, distribution leads aur measurable experiment. Publish founder approval ke bina nahi hoga. Confirm karein?", action: { type: "run_growth", summary: actionSummary("run_growth") } };
  }
  const ruleMatch = message.match(/(?:add|save|remember)(?:\s+(?:a|this))?\s+rule\s*[:\-]?\s*(.+)/i);
  if (ruleMatch?.[1]?.trim() && ruleMatch[1].trim().length >= 5) {
    const rule = ruleMatch[1].trim();
    return { reply: "Is instruction ko permanent founder rule banane ke liye confirmation chahiye.", action: { type: "add_rule", summary: actionSummary("add_rule", rule), rule } };
  }
  if (/\b(deep research|research deeply|strategist)\b/.test(normalized) && topOpportunity) {
    return {
      reply: `Main current top opportunity “${topOpportunity.title}” par Strategist deep research queue kar sakta hoon. Confirm karein?`,
      action: { type: "deep_research", summary: actionSummary("deep_research", topOpportunity.title), opportunityId: topOpportunity.id },
    };
  }
  return null;
}

function isStatusQuestion(message: string): boolean {
  return /\b(status|update|brief|briefing|happening|scheduled|schedule|next job|kya ho|kya chal|what.*doing)\b/i.test(message);
}

function isDeliverableQuestion(message: string): boolean {
  return /\b(report|research|finding|findings|result|deliverable|source|evidence|kya mila|kya banaya|produce|created)\b/i.test(message);
}

function isGrowthQuestion(message: string): boolean {
  return /\b(growth|content|post|video|lead|campaign|install|revenue|performance)\b/i.test(message);
}

function statusReply(context: {
  status: string;
  completed: number;
  failed: number;
  queued: number;
  nextJob?: { type: string; scheduled_at: string } | null;
  top?: { title: string; overallScore: number; confidenceScore: number } | null;
}): string {
  const next = context.nextJob
    ? `Next queued work ${context.nextJob.type.replaceAll("_", " ")} hai, scheduled ${context.nextJob.scheduled_at} UTC.`
    : "Abhi koi queued job nahi hai.";
  const top = context.top
    ? `Top opportunity “${context.top.title}” hai — score ${Math.round(context.top.overallScore)}, confidence ${Math.round(context.top.confidenceScore)}%.`
    : "Abhi koi active opportunity nahi hai.";
  return `Jarvis ${context.status} hai. Aaj ${context.completed} jobs complete aur ${context.failed} failed hui; queue mein ${context.queued} jobs hain. ${next} ${top} Paid spend blocked hai.`;
}

async function createProposal(env: Env, action: NonNullable<AssistantDecision["action"]>): Promise<AssistantProposal | null> {
  const payload: Record<string, unknown> = {};
  if (action.type === "add_rule") {
    if (!action.rule) return null;
    payload.rule = action.rule;
  }
  if (action.type === "deep_research") {
    if (!action.opportunityId) return null;
    const opportunity = await env.DB.prepare("SELECT id, title, summary FROM opportunities WHERE id = ? AND status NOT IN ('rejected', 'archived')")
      .bind(action.opportunityId).first<{ id: string; title: string; summary: string }>();
    if (!opportunity) return null;
    payload.opportunityId = opportunity.id;
    payload.topic = `${opportunity.title}: ${opportunity.summary}`;
    payload.queries = [opportunity.title, "digital closet app", "wardrobe organizer"];
  }
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);
  await env.DB.prepare(
    `INSERT INTO assistant_actions (id, action_type, payload, summary, status, expires_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
  ).bind(id, action.type, JSON.stringify(payload), action.summary, expiresAt).run();
  return { id, type: action.type, summary: action.summary, expiresAt };
}

export async function assistantHistory(env: Env): Promise<Array<Record<string, unknown>>> {
  const result = await env.DB.prepare(
    "SELECT id, role, content, created_at FROM assistant_messages ORDER BY rowid DESC LIMIT 40",
  ).all<Record<string, unknown>>();
  return result.results.reverse();
}

export async function pendingAssistantProposal(env: Env): Promise<AssistantProposal | null> {
  const row = await env.DB.prepare(
    `SELECT id, action_type, summary, expires_at FROM assistant_actions
     WHERE status = 'pending' AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1`,
  ).first<{ id: string; action_type: AssistantActionType; summary: string; expires_at: string }>();
  return row ? { id: row.id, type: row.action_type, summary: row.summary, expiresAt: row.expires_at } : null;
}

export async function chatWithAssistant(env: Env, message: string): Promise<{ reply: string; proposal: AssistantProposal | null }> {
  await storeMessage(env.DB, "user", message);
  const [today, jobs, opportunities, rules, history, deliverables, latestReport, growthGoal, growthAssets, growthTotals] = await Promise.all([
    getTodaySummary(env.DB),
    env.DB.prepare(
      "SELECT type, status, scheduled_at FROM jobs WHERE status IN ('queued', 'running', 'deferred') ORDER BY scheduled_at ASC LIMIT 8",
    ).all<{ type: string; status: string; scheduled_at: string }>(),
    listOpportunities(env.DB, 8),
    listActiveFounderRules(env.DB),
    assistantHistory(env),
    env.DB.prepare("SELECT id, title, status, summary, source_count, content_json, created_at FROM deliverables ORDER BY created_at DESC LIMIT 3").all<Record<string, unknown>>(),
    env.DB.prepare("SELECT summary, content_json, created_at FROM reports ORDER BY created_at DESC LIMIT 1").first<Record<string, unknown>>(),
    env.DB.prepare("SELECT id, name, objective, primary_metric, target_value, current_value, status FROM growth_goals WHERE status = 'active' LIMIT 1").first<Record<string, unknown>>(),
    env.DB.prepare("SELECT status, COUNT(*) count FROM growth_assets GROUP BY status").all<Record<string, unknown>>(),
    env.DB.prepare("SELECT COALESCE(SUM(clicks),0) clicks, COALESCE(SUM(installs),0) installs, COALESCE(SUM(leads),0) leads, COALESCE(SUM(revenue_inr),0) revenue_inr FROM growth_metrics").first<Record<string, unknown>>(),
  ]);
  const activeJobs = jobs.results;
  const queued = activeJobs.filter((job) => job.status === "queued" || job.status === "deferred").length;
  const compactContext = {
    status: today.systemStatus,
    completedToday: today.jobsCompletedToday,
    failedToday: today.jobsFailedToday,
    queuedJobs: activeJobs,
    topOpportunity: today.topOpportunity,
    opportunities: opportunities.map((item) => ({ id: item.id, title: item.title, status: item.status, score: item.overallScore, confidence: item.confidenceScore })),
    founderRules: rules,
    paidSpendAllowed: false,
    latestDeliverables: deliverables.results,
    latestReport: latestReport ?? null,
    growth: { goal: growthGoal ?? null, assetCounts: growthAssets.results, totals: growthTotals ?? {} },
  };

  let decision = directDecision(message, today.topOpportunity ? { id: today.topOpportunity.id, title: today.topOpportunity.title } : null);
  if (!decision && isGrowthQuestion(message)) {
    const totalAssets = growthAssets.results.reduce((sum, item) => sum + Number(item.count ?? 0), 0);
    const ready = growthAssets.results.find((item) => item.status === "ready_to_publish");
    decision = growthGoal ? {
      reply: `Active growth goal “${String(growthGoal.name)}” hai. ${totalAssets} content assets created hain; ${Number(ready?.count ?? 0)} ready to publish. Recorded outcome: ${Number(growthTotals?.clicks ?? 0)} clicks, ${Number(growthTotals?.installs ?? 0)} installs, ${Number(growthTotals?.leads ?? 0)} leads aur ₹${Number(growthTotals?.revenue_inr ?? 0)} revenue. Growth page par drafts approve, copy/publish aur metrics record kar sakte hain.`,
      action: null,
    } : { reply: "Growth Engine abhi initialize nahi hua. Founder confirmation ke baad ClothMatics growth pack create kiya ja sakta hai.", action: null };
  }
  if (!decision && isDeliverableQuestion(message)) {
    const latest = deliverables.results[0];
    decision = latest ? {
      reply: `Latest deliverable “${String(latest.title)}” hai. Isme ${Number(latest.source_count ?? 0)} public sources hain. Status: ${String(latest.status)}. Result: ${String(latest.summary)} Deliverables page par findings, citations, competitors, experiment aur founder decision detail mein available hain.`,
      action: null,
    } : {
      reply: "Abhi tak koi genuine research deliverable nahi bana. Main activity ko result nahi bolunga. Aap ‘run sourced research’ bolkar first evidence-backed brief queue kar sakte hain.",
      action: null,
    };
  }
  if (!decision && isStatusQuestion(message)) {
    decision = {
      reply: statusReply({
        status: today.systemStatus,
        completed: today.jobsCompletedToday,
        failed: today.jobsFailedToday,
        queued,
        nextJob: activeJobs[0] ?? null,
        top: today.topOpportunity,
      }),
      action: null,
    };
  }

  if (!decision) {
    const provider = selectAIProvider(env);
    const runId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO agent_runs (id, role, provider, model, prompt_version, input_summary, started_at)
       VALUES (?, 'founder_assistant', ?, ?, 'assistant-v1', ?, ?)`,
    ).bind(runId, provider.name, env.NVIDIA_MODEL, message.slice(0, 500), new Date().toISOString()).run();
    try {
      const generated = await provider.generateText(
        `You are Jarvis, Chirag's concise founder operating assistant. Answer the founder's exact latest question directly; do not replace it with a generic status briefing. Speak in natural Hinglish unless the latest message uses only English. Use live context only when relevant and report only facts present there. Never claim an action happened or can be executed from this answer. System mutations are handled separately by deterministic confirmation-gated controls. If the request needs code changes, external services, deletion, spending, or unavailable data, clearly say it needs a separate implementation or founder decision. Do not output JSON or markdown code. Keep the reply under 150 words.`,
        `LATEST FOUNDER MESSAGE (answer this):\n${message}\n\nVERIFIED LIVE CONTEXT:\n${JSON.stringify(compactContext)}\n\nRECENT CONVERSATION FOR REFERENCE ONLY:\n${JSON.stringify(history.slice(-4))}`,
      );
      decision = { reply: generated.trim().slice(0, 1800), action: null };
      await env.DB.prepare(
        "UPDATE agent_runs SET output_summary = ?, completed_at = ?, success = 1 WHERE id = ?",
      ).bind(decision.reply.slice(0, 1200), new Date().toISOString(), runId).run();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await env.DB.prepare("UPDATE agent_runs SET completed_at = ?, success = 0, error = ? WHERE id = ?")
        .bind(new Date().toISOString(), reason.slice(0, 1500), runId).run();
      decision = {
        reply: `${statusReply({ status: today.systemStatus, completed: today.jobsCompletedToday, failed: today.jobsFailedToday, queued, nextJob: activeJobs[0] ?? null, top: today.topOpportunity })} General AI reply abhi unavailable hai; aap status ya supported command dobara bol sakte hain.`,
        action: null,
      };
    }
  }

  const proposal = decision.action ? await createProposal(env, decision.action) : null;
  const reply = decision.action && !proposal
    ? `${decision.reply} Is proposal ko safely validate nahi kiya ja saka, isliye koi action create nahi hua.`
    : decision.reply;
  await storeMessage(env.DB, "assistant", reply);
  return { reply, proposal };
}

export async function cancelAssistantAction(env: Env, id: string): Promise<{ message: string }> {
  const action = await env.DB.prepare("SELECT id, status FROM assistant_actions WHERE id = ?").bind(id).first<{ id: string; status: string }>();
  if (!action) throw new Error("Assistant action not found");
  if (action.status !== "pending") throw new Error(`Assistant action is already ${action.status}`);
  const cancelled = await env.DB.prepare(
    "UPDATE assistant_actions SET status = 'cancelled', result = 'Cancelled by founder' WHERE id = ? AND status = 'pending' RETURNING id",
  ).bind(id).first<{ id: string }>();
  if (!cancelled) throw new Error("Assistant action changed before it could be cancelled");
  const message = "Theek hai—action cancel kar diya. System mein koi change nahi hua.";
  await storeMessage(env.DB, "assistant", message);
  return { message };
}

export async function confirmAssistantAction(env: Env, id: string): Promise<{ message: string }> {
  const action = await env.DB.prepare(
    "SELECT id, action_type, payload, summary, status, expires_at FROM assistant_actions WHERE id = ?",
  ).bind(id).first<StoredAction>();
  if (!action) throw new Error("Assistant action not found");
  if (action.status !== "pending") throw new Error(`Assistant action is already ${action.status}`);
  if (Date.parse(`${action.expires_at.replace(" ", "T")}Z`) <= Date.now()) {
    await env.DB.prepare("UPDATE assistant_actions SET status = 'expired' WHERE id = ?").bind(id).run();
    throw new Error("Assistant action expired; please ask Jarvis again");
  }
  const acquired = await env.DB.prepare(
    "UPDATE assistant_actions SET status = 'executing', confirmed_at = datetime('now') WHERE id = ? AND status = 'pending' RETURNING id",
  ).bind(id).first<{ id: string }>();
  if (!acquired) throw new Error("Assistant action changed before it could be confirmed");
  const payload = JSON.parse(action.payload) as Record<string, unknown>;
  let message: string;
  try {
    if (action.action_type === "pause_system" || action.action_type === "resume_system") {
      const status = action.action_type === "pause_system" ? "paused" : "running";
      await env.DB.prepare(
        `INSERT INTO system_settings (key, value, updated_at) VALUES ('system_status', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).bind(status).run();
      message = `Confirmed. Jarvis autonomous system ab ${status} hai.`;
    } else if (action.action_type === "run_heartbeat") {
      const result = await runHeartbeat(env);
      message = result.processed ? "Confirmed. Ek due job process ho gayi." : "Confirmed. Queue check complete; abhi koi due job nahi thi.";
    } else if (action.action_type === "run_scout") {
      const jobId = await enqueueJob(env.DB, "research_brief", {
        reason: "founder_assistant",
        topic: "AI wardrobe and digital closet apps: user problems, competitors, monetization and zero-cost validation",
        queries: ["AI wardrobe app", "digital closet app", "wardrobe organizer"],
      }, 95);
      message = `Confirmed. Sourced research queue ho gaya (${jobId.slice(0, 8)}). Result Deliverables page par citations ke saath dikhega.`;
    } else if (action.action_type === "run_growth") {
      const goal = await env.DB.prepare("SELECT id FROM growth_goals WHERE status = 'active' ORDER BY created_at ASC LIMIT 1").first<{ id: string }>();
      if (!goal) throw new Error("No active growth goal exists");
      const jobId = await enqueueJob(env.DB, "growth_plan", { goalId: goal.id, reason: "founder_assistant" }, 100);
      message = `Confirmed. Growth Factory queue ho gaya (${jobId.slice(0, 8)}). Posts, video script, leads aur experiment Growth page par founder review ke liye aayenge.`;
    } else if (action.action_type === "deep_research") {
      const opportunityId = String(payload.opportunityId ?? "");
      if (!opportunityId) throw new Error("Deep research opportunity is missing");
      await env.DB.batch([
        env.DB.prepare("UPDATE opportunities SET status = 'researching', updated_at = datetime('now') WHERE id = ?").bind(opportunityId),
        env.DB.prepare(
          "INSERT INTO jobs (id, type, priority, payload, status, scheduled_at, max_attempts) VALUES (?, 'research_brief', 95, ?, 'queued', datetime('now'), 3)",
        ).bind(crypto.randomUUID(), JSON.stringify(payload)),
      ]);
      message = "Confirmed. Sourced deep research queue ho gaya; result Deliverables page par citations ke saath dikhega.";
    } else {
      const rule = String(payload.rule ?? "").trim();
      if (rule.length < 5) throw new Error("Founder rule is missing");
      await env.DB.prepare("INSERT INTO founder_rules (id, rule, scope, priority) VALUES (?, ?, 'global', 50)")
        .bind(crypto.randomUUID(), rule).run();
      message = "Confirmed. Permanent founder rule save ho gaya.";
    }
    await env.DB.prepare(
      "UPDATE assistant_actions SET status = 'executed', result = ?, executed_at = datetime('now') WHERE id = ?",
    ).bind(message, id).run();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(
      "UPDATE assistant_actions SET status = 'failed', result = ?, executed_at = datetime('now') WHERE id = ?",
    ).bind(reason.slice(0, 1000), id).run();
    throw error;
  }
  await storeMessage(env.DB, "assistant", message);
  return { message };
}
