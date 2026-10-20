import type { Grounding } from "../ask";
import {
  deskPercentDisplay,
  deskProbabilityDisplay,
  displayOutcomeLabel,
} from "../basics-answer-voice";
import { resolveUserLineDecision, userLineGapPoints } from "../response-correctness";

export function formatPassPlayLineTable(grounding: Grounding): string {
  const line = grounding.pricing.userLine;
  if (!line) return "";
  const label = displayOutcomeLabel(grounding, line.outcome);
  const modelP = grounding.pricing.model[line.outcome].p;
  const { displayPct, fairDecimal } = deskProbabilityDisplay(modelP);
  const impliedP = 1 / line.decimalOdds;
  const impliedPct = deskPercentDisplay(impliedP);
  const gapPoints = userLineGapPoints(modelP, line.decimalOdds);
  const gapSign = gapPoints >= 0 ? "+" : "";
  const dec = line.decimalOdds.toFixed(2);
  const decision = resolveUserLineDecision(line, gapPoints);
  const call = decision === "pass" ? "Pass" : decision === "play" ? "Play" : "No call";
  return [
    "| Side | Model | Fair | Your line | Gap | Call |",
    "| --- | --- | --- | --- | --- | --- |",
    `| ${label} | ${displayPct} | ${fairDecimal} | ${dec} (${impliedPct}) | ${gapSign}${gapPoints.toFixed(1)} pts | ${call} |`,
  ].join("\n");
}
