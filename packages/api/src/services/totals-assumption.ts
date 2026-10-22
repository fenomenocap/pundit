import type { Grounding } from "./ask";

export const SHARED_TOTAL_XG_SENTENCE =
  "I use a fixed total-goals assumption, so these totals cannot tell me whether this particular match will be more open or tighter.";
export const CALIBRATED_GOALS_SENTENCE =
  "I estimate goals from historical scoring patterns and team ratings; these are forecasts, not guarantees.";

export function totalsAssumptionSentence(grounding: Grounding): string {
  return grounding.goalCalibration?.methodId === "outcome-anchored-shrunk-goals-v2"
    ? CALIBRATED_GOALS_SENTENCE
    : SHARED_TOTAL_XG_SENTENCE;
}
