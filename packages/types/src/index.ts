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

export const researchBriefSchema = z.object({
  title: z.string().min(10).max(180),
  executiveSummary: z.string().min(50).max(1200),
  verdict: z.enum(["pursue", "validate_more", "reject"]),
  confidence: score,
  findings: z.array(z.object({
    finding: z.string().min(25).max(700),
    evidenceUrls: z.array(z.string().url()).min(1).max(5),
    confidence: score,
    implication: z.string().min(20).max(500),
  })).min(2).max(5),
  alternatives: z.array(z.object({
    name: z.string().min(2).max(120),
    url: z.string().url(),
    positioning: z.string().min(15).max(400),
    gap: z.string().min(10).max(400),
  })).max(6),
  opportunity: z.object({
    exactProblem: z.string().min(25).max(700),
    targetUser: z.string().min(10).max(400),
    differentiation: z.string().min(20).max(600),
    monetization: z.string().min(15).max(500),
    biggestRisk: z.string().min(15).max(500),
  }),
  validationExperiment: z.object({
    hypothesis: z.string().min(20).max(600),
    method: z.string().min(20).max(800),
    successMetric: z.string().min(10).max(400),
    killCondition: z.string().min(10).max(400),
    steps: z.array(z.string().min(8).max(300)).min(3).max(7),
  }),
  evidenceLimits: z.array(z.string().min(10).max(400)).min(1).max(6),
  founderDecision: z.object({
    question: z.string().min(15).max(400),
    options: z.array(z.string().min(5).max(250)).min(2).max(4),
  }),
});

export type ScoutOpportunity = z.infer<typeof scoutOpportunitySchema>;
export type ScoutOutput = z.infer<typeof scoutOutputSchema>;
export type StrategistOutput = z.infer<typeof strategistOutputSchema>;
export type LearningOutput = z.infer<typeof learningOutputSchema>;
export type ResearchBrief = z.infer<typeof researchBriefSchema>;

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
