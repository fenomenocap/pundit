import type { PunditTakePlan } from "./types";

function callModelPct(plan: PunditTakePlan): number {
  const row = plan.rows.find((r) => r.outcome === plan.call.outcome);
  return row?.modelPctInt ?? 0;
}

function joinBodySentences(points: { text: string }[], max: number): string {
  return points
    .slice(0, max)
    .map((p) => p.text.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .map((p) => (p.endsWith(".") ? p : `${p}.`))
    .join(" ");
}

export function joinBodySentencesFromPlan(plan: PunditTakePlan, max: number): string {
  const bodyPoints = [
    ...plan.supporting,
    ...plan.contradicting,
    ...(plan.flipCondition ? [plan.flipCondition] : []),
  ];
  return joinBodySentences(bodyPoints, max);
}

export function renderTakeProseDeterministic(plan: PunditTakePlan, variant: "full" | "why" = "full"): string {
  const pct = callModelPct(plan);
  const opener = variant === "why"
    ? `On ${plan.fixtureLabel}, I have ${plan.call.headlineLabel} at ${pct}%.`
    : `${plan.fixtureLabel} — ${plan.call.headlineLabel} at ${pct}%.`;

  const body = joinBodySentencesFromPlan(plan, 3);
  const valueSentence = plan.valueLeg?.bestMarketDecimal
    ? `The value is ${plan.valueLeg.label} at ${plan.valueLeg.bestMarketDecimal} against our fair ${plan.valueLeg.fairDecimal}.`
    : null;

  const blocks = [opener];
  if (body) blocks.push(body);
  if (valueSentence) blocks.push(valueSentence);
  return blocks.join("\n\n");
}
