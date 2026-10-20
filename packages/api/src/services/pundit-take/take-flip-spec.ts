import type { Grounding } from "../ask";
import type { MatchDossier } from "../match-dossier/types";
import type { TakePlanCall, TakePlanGridCall } from "./types";

export type FlipStructuredCondition =
  | { kind: "last5-scoring"; team: "home" | "away"; goalsFor: number; played: number }
  | { kind: "last5-leaky"; team: "home" | "away"; goalsAgainst: number; played: number }
  | { kind: "early-favourite-goal" }
  | { kind: "early-lead" }
  | { kind: "goalless-hour" }
  | { kind: "two-goals-first-half" }
  | { kind: "hot-streak-early"; home: string; away: string }
  | { kind: "tight-defences"; home: string; away: string }
  | { kind: "btts-shot-blank"; half: "first" }
  | { kind: "btts-both-first-half"; home: string; away: string }
  | { kind: "first-goal"; team: "home" | "away" };

function teamLabel(grounding: Grounding, team: "home" | "away"): string {
  return team === "home" ? grounding.home : grounding.away;
}

/** One complete flip sentence — never a fragment to concatenate. */
export function renderFlipSentenceFromSpec(
  spec: FlipStructuredCondition,
  grounding: Grounding,
): string {
  switch (spec.kind) {
    case "last5-scoring": {
      const name = teamLabel(grounding, spec.team);
      return `I'd shift if ${name} keep scoring in their last ${spec.played} league games (${spec.goalsFor} goals across all venues).`;
    }
    case "last5-leaky": {
      const name = teamLabel(grounding, spec.team);
      return `I'd shift if ${name} keep leaking goals over their last ${spec.played} league games (${spec.goalsAgainst} conceded across all venues).`;
    }
    case "early-favourite-goal":
      return "I'd shift if the favourite scores inside the first 20 minutes.";
    case "early-lead":
      return "I'd shift if either side grabs an early lead in the first half.";
    case "goalless-hour":
      return "I'd shift if the first hour stays goalless.";
    case "two-goals-first-half":
      return "I'd shift if the first half produces two or more goals.";
    case "hot-streak-early":
      return `I'd shift if ${spec.home} or ${spec.away} hit a hot streak in front of goal early.`;
    case "tight-defences":
      return `I'd shift if ${spec.home} and ${spec.away} both tighten up at the back over their last 5 league games (all venues).`;
    case "btts-shot-blank":
      return "I'd shift if one side fails to register a shot on target in the first half.";
    case "btts-both-first-half":
      return `I'd shift if ${spec.home} and ${spec.away} both score in the first half.`;
    case "first-goal": {
      const name = teamLabel(grounding, spec.team);
      return `I'd shift if ${name} grab the first goal.`;
    }
    default:
      return "I'd shift if the match state turns against this call.";
  }
}

export function buildStructuredFlipCondition(
  dossier: MatchDossier | null,
  grounding: Grounding,
  call: TakePlanCall,
  gridCall: TakePlanGridCall | null,
  marketKind: "1x2" | "btts" | "totals",
): FlipStructuredCondition {
  const home = grounding.home;
  const away = grounding.away;
  const homeForm = dossier?.form.homeLast5.value;
  const awayForm = dossier?.form.awayLast5.value;

  if (gridCall && marketKind === "totals") {
    if (gridCall.sideKey === "under") {
      const hot = (homeForm && homeForm.played >= 3 && homeForm.goalsFor >= 4)
        || (awayForm && awayForm.played >= 3 && awayForm.goalsFor >= 4);
      if (hot) return { kind: "hot-streak-early", home, away };
      return { kind: "two-goals-first-half" };
    }
    if (gridCall.sideKey === "over") {
      const tight = (homeForm && homeForm.played >= 3 && homeForm.goalsAgainst <= 2 && homeForm.goalsFor <= 2)
        && (awayForm && awayForm.played >= 3 && awayForm.goalsAgainst <= 2 && awayForm.goalsFor <= 2);
      if (tight) return { kind: "tight-defences", home, away };
      return { kind: "goalless-hour" };
    }
  }

  if (gridCall && marketKind === "btts") {
    if (gridCall.sideKey === "yes") return { kind: "btts-shot-blank", half: "first" };
    const both = homeForm && awayForm && homeForm.played >= 3 && awayForm.played >= 3
      && homeForm.goalsFor >= 2 && awayForm.goalsFor >= 2;
    if (both) return { kind: "btts-both-first-half", home, away };
    return { kind: "btts-both-first-half", home, away };
  }

  const against = call.outcome;
  if (against === "home") {
    if (awayForm && awayForm.played >= 3 && awayForm.goalsFor >= 2) {
      return { kind: "last5-scoring", team: "away", goalsFor: awayForm.goalsFor, played: awayForm.played };
    }
    if (homeForm && homeForm.played >= 3 && homeForm.goalsAgainst >= homeForm.goalsFor + 2) {
      return { kind: "last5-leaky", team: "home", goalsAgainst: homeForm.goalsAgainst, played: homeForm.played };
    }
  }
  if (against === "away") {
    if (homeForm && homeForm.played >= 3 && homeForm.goalsFor >= 2) {
      return { kind: "last5-scoring", team: "home", goalsFor: homeForm.goalsFor, played: homeForm.played };
    }
  }
  if (against === "draw") {
    if (homeForm && awayForm && homeForm.played >= 3 && awayForm.played >= 3
      && Math.abs(homeForm.goalsFor - awayForm.goalsFor) >= 2) {
      return { kind: "early-lead" };
    }
    return { kind: "early-favourite-goal" };
  }

  return {
    kind: "first-goal",
    team: against === "home" ? "away" : "home",
  };
}
