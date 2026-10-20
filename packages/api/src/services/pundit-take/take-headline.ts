import type { Grounding } from "../ask";
import type { PunditTakePlan } from "./types";

/** Top-two probability gap (percentage points) below which coin-flip language is allowed. */
export const COIN_FLIP_GAP_POINTS = 2;

export function topTwoGapPointsFromProbabilities(probabilities: number[]): number {
  const sorted = probabilities.slice().sort((a, b) => b - a);
  if (sorted.length < 2) return 100;
  return Math.abs(sorted[0] - sorted[1]) * 100;
}

export function topTwoGapPoints1x2(grounding: Grounding): number {
  return topTwoGapPointsFromProbabilities([grounding.pHome, grounding.pDraw, grounding.pAway]);
}

export function allowsCoinFlipLanguage(plan: PunditTakePlan, grounding: Grounding): boolean {
  if (plan.gridCall) {
    const rows = plan.gridRows.map((r) => r.modelPctInt / 100);
    return topTwoGapPointsFromProbabilities(rows) < COIN_FLIP_GAP_POINTS;
  }
  return topTwoGapPoints1x2(grounding) < COIN_FLIP_GAP_POINTS;
}

export function gridHeadlineOpener(plan: PunditTakePlan, variant: "full" | "why"): string | null {
  if (!plan.gridCall) return null;
  const pct = plan.gridCall.modelPctDisplay;
  const label = plan.gridCall.headlineLabel;
  if (plan.gridCall.coinFlip) {
    return variant === "why"
      ? `On ${plan.fixtureLabel}, it's a coin flip — I lean ${label} at ${pct}.`
      : `${plan.fixtureLabel} — coin flip, lean ${label} at ${pct}.`;
  }
  return variant === "why"
    ? `On ${plan.fixtureLabel}, I have ${label} at ${pct}.`
    : `${plan.fixtureLabel} — ${label} at ${pct}.`;
}

export function pickHigherGridSide(
  sides: Array<{ sideKey: string; label: string; p: number }>,
): { sideKey: string; label: string; p: number; coinFlip: boolean } {
  const sorted = sides.slice().sort((a, b) => b.p - a.p);
  const top = sorted[0];
  const second = sorted[1];
  const gapPts = second ? Math.abs(top.p - second.p) * 100 : 100;
  return { ...top, coinFlip: gapPts < COIN_FLIP_GAP_POINTS };
}

/** @deprecated use allowsCoinFlipLanguage */
export function isGenuineTossUp1x2(grounding: Grounding): boolean {
  return topTwoGapPoints1x2(grounding) < COIN_FLIP_GAP_POINTS;
}

export function stripFalseTossUpLanguage(text: string, grounding: Grounding): string {
  if (isGenuineTossUp1x2(grounding)) return text;
  return text
    .replace(/\bessentially a toss-up\b/gi, "")
    .replace(/\ba genuine toss-up\b/gi, "")
    .replace(/\ba toss-up\b/gi, "")
    .replace(/\btoss-up\b/gi, "")
    .replace(/\bcoin-flip\b/gi, "")
    .replace(/\bcoin flip\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
