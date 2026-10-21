import type { Grounding } from "../ask";
import type { PunditTakePlan } from "./types";

const COIN_FLIP_GAP_POINTS = 2;

const GRID_SIDE_TIE_ORDER: Record<string, number> = {
  home: 0,
  yes: 0,
  over: 0,
  draw: 1,
  no: 1,
  under: 1,
  away: 2,
};

function gridSideTieBreak(aKey: string, bKey: string): number {
  return (GRID_SIDE_TIE_ORDER[aKey] ?? 99) - (GRID_SIDE_TIE_ORDER[bKey] ?? 99);
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
  const sorted = sides.slice().sort((a, b) => b.p - a.p || gridSideTieBreak(a.sideKey, b.sideKey));
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
