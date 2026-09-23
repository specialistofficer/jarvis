import type { Env } from "../env";
import { selectAIProvider } from "../ai/provider";

export async function runOutreachScout(
  env: Env,
  jobId: string,
  payload: Record<string, unknown>
): Promise<{ campaignId: string; leadsGenerated: number }> {
  const query = typeof payload.query === "string" && payload.query.trim().length > 0
    ? payload.query.trim()
    : "Plumbers in Texas";
  
  // 1. Create a campaign record
  const campaignId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO outreach_campaigns (id, query, status) VALUES (?, ?, 'processing')"
  ).bind(campaignId, query).run();

  // 2. Perform a lightweight public SERP request
  let html = "";
  try {
    const searchResponse = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    if (searchResponse.ok) {
      html = await searchResponse.text();
    }
  } catch (err) {
    console.warn("Outreach SERP fetch error:", err);
  }

  // Quick regex to extract target links
  const linkRegex = /href="([^"]+)"/g;
  let match: RegExpExecArray | null = null;
  const rawUrls = new Set<string>();
  while ((match = linkRegex.exec(html)) !== null) {
    const urlCandidate = match[1];
    if (
      urlCandidate &&
      urlCandidate.startsWith("http") &&
      !urlCandidate.includes("duckduckgo") &&
      !urlCandidate.includes("google") &&
      !urlCandidate.includes("youtube") &&
      !urlCandidate.includes("bing")
    ) {
      rawUrls.add(urlCandidate);
    }
  }

  const targetUrls = Array.from(rawUrls).slice(0, 3);
  if (targetUrls.length === 0) {
    // Truthful reporting: do NOT invent fake domains or simulated leads
    await env.DB.prepare(
      "UPDATE outreach_campaigns SET status = 'failed' WHERE id = ?"
    ).bind(campaignId).run();
    return { campaignId, leadsGenerated: 0 };
  }

  const provider = selectAIProvider(env);
  let leadsGenerated = 0;

  // 3. For each real discovered URL, generate a consultative pitch
  for (const url of targetUrls) {
    try {
      const parsedUrl = new URL(url);
      const hostParts = parsedUrl.hostname.replace("www.", "").split(".");
      const businessNameDomain = hostParts[0] || "Target Prospect";
      
      const systemPrompt = "You are a technical sales consultant selling custom software, performance, and website optimizations.";
      const leadPrompt = `I found a real business lead with the website: ${url}
Generate a highly personalized cold outreach message (under 100 words) pitching specific digital improvements (e.g. mobile responsiveness, page speed, custom booking flows).
Sound human, conversational, and direct.`;

      const pitch = await provider.generateText(systemPrompt, leadPrompt);
      const leadId = crypto.randomUUID();
      
      await env.DB.prepare(
        `INSERT INTO outreach_leads (id, campaign_id, business_name, website_url, contact_email, seo_issues, personalized_pitch, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')`
      ).bind(
        leadId, 
        campaignId, 
        businessNameDomain, 
        url, 
        null, // Contact email requires verification/enrichment, no fake placeholders
        "Pending automated Lighthouse audit", 
        pitch
      ).run();
      
      leadsGenerated++;
    } catch (e) {
      console.error("Failed to process lead:", url, e);
    }
  }

  const finalStatus = leadsGenerated > 0 ? "completed" : "failed";
  await env.DB.prepare("UPDATE outreach_campaigns SET status = ? WHERE id = ?").bind(finalStatus, campaignId).run();

  return { campaignId, leadsGenerated };
}
