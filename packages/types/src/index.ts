import { z } from "zod";

export const opportunityTypes = [
  "clothmatics_feature",
  "clothmatics_growth",
  "paid_feature",
  "standalone_tool",
  "web_utility",
  "mobile_app",
  "micro_saas",
  "developer_tool",
  "browser_extension",
  "ai_utility",
  "productivity_tool",
  "calculator",
  "generator",
  "seo_asset",
  "content_property",
  "youtube_opportunity",
  "digital_product",
  "api_service",
  "b2b_utility",
  "other",
] as const;

const score = z.number().min(0).max(100);

export const scoutOpportunitySchema = z.object({
  title: z.string().min(8).max(140),
  summary: z.string().min(30).max(800),
  problem: z.string().min(30).max(1200),
  targetUser: z.string().min(10).max(400),
  opportunityType: z.enum(opportunityTypes),
  evidence: z.array(z.object({
    sourceType: z.string().min(2).max(80),
    sourceUrl: z.string().url().nullable(),
    title: z.string().min(4).max(240),
    summary: z.string().min(20).max(1000),
    confidence: score,
  })).min(1).max(8),
  alternatives: z.string().min(15).max(700),
  whyCouldWin: z.string().min(15).max(700),
  discoveryPath: z.string().min(15).max(700),
  monetization: z.string().min(15).max(700),
  biggestRisk: z.string().min(15).max(700),
  killCondition: z.string().min(15).max(700),
  scores: z.object({
    demand: score,
    revenue: score,
    distribution: score,
    competition: score,
    differentiation: score,
    buildEffort: score,
    zeroCost: score,
    strategicValue: score,
    confidence: score,
  }),
});

export const scoutOutputSchema = z.object({
  opportunities: z.array(scoutOpportunitySchema).min(1).max(4),
});

export const strategistOutputSchema = z.object({
  recommendation: z.enum(["continue_research", "candidate", "reject"]),
  rationale: z.string().min(30).max(1500),
  evidenceGaps: z.array(z.string().min(8).max(400)).max(8),
  validationExperiment: z.object({
    hypothesis: z.string().min(20).max(700),
    method: z.string().min(20).max(1000),
    successMetric: z.string().min(10).max(500),
    killCondition: z.string().min(10).max(500),
  }),
  confidence: score,
});

export const learningOutputSchema = z.object({
  title: z.string().min(8).max(180),
  observation: z.string().min(20).max(1000),
  lesson: z.string().min(20).max(1000),
  confidence: score,
  appliesTo: z.string().min(3).max(300),
});

export type ScoutOpportunity = z.infer<typeof scoutOpportunitySchema>;
export type ScoutOutput = z.infer<typeof scoutOutputSchema>;
export type StrategistOutput = z.infer<typeof strategistOutputSchema>;
export type LearningOutput = z.infer<typeof learningOutputSchema>;

export const opportunityActionSchema = z.object({
  action: z.enum(["promote", "reject", "deep_research", "duplicate"]),
  note: z.string().max(1000).optional(),
});

export type OpportunityAction = z.infer<typeof opportunityActionSchema>;

export interface OpportunityRecord {
  id: string;
  ventureId: string | null;
  title: string;
  summary: string;
  problem: string;
  targetUser: string;
  opportunityType: (typeof opportunityTypes)[number];
  source: string;
  evidence: ScoutOpportunity["evidence"];
  overallScore: number;
  confidenceScore: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface TodaySummary {
  systemStatus: "running" | "paused";
  jobsCompletedToday: number;
  jobsFailedToday: number;
  opportunitiesDiscovered: number;
  opportunitiesRejected: number;
  opportunitiesPromoted: number;
  topOpportunity: OpportunityRecord | null;
  latestLearning: { title: string; lesson: string } | null;
  resources: Array<{ provider: string; enabled: boolean; freeOnly: boolean; notes: string | null }>;
}
