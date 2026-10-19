import type { Grounding } from "../ask";
import {
  deskPercentDisplay,
  displayOutcomeLabel,
  formatUserLineSideRow,
} from "../basics-answer-voice";
import type { PunditTakePlan } from "./types";
import { renderTakeProseDeterministic } from "./take-prose";

export function renderPassPlayTakeProse(plan: PunditTakePlan, grounding: Grounding): string | null {
  const line = grounding.pricing.userLine;
  if (!line) {
    return `${plan.fixtureLabel} — add a decimal line on home, draw, or away before I can call pass or play.`;
  }
  const label = displayOutcomeLabel(grounding, line.outcome);
  const modelP = grounding.pricing.model[line.outcome].p;
  const impliedP = 1 / line.decimalOdds;
  const gapPoints = Math.round((modelP - impliedP) * 1000) / 10;
  const decimal = line.decimalOdds.toFixed(2);
  const decision = line.decimalOdds >= line.playPrice
    ? "play"
    : line.decimalOdds < line.passPrice
      ? "pass"
      : "abstain";
  const leanLabel = line.outcome === "draw" ? "the draw" : label;
  let callLine: string;
  if (decision === "pass") {
    callLine = `I pass on ${leanLabel} at ${decimal}.`;
  } else if (decision === "abstain") {
    callLine = `I will not call ${leanLabel} at ${decimal}.`;
  } else {
    const size = Math.abs(gapPoints) >= 15 ? "strong play" : Math.abs(gapPoints) >= 5 ? "play" : "small play";
    callLine = `${leanLabel} at ${decimal}, ${size} — I play.`;
  }
  const opener = `${plan.fixtureLabel} — ${callLine}`;
  const implied = deskPercentDisplay(impliedP);
  const modelPct = deskPercentDisplay(modelP);
  const context = `That price implies ${implied}; I have ${label} at ${modelPct}. ${formatUserLineSideRow(grounding, line.outcome, line.decimalOdds, gapPoints)}`;
  const body = plan.supporting[0]?.text;
  return [opener, context, body].filter(Boolean).join("\n\n");
}

/** Grid markets use the same renderer path as 1X2 once the plan carries `gridCall`. */
export function renderGridTakeProse(plan: PunditTakePlan, variant: "full" | "why" = "full"): string {
  return renderTakeProseDeterministic(plan, variant);
}
