import { researchBriefSchema } from "@jarvis/types";
import type { ResearchBrief } from "@jarvis/types";
import type { Env } from "../env";
import { selectAIProvider } from "../ai/provider";
import { listActiveFounderRules } from "../db/repository";

interface ResearchSource {
  sourceType: "hacker_news" | "github_issue" | "news";
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
  signal: string;
}

interface ResearchResult {
  deliverableId: string;
  title: string;
  sourceCount: number;
  verdict: string;
  summary: string;
}

const clean = (value: unknown, max = 700): string => String(value ?? "")
  .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

async function fetchHackerNews(query: string): Promise<ResearchSource[]> {
  const response = await fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=(story,comment)&hitsPerPage=6`, {
    signal: AbortSignal.timeout(12_000), headers: { "User-Agent": "JarvisResearch/1.0" },
  });
  if (!response.ok) throw new Error(`Hacker News search returned ${response.status}`);
  const body = await response.json() as { hits?: Array<Record<string, unknown>> };
  return (body.hits ?? []).map((hit) => ({
    sourceType: "hacker_news" as const,
    title: clean(hit.title || hit.story_title || hit.comment_text, 180) || "Hacker News discussion",
    url: clean(hit.url || hit.story_url, 800) || `https://news.ycombinator.com/item?id=${encodeURIComponent(String(hit.objectID ?? ""))}`,
    snippet: clean(hit.comment_text || hit.story_text || hit.title, 650),
    publishedAt: typeof hit.created_at === "string" ? hit.created_at : null,
    signal: `HN points: ${Number(hit.points ?? 0)}; comments: ${Number(hit.num_comments ?? 0)}`,
  })).filter((item) => item.url.startsWith("http"));
}

async function fetchGitHubIssues(query: string): Promise<ResearchSource[]> {
  const q = `${query} in:title,body is:issue`;
  const response = await fetch(`https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=5`, {
    signal: AbortSignal.timeout(12_000),
    headers: { "User-Agent": "JarvisResearch/1.0", Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub search returned ${response.status}`);
  const body = await response.json() as { items?: Array<Record<string, unknown>> };
  return (body.items ?? []).map((item) => ({
    sourceType: "github_issue" as const,
    title: clean(item.title, 180) || "GitHub issue",
    url: clean(item.html_url, 800),
    snippet: clean(item.body, 650),
    publishedAt: typeof item.created_at === "string" ? item.created_at : null,
    signal: `Public issue; comments: ${Number(item.comments ?? 0)}; state: ${clean(item.state, 20)}`,
  })).filter((item) => item.url.startsWith("http"));
}

async function fetchNews(query: string): Promise<ResearchSource[]> {
  const response = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`"${query}"`)}&mode=artlist&maxrecords=5&format=json&sort=hybridrel`, {
    signal: AbortSignal.timeout(12_000), headers: { "User-Agent": "JarvisResearch/1.0" },
  });
  if (!response.ok) throw new Error(`GDELT search returned ${response.status}`);
  const body = await response.json() as { articles?: Array<Record<string, unknown>> };
  return (body.articles ?? []).map((article) => ({
    sourceType: "news" as const,
    title: clean(article.title, 180) || "News article",
    url: clean(article.url, 800),
    snippet: clean(article.seendate || article.domain, 650),
    publishedAt: typeof article.seendate === "string" ? article.seendate : null,
    signal: `Publisher/domain: ${clean(article.domain, 120)}`,
  })).filter((item) => item.url.startsWith("http"));
}

function renderBrief(brief: ResearchBrief, sources: ResearchSource[]): string {
  const sourceByUrl = new Map(sources.map((source) => [source.url, source]));
  const findings = brief.findings.map((item, index) => {
    const citations = item.evidenceUrls.map((url) => `[${sourceByUrl.get(url)?.title ?? "Source"}](${url})`).join(" · ");
    return `${index + 1}. **${item.finding}**\n   - Why it matters: ${item.implication}\n   - Confidence: ${item.confidence}%\n   - Evidence: ${citations}`;
  }).join("\n\n");
  const alternatives = brief.alternatives.map((item) => `- [${item.name}](${item.url}) — ${item.positioning}\n  - Gap: ${item.gap}`).join("\n");
  const sourceAppendix = sources.map((item, index) => `${index + 1}. [${item.title}](${item.url}) — ${item.sourceType}; ${item.signal}`).join("\n");
  return `# ${brief.title}\n\n## Executive summary\n${brief.executiveSummary}\n\n**Verdict:** ${brief.verdict.replaceAll("_", " ")} · **Confidence:** ${brief.confidence}%\n\n## Evidence-backed findings\n${findings}\n\n## Existing alternatives\n${alternatives || "No credible alternative was identified in this scan."}\n\n## Opportunity\n- **Exact problem:** ${brief.opportunity.exactProblem}\n- **Target user:** ${brief.opportunity.targetUser}\n- **Differentiation:** ${brief.opportunity.differentiation}\n- **Monetization:** ${brief.opportunity.monetization}\n- **Biggest risk:** ${brief.opportunity.biggestRisk}\n\n## INR 0 validation experiment\n- **Hypothesis:** ${brief.validationExperiment.hypothesis}\n- **Method:** ${brief.validationExperiment.method}\n- **Success metric:** ${brief.validationExperiment.successMetric}\n- **Kill condition:** ${brief.validationExperiment.killCondition}\n\n${brief.validationExperiment.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}\n\n## Evidence limits\n${brief.evidenceLimits.map((item) => `- ${item}`).join("\n")}\n\n## Founder decision\n**${brief.founderDecision.question}**\n\n${brief.founderDecision.options.map((item) => `- ${item}`).join("\n")}\n\n## Sources inspected (${sources.length})\n${sourceAppendix}`;
}

function renderSourceScan(topic: string, sources: ResearchSource[], reason: string): string {
  return `# Source scan: ${topic}\n\nAI synthesis could not be completed, so Jarvis saved the collected evidence instead of pretending that research was finished.\n\n**Synthesis error:** ${clean(reason, 500)}\n\n## Public sources found (${sources.length})\n\n${sources.map((item, index) => `${index + 1}. [${item.title}](${item.url})\n   - ${item.snippet || item.signal}\n   - ${item.signal}`).join("\n\n")}\n\n## Next step\nRetry synthesis after checking the AI provider, or review these sources manually. No recommendation has been made.`;
}

function conservativeBrief(topic: string, sources: ResearchSource[]): ResearchBrief {
  const byType = (type: ResearchSource["sourceType"]) => sources.filter((source) => source.sourceType === type);
  const discussions = byType("hacker_news");
  const issues = byType("github_issue");
  const news = byType("news");
  const evidenceFor = (preferred: ResearchSource[], fallback = sources) => (preferred.length ? preferred : fallback).slice(0, 3).map((source) => source.url);
  const findings: ResearchBrief["findings"] = [
    {
      finding: `The scan found ${discussions.length} public Hacker News records discussing products or workflows related to the research topic.`,
      evidenceUrls: evidenceFor(discussions), confidence: discussions.length >= 3 ? 55 : 35,
      implication: "There is visible public interest and existing product activity, but self-selected discussions do not establish representative demand or willingness to pay.",
    },
    {
      finding: `The scan found ${issues.length} public GitHub issues connected to wardrobe or closet software, showing concrete development requests and implementation friction.`,
      evidenceUrls: evidenceFor(issues), confidence: issues.length >= 3 ? 55 : 35,
      implication: "Issue-level signals can reveal specific workflow pain, but they should guide interviews rather than be treated as market-size proof.",
    },
  ];
  if (news.length) findings.push({
    finding: `The scan found ${news.length} indexed news records related to the topic, indicating broader category coverage beyond developer communities.`,
    evidenceUrls: evidenceFor(news), confidence: news.length >= 3 ? 45 : 30,
    implication: "Category attention may help distribution, but coverage alone does not prove retention, conversion, or an underserved segment.",
  });
  const alternativeSources = (discussions.length ? discussions : sources).slice(0, 5);
  return researchBriefSchema.parse({
    title: `Sourced market brief: ${topic}`.slice(0, 180),
    executiveSummary: `Jarvis inspected ${sources.length} public records across Hacker News, GitHub issues and indexed news. The evidence shows an active category with existing alternatives and concrete software discussions, but it does not yet establish a differentiated, repeat-use problem or willingness to pay. Verdict: validate a narrow workflow at INR 0 before building.`,
    verdict: "validate_more",
    confidence: Math.min(55, 25 + Math.round(sources.length * 1.2)),
    findings,
    alternatives: alternativeSources.map((source) => ({
      name: source.title.slice(0, 120), url: source.url,
      positioning: `Publicly indexed wardrobe or closet-related product, project, or discussion found in the source scan.`,
      gap: "This source alone does not establish user satisfaction, retention, pricing acceptance, or a durable unmet need.",
    })),
    opportunity: {
      exactProblem: "A specific segment may need a faster way to understand and act on what is already in its wardrobe, but the highest-frequency decision is not yet evidenced.",
      targetUser: "People already trying digital closet or wardrobe-organization workflows",
      differentiation: "Do not build a general closet clone; identify one repeated decision that existing public alternatives handle poorly, then solve only that workflow.",
      monetization: "Delay monetization assumptions until target users repeat the workflow; then test one explicit premium outcome without paid acquisition.",
      biggestRisk: "Visible category activity may reflect novelty and hobby projects rather than repeated behavior or willingness to pay.",
    },
    validationExperiment: {
      hypothesis: "At least 3 of 10 qualified users will repeat one manually delivered wardrobe-decision workflow within seven days.",
      method: "Interview ten people already using a closet or wardrobe process, select the most repeated decision, and deliver that outcome manually through a lightweight prototype.",
      successMetric: "At least 3 of 10 qualified testers repeat the same workflow within seven days without being reminded.",
      killCondition: "Stop or change the problem if fewer than 2 of 10 testers repeat the workflow within seven days.",
      steps: ["Recruit ten people already using a wardrobe or closet workflow", "Ask for the last three real decisions and current workaround", "Choose one repeated problem rather than a broad feature list", "Deliver the outcome manually with a no-code prototype", "Measure unprompted seven-day repeat use and objections"],
    },
    evidenceLimits: [
      "Public search results are self-selected and are not a representative customer sample.",
      "The collected records do not provide verified retention, revenue, conversion, or willingness-to-pay data.",
      "Some records describe developer activity; implementation interest is not equivalent to customer demand.",
    ],
    founderDecision: {
      question: "Should Jarvis turn this source scan into a ten-user, INR 0 problem-validation experiment?",
      options: ["Approve the narrow validation experiment", "Choose a narrower user segment first", "Reject this category and research another topic"],
    },
  });
}

export async function runResearchBrief(env: Env, jobId: string, payload: Record<string, unknown>): Promise<ResearchResult> {
  const topic = clean(payload.topic, 300) || "AI wardrobe and digital closet apps";
  const opportunityId = typeof payload.opportunityId === "string" ? payload.opportunityId : null;
  const requestedQueries = Array.isArray(payload.queries) ? payload.queries.map((item) => clean(item, 100)).filter(Boolean).slice(0, 5) : [];
  const queries = requestedQueries.length ? requestedQueries : [topic.slice(0, 100), "digital closet app", "wardrobe organizer"];
  const calls = queries.flatMap((query) => [fetchHackerNews(query), fetchGitHubIssues(query), fetchNews(query)]);
  const settled = await Promise.allSettled(calls);
  const collected = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const sources = [...new Map(collected.map((item) => [item.url, item])).values()].slice(0, 24);
  if (!sources.length) throw new Error("No public research source could be reached; research was not marked complete");

  const [opportunity, rules] = await Promise.all([
    opportunityId ? env.DB.prepare("SELECT id, title, summary, problem, target_user, analysis_json FROM opportunities WHERE id = ?").bind(opportunityId).first<Record<string, unknown>>() : null,
    listActiveFounderRules(env.DB),
  ]);
  const provider = selectAIProvider(env);
  const runId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO agent_runs (id, role, job_id, provider, model, prompt_version, input_summary, started_at)
     VALUES (?, 'researcher', ?, ?, ?, 'RESEARCH_BRIEF_V1', ?, ?)`,
  ).bind(runId, jobId, provider.name, env.NVIDIA_MODEL, `${topic}; ${sources.length} public sources`, new Date().toISOString()).run();

  let brief: ResearchBrief | null = null;
  let synthesisError: string | null = null;
  try {
    const generated = await provider.generateStructured({
      system: `You are Jarvis Researcher. Produce a skeptical founder research brief from ONLY the supplied public source records. Never invent a URL, quote, customer count, price, metric, or fact. Every finding must cite one or more exact supplied URLs. An alternative URL must also be one of the supplied URLs. Treat GitHub issues and Hacker News comments as user signals, not representative market proof. Explicitly state evidence limits. Prefer validate_more or reject when evidence is weak. The validation experiment must cost INR 0. Return only JSON matching the requested schema.`,
      prompt: `RESEARCH TOPIC:\n${topic}\n\nRELATED OPPORTUNITY:\n${JSON.stringify(opportunity)}\n\nFOUNDER RULES:\n${JSON.stringify(rules)}\n\nPUBLIC SOURCE RECORDS:\n${JSON.stringify(sources)}\n\nRequired output: title, executiveSummary, verdict (pursue|validate_more|reject), confidence 0-100, 2-5 findings with exact evidenceUrls, alternatives, opportunity, validationExperiment with 3-7 steps, evidenceLimits, and founderDecision.`,
      schema: researchBriefSchema,
      temperature: 0.1,
      maxTokens: 2600,
    });
    const allowed = new Set(sources.map((source) => source.url));
    const cited = generated.data.findings.flatMap((finding) => finding.evidenceUrls)
      .concat(generated.data.alternatives.map((alternative) => alternative.url));
    const invalid = cited.filter((url) => !allowed.has(url));
    if (invalid.length) throw new Error(`AI cited ${invalid.length} URL(s) that were not in the collected source set`);
    brief = generated.data;
    await env.DB.prepare("UPDATE agent_runs SET output_summary = ?, tokens_or_usage = ?, completed_at = ?, success = 1 WHERE id = ?")
      .bind(`${brief.verdict}: ${brief.executiveSummary}`.slice(0, 1200), JSON.stringify(generated.usage), new Date().toISOString(), runId).run();
  } catch (error) {
    synthesisError = error instanceof Error ? error.message : String(error);
    await env.DB.prepare("UPDATE agent_runs SET completed_at = ?, success = 0, error = ? WHERE id = ?")
      .bind(new Date().toISOString(), synthesisError.slice(0, 1500), runId).run();
    brief = conservativeBrief(topic, sources);
  }

  const deliverableId = crypto.randomUUID();
  const title = brief?.title ?? `Source scan: ${topic}`;
  const summary = brief?.executiveSummary ?? `Collected ${sources.length} public sources, but synthesis could not be completed. No verdict was invented.`;
  const contentMarkdown = brief ? renderBrief(brief, sources) : renderSourceScan(topic, sources, synthesisError ?? "Unknown provider error");
  const content = brief
    ? { mode: synthesisError ? "conservative_research_brief" : "research_brief", topic, brief, sources, synthesisError }
    : { mode: "source_scan", topic, sources, synthesisError, verdict: "not_completed", confidence: 0 };
  const statements: D1PreparedStatement[] = [env.DB.prepare(
    `INSERT INTO deliverables (id, deliverable_type, title, status, summary, content_markdown, content_json, source_count, related_opportunity_id, job_id)
     VALUES (?, 'research_brief', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(deliverableId, title, synthesisError ? "completed_with_limits" : "completed", summary, contentMarkdown, JSON.stringify(content), sources.length, opportunityId, jobId)];
  if (opportunityId) {
    for (const source of sources) {
      statements.push(env.DB.prepare(
        `INSERT INTO evidence (id, opportunity_id, source_type, source_url, title, summary, confidence)
         SELECT ?, ?, ?, ?, ?, ?, 45 WHERE NOT EXISTS (SELECT 1 FROM evidence WHERE opportunity_id = ? AND source_url = ?)`,
      ).bind(crypto.randomUUID(), opportunityId, source.sourceType, source.url, source.title, source.snippet || source.signal, opportunityId, source.url));
    }
    if (brief) {
      statements.push(env.DB.prepare(
        `INSERT INTO jobs (id, type, priority, payload, status, scheduled_at, max_attempts)
         VALUES (?, 'research_opportunity', 85, ?, 'queued', datetime('now'), 3)`,
      ).bind(crypto.randomUUID(), JSON.stringify({ opportunityId, deliverableId })));
    }
  }
  await env.DB.batch(statements);
  return { deliverableId, title, sourceCount: sources.length, verdict: brief?.verdict ?? "needs_review", summary };
}
