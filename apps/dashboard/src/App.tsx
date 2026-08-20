import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { OpportunityAction, OpportunityRecord, TodaySummary } from "@jarvis/types";
import { api, ApiError } from "./api";
import type { AssistantMessage, AssistantProposal, SystemOverview } from "./api";

type View = "Assistant" | "Opportunities" | "Activity" | "Settings";

interface SpeechRecognitionEventLike { results: { [index: number]: { [index: number]: { transcript: string } } }; }
interface SpeechRecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null; onend: (() => void) | null;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
declare global { interface Window { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor; } }

const nav: Array<{ view: View; icon: string; label: string }> = [
  { view: "Assistant", icon: "J", label: "Jarvis" },
  { view: "Opportunities", icon: "◇", label: "Ideas" },
  { view: "Activity", icon: "↗", label: "Activity" },
  { view: "Settings", icon: "⚙", label: "Settings" },
];

function Mark({ active = false }: { active?: boolean }) { return <div className={`mark ${active ? "active" : ""}`} aria-hidden="true">J</div>; }

function localTime(value: unknown): string {
  if (typeof value !== "string" || !value) return "Not scheduled";
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function speak(text: string): void {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.replace(/[₹%]/g, " "));
  utterance.lang = "en-IN"; utterance.rate = 1;
  window.speechSynthesis.speak(utterance);
}

function ScoreRing({ value }: { value: number }) {
  const color = value >= 70 ? "#c9f658" : value >= 50 ? "#ffca6a" : "#83918e";
  return <div className="score-ring" style={{ background: `conic-gradient(${color} ${value * 3.6}deg, #24312e 0deg)` }}><span>{Math.round(value)}</span></div>;
}

function AssistantView({ today, overview, messages, proposal, sending, onSend, onDecision }: {
  today: TodaySummary | null; overview: SystemOverview | null; messages: AssistantMessage[]; proposal: AssistantProposal | null; sending: boolean;
  onSend: (message: string) => Promise<string | null>; onDecision: (decision: "confirm" | "cancel") => Promise<string | null>;
}) {
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceReplies, setVoiceReplies] = useState(() => localStorage.getItem("jarvis_voice_replies") === "true");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const chatEnd = useRef<HTMLDivElement | null>(null);
  const activeJobs = overview?.jobs.filter((job) => ["queued", "running", "deferred"].includes(String(job.status))) ?? [];

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages, proposal, sending]);
  const submit = async (text: string, shouldSpeak = voiceReplies) => {
    const clean = text.trim(); if (!clean || sending) return;
    setInput(""); const reply = await onSend(clean); if (reply && shouldSpeak) speak(reply);
  };
  const startVoice = () => {
    if (listening) { recognition.current?.stop(); return; }
    const Constructor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Constructor) { setVoiceError("Voice input is browser mein available nahi hai. Chrome/Android try karein, ya text type karein."); return; }
    setVoiceError(null);
    const instance = new Constructor(); recognition.current = instance;
    instance.lang = "en-IN"; instance.continuous = false; instance.interimResults = false;
    instance.onresult = (event) => { const transcript = event.results[0]?.[0]?.transcript?.trim(); if (transcript) void submit(transcript, true); };
    instance.onerror = () => { setVoiceError("Voice clear nahi mila. Mic permission check karke dobara try karein."); setListening(false); };
    instance.onend = () => setListening(false); setListening(true); instance.start();
  };
  const toggleVoiceReplies = () => {
    const next = !voiceReplies; setVoiceReplies(next); localStorage.setItem("jarvis_voice_replies", String(next));
    if (!next) window.speechSynthesis?.cancel();
  };

  return <div className="assistant-layout">
    <section className="jarvis-hero">
      <div className="orb-wrap"><div className={`jarvis-orb ${listening || sending ? "thinking" : ""}`}><Mark active /></div></div>
      <div><span className="eyebrow">Your operating assistant</span><h1>{listening ? "I’m listening…" : sending ? "Thinking…" : "Jarvis is online"}</h1><p>Ask what’s happening, what runs next, or propose a change. Nothing modifies the system without your confirmation.</p></div>
      <div className="hero-controls"><button className={`voice-toggle ${voiceReplies ? "on" : ""}`} onClick={toggleVoiceReplies}>{voiceReplies ? "🔊 Voice on" : "🔈 Voice off"}</button></div>
    </section>
    <section className="live-strip">
      <div><span className={`status-dot ${today?.systemStatus ?? "paused"}`} /><span><small>System</small><strong>{today?.systemStatus ?? "checking"}</strong></span></div>
      <div><span><small>Active queue</small><strong>{activeJobs.length} jobs</strong></span></div>
      <div><span><small>Next check</small><strong>{localTime(overview?.heartbeat.nextRunAt)}</strong></span></div>
      <div><span><small>Safety</small><strong>₹0 paid spend</strong></span></div>
    </section>
    <section className="conversation-panel">
      <div className="conversation-heading"><div><span className="eyebrow">Conversation</span><h2>Talk to Jarvis</h2></div><span className="private-badge">Private session</span></div>
      <div className="messages" aria-live="polite">
        {!messages.length && <div className="message assistant"><Mark /><div><p>Hi Chirag. Main live jobs, opportunities, reports aur system state dekh sakta hoon. “Give me a briefing” se start karein.</p><small>Jarvis · now</small></div></div>}
        {messages.map((message) => <div className={`message ${message.role}`} key={message.id}>{message.role === "assistant" && <Mark />}<div><p>{message.content}</p><small>{message.role === "assistant" ? "Jarvis" : "You"} · {localTime(message.created_at)}</small></div></div>)}
        {sending && <div className="message assistant"><Mark active /><div className="typing"><i /><i /><i /></div></div>}
        {proposal && <div className="proposal-card"><span className="eyebrow">Confirmation required</span><h3>{proposal.summary}</h3><p>Jarvis ne abhi koi change nahi kiya. Yeh proposal 30 minutes mein expire hoga.</p><div><button className="primary" disabled={sending} onClick={async () => { const result = await onDecision("confirm"); if (result && voiceReplies) speak(result); }}>Confirm action</button><button disabled={sending} onClick={() => void onDecision("cancel")}>Keep things unchanged</button></div></div>}
        <div ref={chatEnd} />
      </div>
      <div className="quick-prompts">{["Give me a briefing", "What runs next?", "Run Opportunity Scout", "Pause Jarvis automation"].map((prompt) => <button key={prompt} disabled={sending} onClick={() => void submit(prompt)}>{prompt}</button>)}</div>
      {voiceError && <div className="voice-error">{voiceError}</div>}
      <form className="composer" onSubmit={(event) => { event.preventDefault(); void submit(input); }}>
        <textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="Message Jarvis…" rows={1} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(input); } }} />
        <button type="button" className={`mic ${listening ? "listening" : ""}`} onClick={startVoice} aria-label={listening ? "Stop listening" : "Talk to Jarvis"}>{listening ? "■" : "●"}<span>{listening ? "Stop" : "Talk"}</span></button>
        <button className="send" disabled={sending || !input.trim()} aria-label="Send message">↑</button>
      </form>
    </section>
  </div>;
}

function OpportunitiesView({ items, onAction }: { items: OpportunityRecord[]; onAction: (id: string, action: OpportunityAction["action"], title: string) => void }) {
  const active = items.filter((item) => !["rejected", "archived"].includes(item.status));
  return <div className="simple-page"><div className="page-intro"><span className="eyebrow">Evidence before enthusiasm</span><h1>Opportunities</h1><p>Jarvis ke shortlisted ideas. Har direct decision aapse confirmation leta hai.</p></div><div className="opportunity-list">{active.map((item) => <article className="opportunity-card" key={item.id}><div className="opportunity-top"><div><span className="eyebrow">{item.opportunityType.replaceAll("_", " ")}</span><h2>{item.title}</h2></div><ScoreRing value={item.overallScore} /></div><p>{item.summary}</p><div className="evidence-line"><span>{item.evidence.length} evidence</span><span>{item.confidenceScore}% confidence</span><span>{item.status}</span></div><details><summary>Problem and target user</summary><p><b>Problem:</b> {item.problem}</p><p><b>Target:</b> {item.targetUser}</p></details><div className="actions"><button className="primary" onClick={() => onAction(item.id, "deep_research", item.title)}>Deep research</button><button onClick={() => onAction(item.id, "promote", item.title)}>Promote</button><button className="danger" onClick={() => onAction(item.id, "reject", item.title)}>Reject</button></div></article>)}{!active.length && <div className="empty-state">No active opportunities yet. Ask Jarvis to run Opportunity Scout.</div>}</div></div>;
}

function ActivityView({ overview }: { overview: SystemOverview | null }) {
  if (!overview) return <div className="skeleton-block" />;
  const liveJobs = overview.jobs.filter((job) => ["queued", "running", "deferred", "failed"].includes(String(job.status))).slice(0, 12);
  const completedJobs = overview.jobs.filter((job) => job.status === "completed").sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at))).slice(0, 12);
  const nameFor = (type: unknown) => overview.recurringWork.find((item) => item.type === type)?.name ?? String(type).replaceAll("_", " ");
  const nextRunFor = (type: unknown) => overview.jobs.find((job) => job.type === type && ["queued", "deferred"].includes(String(job.status)))?.scheduled_at;
  const outcomeFor = (job: Record<string, unknown>, agentRun?: Record<string, unknown>) => {
    const raw = String(job.result_summary ?? agentRun?.output_summary ?? "Job completed, but this older run did not store a detailed result.");
    const scout = raw.match(/^(\d+) inserted; (\d+) duplicates?$/i);
    if (scout) return `Scout searched for opportunities, saved ${scout[1]} new result and skipped ${scout[2]} duplicate${scout[2] === "1" ? "" : "s"}.`;
    if (String(job.type) === "research_opportunity" && raw.includes(":")) {
      const [decision = "continue research", ...reason] = raw.split(":");
      return `Strategist recommendation: ${decision.replaceAll("_", " ")}. ${reason.join(":").trim()}`;
    }
    return raw;
  };
  return <div className="simple-page">
    <div className="page-intro"><span className="eyebrow">Live operations</span><h1>What Jarvis actually did</h1><p>Har completed job ka result, completion time aur next run yahan milega.</p></div>
    <section className="panel schedule-summary"><div><span className="status-dot running" /><span><small>Next hourly queue check</small><strong>{localTime(overview.heartbeat.nextRunAt)}</strong></span></div><code>{overview.heartbeat.cron} UTC</code></section>
    <section className="panel outcomes-panel"><div className="section-title"><div><span className="eyebrow">Completed work</span><h2>Results, not just activity</h2></div><span className="done-count">{completedJobs.length} shown</span></div><div className="outcome-list">{completedJobs.map((job) => {
      const agentRun = overview.recentAgentRuns.find((run) => run.job_id === job.id && Number(run.success) === 1);
      const nextRun = nextRunFor(job.type);
      return <article className="outcome-card" key={String(job.id)}><div className="outcome-head"><span className="done-icon">✓</span><div><small>Completed</small><h3>{nameFor(job.type)}</h3></div></div><p>{outcomeFor(job, agentRun)}</p><div className="outcome-times"><span><small>Finished</small><strong>{localTime(job.completed_at)}</strong></span><span><small>Next scheduled run</small><strong>{nextRun ? localTime(nextRun) : "On founder request"}</strong></span></div>{agentRun?.output_summary && job.result_summary !== agentRun.output_summary ? <details><summary>Technical AI output</summary><p>{String(agentRun.output_summary)}</p></details> : null}</article>;
    })}{!completedJobs.length && <div className="empty-state">No completed job outcome yet.</div>}</div></section>
    <section className="panel"><span className="eyebrow">Upcoming queue and exceptions</span><div className="activity-rows">{liveJobs.map((job) => <div key={String(job.id)}><span className={`status-dot ${String(job.status)}`} /><span><strong>{nameFor(job.type)}</strong><small>{String(job.status)} · {localTime(job.scheduled_at)}</small>{job.last_error ? <p>{String(job.last_error)}</p> : null}</span></div>)}{!liveJobs.length && <p>Queue clear hai; next recurring jobs apne scheduled time par create/run honge.</p>}</div></section>
    <details className="panel technical-log"><summary>Technical AI audit log</summary><div className="activity-rows">{overview.recentAgentRuns.slice(0, 10).map((run) => <div key={String(run.id)}><span className={`status-dot ${Number(run.success) === 1 ? "running" : "failed"}`} /><span><strong>{String(run.role).replaceAll("_", " ")}</strong><small>{String(run.model)} · {localTime(run.completed_at ?? run.started_at)}</small><p>{String(run.output_summary ?? run.error ?? "In progress")}</p></span></div>)}</div></details>
  </div>;
}

function SettingsView({ today, overview, onStatus, onRun, onLogout }: { today: TodaySummary | null; overview: SystemOverview | null; onStatus: (status: "running" | "paused") => void; onRun: () => void; onLogout: () => void }) {
  return <div className="simple-page"><div className="page-intro"><span className="eyebrow">Control and safety</span><h1>Settings</h1><p>Rare controls yahan hain. Daily work ke liye Jarvis chat use karein.</p></div><section className="panel settings-card"><div><span className="eyebrow">Autonomy</span><h2>System is {today?.systemStatus ?? "checking"}</h2><p>Hourly heartbeat ek due job process karta hai. Jarvis se change bolne par bhi confirmation required rahegi.</p></div><div className="actions"><button className={today?.systemStatus === "paused" ? "primary" : "danger"} onClick={() => onStatus(today?.systemStatus === "paused" ? "running" : "paused")}>{today?.systemStatus === "paused" ? "Resume system" : "Pause system"}</button><button onClick={onRun}>Run one due job</button></div></section><section className="panel provider-explainer"><div><span className="eyebrow">AI provider — simple meaning</span><h2>{overview?.provider.model ?? "Checking model"}</h2><p><b>Llama 3.1 8B</b> Jarvis ka language/analysis model hai; <b>NVIDIA</b> us model ko run karne wali service hai.</p></div><div className="meaning-grid"><div><span>✓</span><div><strong>Free allowance confirmed</strong><p>Aapne existing free allowance confirm kiya hai. Yeh live NVIDIA balance meter nahi hai.</p></div></div><div><span>₹0</span><div><strong>Jarvis spend policy</strong><p>App paid work intentionally approve nahi karta. Provider billing ko separately NVIDIA account par control karna safest hai.</p></div></div></div><div className="cost-note"><strong>Important:</strong> “Paid spend blocked” Jarvis ki internal policy hai, NVIDIA account-level spending limit nahi.</div></section><section className="panel"><span className="eyebrow">Connected resources</span><div className="resource-list">{today?.resources.map((resource) => <div key={resource.provider}><span className={`resource-dot ${resource.enabled ? "enabled" : ""}`} /><strong>{resource.provider}</strong><small>{resource.freeOnly ? "free only" : "manual"}</small></div>)}</div></section><section className="panel account-card"><div><span className="eyebrow">Account</span><h2>Single founder access</h2><p>Session is stored only in this browser and expires automatically.</p></div><button className="danger logout" onClick={onLogout}>Log out of Jarvis</button></section></div>;
}

export function App() {
  const [view, setView] = useState<View>("Assistant");
  const [today, setToday] = useState<TodaySummary | null>(null);
  const [opportunities, setOpportunities] = useState<OpportunityRecord[]>([]);
  const [overview, setOverview] = useState<SystemOverview | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [proposal, setProposal] = useState<AssistantProposal | null>(null);
  const [authState, setAuthState] = useState<"checking" | "required" | "authenticated">("checking");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [todayData, opportunityData, overviewData, assistantData] = await Promise.all([api.today(), api.opportunities(), api.systemOverview(), api.assistantHistory()]);
      setToday(todayData); setOpportunities(opportunityData.opportunities); setOverview(overviewData); setMessages(assistantData.messages); setProposal(assistantData.proposal); setError(null); setAuthState("authenticated");
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) setAuthState("required");
      else { setError(cause instanceof Error ? cause.message : "Jarvis is temporarily unavailable"); setAuthState("authenticated"); }
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const logout = () => { api.logout(); window.speechSynthesis?.cancel(); setToday(null); setOverview(null); setMessages([]); setProposal(null); setPassword(""); setAuthState("required"); };
  const confirmBrowserAction = (description: string) => window.confirm(`${description}\n\nJarvis will only change this after your confirmation.`);
  const onStatus = async (status: "running" | "paused") => { if (!confirmBrowserAction(`${status === "paused" ? "Pause" : "Resume"} autonomous Jarvis?`)) return; setBusy(true); try { await api.systemStatus(status); await refresh(); } finally { setBusy(false); } };
  const onRun = async () => { if (!confirmBrowserAction("Run one due job now?")) return; setBusy(true); try { await api.runHeartbeat(); await refresh(); } finally { setBusy(false); } };
  const onOpportunityAction = async (id: string, action: OpportunityAction["action"], title: string) => { if (!confirmBrowserAction(`${action.replaceAll("_", " ")} “${title}”?`)) return; setBusy(true); try { await api.opportunityAction(id, { action }); await refresh(); } finally { setBusy(false); } };
  const sendMessage = async (text: string): Promise<string | null> => {
    setBusy(true); setError(null); setMessages((current) => [...current, { id: `local-${crypto.randomUUID()}`, role: "user", content: text, created_at: new Date().toISOString() }]);
    try { const result = await api.assistantChat(text); setMessages((current) => [...current, { id: `local-${crypto.randomUUID()}`, role: "assistant", content: result.reply, created_at: new Date().toISOString() }]); setProposal(result.proposal); return result.reply; }
    catch (cause) { const message = cause instanceof Error ? cause.message : "Jarvis could not answer"; setMessages((current) => [...current, { id: `local-${crypto.randomUUID()}`, role: "assistant", content: `I couldn't complete that request: ${message}`, created_at: new Date().toISOString() }]); return null; }
    finally { setBusy(false); }
  };
  const decideProposal = async (decision: "confirm" | "cancel"): Promise<string | null> => {
    if (!proposal) return null; setBusy(true);
    try { const result = await api.assistantAction(proposal.id, decision); setProposal(null); await refresh(); return result.message; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Action could not be completed"); return null; }
    finally { setBusy(false); }
  };

  if (authState === "checking") return <div className="boot-screen"><div className="jarvis-orb thinking"><Mark active /></div><p>Connecting to Jarvis…</p></div>;
  if (authState === "required") return <div className="auth-shell"><form className="auth-card" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setAuthError(null); try { await api.login(email, password); setPassword(""); await refresh(); } catch (cause) { setAuthError(cause instanceof Error ? cause.message : "Login failed"); } finally { setBusy(false); } }}><Mark active /><span className="eyebrow">Private founder access</span><h1>Sign in to Jarvis</h1><p>Enter your founder credentials. Email is never pre-filled or bundled into the website.</p><label htmlFor="email">Email</label><input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" placeholder="you@example.com" required /><label htmlFor="password">Password</label><input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="Your password" required />{authError && <div className="auth-error">{authError}</div>}<button className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button><small>One founder account · secure seven-day session</small></form></div>;

  return <div className="app-shell"><aside><div className="brand"><Mark active /><div><strong>Jarvis</strong><small>Founder assistant</small></div></div><nav>{nav.map((item) => <button key={item.view} className={view === item.view ? "active" : ""} onClick={() => setView(item.view)}><span>{item.icon}</span>{item.label}</button>)}</nav><div className="sidebar-bottom"><div><span className={`status-dot ${today?.systemStatus ?? "paused"}`} /><span><strong>{today?.systemStatus ?? "offline"}</strong><small>₹0 guard active</small></span></div><button className="logout-link" onClick={logout}>↪ Log out</button></div></aside><main>{view !== "Assistant" && <header><div><span className="eyebrow">Jarvis / {view}</span></div><div className="header-actions"><button onClick={() => void refresh()} disabled={busy}>↻ Refresh</button><button className="logout-button" onClick={logout}>Log out</button></div></header>}{error && <div className="error-banner"><strong>Jarvis notice</strong><span>{error}</span></div>}{view === "Assistant" && <AssistantView today={today} overview={overview} messages={messages} proposal={proposal} sending={busy} onSend={sendMessage} onDecision={decideProposal} />}{view === "Opportunities" && <OpportunitiesView items={opportunities} onAction={onOpportunityAction} />}{view === "Activity" && <ActivityView overview={overview} />}{view === "Settings" && <SettingsView today={today} overview={overview} onStatus={onStatus} onRun={onRun} onLogout={logout} />}</main><nav className="bottom-nav">{nav.map((item) => <button key={item.view} className={view === item.view ? "active" : ""} onClick={() => setView(item.view)}><span>{item.icon}</span><small>{item.label}</small></button>)}</nav></div>;
}
