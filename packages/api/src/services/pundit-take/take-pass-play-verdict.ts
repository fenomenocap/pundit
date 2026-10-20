import type { Grounding } from "../ask";
import { formatUserLineLean } from "../basics-answer-voice";
import {
  resolveUserLineDecision,
  userLinePassPlayTableCall,
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
  return { gapPoints, decision, tableCall: userLinePassPlayTableCall(decision) };
}

/** Same play / pass / no-call wording as the deterministic composer (`formatUserLineLean`). */
export function passPlayProseCallLine(
  grounding: Grounding,
  verdict: PassPlayVerdict,
): string {
  const line = grounding.pricing.userLine!;
  const lean = formatUserLineLean(
    grounding,
    line.outcome,
    line.decimalOdds,
    verdict.gapPoints,
    verdict.decision,
  );
  return lean.replace(/^Lean: /, "");
}
