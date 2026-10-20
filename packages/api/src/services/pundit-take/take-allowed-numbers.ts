import type { Grounding } from "../ask";
import { modelGapPointsVsBestDecimal } from "./take-maths";
import type { PunditTakePlan } from "./types";

/** Numbers the prose renderer may use (from plan + seeded facts). */
export function allowedNumbersFromPlan(plan: PunditTakePlan, grounding?: Grounding): Set<string> {
  const allowed = new Set<string>();

  const ingest = (text: string) => {
    for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) allowed.add(m[1]!);
    for (const m of text.matchAll(/\b(\d+(?:\.\d+)?)(?=(?:st|nd|rd|th)\b)/g)) allowed.add(m[1]!);
    for (const m of text.matchAll(/\b(\d+(?:\.\d+)?)-point\b/g)) allowed.add(m[1]!);
    for (const m of text.matchAll(/(?<![./])\b(\d+(?:\.\d+)?)\b/g)) allowed.add(m[1]!);
  };

  for (const p of [...plan.supporting, ...plan.contradicting, plan.flipCondition].filter(Boolean)) {
    ingest(p!.text);
  }

  for (const row of plan.rows) {
    allowed.add(String(row.modelPctInt));
    ingest(row.fairDecimal);
    for (const dec of Object.values(row.sourceDecimals)) {
      if (dec) ingest(dec);
    }
    if (row.bestDecimal) ingest(row.bestDecimal);
  }

  for (const row of plan.gridRows) {
    allowed.add(String(row.modelPctInt));
    ingest(row.fairDecimal);
    ingest(row.label);
  }

  if (plan.gridCall) {
    allowed.add(String(plan.gridCall.modelPctInt));
    ingest(plan.gridCall.modelPctDisplay);
    ingest(plan.gridCall.fairDecimal);
    ingest(plan.gridCall.headlineLabel);
  }

  if (plan.marketKind === "totals") {
    allowed.add("2.5");
  }

  const callRow = plan.rows.find((r) => r.outcome === plan.call.outcome);
  if (callRow) allowed.add(String(callRow.modelPctInt));

  if (plan.valueLeg) {
    allowed.add(String(plan.valueLeg.modelPctInt));
    ingest(plan.valueLeg.fairDecimal);
    if (plan.valueLeg.bestMarketDecimal) ingest(plan.valueLeg.bestMarketDecimal);
    allowed.add(String(Math.abs(plan.valueLeg.gapPoints)));
  }

  if (grounding?.pricing.userLine?.decimalOdds != null) {
    const dec = grounding.pricing.userLine.decimalOdds;
    allowed.add(String(dec));
    allowed.add(dec.toFixed(2));
  }

  if (grounding) {
    for (const divergence of grounding.marketDivergence) {
      for (const leg of divergence.legs) {
        allowed.add(String(Math.round(leg.marketPercent)));
        allowed.add(String(Math.round(leg.modelPercent)));
        allowed.add(String(Math.round(Math.abs(leg.gapPoints))));
        allowed.add(String(Math.abs(leg.gapPoints).toFixed(1)));
      }
    }
    for (const row of plan.rows) {
      const p = row.outcome === "home" ? grounding.pHome : row.outcome === "draw" ? grounding.pDraw : grounding.pAway;
      if (row.bestDecimal) {
        const gap = modelGapPointsVsBestDecimal(p, row.bestDecimal);
        if (gap != null) {
          allowed.add(String(Math.abs(gap).toFixed(1)));
          allowed.add(String(Math.round(Math.abs(gap))));
        }
      }
    }
  }

  return allowed;
}

export function sentenceUsesDisallowedNumber(sentence: string, allowed: Set<string>): boolean {
  const matches = sentence.matchAll(/(?<![./])\b(\d+(?:\.\d+)?)\b/g);
  for (const m of matches) {
    const token = m[1]!;
    if (allowed.has(token)) continue;
    const asInt = String(Math.round(Number(token)));
    if (allowed.has(asInt)) continue;
    return true;
  }
  return false;
}
