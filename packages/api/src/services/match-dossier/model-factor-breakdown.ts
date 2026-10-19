import {
  computeMatchModel,
  DEFAULT_HOME_ADVANTAGE_ELO,
} from "../dixon-coles";
import { getResolvedActiveScoreModel } from "../active-score-model";
import type { ModelFixture } from "../model-data";
import type { ModelFactorBreakdown, ModelFactorContribution } from "./types";

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function pctDelta(a: number, b: number): number {
  return round4((a - b) * 100);
}

function triplet(model: { pHome: number; pDraw: number; pAway: number }): [number, number, number] {
  return [model.pHome, model.pDraw, model.pAway];
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

export interface ForecastStrengthInput {
  homeStrength: number;
  awayStrength: number;
  homeAdvantageElo: number;
  kickoff: string;
  competitionId: string;
  home: string;
  away: string;
}

export function resolveForecastStrengthInput(fixture: ModelFixture): ForecastStrengthInput {
  const homeAdvantageElo = defaultHomeAdvantageElo(fixture);
  const inputs = fixture.forecastInputs;
  if (inputs?.homeStrength != null && inputs?.awayStrength != null) {
    return {
      homeStrength: inputs.homeStrength,
      awayStrength: inputs.awayStrength,
      homeAdvantageElo: inputs.homeAdvantageElo ?? homeAdvantageElo,
      kickoff: inputs.utcDate ?? fixture.utcDate,
      competitionId: inputs.competitionId ?? fixture.competitionId,
      home: inputs.home ?? fixture.home,
      away: inputs.away ?? fixture.away,
    };
  }
  return {
    homeStrength: fixture.homeElo,
    awayStrength: fixture.awayElo,
    homeAdvantageElo,
    kickoff: fixture.utcDate,
    competitionId: fixture.competitionId,
    home: fixture.home,
    away: fixture.away,
  };
}

/** Same pricing path as `buildModelFixtureFromActive` / public model rows. */
export function productionMatchPricing(
  fixture: ModelFixture,
  at: Date = fixture.forecastProvenance?.forecastAt
    ? new Date(fixture.forecastProvenance.forecastAt)
    : new Date(),
) {
  const input = resolveForecastStrengthInput(fixture);
  return getResolvedActiveScoreModel({
    competitionId: input.competitionId,
    home: input.home,
    away: input.away,
    kickoff: input.kickoff,
    homeStrength: input.homeStrength,
    awayStrength: input.awayStrength,
    homeAdvantageElo: input.homeAdvantageElo,
  }, at);
}

export function buildModelFactorBreakdown(
  fixture: ModelFixture,
  lambdaHome: number,
  lambdaAway: number,
): ModelFactorBreakdown {
  const input = resolveForecastStrengthInput(fixture);
  const { homeStrength, awayStrength, homeAdvantageElo } = input;
  const avgStrength = (homeStrength + awayStrength) / 2;
  const rawGap = homeStrength - awayStrength;

  const baselineModel = computeMatchModel(avgStrength, avgStrength, 0);
  const afterEloModel = computeMatchModel(homeStrength, awayStrength, 0);
  const afterHfaChampion = computeMatchModel(homeStrength, awayStrength, homeAdvantageElo);
  const shippedModel = productionMatchPricing(fixture);

  const baseline = triplet(baselineModel);
  const afterElo = triplet(afterEloModel);
  const afterHfa = triplet(afterHfaChampion);
  const shippedExact = triplet(shippedModel);

  const steps: ModelFactorContribution[] = [
    contribution(
      "elo-rating-gap",
      "Club strength (Elo gap)",
      `Rating gap ${round4(rawGap)} Elo vs equal-strength baseline at ${round4(avgStrength)} (neutral venue).`,
      baseline,
      afterElo,
    ),
    contribution(
      "home-advantage",
      "Home advantage",
      homeAdvantageElo > 0
        ? `${homeAdvantageElo} Elo home boost for ${fixture.home} (effective gap ${round4(rawGap + homeAdvantageElo)}).`
        : "Neutral venue — no home-field Elo boost.",
      afterElo,
      afterHfa,
    ),
  ];

  const calibrationActive = Boolean(fixture.goalCalibration) || shippedModel.method === "calibrated";
  const calibrationDelta = contribution(
    "goal-calibration-shape",
    "EPL goal calibration (score shape)",
    calibrationActive
      ? "Outcome-anchored calibration preserves champion 1X2; adjusts score-shape marginals only."
      : "Baseline Dixon–Coles champion grid (no EPL calibration artifact).",
    afterHfa,
    shippedExact,
  );
  if (
    calibrationActive
    || Math.abs(calibrationDelta.deltaPHomePct) > 0.0001
    || Math.abs(calibrationDelta.deltaPDrawPct) > 0.0001
    || Math.abs(calibrationDelta.deltaPAwayPct) > 0.0001
  ) {
    steps.push(calibrationDelta);
  }

  const deltaPHomePctSum = round4(steps.reduce((sum, step) => sum + step.deltaPHomePct, 0));
  const expectedDeltaPHomePct = pctDelta(shippedExact[0], baseline[0]);

  return {
    shipped: {
      pHome: fixture.pHome,
      pDraw: fixture.pDraw,
      pAway: fixture.pAway,
    },
    pricingExact: {
      pHome: round4(shippedExact[0]),
      pDraw: round4(shippedExact[1]),
      pAway: round4(shippedExact[2]),
    },
    baseline: {
      pHome: round4(baseline[0]),
      pDraw: round4(baseline[1]),
      pAway: round4(baseline[2]),
    },
    counterfactualSteps: steps,
    reconciliation: {
      deltaPHomePctSum,
      expectedDeltaPHomePct,
      deltaPHomePctResidual: round4(expectedDeltaPHomePct - deltaPHomePctSum),
    },
    eloGapRaw: round4(rawGap),
    eloGapEffective: round4(rawGap + homeAdvantageElo),
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
