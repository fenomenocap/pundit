import type { Grounding } from "../ask";
import {
  deskPercentDisplay,
  displayOutcomeLabel,
  formatUserLineSideRow,
} from "../basics-answer-voice";
import type { PunditTakePlan } from "./types";
import { joinBodySentencesFromPlan } from "./take-prose";

function pctInt(p: number): number {
  return Math.round(p * 100);
}

export function renderBttsTakeProse(plan: PunditTakePlan, grounding: Grounding): string {
  const opener = `${plan.fixtureLabel} — BTTS yes at ${pctInt(grounding.pBttsYes)}%.`;
  const split = `BTTS no sits at ${pctInt(grounding.pBttsNo)}%.`;
  const body = joinBodySentencesFromPlan(plan, 2);
  return [opener, split, body].filter(Boolean).join("\n\n");
}

export function renderTotalsTakeProse(plan: PunditTakePlan, grounding: Grounding, underFocus: boolean): string {
  const lead = underFocus ? "Under 2.5" : "Over 2.5";
  const leadP = underFocus ? grounding.pUnder2_5 : grounding.pOver2_5;
  const otherP = underFocus ? grounding.pOver2_5 : grounding.pUnder2_5;
  const otherLabel = underFocus ? "Over 2.5" : "Under 2.5";
  const opener = `${plan.fixtureLabel} — ${lead} at ${pctInt(leadP)}%.`;
  const split = `${otherLabel} sits at ${pctInt(otherP)}%.`;
  const body = joinBodySentencesFromPlan(plan, 2);
  return [opener, split, body].filter(Boolean).join("\n\n");
}

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
  const modelRow = formatUserLineSideRow(grounding, line.outcome, line.decimalOdds, gapPoints);
  const implied = deskPercentDisplay(impliedP);
  const context = `That line implies ${implied}; my model has ${label} at ${deskPercentDisplay(modelP)}. ${modelRow}`;
  const body = joinBodySentencesFromPlan(plan, 1);
  return [opener, context, body].filter(Boolean).join("\n\n");
}
