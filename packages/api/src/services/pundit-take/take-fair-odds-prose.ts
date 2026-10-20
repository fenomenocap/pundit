import type { Grounding } from "../ask";
import { displayOutcomeLabel } from "../basics-answer-voice";
import type { PunditTakePlan } from "./types";
export function asksFairOddsFixtureQuestion(question: string): boolean {
  const q = question.trim();
  if (/\d{1,2}\s*-\s*\d{1,2}/.test(q)) return false;
  return /\bfair odds?\b/i.test(q);
}

export function renderFairOddsTakeProse(plan: PunditTakePlan, grounding: Grounding): string {
  const lines: string[] = [];
  lines.push(`${plan.fixtureLabel} — fair 1X2 vs the best prices I have:`);
  const divergence = grounding.marketDivergence[0];
  for (const row of plan.rows) {
    const label = displayOutcomeLabel(grounding, row.outcome);
    const leg = divergence?.legs.find((l) => l.outcome === row.outcome);
    const best = row.bestDecimal;
    if (best) {
      const gap = leg?.gapPoints;
      const gapText = gap != null
        ? `${gap >= 0 ? "+" : ""}${gap.toFixed(1)} pts vs best offered`
        : "no gap computed";
      lines.push(
        `${label}: our fair ${row.fairDecimal} (${row.modelPctInt}%) vs best ${best} — ${gapText}.`,
      );
    } else {
      lines.push(`${label}: our fair ${row.fairDecimal} (${row.modelPctInt}%) — no complete market line yet.`);
    }
  }
  return lines.join("\n");
}
