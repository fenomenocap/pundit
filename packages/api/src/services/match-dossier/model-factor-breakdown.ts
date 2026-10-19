import {
  computeMatchModel,
  DEFAULT_HOME_ADVANTAGE_ELO,
  eloToLambdas,
  matrixTo1x2,
  scoreMatrix,
} from "../dixon-coles";
import type { ModelFixture } from "../model-data";
import type { ModelFactorBreakdown, ModelFactorContribution } from "./types";

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function pctDelta(a: number, b: number): number {
  return round4((a - b) * 100);
}

function contribution(
  factorId: ModelFactorContribution["factorId"],
  label: string,
  narrative: string,
  before: [number, number, number],
  after: [number, number, number],
): ModelFactorContribution {
  return {
    factorId,
    label,
    narrative,
    deltaPHomePct: pctDelta(after[0], before[0]),
    deltaPDrawPct: pctDelta(after[1], before[1]),
    deltaPAwayPct: pctDelta(after[2], before[2]),
  };
}

export function buildModelFactorBreakdown(
  fixture: ModelFixture,
  homeAdvantageElo: number,
  lambdaHome: number,
  lambdaAway: number,
): ModelFactorBreakdown {
  const homeElo = fixture.homeElo;
  const awayElo = fixture.awayElo;
  const avgElo = (homeElo + awayElo) / 2;

  const equalRating = computeMatchModel(avgElo, avgElo, 0);
  const ratingOnly = computeMatchModel(homeElo, awayElo, 0);
  const withHfa = computeMatchModel(homeElo, awayElo, homeAdvantageElo);

  const equalTriplet: [number, number, number] = [equalRating.pHome, equalRating.pDraw, equalRating.pAway];
  const ratingTriplet: [number, number, number] = [ratingOnly.pHome, ratingOnly.pDraw, ratingOnly.pAway];
  const hfaTriplet: [number, number, number] = [withHfa.pHome, withHfa.pDraw, withHfa.pAway];

  const steps: ModelFactorContribution[] = [
    contribution(
      "elo-rating-gap",
      "Club strength (Elo gap)",
      `Raw gap ${round4(homeElo - awayElo)} Elo at equal venue (${round4(avgElo)} baseline).`,
      equalTriplet,
      ratingTriplet,
    ),
    contribution(
      "home-advantage",
      "Home advantage",
      homeAdvantageElo > 0
        ? `${homeAdvantageElo} Elo home boost applied for ${fixture.home}.`
        : "Neutral venue — no home-field Elo boost.",
      ratingTriplet,
      hfaTriplet,
    ),
  ];

  const calibrationActive = Boolean(fixture.goalCalibration);
  if (calibrationActive) {
    const championMatrix = scoreMatrix(...eloToLambdas(homeElo, awayElo, homeAdvantageElo));
    const championTriplet = matrixTo1x2(championMatrix);
    steps.push({
      factorId: "goal-calibration-shape",
      label: "EPL goal calibration (score shape)",
      narrative: "Outcome-anchored calibration adjusts totals/BTTS/scorelines; shipped 1X2 matches the Elo champion.",
      deltaPHomePct: pctDelta(fixture.pHome, championTriplet[0]),
      deltaPDrawPct: pctDelta(fixture.pDraw, championTriplet[1]),
      deltaPAwayPct: pctDelta(fixture.pAway, championTriplet[2]),
    });
  }

  return {
    shipped: {
      pHome: fixture.pHome,
      pDraw: fixture.pDraw,
      pAway: fixture.pAway,
    },
    counterfactualSteps: steps,
    eloGapEffective: round4(homeElo + homeAdvantageElo - awayElo),
    homeAdvantageElo,
    lambdaHome: round4(lambdaHome),
    lambdaAway: round4(lambdaAway),
    totalXg: round4(lambdaHome + lambdaAway),
    calibrationActive,
  };
}

export function defaultHomeAdvantageElo(fixture: ModelFixture): number {
  if (fixture.forecastProvenance?.homeAdvantageElo != null) {
    return fixture.forecastProvenance.homeAdvantageElo;
  }
  return DEFAULT_HOME_ADVANTAGE_ELO;
}
