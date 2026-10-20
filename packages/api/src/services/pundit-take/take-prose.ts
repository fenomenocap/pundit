import type { PunditTakePlan } from "./types";

function callModelPct(plan: PunditTakePlan): number {
  if (plan.gridCall) return plan.gridCall.modelPctInt;
  const row = plan.rows.find((r) => r.outcome === plan.call.outcome);
  return row?.modelPctInt ?? 0;
}

function headlineLabel(plan: PunditTakePlan): string {
  if (plan.gridCall) return plan.gridCall.headlineLabel;
  return plan.call.headlineLabel;
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

function weaveBody(plan: PunditTakePlan): string {
  const support = plan.supporting.slice(0, 2).map((p) => p.text.trim().replace(/\.$/, ""));
  const counter = plan.contradicting[0]?.text.trim().replace(/\.$/, "");
  const flip = plan.flipCondition?.text.trim().replace(/\.$/, "");

  const chunks: string[] = [];
  if (support.length) chunks.push(support.join("; ") + ".");
  if (counter) {
    chunks.push(counter.endsWith(".") ? counter : `${counter}.`);
  }
  if (flip) {
    chunks.push(`I'd revisit if ${flip.charAt(0).toLowerCase()}${flip.slice(1)}${flip.endsWith(".") ? "" : "."}`);
  }
  return chunks.slice(0, 3).join(" ");
}

export function renderTakeProseDeterministic(plan: PunditTakePlan, variant: "full" | "why" = "full"): string {
  const pct = callModelPct(plan);
  const label = headlineLabel(plan);
  const opener = variant === "why"
    ? `On ${plan.fixtureLabel}, I have ${label} at ${pct}%.`
    : `${plan.fixtureLabel} — ${label} at ${pct}%.`;

  const body = weaveBody(plan);
  const valueSentence = plan.valueLeg?.bestMarketDecimal
    ? `The value is ${plan.valueLeg.label} at ${plan.valueLeg.bestMarketDecimal} against our fair ${plan.valueLeg.fairDecimal}.`
    : null;

  const blocks = [opener];
  if (body.trim()) blocks.push(body.trim());
  if (valueSentence) blocks.push(valueSentence);
  return blocks.join("\n\n");
}
