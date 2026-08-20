import type { ScoutOpportunity } from "@jarvis/types";

export const SCORE_WEIGHTS = Object.freeze({
  demand: 0.2,
  revenue: 0.2,
  distribution: 0.15,
  zeroCost: 0.15,
  speedToValidate: 0.1,
  competitionAdvantage: 0.1,
  differentiation: 0.05,
  strategicValue: 0.05,
});

export function calculateOpportunityScore(scores: ScoutOpportunity["scores"]): number {
  const weighted =
    scores.demand * SCORE_WEIGHTS.demand +
    scores.revenue * SCORE_WEIGHTS.revenue +
    scores.distribution * SCORE_WEIGHTS.distribution +
    scores.zeroCost * SCORE_WEIGHTS.zeroCost +
    (100 - scores.buildEffort) * SCORE_WEIGHTS.speedToValidate +
    (100 - scores.competition) * SCORE_WEIGHTS.competitionAdvantage +
    scores.differentiation * SCORE_WEIGHTS.differentiation +
    scores.strategicValue * SCORE_WEIGHTS.strategicValue;

  return Math.round(Math.max(0, Math.min(100, weighted)) * 10) / 10;
}
