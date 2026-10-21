import type { Grounding } from "../ask";
import type { PunditTakePlan } from "./types";
import { deskPercentDisplay, displayOutcomeLabel } from "../basics-answer-voice";

export const COIN_FLIP_GAP_POINTS = 2;

export function oneXTwoTopGapPoints(grounding: Grounding): number {
  const sorted = [grounding.pHome, grounding.pDraw, grounding.pAway].slice().sort((a, b) => b - a);
  return (sorted[0] - sorted[1]) * 100;
}

export function is1x2SidePickSuppressed(grounding: Grounding): boolean {
  return oneXTwoTopGapPoints(grounding) < COIN_FLIP_GAP_POINTS;
}

export function format1x2V2Headline(
  fixtureLabel: string,
  grounding: Grounding,
  variant: "full" | "why",
): string {
  const pct = deskPercentDisplay(
    Math.max(grounding.pHome, grounding.pDraw, grounding.pAway),
  );
  if (is1x2SidePickSuppressed(grounding)) {
    return variant === "why"
      ? `On ${fixtureLabel}, the sides are level at ${pct} each; I have no side.`
      : `${fixtureLabel} — level at ${pct} each; I have no side.`;
  }
  const ranked = ([
    { outcome: "home" as const, p: grounding.pHome },
    { outcome: "draw" as const, p: grounding.pDraw },
    { outcome: "away" as const, p: grounding.pAway },
  ] as const).slice().sort((a, b) => b.p - a.p);
  const top = ranked[0];
  const label = displayOutcomeLabel(grounding, top.outcome);
  const headline = top.outcome === "draw" ? "the draw" : label;
  const display = deskPercentDisplay(top.p);
  return variant === "why"
    ? `On ${fixtureLabel}, I have ${headline} at ${display}.`
    : `${fixtureLabel} — ${headline} at ${display}.`;
}

export function gridHeadlineOpener(plan: PunditTakePlan, variant: "full" | "why"): string | null {
  if (!plan.gridCall) return null;
  const pct = plan.gridCall.modelPctDisplay;
  if (plan.gridCall.coinFlip) {
    return variant === "why"
      ? `On ${plan.fixtureLabel}, the sides are level at ${pct} each; I have no side.`
      : `${plan.fixtureLabel} — level at ${pct} each; I have no side.`;
  }
  const label = plan.gridCall.headlineLabel;
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
