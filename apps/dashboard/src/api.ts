import type { OpportunityAction, OpportunityRecord, TodaySummary } from "@jarvis/types";

const configuredApiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "");
const API_BASE = configuredApiBase || (typeof window !== "undefined" && window.location.hostname.endsWith("pages.dev")
  ? "https://jarvis-api.chiragsharma376.workers.dev"
  : "");

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function setFounderToken(token: string): void {
  sessionStorage.setItem("jarvis_founder_token", token);
}

export interface SystemOverview {
  serverNow: string;
  timezone: string;
  heartbeat: { cron: string; frequency: string; nextRunAt: string; behavior: string };
  recurringWork: Array<{ type: string; name: string; cadence: string; purpose: string }>;
  settings: Array<Record<string, unknown>>;
  jobCounts: Array<{ status: string; count: number }>;
  jobs: Array<Record<string, unknown>>;
  recentAgentRuns: Array<Record<string, unknown>>;
  opportunityCounts: Array<{ status: string; count: number }>;
  latestReport: Record<string, unknown> | null;
  latestDeliverables: Array<Record<string, unknown>>;
  provider: { name: string; model: string; freeAllowanceConfirmed: boolean };
  costPolicy: { allowPaidSpend: boolean; maxCostInr: number };
}

export interface DeliverableRecord {
  id: string;
  deliverable_type: string;
  title: string;
  status: string;
  summary: string;
  content_markdown: string;
  content_json: string;
  source_count: number;
  related_opportunity_id: string | null;
  created_at: string;
}

export interface ReportRecord {
  id: string;
  report_type: string;
  period_start: string;
  summary: string;
  content_json: string;
  created_at: string;
}

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface AssistantProposal {
  id: string;
  type: "pause_system" | "resume_system" | "run_heartbeat" | "run_scout" | "run_growth" | "deep_research" | "add_rule";
  summary: string;
  expiresAt: string;
}

export interface GrowthGoal {
  id: string; name: string; objective: string; audience: string; offer: string; primary_metric: string;
  target_value: number; current_value: number; channels_json: string; deadline: string | null; status: string;
}
export interface GrowthAsset {
  id: string; goal_id: string; asset_type: string; channel: string; title: string; hook: string; body: string;
  cta: string; production_notes: string; source_urls_json: string; status: string; external_url: string | null; created_at: string;
}
export interface GrowthLead { id: string; lead_type: string; name: string; source_url: string | null; why_relevant: string; next_action: string; status: string; }
export interface GrowthMetric { id: string; goal_id: string; asset_id: string | null; metric_date: string; channel: string; impressions: number; views: number; clicks: number; installs: number; leads: number; revenue_inr: number; notes: string | null; }
export interface GrowthReview { id: string; summary: string; metrics_json: string; winners_json: string; failures_json: string; recommendations_json: string; created_at: string; }
export interface GrowthOverview {
  goal: GrowthGoal | null; assets: GrowthAsset[]; leads: GrowthLead[]; metrics: GrowthMetric[]; reviews: GrowthReview[];
  experiments: Array<Record<string, unknown>>; totals: { impressions?: number; views?: number; clicks?: number; installs?: number; leads?: number; revenue_inr?: number };
}
export interface MediaAsset {
  id: string; growth_asset_id: string; media_kind: "image" | "video"; format: string; width: number; height: number;
  duration_seconds: number | null; provider: string; model: string | null; prompt: string; spec_json: string; status: string;
  public_id: string; publicUrl: string | null; bytes: number; render_attempts: number; last_error: string | null;
  growth_title: string; channel: string; hook: string; cta: string; created_at: string; completed_at: string | null;
}
export interface ChannelConnection { id: string; provider: string; connection_type: string; capabilities_json: string; status: string; account_label: string | null; last_sync_at: string | null; last_error: string | null; }
export interface MediaOverview {
  assets: MediaAsset[]; connections: ChannelConnection[]; counts: Array<{ status: string; count: number }>;
  renderer: { name: string; cadence: string; maxAttempts: number };
  storage: { provider: string; bucket: string; freeGuardGb: number; existingClothmaticsBucketUsed: boolean };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = sessionStorage.getItem("jarvis_founder_token");
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers },
  });
  const raw = await response.text();
  let body: T & { error?: string };
  try {
    body = JSON.parse(raw) as T & { error?: string };
  } catch {
    const isHtml = raw.trimStart().startsWith("<");
    throw new ApiError(isHtml
      ? "Dashboard API configuration error: website returned HTML instead of the Jarvis API. Please refresh after deployment completes."
      : `Jarvis API returned an empty or invalid response (${response.status}).`, response.status);
  }
  if (!response.ok) throw new ApiError(body.error ?? `Request failed (${response.status})`, response.status);
  return body;
}

export const api = {
  login: async (email: string, password: string) => {
    const result = await request<{ token: string; email: string; expiresInSeconds: number }>(
      "/api/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) },
    );
    setFounderToken(result.token);
    return result;
  },
  logout: () => sessionStorage.removeItem("jarvis_founder_token"),
  assistantHistory: () => request<{ messages: AssistantMessage[]; proposal: AssistantProposal | null }>("/api/assistant/history"),
  assistantChat: (message: string) => request<{ reply: string; proposal: AssistantProposal | null }>(
    "/api/assistant/chat",
    { method: "POST", body: JSON.stringify({ message }) },
  ),
  assistantAction: (id: string, decision: "confirm" | "cancel") => request<{ message: string }>(
    `/api/assistant/actions/${encodeURIComponent(id)}/${decision}`,
    { method: "POST" },
  ),
  today: () => request<TodaySummary>("/api/today"),
  systemOverview: () => request<SystemOverview>("/api/system/overview"),
  opportunities: () => request<{ opportunities: OpportunityRecord[] }>("/api/opportunities"),
  deliverables: () => request<{ deliverables: DeliverableRecord[] }>("/api/deliverables"),
  reports: () => request<{ reports: ReportRecord[] }>("/api/reports"),
  growthOverview: () => request<GrowthOverview>("/api/growth/overview"),
  mediaOverview: () => request<MediaOverview>("/api/media/overview"),
  produceMedia: (growthAssetId: string) => request<{ ok: true; jobId: string; message: string }>(
    `/api/media/growth-assets/${encodeURIComponent(growthAssetId)}/produce`, { method: "POST" },
  ),
  mediaAssetAction: (id: string, action: "approve" | "reject" | "delete" | "retry") => request<{ ok: true }>(
    `/api/media/assets/${encodeURIComponent(id)}/action`, { method: "POST", body: JSON.stringify({ action }) },
  ),
  startGrowth: (goalId = "goal_clothmatics_growth_v1") => request<{ ok: true; jobId: string; message: string }>(
    "/api/growth/start", { method: "POST", body: JSON.stringify({ goalId }) },
  ),
  growthAssetAction: (id: string, action: "approve" | "reject" | "mark_published" | "delete", externalUrl?: string) => request<{ ok: true; asset: GrowthAsset }>(
    `/api/growth/assets/${encodeURIComponent(id)}/action`, { method: "POST", body: JSON.stringify({ action, ...(externalUrl ? { externalUrl } : {}) }) },
  ),
  addGrowthMetric: (metric: { goalId: string; assetId?: string; metricDate: string; channel: string; impressions: number; views: number; clicks: number; installs: number; leads: number; revenueInr: number; notes?: string }) => request<{ ok: true; id: string }>(
    "/api/growth/metrics", { method: "POST", body: JSON.stringify(metric) },
  ),
  reviewGrowth: (goalId: string) => request<{ ok: true; jobId: string; message: string }>(
    "/api/growth/review", { method: "POST", body: JSON.stringify({ goalId }) },
  ),
  requestResearch: (topic: string) => request<{ ok: true; jobId: string; message: string }>(
    "/api/deliverables/research",
    { method: "POST", body: JSON.stringify({ topic }) },
  ),
  opportunityAction: (id: string, action: OpportunityAction) => request<{ ok: true; status: string }>(
    `/api/opportunities/${encodeURIComponent(id)}/action`,
    { method: "POST", body: JSON.stringify(action) },
  ),
  systemStatus: (status: "running" | "paused") => request<{ ok: true; status: string }>(
    "/api/system/status",
    { method: "POST", body: JSON.stringify({ status }) },
  ),
  runHeartbeat: () => request<{ ok: true; processed: boolean }>("/api/system/run-heartbeat", { method: "POST" }),
  collection: (name: string) => request<Record<string, Array<Record<string, unknown>>>>(`/api/${name}`),
  addRule: (rule: string) => request<{ ok: true; id: string }>(
    "/api/rules",
    { method: "POST", body: JSON.stringify({ rule, scope: "global", priority: 50 }) },
  ),
};
