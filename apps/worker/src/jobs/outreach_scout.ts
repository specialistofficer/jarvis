import type { Env } from "../env";
import { selectAIProvider } from "../ai/provider";

export async function runOutreachScout(env: Env, jobId: string, payload: Record<string, unknown>): Promise<{ campaignId: string; leadsGenerated: number }> {
  const query = typeof payload.query === "string" ? payload.query : "Plumbers in Texas";
  
  // 1. Create a campaign record
  const campaignId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO outreach_campaigns (id, query, status) VALUES (?, ?, 'processing')"
  ).bind(campaignId, query).run();

  // 2. Perform a simulated / lightweight SERP scrape
  // (In a real app, you'd use a SERP API like BrightData, SerpApi, or Cheerio scraping here)
  // For MVP, we simulate fetching Google results for the query
  const searchResponse = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
  });
  const html = await searchResponse.text();
  
  // Quick regex to extract links (very basic parsing)
  const linkRegex = /href="([^"]+)"/g;
  let match;
  const rawUrls = new Set<string>();
  while ((match = linkRegex.exec(html)) !== null) {
    if (match[1].startsWith("http") && !match[1].includes("duckduckgo") && !match[1].includes("google") && !match[1].includes("youtube")) {
      rawUrls.add(match[1]);
    }
  }

  // Pick top 3 raw leads
  const targetUrls = Array.from(rawUrls).slice(0, 3);
  if (targetUrls.length === 0) {
      await env.DB.prepare("UPDATE outreach_campaigns SET status = 'failed' WHERE id = ?").bind(campaignId).run();
      throw new Error(`No leads found for query: ${query}`);
  }

  const provider = selectAIProvider(env);
  let leadsGenerated = 0;

  // 3. For each lead, "analyze" it and generate a pitch
  for (const url of targetUrls) {
      try {
          // Simulate fetching the lead's website content
          // We just use the URL as a proxy for the business name in this MVP
          const businessNameDomain = new URL(url).hostname.replace('www.', '').split('.')[0];
          
          const pitchPrompt = `You are a technical sales consultant selling custom software and website optimizations.
I found a lead with the website: ${url}
Generate a highly personalized cold email (under 100 words) pitching how we can improve their digital presence (e.g., speed, custom booking app, SEO). 
Sound human, conversational, and direct.`;

          const pitch = await provider.generateText(pitchPrompt);
          const leadId = crypto.randomUUID();
          
          await env.DB.prepare(
            `INSERT INTO outreach_leads (id, campaign_id, business_name, website_url, contact_email, seo_issues, personalized_pitch, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')`
          ).bind(
              leadId, 
              campaignId, 
              businessNameDomain, 
              url, 
              `hello@${businessNameDomain}.com`, // Simulated email
              "Slow load time, no mobile booking flow", 
              pitch
          ).run();
          
          leadsGenerated++;
      } catch (e) {
          console.error("Failed to process lead:", url, e);
      }
  }

  await env.DB.prepare("UPDATE outreach_campaigns SET status = 'completed' WHERE id = ?").bind(campaignId).run();

  return { campaignId, leadsGenerated };
}
