import type { OpportunityRecord, ScoutOpportunity, TodaySummary } from "@jarvis/types";
import { calculateOpportunityScore } from "@jarvis/scoring";
import { jaccardSimilarity, normalizeFingerprint } from "@jarvis/shared";

interface OpportunityRow {
  id: string;
  venture_id: string | null;
  title: string;
  summary: string;
  problem: string;
  target_user: string;
  opportunity_type: OpportunityRecord["opportunityType"];
  source: string;
  evidence_json: string;
  fingerprint: string;
  overall_score: number;
  confidence_score: number;
  status: string;
  created_at: string;
  updated_at: string;
}

function safeJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export function mapOpportunity(row: OpportunityRow): OpportunityRecord {
  return {
    id: row.id,
    ventureId: row.venture_id,
    title: row.title,
    summary: row.summary,
    problem: row.problem,
    targetUser: row.target_user,
    opportunityType: row.opportunity_type,
    source: row.source,
    evidence: safeJson(row.evidence_json, []),
    overallScore: row.overall_score,
    confidenceScore: row.confidence_score,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listOpportunities(db: D1Database, limit = 100): Promise<OpportunityRecord[]> {
  const result = await db.prepare(
    `SELECT id, venture_id, title, summary, problem, target_user, opportunity_type, source,
      evidence_json, fingerprint, overall_score, confidence_score, status, created_at, updated_at
     FROM opportunities ORDER BY overall_score DESC, created_at DESC LIMIT ?`,
  ).bind(limit).all<OpportunityRow>();
  return result.results.map(mapOpportunity);
}

export async function listActiveFounderRules(db: D1Database): Promise<string[]> {
  const result = await db.prepare(
    "SELECT rule FROM founder_rules WHERE active = 1 ORDER BY priority DESC, created_at ASC",
  ).all<{ rule: string }>();
  return result.results.map((row) => row.rule);
}

export async function listPriorOpportunityTitles(db: D1Database): Promise<string[]> {
  const result = await db.prepare(
    "SELECT title FROM opportunities ORDER BY created_at DESC LIMIT 100",
  ).all<{ title: string }>();
  return result.results.map((row) => row.title);
}

export interface StoreOpportunityResult {
  id: string;
  inserted: boolean;
  duplicateOf?: string;
}

export async function storeOpportunity(
  db: D1Database,
  opportunity: ScoutOpportunity,
  source: string,
): Promise<StoreOpportunityResult> {
  const fingerprint = normalizeFingerprint(opportunity.title, opportunity.problem, opportunity.targetUser);
  const candidates = await db.prepare(
    "SELECT id, fingerprint FROM opportunities ORDER BY created_at DESC LIMIT 250",
  ).all<{ id: string; fingerprint: string }>();
  const duplicate = candidates.results.find((row) => jaccardSimilarity(fingerprint, row.fingerprint) >= 0.82);

  if (duplicate) {
    const decisionId = crypto.randomUUID();
    await db.batch([
      db.prepare("UPDATE opportunities SET updated_at = datetime('now') WHERE id = ?").bind(duplicate.id),
      db.prepare(
        `INSERT INTO decisions (id, decision_type, subject_type, subject_id, reasoning_summary, decision, confidence)
         VALUES (?, 'deduplication', 'opportunity', ?, ?, 'merged_duplicate', 90)`,
      ).bind(decisionId, duplicate.id, `Scout candidate '${opportunity.title}' matched an existing fingerprint.`),
    ]);
    return { id: duplicate.id, inserted: false, duplicateOf: duplicate.id };
  }

  const id = crypto.randomUUID();
  const ventureId = opportunity.opportunityType.startsWith("clothmatics_") ? "venture_clothmatics" : null;
  const score = calculateOpportunityScore(opportunity.scores);
  const hasLinkedEvidence = opportunity.evidence.some((item) => item.sourceUrl !== null && item.confidence >= 50);
  const status = hasLinkedEvidence && opportunity.scores.confidence >= 60 ? "discovered" : "researching";
  const analysis = {
    alternatives: opportunity.alternatives,
    whyCouldWin: opportunity.whyCouldWin,
    discoveryPath: opportunity.discoveryPath,
    monetization: opportunity.monetization,
    biggestRisk: opportunity.biggestRisk,
    killCondition: opportunity.killCondition,
  };

  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO opportunities (
        id, venture_id, title, summary, problem, target_user, opportunity_type, source,
        fingerprint, evidence_json, analysis_json, demand_score, revenue_score, distribution_score,
        competition_score, differentiation_score, build_effort_score, zero_cost_score,
        strategic_value_score, confidence_score, overall_score, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, ventureId, opportunity.title, opportunity.summary, opportunity.problem,
      opportunity.targetUser, opportunity.opportunityType, source, fingerprint,
      JSON.stringify(opportunity.evidence), JSON.stringify(analysis),
      opportunity.scores.demand, opportunity.scores.revenue, opportunity.scores.distribution,
      opportunity.scores.competition, opportunity.scores.differentiation,
      opportunity.scores.buildEffort, opportunity.scores.zeroCost,
      opportunity.scores.strategicValue, opportunity.scores.confidence, score, status,
    ),
  ];

  for (const item of opportunity.evidence) {
    statements.push(db.prepare(
      `INSERT INTO evidence (id, opportunity_id, source_type, source_url, title, summary, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), id, item.sourceType, item.sourceUrl, item.title, item.summary, item.confidence));
  }

  await db.batch(statements);
  return { id, inserted: true };
}

export async function getTodaySummary(db: D1Database): Promise<TodaySummary> {
  const [setting, jobCounts, opportunityCounts, top, learning, resources] = await Promise.all([
    db.prepare("SELECT value FROM system_settings WHERE key = 'system_status'").first<{ value: string }>(),
    db.prepare(
      `SELECT
        SUM(CASE WHEN status = 'completed' AND date(completed_at) = date('now') THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'failed' AND date(updated_at) = date('now') THEN 1 ELSE 0 END) AS failed
       FROM jobs`,
    ).first<{ completed: number | null; failed: number | null }>(),
    db.prepare(
      `SELECT
        SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END) AS discovered,
        SUM(CASE WHEN status = 'rejected' AND date(updated_at) = date('now') THEN 1 ELSE 0 END) AS rejected,
        SUM(CASE WHEN status IN ('candidate', 'build_candidate') AND date(updated_at) = date('now') THEN 1 ELSE 0 END) AS promoted
       FROM opportunities`,
    ).first<{ discovered: number | null; rejected: number | null; promoted: number | null }>(),
    db.prepare(
      `SELECT id, venture_id, title, summary, problem, target_user, opportunity_type, source,
        evidence_json, fingerprint, overall_score, confidence_score, status, created_at, updated_at
       FROM opportunities WHERE status NOT IN ('rejected', 'archived') ORDER BY overall_score DESC LIMIT 1`,
    ).first<OpportunityRow>(),
    db.prepare("SELECT title, lesson FROM learnings WHERE active = 1 ORDER BY created_at DESC LIMIT 1")
      .first<{ title: string; lesson: string }>(),
    db.prepare("SELECT provider, enabled, free_only, notes FROM resources ORDER BY provider")
      .all<{ provider: string; enabled: number; free_only: number; notes: string | null }>(),
  ]);

  return {
    systemStatus: setting?.value === "paused" ? "paused" : "running",
    jobsCompletedToday: jobCounts?.completed ?? 0,
    jobsFailedToday: jobCounts?.failed ?? 0,
    opportunitiesDiscovered: opportunityCounts?.discovered ?? 0,
    opportunitiesRejected: opportunityCounts?.rejected ?? 0,
    opportunitiesPromoted: opportunityCounts?.promoted ?? 0,
    topOpportunity: top ? mapOpportunity(top) : null,
    latestLearning: learning ?? null,
    resources: resources.results.map((item) => ({
      provider: item.provider,
      enabled: item.enabled === 1,
      freeOnly: item.free_only === 1,
      notes: item.notes,
    })),
  };
}
