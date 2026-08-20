import { describe, expect, it } from "vitest";
import { calculateOpportunityScore } from "@jarvis/scoring";
import { COST_POLICY, jaccardSimilarity, mayExecuteProviderCall, normalizeFingerprint } from "@jarvis/shared";

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
});
