import { describe, expect, it } from "vitest";
import { calculateOpportunityScore } from "@jarvis/scoring";
import { COST_POLICY, jaccardSimilarity, mayExecuteProviderCall, normalizeFingerprint } from "@jarvis/shared";
import { growthPackSchema } from "@jarvis/types";

describe("Jarvis deterministic foundation", () => {
  it("keeps paid spend disabled", () => {
    expect(COST_POLICY).toEqual({ allowPaidSpend: false, maxCostInr: 0 });
    expect(mayExecuteProviderCall({ provider: "paid", freeAllowance: "none", currentUsage: "0", estimatedCostInr: 0.01, allowed: true })).toBe(false);
  });

  it("inverts competition and build effort in scoring", () => {
    const score = calculateOpportunityScore({
      demand: 80, revenue: 70, distribution: 60, competition: 90,
      differentiation: 50, buildEffort: 80, zeroCost: 100,
      strategicValue: 60, confidence: 70,
    });
    expect(score).toBe(62.5);
  });

  it("normalizes and compares duplicate concepts", () => {
    const a = normalizeFingerprint("AI Wardrobe Cost Calculator", "People planning outfits");
    const b = normalizeFingerprint("Wardrobe AI calculator", "People planning outfits");
    expect(jaccardSimilarity(a, b)).toBeGreaterThan(0.7);
  });

  it("accepts a complete measurable growth pack including the X channel", () => {
    const result = growthPackSchema.safeParse({
      strategySummary: "Create a small evidence-led growth campaign that measures clicks and installs instead of rewarding content volume or unsupported reach claims.",
      targetAudience: "People actively trying to organize and use an existing wardrobe",
      messagingAngle: "Make one repeated wardrobe decision easier before adding more features.",
      contentPillars: ["Practical wardrobe decisions", "Evidence-led product building", "Measurable no-buy experiments"],
      assets: ["instagram_post", "linkedin_post", "x_thread", "youtube_short_script"].map((assetType, index) => ({
        assetType, channel: index === 2 ? "x" : index === 3 ? "youtube_shorts" : index === 1 ? "linkedin" : "instagram",
        title: `Useful growth asset ${index + 1}`, hook: "A concrete wardrobe problem worth testing today.",
        body: "This fixture contains enough concrete copy to validate the Growth Factory contract without claiming that a post was published or produced a business outcome.",
        cta: "Record one measurable response to this asset.", productionNotes: "Founder reviews and manually publishes this draft before metrics are recorded.", sourceUrls: [],
      })),
      distributionLeads: [1, 2].map((index) => ({ leadType: "customer_signal", name: `Interview target ${index}`, sourceUrl: null, whyRelevant: "A direct user signal is required before treating public attention as demand.", nextAction: "Recruit the target with consent and record the last three real decisions." })),
      experiment: { hypothesis: "Problem-led assets will produce qualified responses.", method: "Publish approved drafts manually and record attributed outcomes.", successMetric: "At least three qualified responses.", killCondition: "Stop after five assets with zero qualified responses." },
      evidenceLimits: ["This fixture proves the schema only, not market demand."],
    });
    expect(result.success).toBe(true);
  });
});
