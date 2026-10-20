import type { Grounding } from "../ask";
import { displayOutcomeLabel } from "../basics-answer-voice";
import { modelGapPointsVsBestDecimal } from "./take-maths";
import type { PunditTakePlan, TakePlanRow } from "./types";

export function asksFairOddsFixtureQuestion(question: string): boolean {
  const q = question.trim();
  if (/\d{1,2}\s*-\s*\d{1,2}/.test(q)) return false;
  return /\bfair odds?\b/i.test(q);
}

type OutcomeKey = TakePlanRow["outcome"];

function fairPricesClause(plan: PunditTakePlan, grounding: Grounding): string {
  const parts: string[] = [];
  for (const outcome of ["home", "draw", "away"] as const) {
    const row = plan.rows.find((r) => r.outcome === outcome);
    if (!row) continue;
    const label = outcome === "draw" ? "Draw" : displayOutcomeLabel(grounding, outcome);
    parts.push(`${label} ${row.fairDecimal}`);
  }
  return `My fair prices: ${parts.join(", ")}.`;
}

/** Club names take plural verbs; the draw stays singular. */
function sideLinkVerb(outcome: OutcomeKey): "are" | "is" {
  return outcome === "draw" ? "is" : "are";
}

function valueSideSentence(
  valueLeg: {
    label: string;
    outcome: OutcomeKey;
    fairDecimal: string;
    modelPctInt: number;
    bestDecimal: string;
    gap: number;
  },
): string {
  const best = Number.parseFloat(valueLeg.bestDecimal);
  const fair = Number.parseFloat(valueLeg.fairDecimal);
  const link = sideLinkVerb(valueLeg.outcome);
  if (Number.isFinite(best) && Number.isFinite(fair) && best < fair) {
    return `${valueLeg.label} at ${valueLeg.bestDecimal} ${link} too short; I make them ${valueLeg.fairDecimal} (${valueLeg.modelPctInt}%), so there's no value there.`;
  }
  const gapText = `${valueLeg.gap >= 0 ? "+" : ""}${valueLeg.gap.toFixed(1)}`;
  return `${valueLeg.label} at ${valueLeg.bestDecimal} ${link} bigger than my ${valueLeg.fairDecimal} (${valueLeg.modelPctInt}%), so that's the value side, ${gapText} pts in our favour.`;
}

/** Fair-odds policy prose: fair 1X2 line + plain-English value direction (table/footer unchanged). */
export function renderFairOddsTakeProse(plan: PunditTakePlan, grounding: Grounding): string {
  let valueLeg: {
    label: string;
    outcome: OutcomeKey;
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
        outcome: row.outcome,
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

  const fairLine = fairPricesClause(plan, grounding);
  const valueLine = valueSideSentence(valueLeg);
  return `${plan.fixtureLabel} — ${fairLine} ${valueLine}`;
}
