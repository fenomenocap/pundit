import type { Grounding } from "../ask";
import type { PunditTakePlan } from "./types";
import { appendWhatFlipsItClosing } from "./take-flip-prose";
import { gridHeadlineOpener, isGenuineTossUp1x2, stripFalseTossUpLanguage } from "./take-headline";
import { capitalizeTakeProse, polishTakeProseLine, valueLegMatchesHeadline } from "./take-prose-polish";

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
  ];
  return joinBodySentences(bodyPoints, max);
}

function weaveBody(plan: PunditTakePlan, grounding: Grounding | null): string {
  const support = plan.supporting.slice(0, 2).map((p) => polishTakeProseLine(p.text.trim().replace(/\.$/, "")));
  let counter = plan.contradicting[0]?.text.trim().replace(/\.$/, "");
  if (counter) counter = polishTakeProseLine(counter);
  if (counter && grounding && !isGenuineTossUp1x2(grounding)) {
    counter = stripFalseTossUpLanguage(counter, grounding);
  }

  const chunks: string[] = [];
  if (support.length) chunks.push(support.join("; ") + ".");
  if (counter) {
    chunks.push(counter.endsWith(".") ? counter : `${counter}.`);
  }
  return chunks.slice(0, 2).join(" ");
}

export function renderTakeProseDeterministic(
  plan: PunditTakePlan,
  variant: "full" | "why" = "full",
  grounding: Grounding | null = null,
): string {
  const gridOpener = gridHeadlineOpener(plan, variant);
  const pct = callModelPct(plan);
  const label = headlineLabel(plan);
  const opener = gridOpener ?? (variant === "why"
    ? `On ${plan.fixtureLabel}, I have ${label} at ${pct}%.`
    : `${plan.fixtureLabel} — ${label} at ${pct}%.`);

  const body = weaveBody(plan, grounding);
  let valueSentence: string | null = null;
  if (plan.valueLeg?.bestMarketDecimal) {
    if (valueLegMatchesHeadline(plan)) {
      valueSentence = `The value is ${plan.valueLeg.label} at ${plan.valueLeg.bestMarketDecimal} against our fair ${plan.valueLeg.fairDecimal}.`;
    } else {
      valueSentence = `Separately, ${plan.valueLeg.label} at ${plan.valueLeg.bestMarketDecimal} looks rich against our fair ${plan.valueLeg.fairDecimal}.`;
    }
  }

  const blocks = [polishTakeProseLine(opener)];
  if (body.trim()) blocks.push(body.trim());
  if (valueSentence) blocks.push(polishTakeProseLine(valueSentence));
  return capitalizeTakeProse(appendWhatFlipsItClosing(plan, blocks.join("\n\n"), grounding));
}
