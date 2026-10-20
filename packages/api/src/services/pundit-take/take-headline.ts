import type { Grounding } from "../ask";
import type { PunditTakePlan } from "./types";

const COIN_FLIP_GAP_POINTS = 2;

export function gridHeadlineOpener(plan: PunditTakePlan, variant: "full" | "why"): string | null {
  if (!plan.gridCall) return null;
  const pct = plan.gridCall.modelPctInt;
  const label = plan.gridCall.headlineLabel;
  if (plan.gridCall.coinFlip) {
    return variant === "why"
      ? `On ${plan.fixtureLabel}, it's a coin flip — I lean ${label} at ${pct}%.`
      : `${plan.fixtureLabel} — coin flip, lean ${label} at ${pct}%.`;
  }
  return variant === "why"
    ? `On ${plan.fixtureLabel}, I have ${label} at ${pct}%.`
    : `${plan.fixtureLabel} — ${label} at ${pct}%.`;
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

export function isGenuineTossUp1x2(grounding: Grounding): boolean {
  const sorted = [grounding.pHome, grounding.pDraw, grounding.pAway].slice().sort((a, b) => b - a);
  if (sorted[0] < 0.4) return true;
  if (sorted[0] - sorted[1] <= 0.05) return true;
  return false;
}

export function stripFalseTossUpLanguage(text: string, grounding: Grounding): string {
  if (isGenuineTossUp1x2(grounding)) return text;
  return text
    .replace(/\bessentially a toss-up\b/gi, "")
    .replace(/\ba toss-up\b/gi, "")
    .replace(/\btoss-up\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
