import type { AIProvider, GenerateRequest, GenerationResult } from "@jarvis/ai";

const MOCK_SCOUT_OUTPUT = {
  opportunities: [
    {
      title: "Wardrobe gap checklist before shopping",
      summary: "A zero-cost ClothMatics feature experiment that turns a wardrobe inventory into a short, evidence-seeking shopping checklist instead of generic outfit advice.",
      problem: "People buy duplicate or low-utility clothing because they cannot quickly see which wardrobe gaps matter for their actual routines and existing clothes.",
      targetUser: "ClothMatics users who already catalogued several items and are considering their next clothing purchase.",
      opportunityType: "clothmatics_feature",
      evidence: [{
        sourceType: "development_fixture",
        sourceUrl: null,
        title: "Evidence required before promotion",
        summary: "This deterministic local fixture demonstrates the pipeline only; real user interviews or funnel data are still required.",
        confidence: 20,
      }],
      alternatives: "Manual closet audits, shopping wishlists, generic capsule wardrobe checklists, and stylist consultations.",
      whyCouldWin: "ClothMatics can use a user's own wardrobe inventory, making the checklist more specific than generic shopping advice.",
      discoveryPath: "Expose the experiment to activated users after they catalog enough items, then measure checklist opens and saved recommendations.",
      monetization: "First validate retention and shopping-intent value; later it could support premium planning or affiliate experiments with founder approval.",
      biggestRisk: "The recommendation may be perceived as generic or encourage purchases without creating repeat product value.",
      killCondition: "Stop if fewer than 10 percent of eligible activated testers save a recommendation after a meaningful test sample.",
      scores: {
        demand: 55, revenue: 35, distribution: 75, competition: 45,
        differentiation: 65, buildEffort: 25, zeroCost: 95,
        strategicValue: 80, confidence: 25,
      },
    },
  ],
};

const MOCK_STRATEGIST_OUTPUT = {
  recommendation: "continue_research",
  rationale: "The concept is strategically aligned and inexpensive to test, but the current development fixture is not credible demand evidence and cannot justify promotion.",
  evidenceGaps: ["Interview or behavioral evidence from activated ClothMatics users", "A measured baseline for shopping-planning behavior"],
  validationExperiment: {
    hypothesis: "Activated users with at least ten catalogued items will save a personalized wardrobe-gap recommendation.",
    method: "Show a manual prototype to a small opted-in user sample and record recommendation views, saves, and qualitative objections.",
    successMetric: "At least 20 percent of eligible testers save one recommendation.",
    killCondition: "Stop if fewer than 10 percent save a recommendation after a meaningful sample.",
  },
  confidence: 30,
};

const MOCK_LEARNING_OUTPUT = {
  title: "Fixture outcomes cannot validate demand",
  observation: "The development pipeline produced structured output without any observed user behavior or external market evidence.",
  lesson: "Use development fixtures only to validate system plumbing; never promote their ideas as validated opportunities.",
  confidence: 100,
  appliesTo: "all ventures",
};

export class DevelopmentMockProvider implements AIProvider {
  readonly name = "development-mock";

  async generateText(): Promise<string> {
    return JSON.stringify(MOCK_SCOUT_OUTPUT);
  }

  async generateStructured<T>(request: GenerateRequest<T>): Promise<GenerationResult<T>> {
    const candidates = [MOCK_SCOUT_OUTPUT, MOCK_STRATEGIST_OUTPUT, MOCK_LEARNING_OUTPUT];
    const parsed = candidates.map((candidate) => request.schema.safeParse(candidate)).find((result) => result.success);
    if (!parsed?.success) throw new Error("Development mock has no fixture for the requested schema");
    return {
      data: parsed.data,
      model: "deterministic-fixture-v1",
      usage: { apiCalls: 0 },
    };
  }
}
