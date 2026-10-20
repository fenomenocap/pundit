import type { Grounding } from "../ask";
import { displayOutcomeLabel } from "../basics-answer-voice";
import { modelGapPointsVsBestDecimal } from "./take-maths";
import type { PunditTakePlan } from "./types";

export function asksFairOddsFixtureQuestion(question: string): boolean {
  const q = question.trim();
  if (/\d{1,2}\s*-\s*\d{1,2}/.test(q)) return false;
  return /\bfair odds?\b/i.test(q);
}

export function renderFairOddsTakeProse(plan: PunditTakePlan, grounding: Grounding): string {
  let bestLeg: {
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
    if (!bestLeg || Math.abs(gap) > Math.abs(bestLeg.gap)) {
      bestLeg = {
        label: displayOutcomeLabel(grounding, row.outcome),
        fairDecimal: row.fairDecimal,
        modelPctInt: row.modelPctInt,
        bestDecimal: best,
        gap,
      };
    }
  }

  const opener = `${plan.fixtureLabel} — fair 1X2 vs the best prices I have:`;
  if (!bestLeg) {
    return `${opener} no complete market line to compare yet — see the table for our fair prices.`;
  }

  const gapText = `${bestLeg.gap >= 0 ? "+" : ""}${bestLeg.gap.toFixed(1)} pts vs best offered`;
  const edgeSide = bestLeg.gap >= 0 ? "looks light vs our fair price" : "looks rich vs our fair price";
  return `${opener} the biggest gap is ${bestLeg.label} (${bestLeg.gap >= 0 ? "our" : "market"} side ${edgeSide}: fair ${bestLeg.fairDecimal} (${bestLeg.modelPctInt}%) vs best ${bestLeg.bestDecimal}, ${gapText}).`;
}
