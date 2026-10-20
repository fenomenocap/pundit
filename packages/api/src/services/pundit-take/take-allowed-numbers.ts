import type { PunditTakePlan } from "./types";

/** Numbers the prose renderer may use (from plan + seeded facts). */
export function allowedNumbersFromPlan(plan: PunditTakePlan): Set<string> {
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

  return allowed;
}

export function sentenceUsesDisallowedNumber(sentence: string, allowed: Set<string>): boolean {
  const matches = sentence.matchAll(/(?<![./])\b(\d+(?:\.\d+)?)\b/g);
  for (const m of matches) {
    const token = m[1]!;
    if (allowed.has(token)) continue;
    const asInt = String(Math.round(Number(token)));
    if (allowed.has(asInt)) continue;
    const oneDecimal = Number(token).toFixed(1);
    if (allowed.has(oneDecimal)) continue;
    const twoDecimal = Number(token).toFixed(2);
    if (allowed.has(twoDecimal)) continue;
    return true;
  }
  return false;
}
