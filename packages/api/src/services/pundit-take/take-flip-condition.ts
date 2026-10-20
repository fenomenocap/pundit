import type { Grounding } from "../ask";
import type { MatchDossier } from "../match-dossier/types";
import { takeEligibleDossierEvidence } from "./take-dossier-evidence";
import { isGenuineTossUp1x2 } from "./take-headline";
import type { TakePlanCall, TakePlanGridCall, TakePlanPoint } from "./types";

function teamName(grounding: Grounding, side: "home" | "away"): string {
  return side === "home" ? grounding.home : grounding.away;
}

function flipFromEligibleEvidence(
  dossier: MatchDossier | null,
  grounding: Grounding,
  againstSide: "home" | "draw" | "away" | null,
): TakePlanPoint | null {
  const contradicts = (dossier?.evidence ?? []).filter(
    (item) => takeEligibleDossierEvidence(item) && item.direction === "contradicts-model",
  );
  for (const item of contradicts) {
    if (!isGenuineTossUp1x2(grounding) && /\btoss-up\b/i.test(item.claim)) continue;
    return {
      id: `flip-ev-${item.id}`,
      role: "flip",
      text: item.claim,
      evidenceId: item.id,
      fieldPath: `evidence.${item.id}`,
    };
  }

  for (const item of dossier?.lineups.value.items ?? []) {
    if (!takeEligibleDossierEvidence(item)) continue;
    return {
      id: "flip-lineups",
      role: "flip",
      text: item.claim,
      fieldPath: "lineups",
      evidenceId: item.id,
    };
  }

  for (const item of dossier?.injuries.value.items ?? []) {
    if (!takeEligibleDossierEvidence(item)) continue;
    return {
      id: "flip-injuries",
      role: "flip",
      text: item.claim,
      fieldPath: "injuries",
      evidenceId: item.id,
    };
  }

  if (againstSide === "home") {
    const awayForm = dossier?.form.awayLast5.value;
    if (awayForm && awayForm.played >= 3 && awayForm.goalsFor >= 2) {
      return {
        id: "flip-away-attack",
        role: "flip",
        text: `${teamName(grounding, "away")} keep scoring in league play (${awayForm.goalsFor} in their last ${awayForm.played}).`,
        fieldPath: "form.awayLast5",
      };
    }
    const homeForm = dossier?.form.homeLast5.value;
    if (homeForm && homeForm.played >= 3 && homeForm.goalsAgainst >= homeForm.goalsFor + 2) {
      return {
        id: "flip-home-leaky",
        role: "flip",
        text: `${teamName(grounding, "home")} have leaked ${homeForm.goalsAgainst} in their last ${homeForm.played} league games.`,
        fieldPath: "form.homeLast5",
      };
    }
  }

  if (againstSide === "away") {
    const homeForm = dossier?.form.homeLast5.value;
    if (homeForm && homeForm.played >= 3 && homeForm.goalsFor >= 2) {
      return {
        id: "flip-home-attack",
        role: "flip",
        text: `${teamName(grounding, "home")} have scored ${homeForm.goalsFor} across their last ${homeForm.played} league games at this venue stretch.`,
        fieldPath: "form.homeLast5",
      };
    }
  }

  if (againstSide === "draw") {
    const homeForm = dossier?.form.homeLast5.value;
    const awayForm = dossier?.form.awayLast5.value;
    if (homeForm && awayForm && homeForm.played >= 3 && awayForm.played >= 3
      && Math.abs(homeForm.goalsFor - awayForm.goalsFor) >= 2) {
      return {
        id: "flip-open-game",
        role: "flip",
        text: "Recent form points to a clearer favourite rather than a stalemate.",
        fieldPath: "form.homeLast5,form.awayLast5",
      };
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
      return {
        id: "flip-under-attack",
        role: "flip",
        text: `${home} or ${away} finding a hot streak in front of goal would push the total over 2.5.`,
        fieldPath: "form.homeLast5,form.awayLast5",
      };
    }
    if (Number.isFinite(grounding.totalXg) && grounding.totalXg >= 2.8) {
      return {
        id: "flip-under-xg",
        role: "flip",
        text: "A fast start or an early penalty would make the under hard to hold.",
        fieldPath: "totalXg",
      };
    }
    return {
      id: "flip-under-default",
      role: "flip",
      text: "An open first half with two early goals would flip this to the over.",
      fieldPath: "gridCall",
    };
  }

  if (gridCall.sideKey === "over") {
    const tight = (homeForm && homeForm.played >= 3 && homeForm.goalsAgainst <= 2 && homeForm.goalsFor <= 2)
      && (awayForm && awayForm.played >= 3 && awayForm.goalsAgainst <= 2 && awayForm.goalsFor <= 2);
    if (tight) {
      return {
        id: "flip-over-tight",
        role: "flip",
        text: `${home} and ${away} both tightening up defensively recently would lean under 2.5.`,
        fieldPath: "form.homeLast5,form.awayLast5",
      };
    }
    return {
      id: "flip-over-default",
      role: "flip",
      text: "A cagey 0-0 through 60 minutes would shift me toward the under.",
      fieldPath: "gridCall",
    };
  }

  if (gridCall.sideKey === "yes") {
    const clean = (homeForm && homeForm.played >= 3 && homeForm.goalsAgainst === 0)
      || (awayForm && awayForm.played >= 3 && awayForm.goalsAgainst === 0);
    if (clean) {
      return {
        id: "flip-btts-no-clean",
        role: "flip",
        text: "A clean sheet on either side in the first half would flip BTTS to no.",
        fieldPath: "form.homeLast5,form.awayLast5",
      };
    }
    return {
      id: "flip-btts-yes-default",
      role: "flip",
      text: "One side failing to register a shot on target would flip BTTS to no.",
      fieldPath: "gridCall",
    };
  }

  if (gridCall.sideKey === "no") {
    const bothScore = homeForm && awayForm && homeForm.played >= 3 && awayForm.played >= 3
      && homeForm.goalsFor >= 2 && awayForm.goalsFor >= 2;
    if (bothScore) {
      return {
        id: "flip-btts-both-score",
        role: "flip",
        text: `${home} and ${away} both finding the net lately would flip BTTS to yes.`,
        fieldPath: "form.homeLast5,form.awayLast5",
      };
    }
    return {
      id: "flip-btts-no-default",
      role: "flip",
      text: "An early goal for each side would flip BTTS to yes.",
      fieldPath: "gridCall",
    };
  }

  return null;
}

export function buildTakeFlipCondition(
  dossier: MatchDossier | null,
  grounding: Grounding,
  call: TakePlanCall,
  gridCall: TakePlanGridCall | null,
  marketKind: "1x2" | "btts" | "totals",
): TakePlanPoint | null {
  if (gridCall && marketKind !== "1x2") {
    return buildGridMarketFlip(grounding, dossier, gridCall)
      ?? flipFromEligibleEvidence(dossier, grounding, null);
  }

  const against: "home" | "draw" | "away" = call.outcome;
  return flipFromEligibleEvidence(dossier, grounding, against)
    ?? {
      id: "flip-table-default",
      role: "flip",
      text: call.outcome === "draw"
        ? "A quick favourite goal would kill the draw angle."
        : `${call.outcome === "home" ? teamName(grounding, "away") : teamName(grounding, "home")} grabbing the first goal would flip this.`,
      fieldPath: "call",
    };
}
