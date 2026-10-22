import type { Grounding } from "../ask";
import { formatUserLineLean } from "../basics-answer-voice";
import {
  resolveUserLineDecision,
  userLinePassPlayTableCall,
  userLineGapPoints,
} from "../response-correctness";
import { is1x2SidePickSuppressed } from "./take-headline";

export type PassPlayDecision = ReturnType<typeof resolveUserLineDecision>;

export interface PassPlayVerdict {
  gapPoints: number;
  decision: PassPlayDecision;
  tableCall: "Play" | "Pass" | "No call";
  /** Level 1X2 (top two raw outcomes within COIN_FLIP_GAP_POINTS): no side, so any quoted price is a Pass. */
  levelNoSide: boolean;
}

export function resolvePassPlayVerdict(grounding: Grounding): PassPlayVerdict | null {
  const line = grounding.pricing.userLine;
  if (!line) return null;
  const modelP = grounding.pricing.model[line.outcome].p;
  const gapPoints = userLineGapPoints(modelP, line.decimalOdds);
  // types.ts levelNoSide: a level game has no side pick, value, or flip, so a user-quoted price never plays.
  const levelNoSide = is1x2SidePickSuppressed(grounding);
  const decision = levelNoSide ? "pass" : resolveUserLineDecision(line, gapPoints);
  return { gapPoints, decision, tableCall: userLinePassPlayTableCall(decision), levelNoSide };
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
