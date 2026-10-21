import type { Grounding } from "../ask";
import { isFplBootstrapInjuryItem, type MatchDossier } from "../match-dossier/types";
import { compactTeamLabel } from "../basics-answer-voice";
import type { TakePlanPoint } from "./types";
import { takeEligibleDossierEvidence } from "./take-dossier-evidence";
import { buildFplInternalInjuryPoints } from "./take-fpl-injuries";
import { isGenuineTossUp1x2 } from "./take-headline";

/** Goal-rate copy must match calibrated grid means on the same row as pBTTS / totals. */
function calibratedGoalRatesOnRow(grounding: Grounding): boolean {
  return Boolean(grounding.goalCalibration)
    && Number.isFinite(grounding.lambdaHome)
    && Number.isFinite(grounding.lambdaAway)
    && Number.isFinite(grounding.totalXg);
}

export function buildGoalReasonPoints(
  grounding: Grounding,
  dossier: MatchDossier | null,
  homeShort: string,
  awayShort: string,
): TakePlanPoint[] {
  const points: TakePlanPoint[] = [];

  if (!calibratedGoalRatesOnRow(grounding)) {
    return points;
  }

  if (Number.isFinite(grounding.totalXg) && grounding.totalXg > 0) {
    const rounded = Math.round(grounding.totalXg);
    const goalPhrase = rounded <= 1
      ? "about one goal"
      : rounded === 2
        ? "about two goals"
        : rounded === 3
          ? "close to three goals"
          : rounded === 4
            ? "around four goals"
            : `around ${rounded} goals`;
    points.push({
      id: "fact-total-xg",
      role: "support",
      text: `The model expects ${goalPhrase} in the match.`,
      fieldPath: "totalXg",
    });
  }

  const homeForm = dossier?.form.homeLast5.value;
  if (homeForm && homeForm.played >= 3) {
    points.push({
      id: "fact-form-home-goals",
      role: "support",
      text: `${homeShort} have scored ${homeForm.goalsFor} and conceded ${homeForm.goalsAgainst} across their last ${homeForm.played} league games.`,
      fieldPath: "form.homeLast5",
    });
  }

  const awayForm = dossier?.form.awayLast5.value;
  if (awayForm && awayForm.played >= 3) {
    points.push({
      id: "fact-form-away-goals",
      role: "support",
      text: `${awayShort} have scored ${awayForm.goalsFor} and conceded ${awayForm.goalsAgainst} across their last ${awayForm.played} league games.`,
      fieldPath: "form.awayLast5",
    });
  }

  return points.slice(0, 3);
}

export function build1x2SupportingPoints(
  grounding: Grounding,
  dossier: MatchDossier | null,
  callOutcome: "home" | "draw" | "away" | null,
  homeShort: string,
  awayShort: string,
): TakePlanPoint[] {
  const points: TakePlanPoint[] = [];
  const favSide = callOutcome;

  const homePos = grounding.homeTable.position ?? dossier?.table.home.value.position;
  const awayPos = grounding.awayTable.position ?? dossier?.table.away.value.position;
  const homePts = grounding.homeTable.points ?? dossier?.table.home.value.points;
  const awayPts = grounding.awayTable.points ?? dossier?.table.away.value.points;
  if (homePos != null && awayPos != null && homePts != null && awayPts != null) {
    points.push({
      id: "fact-table-standings",
      role: "support",
      text: `${homeShort} are ${ordinal(homePos)} on ${homePts} points; ${awayShort} are ${ordinal(awayPos)} on ${awayPts}.`,
      fieldPath: "table.home,table.away",
    });
  }

  if (favSide === "home" && grounding.homeFieldAdvantage) {
    points.push({
      id: "fact-home-advantage",
      role: "support",
      text: `${homeShort} are at home; ${awayShort} travel.`,
      fieldPath: "fixture.homeFieldAdvantage",
    });
  }

  for (const item of dossier?.evidence ?? []) {
    if (!takeEligibleDossierEvidence(item)) continue;
    if (item.category === "manager") continue;
    if (/\bhold a lead\b|\balways win\b|\bcan win\b/i.test(item.claim) && item.verification !== "page-verified") continue;
    if (item.direction === "supports-home" && favSide === "home") {
      points.push({
        id: `support-ev-${item.id}`,
        role: "support",
        text: item.claim,
        evidenceId: item.id,
        fieldPath: `evidence.${item.id}`,
      });
    }
    if (item.direction === "supports-away" && favSide === "away") {
      points.push({
        id: `support-ev-${item.id}`,
        role: "support",
        text: item.claim,
        evidenceId: item.id,
        fieldPath: `evidence.${item.id}`,
      });
    }
  }

  return points.slice(0, 4);
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

export function buildContradictingPointsShared(
  grounding: Grounding,
  dossier: MatchDossier | null,
  favSide: "home" | "draw" | "away" | null,
  favLabel: string,
): TakePlanPoint[] {
  const points: TakePlanPoint[] = [];

  points.push(...buildFplInternalInjuryPoints(grounding, dossier));

  const homeForm = dossier?.form.homeLast5.value;
  if (homeForm && homeForm.played >= 3 && favSide === "home") {
    points.push({
      id: "fact-form-home-last5",
      role: "contradict",
      text: `Over their last ${homeForm.played} league games ${compactTeamLabel(grounding.home)} scored ${homeForm.goalsFor} and conceded ${homeForm.goalsAgainst}.`,
      fieldPath: "form.homeLast5",
    });
  }

  const injuryItems = (dossier?.injuries.value.items ?? [])
    .filter((item) => !isFplBootstrapInjuryItem(item))
    .filter(takeEligibleDossierEvidence);
  if (injuryItems.length) {
    points.push({
      id: "fact-injuries",
      role: "contradict",
      text: injuryItems.slice(0, 2).map((i) => i.claim).join(" "),
      fieldPath: "injuries",
      evidenceId: injuryItems[0]?.id,
    });
  }

  for (const item of dossier?.evidence ?? []) {
    if (!takeEligibleDossierEvidence(item)) continue;
    if (/\bhold a lead\b|\balways win\b|\bcan win\b/i.test(item.claim) && item.verification !== "page-verified") continue;
    if (item.direction === "contradicts-model") {
      points.push({
        id: `contradict-ev-${item.id}`,
        role: "contradict",
        text: item.claim,
        evidenceId: item.id,
        fieldPath: `evidence.${item.id}`,
      });
    }
  }

  const divergence = grounding.marketDivergence[0];
  if (divergence && favSide) {
    const favLeg = divergence.legs.find((leg) => leg.outcome === favSide);
    if (favLeg && favLeg.gapPoints <= -2) {
      const modelInt = Math.round(favLeg.modelPercent);
      const marketInt = Math.round(favLeg.marketPercent);
      points.push({
        id: "fact-market-more-confident-favourite",
        role: "contradict",
        text: `The market is more confident in ${favLabel} than I am (${marketInt}% v ${modelInt}%).`,
        fieldPath: "marketDivergence",
      });
    }
  }

  return points
    .filter((point) => isGenuineTossUp1x2(grounding) || !/\btoss-up\b/i.test(point.text))
    .slice(0, 3);
}
