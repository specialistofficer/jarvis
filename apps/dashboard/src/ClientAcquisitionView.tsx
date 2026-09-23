import { useState, useEffect, useCallback } from "react";
import { clientAgent } from "./api";
import type {
  ClientOpportunity,
  ClientApplication,
  FunnelReport,
  RoiReport,
  StrategyReport,
} from "./api";

type Tab = "opportunities" | "applications" | "analytics" | "strategy" | "profile";

export function ClientAcquisitionView() {
  const [activeTab, setActiveTab] = useState<Tab>("opportunities");
  const [opportunities, setOpportunities] = useState<ClientOpportunity[]>([]);
  const [applications, setApplications] = useState<ClientApplication[]>([]);
  const [funnel, setFunnel] = useState<FunnelReport | null>(null);
  const [roi, setRoi] = useState<RoiReport | null>(null);
  const [strategy, setStrategy] = useState<StrategyReport | null>(null);
  const [portfolio, setPortfolio] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [notice, setNotice] = useState<string | null>(null);

  const showNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  };

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      const health = await clientAgent.health();
      setBackendOnline(health.ok);
      const [opps, apps, fReport, rReport, strat, port, prof] = await Promise.allSettled([
        clientAgent.opportunities(),
        clientAgent.applications(),
        clientAgent.funnel(),
        clientAgent.roi(),
        clientAgent.strategyReview(),
        clientAgent.portfolio(),
        clientAgent.profile(),
      ]);

      if (opps.status === "fulfilled") setOpportunities(opps.value);
      if (apps.status === "fulfilled") setApplications(apps.value);
      if (fReport.status === "fulfilled") setFunnel(fReport.value);
      if (rReport.status === "fulfilled") setRoi(rReport.value);
      if (strat.status === "fulfilled") setStrategy(strat.value);
      if (port.status === "fulfilled") setPortfolio(port.value);
      if (prof.status === "fulfilled") setProfile(prof.value);
    } catch {
      setBackendOnline(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const handleScan = async (source?: string) => {
    setLoading(true);
    try {
      const res = await clientAgent.triggerDiscovery(source);
      showNotice(`Discovery scan complete: ${res.new_opportunities_stored} new opportunities stored (${res.duplicates_skipped} duplicates skipped).`);
      await refreshAll();
    } catch (e: any) {
      showNotice(`Scan failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleScore = async (id: string) => {
    setLoading(true);
    try {
      await clientAgent.scoreOpportunity(id);
      showNotice("Opportunity evaluated and scored successfully.");
      await refreshAll();
    } catch (e: any) {
      showNotice(`Scoring failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateProposal = async (id: string) => {
    setLoading(true);
    try {
      await clientAgent.generateProposal(id);
      showNotice("Proposal drafted and factually verified. Switched to Applications.");
      await refreshAll();
      setActiveTab("applications");
    } catch (e: any) {
      showNotice(`Proposal generation failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitApp = async (id: string) => {
    setLoading(true);
    try {
      const res = await clientAgent.submitApplication(id);
      showNotice(`Application action: ${res.status}`);
      await refreshAll();
    } catch (e: any) {
      showNotice(`Action failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyPackage = (app: ClientApplication) => {
    const proposal = app.proposals?.[0];
    const text = `JOB: ${app.opportunity?.title}\nURL: ${app.submission_url || ""}\nBID: $${app.proposed_price || ""}\n\nPROPOSAL:\n${proposal?.cover_letter || ""}`;
    void navigator.clipboard.writeText(text);
    showNotice("1-Click Submission package copied to clipboard!");
  };

  // Filter opportunities
  const filteredOpps = opportunities.filter((o) => {
    if (sourceFilter !== "all" && o.source !== sourceFilter) return false;
    const score = o.scores?.[0];
    if (actionFilter !== "all" && score?.recommended_action !== actionFilter) return false;
    return true;
  });

  return (
    <div>
      {/* Notice Banner */}
      {notice && (
        <div style={{ background: "var(--accent-bg)", color: "var(--accent)", padding: "10px 16px", borderRadius: 8, marginBottom: 16, border: "1px solid var(--accent)", fontSize: 13, display: "flex", justifyContent: "space-between" }}>
          <span>{notice}</span>
          <span style={{ cursor: "pointer" }} onClick={() => setNotice(null)}>✕</span>
        </div>
      )}

      {/* Backend Status Header */}
      <div className="flex-between" style={{ marginBottom: 20 }}>
        <div>
          <h2>Client Acquisition HQ</h2>
          <small style={{ color: "var(--text-muted)" }}>
            Multi-Source Discovery • Unit Economics • Zero-Hallucination Proposals • Human-in-the-Loop Control
          </small>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: backendOnline ? "var(--accent)" : "var(--danger)", display: "flex", alignItems: "center", gap: 6 }}>
            <span className={`status-dot ${backendOnline ? "running" : ""}`} style={{ background: backendOnline ? "var(--accent)" : "var(--danger)" }} />
            {backendOnline ? "Client Agent Online" : "Client Agent Offline (start backend)"}
          </span>
          <button className="secondary" disabled={loading} onClick={() => void refreshAll()}>
            Refresh
          </button>
        </div>
      </div>

      {/* Sub Navigation */}
      <div className="subnav">
        <button className={`subnav-btn ${activeTab === "opportunities" ? "active" : ""}`} onClick={() => setActiveTab("opportunities")}>
          🎯 Opportunities ({opportunities.length})
        </button>
        <button className={`subnav-btn ${activeTab === "applications" ? "active" : ""}`} onClick={() => setActiveTab("applications")}>
          📑 Applications & Proposals ({applications.length})
        </button>
        <button className={`subnav-btn ${activeTab === "analytics" ? "active" : ""}`} onClick={() => setActiveTab("analytics")}>
          📈 Conversion Funnel & ROI
        </button>
        <button className={`subnav-btn ${activeTab === "strategy" ? "active" : ""}`} onClick={() => setActiveTab("strategy")}>
          🧪 A/B Strategy Learning
        </button>
        <button className={`subnav-btn ${activeTab === "profile" ? "active" : ""}`} onClick={() => setActiveTab("profile")}>
          🛡️ Verified Profile & Proof
        </button>
      </div>

      {/* Tab 1: Opportunities */}
      {activeTab === "opportunities" && (
        <div>
          <div className="panel" style={{ marginBottom: 20 }}>
            <div className="flex-between" style={{ flexWrap: "wrap", gap: 12 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Source:</span>
                <select style={{ background: "var(--bg)", color: "#fff", border: "1px solid var(--border)", padding: "6px 12px", borderRadius: 6 }} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
                  <option value="all">All Sources</option>
                  <option value="upwork_rss">Upwork RSS</option>
                  <option value="remoteok">RemoteOK</option>
                  <option value="hackernews">HackerNews</option>
                  <option value="reddit">Reddit (forhire)</option>
                </select>
                <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 8 }}>Action:</span>
                <select style={{ background: "var(--bg)", color: "#fff", border: "1px solid var(--border)", padding: "6px 12px", borderRadius: 6 }} value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
                  <option value="all">All Recommendations</option>
                  <option value="APPLY">APPLY Only</option>
                  <option value="REVIEW">REVIEW Only</option>
                  <option value="SKIP">SKIP Only</option>
                </select>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="primary" disabled={loading} onClick={() => void handleScan()}>
                  ⚡ Scan All Sources Now
                </button>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {filteredOpps.map((opp) => {
              const score = opp.scores?.[0];
              const badgeClass =
                score?.recommended_action === "APPLY"
                  ? "badge success"
                  : score?.recommended_action === "REVIEW"
                  ? "badge warning"
                  : "badge danger";

              return (
                <div key={opp.id} className="list-item" style={{ background: "var(--panel)" }}>
                  <div className="flex-between">
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span className="badge info">{opp.source.replace("_", " ")}</span>
                      <h4>{opp.title}</h4>
                    </div>
                    {score && <span className={badgeClass}>{score.recommended_action} (Fit: {(score.fit_score * 100).toFixed(0)}%)</span>}
                  </div>

                  <p style={{ marginTop: 8, fontSize: 13, color: "var(--text-muted)" }}>{opp.description}</p>

                  <div className="flex-between" style={{ marginTop: 12, flexWrap: "wrap", gap: 8 }}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {opp.budget_max ? (
                        <span style={{ background: "var(--bg)", padding: "3px 8px", borderRadius: 4, fontSize: 12, color: "var(--accent)" }}>
                          Budget: ${opp.budget_max} {opp.currency}
                        </span>
                      ) : null}
                      {opp.required_skills?.slice(0, 4).map((s) => (
                        <span key={s} style={{ background: "var(--bg)", padding: "3px 8px", borderRadius: 4, fontSize: 12 }}>
                          {s}
                        </span>
                      ))}
                    </div>

                    <div style={{ display: "flex", gap: 8 }}>
                      <a href={opp.url} target="_blank" rel="noreferrer">
                        <button style={{ fontSize: 12, padding: "6px 12px" }}>🌐 View Job</button>
                      </a>
                      {!score && (
                        <button className="secondary" style={{ fontSize: 12, padding: "6px 12px" }} disabled={loading} onClick={() => void handleScore(opp.id)}>
                          Evaluate & Score
                        </button>
                      )}
                      <button className="primary" style={{ fontSize: 12, padding: "6px 12px" }} disabled={loading} onClick={() => void handleGenerateProposal(opp.id)}>
                        📝 Generate Proposal
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {!filteredOpps.length && (
              <div className="empty-state">
                No opportunities match current filter. Click "Scan All Sources Now" to ingest fresh freelance posts.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Applications & Proposals */}
      {activeTab === "applications" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {applications.map((app) => {
            const proposal = app.proposals?.[0];
            const isVerified = proposal?.is_factually_verified;
            return (
              <div key={app.id} className="panel">
                <div className="flex-between" style={{ marginBottom: 12 }}>
                  <div>
                    <span className="badge info" style={{ marginRight: 8 }}>{app.opportunity?.source || "Source"}</span>
                    <strong>{app.opportunity?.title || "Application"}</strong>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span className={`badge ${app.status === "won" ? "success" : app.status === "submitted" ? "info" : "warning"}`}>
                      Status: {app.status}
                    </span>
                    <span className="badge" style={{ background: "var(--bg)" }}>Mode: {app.mode}</span>
                  </div>
                </div>

                {/* Proposal Cover Letter */}
                {proposal && (
                  <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: 16, marginBottom: 12 }}>
                    <div className="flex-between" style={{ marginBottom: 8 }}>
                      <span style={{ fontSize: 12, color: "var(--accent)" }}>Strategy: {proposal.strategy}</span>
                      <span className={`badge ${isVerified ? "success" : "danger"}`}>
                        {isVerified ? "✓ 100% Factually Verified (Zero Hallucination)" : "⚠️ Unverified Claims Detected"}
                      </span>
                    </div>
                    <div style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "var(--text-main)", maxHeight: 220, overflowY: "auto", fontFamily: "monospace" }}>
                      {proposal.cover_letter}
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex-between" style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    Proposed Bid: <strong>${app.proposed_price || 0} USD</strong>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="secondary" onClick={() => handleCopyPackage(app)}>
                      📋 Copy 1-Click Package
                    </button>
                    {app.submission_url && (
                      <a href={app.submission_url} target="_blank" rel="noreferrer">
                        <button className="secondary">🌐 Open Application URL</button>
                      </a>
                    )}
                    {app.status === "pending_approval" && (
                      <button className="primary" disabled={loading} onClick={() => void handleSubmitApp(app.id)}>
                        ✅ Approve & Submit
                      </button>
                    )}
                  </div>
                </div>

                {/* Client Communication History */}
                {app.messages && app.messages.length > 0 && (
                  <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8 }}>
                      Client Responses & AI Reply Drafter
                    </div>
                    {app.messages.map((m) => (
                      <div key={m.id} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, marginBottom: 8 }}>
                        <div className="flex-between">
                          <strong style={{ fontSize: 13, color: m.sender === "client" ? "#a855f7" : "var(--accent)" }}>
                            {m.sender === "client" ? "👤 Client Message" : "🤖 Assistant Draft"}
                          </strong>
                          {m.intent && <span className="badge warning">Intent: {m.intent}</span>}
                        </div>
                        <p style={{ marginTop: 6, fontSize: 13 }}>{m.text}</p>
                        {m.suggested_reply && (
                          <div style={{ marginTop: 8, padding: 10, background: "var(--panel)", borderRadius: 6, border: "1px solid var(--border)" }}>
                            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Suggested Reply (Asia/Calcutta IST Timetable):</div>
                            <div style={{ fontSize: 12, whiteSpace: "pre-wrap", color: "var(--accent)" }}>{m.suggested_reply}</div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {!applications.length && (
            <div className="empty-state">
              No applications prepared yet. Head to "Opportunities" and click "Generate Proposal" on a high-scoring job.
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Conversion Funnel & ROI */}
      {activeTab === "analytics" && (
        <div>
          {/* Top Level Financial Summary */}
          {roi && (
            <div className="grid-4" style={{ marginBottom: 24 }}>
              <div className="metric">
                <small>Total Connects/Fees Cost</small>
                <strong>${roi.total_spend_usd}</strong>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>≈ ₹{roi.total_spend_inr} INR</div>
              </div>
              <div className="metric">
                <small>Pipeline Value</small>
                <strong>${roi.pipeline_value_usd}</strong>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Active Applications</div>
              </div>
              <div className="metric">
                <small>Won Revenue</small>
                <strong style={{ color: "var(--accent)" }}>${roi.won_revenue_usd}</strong>
                <div style={{ fontSize: 12, color: "var(--accent)", marginTop: 4 }}>Closed Contracts</div>
              </div>
              <div className="metric">
                <small>Net ROI %</small>
                <strong style={{ color: roi.net_profit_usd >= 0 ? "var(--accent)" : "var(--danger)" }}>
                  {roi.overall_roi_percent}%
                </strong>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Profit: ${roi.net_profit_usd}</div>
              </div>
            </div>
          )}

          {/* Conversion Funnel */}
          {funnel && (
            <div className="panel" style={{ marginBottom: 24 }}>
              <div className="panel-title">
                <span>Client Acquisition Funnel</span>
                <span className="badge success">Overall Conversion: {(funnel.overall_conversion_rate * 100).toFixed(1)}%</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {funnel.stages.map((stage) => {
                  const maxCount = Math.max(...funnel.stages.map((s) => s.count), 1);
                  const pct = Math.round((stage.count / maxCount) * 100);
                  return (
                    <div key={stage.stage} className="funnel-step">
                      <div style={{ width: 120, fontWeight: 600 }}>{stage.stage}</div>
                      <div className="funnel-bar-container">
                        <div className="funnel-bar-fill" style={{ width: `${Math.max(pct, 4)}%` }} />
                      </div>
                      <div style={{ width: 80, textAlign: "right", fontWeight: 700 }}>{stage.count}</div>
                      <div style={{ width: 100, textAlign: "right", color: "var(--text-muted)", fontSize: 12 }}>
                        {stage.conversion_from_previous < 1.0 ? `${(stage.conversion_from_previous * 100).toFixed(0)}% conv` : "100%"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Platform Performance Table */}
          {roi && (
            <div className="panel" style={{ marginBottom: 24 }}>
              <div className="panel-title">Platform ROI & Unit Economics</div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Jobs Scanned</th>
                    <th>Applications</th>
                    <th>Replies</th>
                    <th>Wins</th>
                    <th>Win Rate</th>
                    <th>Revenue</th>
                    <th>ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {roi.platform_breakdown.map((p) => (
                    <tr key={p.source_id}>
                      <td><strong>{p.source_id}</strong></td>
                      <td>{p.opportunities_count}</td>
                      <td>{p.applications_count}</td>
                      <td>{p.replies_count}</td>
                      <td>{p.wins_count}</td>
                      <td>{(p.win_rate * 100).toFixed(0)}%</td>
                      <td>${p.won_revenue_usd}</td>
                      <td style={{ color: p.roi_percent >= 0 ? "var(--accent)" : "var(--danger)" }}>{p.roi_percent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Tech Stack Distribution */}
          {roi && (
            <div className="panel">
              <div className="panel-title">Tech Stack Conversion Breakdown</div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Engineering Niche</th>
                    <th>Opportunities</th>
                    <th>Applications</th>
                    <th>Wins</th>
                    <th>Win Rate</th>
                    <th>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {roi.tech_breakdown.map((t) => (
                    <tr key={t.tech}>
                      <td><strong>{t.tech}</strong></td>
                      <td>{t.opportunities_count}</td>
                      <td>{t.applications_count}</td>
                      <td>{t.wins_count}</td>
                      <td>{(t.win_rate * 100).toFixed(0)}%</td>
                      <td>${t.revenue_usd}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Strategy Experiments */}
      {activeTab === "strategy" && strategy && (
        <div>
          {/* Active Experiments */}
          {strategy.active_experiments.map((exp) => (
            <div key={exp.experiment_id} className="panel" style={{ marginBottom: 24 }}>
              <div className="flex-between">
                <div>
                  <div className="panel-title">{exp.name}</div>
                  <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Dimension: {exp.dimension}</p>
                </div>
                {exp.winning_variant && (
                  <span className="badge success">
                    Winner: {exp.winning_variant} ({(exp.confidence_level * 100).toFixed(0)}% confidence)
                  </span>
                )}
              </div>

              <table className="data-table">
                <thead>
                  <tr>
                    <th>Variant</th>
                    <th>Applications</th>
                    <th>Replies</th>
                    <th>Wins</th>
                    <th>Win Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {exp.variants.map((v) => (
                    <tr key={v.name}>
                      <td><strong>{v.name}</strong></td>
                      <td>{v.applications_count}</td>
                      <td>{v.replies_count}</td>
                      <td>{v.wins_count}</td>
                      <td>{(v.win_rate * 100).toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ marginTop: 16, padding: 12, background: "var(--bg)", borderRadius: 8, fontSize: 13 }}>
                <strong>Agent Insight:</strong> {exp.recommendation}
              </div>
            </div>
          ))}

          {/* Strategic Action Items */}
          <div className="panel">
            <div className="panel-title">Strategic Acquisition Directives</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {strategy.strategic_recommendations.map((rec, i) => (
                <div key={i} className="list-item" style={{ margin: 0 }}>
                  <span>🎯 {rec}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab 5: Verified Profile & Portfolio */}
      {activeTab === "profile" && (
        <div>
          <div className="panel" style={{ borderLeft: "4px solid var(--accent)", marginBottom: 24 }}>
            <div className="panel-title">Strict Zero-Invention Ground Rule</div>
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
              Every proposal drafted by this agent is mathematically validated against Chirag's verified 10-year track record.
              Any mention of unverified skills, fabricated client metrics, or fake previous employers triggers immediate rejection.
            </p>
          </div>

          {/* Profile Overview */}
          {profile && (
            <div className="panel" style={{ marginBottom: 24 }}>
              <div className="panel-title">Founder Profile ({profile.name})</div>
              <p style={{ marginBottom: 12 }}>{profile.title} • {profile.years_of_experience} Years Experience</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                {profile.skills?.map((s: any) => (
                  <span key={s.name} className="badge" style={{ background: "var(--bg)" }}>
                    {s.name} ({s.years}y)
                  </span>
                ))}
              </div>
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{profile.bio}</p>
            </div>
          )}

          {/* Portfolio Catalog */}
          <div className="panel">
            <div className="panel-title">Verified Portfolio Catalog</div>
            <div className="grid-2">
              {portfolio.map((item) => (
                <div key={item.id} className="list-item" style={{ background: "var(--bg)" }}>
                  <div className="flex-between">
                    <h4>{item.title}</h4>
                    <span className="badge info">{item.category}</span>
                  </div>
                  <p style={{ marginTop: 6, fontSize: 13 }}>{item.description}</p>
                  <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {item.technologies?.map((tech: string) => (
                      <span key={tech} style={{ fontSize: 11, background: "var(--panel)", padding: "2px 6px", borderRadius: 4 }}>
                        {tech}
                      </span>
                    ))}
                  </div>
                  {item.play_store_url && (
                    <div style={{ marginTop: 10 }}>
                      <a href={item.play_store_url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                        Google Play Store Link ↗
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
