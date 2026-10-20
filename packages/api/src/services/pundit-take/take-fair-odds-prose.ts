import type { Grounding } from "../ask";
import { displayOutcomeLabel } from "../basics-answer-voice";
import { modelGapPointsVsBestDecimal } from "./take-maths";
import type { PunditTakePlan } from "./types";

export function asksFairOddsFixtureQuestion(question: string): boolean {
  const q = question.trim();
  if (/\d{1,2}\s*-\s*\d{1,2}/.test(q)) return false;
  return /\bfair odds?\b/i.test(q);
}

/** One sentence on the value side; table carries the rest. No "model" in prose. */
export function renderFairOddsTakeProse(plan: PunditTakePlan, grounding: Grounding): string {
  let valueLeg: {
    label: string;
    fairDecimal: string;
    modelPctInt: number;
    bestDecimal: string;
    gap: number;
  } | null = null;

  for (const row of plan.rows) {
    const best = row.bestDecimal;
    if (!best) continue;
    const p = row.outcome === "home" ? grounding.pHome : row.outcome === "draw" ? grounding.pDraw : grounding.pAway;
    const gap = modelGapPointsVsBestDecimal(p, best);
    if (gap == null) continue;
    if (!valueLeg || Math.abs(gap) > Math.abs(valueLeg.gap)) {
      valueLeg = {
        label: displayOutcomeLabel(grounding, row.outcome),
        fairDecimal: row.fairDecimal,
        modelPctInt: row.modelPctInt,
        bestDecimal: best,
        gap,
      };
    }
  }

  if (!valueLeg) {
    return `${plan.fixtureLabel} — I don't have a complete market line to compare yet; see the table for our fair 1X2 prices.`;
  }

  const gapText = `${valueLeg.gap >= 0 ? "+" : ""}${valueLeg.gap.toFixed(1)} pts vs best offered`;
  const edge = valueLeg.gap >= 0
    ? `${valueLeg.label} looks light at ${valueLeg.bestDecimal} against our fair ${valueLeg.fairDecimal} (${valueLeg.modelPctInt}%, ${gapText}).`
    : `${valueLeg.label} looks rich at ${valueLeg.bestDecimal} against our fair ${valueLeg.fairDecimal} (${valueLeg.modelPctInt}%, ${gapText}).`;
  return `${plan.fixtureLabel} — ${edge}`;
}
