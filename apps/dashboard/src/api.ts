import type { OpportunityAction, OpportunityRecord, TodaySummary } from "@jarvis/types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

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
  type: "pause_system" | "resume_system" | "run_heartbeat" | "run_scout" | "deep_research" | "add_rule";
  summary: string;
  expiresAt: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = sessionStorage.getItem("jarvis_founder_token");
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers },
  });
  const body = await response.json() as T & { error?: string };
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
