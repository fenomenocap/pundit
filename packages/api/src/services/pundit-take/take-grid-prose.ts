import type { Grounding } from "../ask";
import {
  deskPercentDisplay,
  displayOutcomeLabel,
} from "../basics-answer-voice";
import type { PunditTakePlan } from "./types";
import { passPlayProseCallLine, resolvePassPlayVerdict } from "./take-pass-play-verdict";
import { renderTakeProseDeterministic } from "./take-prose";
import { format1x2V2Headline } from "./take-headline";
import { levelPassPlayPassSentence } from "./take-pass-play-opener";
import { polishTakeProseLine } from "./take-prose-polish";

export function renderPassPlayTakeProse(plan: PunditTakePlan, grounding: Grounding): string | null {
  const line = grounding.pricing.userLine;
  if (!line) {
    return `${plan.fixtureLabel} — add a decimal line on home, draw, or away before I can call pass or play.`;
  }
  const verdict = resolvePassPlayVerdict(grounding);
  if (!verdict) {
    return `${plan.fixtureLabel} — add a decimal line on home, draw, or away before I can call pass or play.`;
  }
  const body = plan.supporting[0]?.text ? polishTakeProseLine(plan.supporting[0].text) : undefined;
  if (verdict.levelNoSide) {
    // Level 1X2: same no-side headline as who-wins/why, then a Pass at the user's price. No side named as a pick.
    const headline = format1x2V2Headline(plan.fixtureLabel, grounding, "full");
    return [headline, levelPassPlayPassSentence(line.decimalOdds), body].filter(Boolean).join("\n\n");
  }
  const label = displayOutcomeLabel(grounding, line.outcome);
  const modelP = grounding.pricing.model[line.outcome].p;
  const callLine = passPlayProseCallLine(grounding, verdict);
  const opener = `${plan.fixtureLabel} — ${callLine}`;
  const implied = deskPercentDisplay(1 / line.decimalOdds);
  const modelPct = deskPercentDisplay(modelP);
  const context = `That price implies ${implied}; I have ${label} at ${modelPct}.`;
  return [opener, polishTakeProseLine(context), body].filter(Boolean).join("\n\n");
}

/** Grid markets use the same renderer path as 1X2 once the plan carries `gridCall`. */
export function renderGridTakeProse(plan: PunditTakePlan, variant: "full" | "why" = "full"): string {
  return renderTakeProseDeterministic(plan, variant);
}
