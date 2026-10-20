import type { Grounding } from "../ask";
import type { MatchDossier } from "../match-dossier/types";
import { normalizeFlipClause } from "./take-flip-clause";
import type { TakePlanCall, TakePlanGridCall, TakePlanPoint } from "./types";

function teamName(grounding: Grounding, side: "home" | "away"): string {
  return side === "home" ? grounding.home : grounding.away;
}

function flipPoint(id: string, text: string, fieldPath: string): TakePlanPoint {
  return { id, role: "flip", text, fieldPath };
}

function flipFromForm(
  dossier: MatchDossier | null,
  grounding: Grounding,
  againstSide: "home" | "draw" | "away" | null,
): TakePlanPoint | null {
  if (againstSide === "home") {
    const awayForm = dossier?.form.awayLast5.value;
    if (awayForm && awayForm.played >= 3 && awayForm.goalsFor >= 2) {
      return flipPoint(
        "flip-away-attack",
        `${teamName(grounding, "away")} keep scoring in league play (${awayForm.goalsFor} in their last ${awayForm.played}).`,
        "form.awayLast5",
      );
    }
    const homeForm = dossier?.form.homeLast5.value;
    if (homeForm && homeForm.played >= 3 && homeForm.goalsAgainst >= homeForm.goalsFor + 2) {
      return flipPoint(
        "flip-home-leaky",
        `${teamName(grounding, "home")} leak more than a goal a game over their last ${homeForm.played} league outings.`,
        "form.homeLast5",
      );
    }
  }

  if (againstSide === "away") {
    const homeForm = dossier?.form.homeLast5.value;
    if (homeForm && homeForm.played >= 3 && homeForm.goalsFor >= 2) {
      return flipPoint(
        "flip-home-attack",
        `${teamName(grounding, "home")} keep scoring in league play (${homeForm.goalsFor} in their last ${homeForm.played}).`,
        "form.homeLast5",
      );
    }
  }

  if (againstSide === "draw") {
    const homeForm = dossier?.form.homeLast5.value;
    const awayForm = dossier?.form.awayLast5.value;
    if (homeForm && awayForm && homeForm.played >= 3 && awayForm.played >= 3
      && Math.abs(homeForm.goalsFor - awayForm.goalsFor) >= 2) {
      return flipPoint(
        "flip-open-game",
        "either side grabs an early lead",
        "form.homeLast5,form.awayLast5",
      );
    }
  }

  return null;
}

function buildGridMarketFlip(
  grounding: Grounding,
  dossier: MatchDossier | null,
  gridCall: TakePlanGridCall,
): TakePlanPoint | null {
  const homeForm = dossier?.form.homeLast5.value;
  const awayForm = dossier?.form.awayLast5.value;
  const home = teamName(grounding, "home");
  const away = teamName(grounding, "away");

  if (gridCall.sideKey === "under") {
    const hotAttack = (homeForm && homeForm.played >= 3 && homeForm.goalsFor >= 4)
      || (awayForm && awayForm.played >= 3 && awayForm.goalsFor >= 4);
    if (hotAttack) {
      return flipPoint(
        "flip-under-attack",
        `${home} or ${away} hit a hot streak in front of goal early`,
        "form.homeLast5,form.awayLast5",
      );
    }
    return flipPoint(
      "flip-under-default",
      "the first half sees two or more goals",
      "gridCall",
    );
  }

  if (gridCall.sideKey === "over") {
    const tight = (homeForm && homeForm.played >= 3 && homeForm.goalsAgainst <= 2 && homeForm.goalsFor <= 2)
      && (awayForm && awayForm.played >= 3 && awayForm.goalsAgainst <= 2 && awayForm.goalsFor <= 2);
    if (tight) {
      return flipPoint(
        "flip-over-tight",
        `${home} and ${away} both tighten up at the back for another week`,
        "form.homeLast5,form.awayLast5",
      );
    }
    return flipPoint(
      "flip-over-default",
      "the first hour stays goalless",
      "gridCall",
    );
  }

  if (gridCall.sideKey === "yes") {
    return flipPoint(
      "flip-btts-yes-default",
      "one side fails to register a shot on target in the first half",
      "gridCall",
    );
  }

  if (gridCall.sideKey === "no") {
    const bothScore = homeForm && awayForm && homeForm.played >= 3 && awayForm.played >= 3
      && homeForm.goalsFor >= 2 && awayForm.goalsFor >= 2;
    if (bothScore) {
      return flipPoint(
        "flip-btts-both-score",
        `${home} and ${away} both score in the first half`,
        "form.homeLast5,form.awayLast5",
      );
    }
    return flipPoint(
      "flip-btts-no-default",
      "each side scores in the first half",
      "gridCall",
    );
  }

  return null;
}

function finalizeFlipText(text: string, grounding: Grounding): string {
  return normalizeFlipClause(text, grounding.home, grounding.away) ?? text;
}

export function buildTakeFlipCondition(
  dossier: MatchDossier | null,
  grounding: Grounding,
  call: TakePlanCall,
  gridCall: TakePlanGridCall | null,
  marketKind: "1x2" | "btts" | "totals",
): TakePlanPoint | null {
  let point: TakePlanPoint | null;
  if (gridCall && marketKind !== "1x2") {
    point = buildGridMarketFlip(grounding, dossier, gridCall);
  } else {
    const against: "home" | "draw" | "away" = call.outcome;
    point = flipFromForm(dossier, grounding, against)
      ?? flipPoint(
        "flip-table-default",
        call.outcome === "draw"
          ? "the favourite scores inside the first 20 minutes"
          : `${call.outcome === "home" ? teamName(grounding, "away") : teamName(grounding, "home")} grab the first goal`,
        "call",
      );
  }
  if (!point) return null;
  const normalized = finalizeFlipText(point.text, grounding);
  return { ...point, text: normalized };
}
