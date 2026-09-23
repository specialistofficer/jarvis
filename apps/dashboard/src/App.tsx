import { useCallback, useEffect, useRef, useState } from "react";
import type { OpportunityAction, OpportunityRecord, TodaySummary } from "@jarvis/types";
import { api, ApiError, API_BASE } from "./api";
import type { AssistantMessage, AssistantProposal, DeliverableRecord, GrowthAsset, GrowthOverview, MediaAsset, MediaOverview, ReportRecord, SystemOverview } from "./api";
import { ClientAcquisitionView } from "./ClientAcquisitionView";

type View = "ClientAcquisition" | "Research" | "Media" | "Leads" | "Published" | "Analytics" | "Jarvis" | "Diagnostic" | "Settings";

const nav: Array<{ view: View; icon: string; label: string }> = [
  { view: "ClientAcquisition", icon: "💼", label: "Client Acquisition" },
  { view: "Research", icon: "▤", label: "Research" },
  { view: "Media", icon: "▣", label: "Media" },
  { view: "Leads", icon: "🎯", label: "Leads" },
  { view: "Published", icon: "✓", label: "Published" },
  { view: "Analytics", icon: "📈", label: "Analytics" },
];

function localTime(value: unknown): string {
  if (typeof value !== "string" || !value) return "Not scheduled";
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function parseObject(value: string): Record<string, unknown> {
  try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}; }
  catch { return {}; }
}

function ResearchView({ deliverables, reports, messages, busy, onResearch, onSend }: { deliverables: DeliverableRecord[]; reports: ReportRecord[]; messages: AssistantMessage[]; busy: boolean; onResearch: (topic: string) => Promise<void>; onSend: (text: string) => Promise<void> }) {
  const [input, setInput] = useState("");
  return (
    <div>
      <div className="panel" style={{marginBottom: 20}}>
        <div className="panel-title">Command Center</div>
        <div style={{maxHeight: '300px', overflowY: 'auto', marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px', fontFamily: 'monospace', fontSize: '13px'}}>
          {messages.length === 0 && <div style={{color: 'var(--text-muted)'}}>System ready. Waiting for input...</div>}
          {messages.map((m: any) => (
            <div key={m.id} style={{color: m.role === 'user' ? 'var(--text-muted)' : 'var(--text-main)'}}>
              <span style={{color: m.role === 'user' ? 'var(--accent)' : '#a855f7', marginRight: '8px'}}>
                {m.role === 'user' ? '>' : 'JARVIS:'}
              </span>
              <span style={{whiteSpace: 'pre-wrap'}}>{m.content}</span>
            </div>
          ))}
        </div>
        <div className="flex-between gap-4">
          <input type="text" style={{flex: 1, padding: '10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px', color: '#fff'}} value={input} onChange={e => setInput(e.target.value)} placeholder="Execute a command or enter a research topic..." onKeyDown={e => { if (e.key === 'Enter' && input && !busy) { onSend(input); setInput(""); } }} />
          <button className="secondary" disabled={busy || !input} onClick={() => { if(input) { onSend(input); setInput(""); } }}>Execute</button>
          <button className="primary" disabled={busy || !input} onClick={() => void onResearch(input)}>Deep Research</button>
        </div>
      </div>
      <div className="grid-2">
        {deliverables.map(d => {
          const content = parseObject(d.content_json);
          return (
            <div key={d.id} className="list-item">
              <div className="flex-between">
                <h4>{d.title}</h4>
                <span className="badge">{d.status}</span>
              </div>
              <p>{d.summary}</p>
              <div className="meta"><span>{d.source_count} sources</span><span>{localTime(d.created_at)}</span></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MediaView({ growth, media, busy, onGenerate, onScoutTrends, onAssetAction, onProduce, onMediaAction }: any) {
  const readyAssets = growth?.assets.filter((a: any) => a.status === "ready_to_publish") || [];
  const drafts = growth?.assets.filter((a: any) => a.status === "draft") || [];
  return (
    <div>
      <div className="flex-between" style={{marginBottom: 20}}>
        <h2>Content Pipeline</h2>
        <div style={{display: 'flex', gap: '10px'}}>
          <button className="secondary" disabled={busy} onClick={onScoutTrends}>Scout Trends</button>
          <button className="primary" disabled={busy} onClick={onGenerate}>Generate Pack</button>
        </div>
      </div>
      <div className="panel">
        <div className="panel-title">Drafts Awaiting Approval</div>
        {drafts.map((asset: any) => (
          <div key={asset.id} className="list-item">
            <h4>{asset.title}</h4>
            <p>{asset.hook}</p>
            <div className="flex-between mt-2">
              <small>{asset.channel}</small>
              <div className="gap-2" style={{display: 'flex'}}>
                <button className="primary" disabled={busy} onClick={() => onAssetAction(asset, "approve")}>Approve</button>
                <button className="danger" disabled={busy} onClick={() => onAssetAction(asset, "reject")}>Reject</button>
              </div>
            </div>
          </div>
        ))}
        {!drafts.length && <div className="empty-state">No drafts.</div>}
      </div>
      <div className="panel">
        <div className="panel-title">Approved (Waiting for Media)</div>
        {readyAssets.map((asset: any) => (
          <div key={asset.id} className="list-item">
            <h4>{asset.title}</h4>
            <div className="flex-between mt-2">
              <small>{asset.channel}</small>
              <button className="primary" disabled={busy} onClick={() => onProduce(asset)}>Produce Media</button>
            </div>
          </div>
        ))}
        {!readyAssets.length && <div className="empty-state">No approved plans waiting.</div>}
      </div>
      <div className="panel">
        <div className="panel-title">Generated Media</div>
        <div className="grid-3">
          {media?.assets.filter((a:any) => a.status !== 'published').map((asset: any) => (
            <div key={asset.id} className="media-card">
              <div className="media-preview">
                {asset.publicUrl ? (asset.media_kind === "video" ? <video src={asset.publicUrl} controls /> : <img src={asset.publicUrl} />) : <div style={{padding: 20, textAlign: 'center'}}>{asset.status}</div>}
              </div>
              <div className="media-info">
                <h3>{asset.growth_title}</h3>
                <p>{asset.media_kind} • {asset.status}</p>
                <div className="media-actions">
                  {asset.status === 'ready_for_review' && <><button className="primary" onClick={() => onMediaAction(asset, "approve")}>Approve</button><button onClick={() => onMediaAction(asset, "reject")}>Reject</button></>}
                  {asset.status === 'failed' && <button onClick={() => onMediaAction(asset, "retry")}>Retry</button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LeadsView({ outreach, busy, onTriggerOutreach }: any) {
  const [query, setQuery] = useState("");
  return (
    <div>
      <div className="panel" style={{marginBottom: '20px'}}>
        <div className="panel-title">Outreach Campaigns (Lead Scraper)</div>
        <div className="flex-between gap-4">
          <input type="text" style={{flex: 1, padding: '10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px', color: '#fff'}} value={query} onChange={e => setQuery(e.target.value)} placeholder="e.g. Plumbers in Texas, Dentists in NY..." />
          <button className="primary" disabled={busy || !query} onClick={() => { if(query) { onTriggerOutreach(query); setQuery(""); } }}>Start Outreach</button>
        </div>
      </div>
      <div className="grid-2">
        <div className="panel">
          <div className="panel-title">Recent Campaigns</div>
          {outreach?.campaigns?.map((c: any) => (
            <div key={c.id} className="list-item">
              <h4>{c.query}</h4>
              <div className="meta"><span>{c.status}</span><span>{localTime(c.created_at)}</span></div>
            </div>
          ))}
          {!outreach?.campaigns?.length && <div className="empty-state">No campaigns found.</div>}
        </div>
        <div className="panel">
          <div className="panel-title">Drafted Pitches (AI Generated)</div>
          <div style={{display: 'flex', flexDirection: 'column', gap: '12px'}}>
            {outreach?.leads?.map((lead: any) => (
              <div key={lead.id} className="list-item" style={{background: 'var(--bg)'}}>
                <div className="flex-between">
                  <h4>{lead.business_name}</h4>
                  <a href={lead.website_url} target="_blank" rel="noreferrer" style={{fontSize: '12px'}}>Visit Website</a>
                </div>
                {lead.contact_email && <div style={{fontSize: '12px', color: 'var(--accent)', marginTop: '4px'}}>Email: {lead.contact_email}</div>}
                <div style={{fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px'}}><strong>SEO Issues:</strong> {lead.seo_issues}</div>
                <div style={{marginTop: '12px', padding: '12px', background: 'var(--panel)', borderRadius: '8px', fontSize: '13px', whiteSpace: 'pre-wrap', border: '1px solid var(--border)'}}>
                  {lead.personalized_pitch}
                </div>
              </div>
            ))}
            {!outreach?.leads?.length && <div className="empty-state">No leads generated yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function PublishedView({ growth, media }: any) {
  const pubMedia = media?.assets.filter((a:any) => a.status === 'published') || [];
  return (
    <div className="panel">
      <div className="panel-title">Published Results</div>
      <div className="grid-3">
        {pubMedia.map((asset: any) => (
          <div key={asset.id} className="media-card">
            <div className="media-preview">
              {asset.publicUrl ? (asset.media_kind === "video" ? <video src={asset.publicUrl} controls /> : <img src={asset.publicUrl} />) : null}
            </div>
            <div className="media-info">
              <h3>{asset.growth_title}</h3>
              <p>Published to {asset.channel}</p>
            </div>
          </div>
        ))}
        {!pubMedia.length && <div className="empty-state">No published media yet.</div>}
      </div>
    </div>
  );
}

function AnalyticsView({ growth }: any) {
  const t = growth?.totals || {};
  return (
    <div>
      <div className="grid-4" style={{marginBottom: 24}}>
        <div className="metric"><small>Revenue</small><strong>₹{t.revenue_inr || 0}</strong></div>
        <div className="metric"><small>Installs</small><strong>{t.installs || 0}</strong></div>
        <div className="metric"><small>Clicks</small><strong>{t.clicks || 0}</strong></div>
        <div className="metric"><small>Views</small><strong>{t.views || 0}</strong></div>
      </div>
      <div className="panel">
        <div className="panel-title">Latest Review</div>
        <p>{growth?.reviews?.[0]?.summary || "No reviews yet."}</p>
      </div>
    </div>
  );
}

function DiagnosticView({ overview, onStatus, today }: any) {
  return (
    <div>
    <div className="panel">
      <div className="panel-title">Connected Resources</div>
      
      <div className="list-item flex-between">
        <div><strong>Google Drive</strong><p style={{fontSize: 12, color: 'var(--text-muted)'}}>Archive & Data Warehouse</p></div>
        <button onClick={async () => {
          try {
            const res = await fetch(API_BASE + "/api/connections/google_drive/auth", { headers: { "Authorization": "Bearer " + sessionStorage.getItem("jarvis_founder_token") } });
            const data = await res.json();
            if (data.url) window.location.href = data.url; else alert(data.error || "Failed to get auth URL");
          } catch (err) { alert("Error initiating OAuth"); }
        }}>Connect</button>
      </div>

      <div className="list-item flex-between">
        <div><strong>YouTube</strong><p style={{fontSize: 12, color: 'var(--text-muted)'}}>Video Publishing & Analytics</p></div>
        <button onClick={async () => {
          try {
            const res = await fetch(API_BASE + "/api/connections/youtube/auth", { headers: { "Authorization": "Bearer " + sessionStorage.getItem("jarvis_founder_token") } });
            const data = await res.json();
            if (data.url) window.location.href = data.url; else alert(data.error || "Failed to get auth URL");
          } catch (err) { alert("Error initiating OAuth"); }
        }}>Connect</button>
      </div>

      <div className="list-item flex-between">
        <div><strong>Instagram</strong><p style={{fontSize: 12, color: 'var(--text-muted)'}}>Meta Graph API (Publishing & Analytics)</p></div>
        <button onClick={async () => {
          try {
            const res = await fetch(API_BASE + "/api/connections/instagram/auth", { headers: { "Authorization": "Bearer " + sessionStorage.getItem("jarvis_founder_token") } });
            const data = await res.json();
            if (data.url) window.location.href = data.url; else alert(data.error || "Failed to get auth URL");
          } catch (err) { alert("Error initiating OAuth"); }
        }}>Connect</button>
      </div>

      <div className="list-item flex-between">
        <div><strong>LinkedIn</strong><p style={{fontSize: 12, color: 'var(--text-muted)'}}>Professional Network</p></div>
        <button onClick={async () => {
          try {
            const res = await fetch(API_BASE + "/api/connections/linkedin/auth", { headers: { "Authorization": "Bearer " + sessionStorage.getItem("jarvis_founder_token") } });
            const data = await res.json();
            if (data.url) window.location.href = data.url; else alert(data.error || "Failed to get auth URL");
          } catch (err) { alert("Error initiating OAuth"); }
        }}>Connect</button>
      </div>

      <div className="list-item flex-between">
        <div><strong>X (Twitter)</strong><p style={{fontSize: 12, color: 'var(--text-muted)'}}>X API v2</p></div>
        <button onClick={async () => {
          try {
            const res = await fetch(API_BASE + "/api/connections/x/auth", { headers: { "Authorization": "Bearer " + sessionStorage.getItem("jarvis_founder_token") } });
            const data = await res.json();
            if (data.url) window.location.href = data.url; else alert(data.error || "Failed to get auth URL");
          } catch (err) { alert("Error initiating OAuth"); }
        }}>Connect</button>
      </div>
      
    </div>
    <div className="panel">
      <div className="panel-title">Technical Diagnostics</div>
      <div className="flex-between" style={{marginBottom: 20}}>
        <div>System is <strong>{today?.systemStatus}</strong></div>
        <button onClick={() => onStatus(today?.systemStatus === 'paused' ? 'running' : 'paused')}>{today?.systemStatus === 'paused' ? 'Resume' : 'Pause'}</button>
      </div>
      <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
        {overview?.jobs.slice(0,10).map((j:any) => (
          <div key={j.id} className="list-item" style={{display: 'flex', justifyContent: 'space-between'}}>
            <div><strong>{j.type}</strong> <span style={{color:'var(--text-muted)'}}>{j.status}</span></div>
            <small>{localTime(j.updated_at)}</small>
          </div>
        ))}
      </div>
    </div>
    </div>
  );
}

export function App() {
  const [view, setView] = useState<View>("ClientAcquisition");
  const [today, setToday] = useState<TodaySummary | null>(null);
  const [opportunities, setOpportunities] = useState<OpportunityRecord[]>([]);
  const [overview, setOverview] = useState<SystemOverview | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
const [proposal, setProposal] = useState<AssistantProposal | null>(null);
  const [deliverables, setDeliverables] = useState<DeliverableRecord[]>([]);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [growth, setGrowth] = useState<GrowthOverview | null>(null);
  const [media, setMedia] = useState<MediaOverview | null>(null);
  const [outreach, setOutreach] = useState<any>(null);
  const [authState, setAuthState] = useState<"checking" | "required" | "authenticated">("checking");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null); const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [todayData, opportunityData, overviewData, assistantData, deliverableData, reportData, growthData, mediaData, outreachData] = await Promise.all([api.today(), api.opportunities(), api.systemOverview(), api.assistantHistory(), api.deliverables(), api.reports(), api.growthOverview(), api.mediaOverview(), api.fetchOutreachOverview()]);
      setToday(todayData); setOpportunities(opportunityData.opportunities); setOverview(overviewData); setMessages(assistantData.messages); setProposal(assistantData.proposal); setDeliverables(deliverableData.deliverables); setReports(reportData.reports); setGrowth(growthData); setMedia(mediaData); setOutreach(outreachData); setAuthState("authenticated");
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) setAuthState("required");
      else setAuthState("authenticated");
    }
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    const match = url.pathname.match(/^\/oauth\/callback\/([a-z_]+)$/);
    if (match) {
      const provider = match[1];
      const code = url.searchParams.get("code");
      if (code) {
        fetch(API_BASE + `/api/connections/${provider}/callback`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + sessionStorage.getItem("jarvis_founder_token") },
          body: JSON.stringify({ code, redirectUri: window.location.origin + `/oauth/callback/${provider}` })
        }).then(() => {
          window.location.href = "/";
        }).catch(() => {
          alert("OAuth failed for " + provider);
          window.location.href = "/";
        });
        return;
      }
    }
    void refresh();
  }, [refresh]);

  const logout = () => { api.logout(); setAuthState("required"); };
  const onStatus = async (status: "running" | "paused") => { setBusy(true); await api.systemStatus(status); await refresh(); setBusy(false); };
  const onGenerateGrowth = async () => { setBusy(true); await api.startGrowth(growth!.goal!.id); await refresh(); setBusy(false); };
  const onScoutTrends = async () => { setBusy(true); await api.triggerScout(); alert("Scouting started! Check diagnostics."); await refresh(); setBusy(false); };
  const onGrowthAssetAction = async (asset: GrowthAsset, action: any) => { setBusy(true); await api.growthAssetAction(asset.id, action); await refresh(); setBusy(false); };
  const onProduceMedia = async (asset: GrowthAsset) => { setBusy(true); await api.produceMedia(asset.id); await refresh(); setBusy(false); };
  const onMediaAction = async (asset: MediaAsset, action: "approve" | "reject" | "delete" | "retry") => {
    setBusy(true);
    try {
      await api.mediaAssetAction(asset.id, action);
      await refresh();
    } catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  };

  const onTriggerOutreach = async (query: string) => {
    setBusy(true);
    try {
      await api.triggerOutreach(query);
      await refresh();
    } catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  };

  const onResearch = async (topic: string) => { setBusy(true); await api.requestResearch(topic); await refresh(); setBusy(false); };
  const sendMessage = async (text: string) => { setBusy(true); await api.assistantChat(text); await refresh(); setBusy(false); };

  if (authState === "checking") return <div className="auth-wrap">Loading...</div>;
  if (authState === "required") return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={async e => { e.preventDefault(); setBusy(true); try { await api.login(email, password); await refresh(); } catch { setAuthError("Failed"); } finally { setBusy(false); } }}>
        <h2>Jarvis Login</h2>
        <div className="form-group"><label>Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
        <div className="form-group"><label>Password</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} required /></div>
        {authError && <div style={{color: 'var(--danger)'}}>{authError}</div>}
        <button className="primary" disabled={busy}>Sign In</button>
      </form>
    </div>
  );

  return (
    <div className="app-shell">
      <aside>
        <div className="brand"><div className="mark">J</div><div><strong>Jarvis</strong><small>Founder HQ</small></div></div>
        <nav>
          {nav.map(item => <button key={item.view} className={view === item.view ? "active" : ""} onClick={() => setView(item.view)}><span>{item.icon}</span>{item.label}</button>)}
        </nav>
        <div className="sidebar-bottom">
          <nav>
            <button className={view === "Diagnostic" ? "active" : ""} onClick={() => setView("Diagnostic")}><span>⚙</span> Diagnostic</button>
            <button onClick={logout}><span>↪</span> Logout</button>
          </nav>
          <div className="status"><span className={`status-dot ${today?.systemStatus}`} /> {today?.systemStatus}</div>
        </div>
      </aside>
      <main>
        <header><h1>{view === "ClientAcquisition" ? "Client Acquisition HQ" : view}</h1></header>
        {view === "ClientAcquisition" && <ClientAcquisitionView />}
        {view === "Research" && <ResearchView deliverables={deliverables} reports={reports} messages={messages} busy={busy} onResearch={onResearch} onSend={sendMessage} />}
        {view === "Media" && <MediaView growth={growth} media={media} busy={busy} onGenerate={onGenerateGrowth} onScoutTrends={onScoutTrends} onAssetAction={onGrowthAssetAction} onProduce={onProduceMedia} onMediaAction={onMediaAction} />}
        {view === "Leads" && <LeadsView outreach={outreach} busy={busy} onTriggerOutreach={onTriggerOutreach} />}
        {view === "Published" && <PublishedView growth={growth} media={media} />}
        {view === "Analytics" && <AnalyticsView growth={growth} />}
        {view === "Diagnostic" && <DiagnosticView overview={overview} today={today} onStatus={onStatus} />}
      </main>
    </div>
  );
}
