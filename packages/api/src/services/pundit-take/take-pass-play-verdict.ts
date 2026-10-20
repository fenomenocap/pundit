import type { Grounding } from "../ask";
import {
  displayOutcomeLabel,
} from "../basics-answer-voice";
import {
  resolveUserLineDecision,
  userLineGapPoints,
} from "../response-correctness";

export type PassPlayDecision = ReturnType<typeof resolveUserLineDecision>;

export interface PassPlayVerdict {
  gapPoints: number;
  decision: PassPlayDecision;
  tableCall: "Play" | "Pass" | "No call";
}

export function resolvePassPlayVerdict(grounding: Grounding): PassPlayVerdict | null {
  const line = grounding.pricing.userLine;
  if (!line) return null;
  const modelP = grounding.pricing.model[line.outcome].p;
  const gapPoints = userLineGapPoints(modelP, line.decimalOdds);
  const decision = resolveUserLineDecision(line, gapPoints);
  const tableCall = decision === "pass" ? "Pass" : decision === "play" ? "Play" : "No call";
  return { gapPoints, decision, tableCall };
}

export function passPlayProseCallLine(
  grounding: Grounding,
  verdict: PassPlayVerdict,
): string {
  const line = grounding.pricing.userLine!;
  const label = displayOutcomeLabel(grounding, line.outcome);
  const leanLabel = line.outcome === "draw" ? "the draw" : label;
  const dec = line.decimalOdds.toFixed(2);
  const { gapPoints, decision } = verdict;
  if (decision === "pass") {
    if (gapPoints >= 0) {
      return `I pass on ${leanLabel} at ${dec} — the edge is below my play threshold.`;
    }
    return `I pass on ${leanLabel} at ${dec}.`;
  }
  if (decision === "abstain") {
    return `I will not call ${leanLabel} at ${dec} — the edge is below my play threshold.`;
  }
  const size = Math.abs(gapPoints) >= 15 ? "strong play" : Math.abs(gapPoints) >= 5 ? "play" : "small play";
  return `${leanLabel} at ${dec}, ${size} — I play.`;
}
