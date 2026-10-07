/** Consume calibrated server means; reconstruct Elo→λ only for legacy rows. */

import type { GoalCalibration, ModelFixtureResponse } from "@/lib/api";

const SCALE = 400;
const BASE = 1.35;
const CAP = 5;

export type ImpliedLambdaOptions = {
  hfa?: number;
  baseGoals?: number;
  eloScale?: number;
  lambdaCap?: number;
};

export type ModelRowLambdas = {
  fixtureId: number;
  competitionId: string;
  utcDate: string;
  home: string;
  away: string;
  homeElo: number;
  awayElo: number;
  pOver2_5: number;
  pHome?: number;
  pDraw?: number;
  pAway?: number;
  pUnder2_5?: number;
  pBttsYes?: number;
  pBttsNo?: number;
  expectedHomeGoals?: number;
  expectedAwayGoals?: number;
  scoreGrid?: number[][];
  goalCalibration?: GoalCalibration;
  forecastInputs?: ModelFixtureResponse["forecastInputs"];
  forecastProvenance?: {
    ratingArtifactId?: string;
    ratingArtifactSha256?: string;
    ratingSnapshotAt?: string | null;
    homeAdvantageElo?: number;
    goalCalibrationArtifactSha256?: string;
    config?: { baseGoals?: number; eloScale?: number; lambdaCap?: number };
  };
};

function exactInputs(row: ModelRowLambdas): [number, number, number] {
  const inputs = row.forecastInputs;
  const provenance = row.forecastProvenance;
  // Historical rows and explicit mocks predate the carried-input contract.
  if (inputs === undefined) return [row.homeElo, row.awayElo, provenance?.homeAdvantageElo ?? 42];
  const config = provenance?.config;
  const valid = inputs !== null && typeof inputs === "object" && provenance != null
    && [inputs.homeStrength, inputs.awayStrength, inputs.homeAdvantageElo].every(Number.isFinite)
    && Number.isFinite(provenance.homeAdvantageElo)
    && inputs.homeAdvantageElo === provenance.homeAdvantageElo
    && inputs.fixtureId === row.fixtureId && inputs.competitionId === row.competitionId
    && inputs.utcDate === row.utcDate && inputs.home === row.home && inputs.away === row.away
    && Math.round(inputs.homeStrength * 10) / 10 === row.homeElo
    && Math.round(inputs.awayStrength * 10) / 10 === row.awayElo
    && inputs.ratingArtifactId === (provenance.ratingArtifactId ?? null)
    && inputs.ratingArtifactSha256 === (provenance.ratingArtifactSha256 ?? null)
    && inputs.ratingSnapshotAt === provenance.ratingSnapshotAt
    && config != null
    && [config.baseGoals, config.eloScale, config.lambdaCap]
      .every((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
  if (!valid) throw new Error("Cached forecast inputs do not match fixture provenance");
  return [inputs.homeStrength, inputs.awayStrength, inputs.homeAdvantageElo];
}

/** Fixed-total 2×baseGoals split by Elo odds ratio — same mapping as the API. */
export function impliedLambdas(
  homeElo: number,
  awayElo: number,
  options: ImpliedLambdaOptions = {}
): [number, number] {
  const hfa = options.hfa ?? 42;
  const baseGoals = options.baseGoals ?? BASE;
  const eloScale = options.eloScale ?? SCALE;
  const lambdaCap = options.lambdaCap ?? CAP;
  const d = homeElo + hfa - awayElo;
  const r = 10 ** (d / eloScale);
  const totalXg = 2 * baseGoals;
  return [
    Math.min((totalXg * r) / (1 + r), lambdaCap),
    Math.min(totalXg / (1 + r), lambdaCap),
  ];
}

/** Expected goals and Over 2.5 reflect the same supplied forecast distribution. */
export function deskNumbersFromModelRow(row: ModelRowLambdas): {
  xg: [number, number];
  over25: number;
} {
  if (row.goalCalibration !== undefined) {
    validateCalibratedModelRow(row);
    return { xg: [row.expectedHomeGoals!, row.expectedAwayGoals!], over25: row.pOver2_5 };
  }
  if (row.forecastInputs?.goalCalibrationArtifactSha256 !== undefined
    || row.forecastProvenance?.goalCalibrationArtifactSha256 !== undefined) {
    throw new Error("Goal calibration metadata is incomplete");
  }
  const [homeStrength, awayStrength, hfa] = exactInputs(row);
  const [lh, la] = impliedLambdas(homeStrength, awayStrength, {
    hfa,
    baseGoals: row.forecastProvenance?.config?.baseGoals,
    eloScale: row.forecastProvenance?.config?.eloScale,
    lambdaCap: row.forecastProvenance?.config?.lambdaCap,
  });
  if (![lh, la].every(Number.isFinite)) throw new Error("Cached forecast inputs do not produce finite xG");
  return {
    xg: [Math.round(lh * 100) / 100, Math.round(la * 100) / 100],
    over25: row.pOver2_5,
  };
}


/** Validate the supplied distribution; expected goals are its means, not shape parameters. */
export function scoreGridSummary(matrix: number[][]) {
  if (!Array.isArray(matrix) || matrix.length < 2 || matrix.length > 31
    || matrix.some(row => !Array.isArray(row) || row.length !== matrix.length)) {
    throw new Error("Score grid must be a bounded square matrix");
  }
  let mass = 0, homeGoals = 0, awayGoals = 0, home = 0, draw = 0, away = 0, over = 0, btts = 0;
  for (let h = 0; h < matrix.length; h++) {
    for (let a = 0; a < matrix.length; a++) {
      const probability = matrix[h][a];
      if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
        throw new Error("Score grid contains invalid probabilities");
      }
      mass += probability;
      homeGoals += h * probability;
      awayGoals += a * probability;
      if (h > a) home += probability;
      else if (h === a) draw += probability;
      else away += probability;
      if (h + a > 2) over += probability;
      if (h > 0 && a > 0) btts += probability;
    }
  }
  if (Math.abs(mass - 1) > 1e-8) throw new Error("Score grid is not normalized");
  return { homeGoals, awayGoals, home, draw, away, over, btts };
}

export function validateCalibratedModelRow(row: ModelRowLambdas): void {
  const calibration = row.goalCalibration;
  if (!calibration || row.competitionId !== "eng.1"
    || calibration.methodId !== "outcome-anchored-shrunk-goals-v2"
    || !/^[a-f0-9]{64}$/.test(calibration.artifactSha256)
    || calibration.artifactId !== `${calibration.methodId}:${calibration.artifactSha256}`
    || row.forecastInputs?.goalCalibrationArtifactSha256 !== calibration.artifactSha256
    || row.forecastProvenance?.goalCalibrationArtifactSha256 !== calibration.artifactSha256) {
    throw new Error("Goal calibration does not match forecast provenance");
  }
  exactInputs(row);
  const summary = scoreGridSummary(row.scoreGrid!);
  if (![row.expectedHomeGoals, row.expectedAwayGoals].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0)
    || Math.abs(row.expectedHomeGoals! - summary.homeGoals) > 1e-8
    || Math.abs(row.expectedAwayGoals! - summary.awayGoals) > 1e-8) {
    throw new Error("Expected goals do not match the final score grid");
  }
  const markets = [[row.pHome, summary.home], [row.pDraw, summary.draw], [row.pAway, summary.away],
    [row.pOver2_5, summary.over], [row.pBttsYes, summary.btts],
    ...(row.pUnder2_5 !== undefined ? [[row.pUnder2_5, 1 - summary.over]] : []),
    ...(row.pBttsNo !== undefined ? [[row.pBttsNo, 1 - summary.btts]] : [])];
  if (markets.some(([value, expected]) => typeof value !== "number" || !Number.isFinite(value)
    || value < 0 || value > 1 || Math.abs(value - expected!) > 0.00005001)) {
    throw new Error("Forecast markets do not match the final score grid");
  }
}

/** One CDF draw from the full joint grid; never replace it with independent Poisson means. */
export function sampleScoreGrid(matrix: number[][], random: () => number = Math.random): [number, number] {
  scoreGridSummary(matrix);
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new Error("Invalid simulation draw");
  let cumulative = 0;
  let last: [number, number] = [0, 0];
  for (let home = 0; home < matrix.length; home++) {
    for (let away = 0; away < matrix.length; away++) {
      if (matrix[home][away] <= 0) continue;
      last = [home, away];
      cumulative += matrix[home][away];
      if (sample < cumulative) return last;
    }
  }
  return last;
}

/** Legacy paper fixtures retain their independent Poisson simulation. */
export function samplePaperScore(fixture: { xg: [number, number] | null; scoreGrid?: number[][]; goalCalibration?: GoalCalibration },
  random: () => number = Math.random): [number, number] {
  if (fixture.scoreGrid !== undefined) return sampleScoreGrid(fixture.scoreGrid, random);
  if (fixture.goalCalibration !== undefined) throw new Error("Calibrated paper fixture has no score grid");
  if (!fixture.xg || fixture.xg.some(value => !Number.isFinite(value) || value < 0 || value > 30)) {
    throw new Error("Paper fixture has invalid goal estimates");
  }
  const poisson = (lambda: number) => {
    const limit = Math.exp(-lambda);
    let product = 1, count = 0;
    do {
      const draw = random();
      if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new Error("Invalid simulation draw");
      count++; product *= draw;
    } while (product > limit);
    return count - 1;
  };
  return [poisson(fixture.xg[0]), poisson(fixture.xg[1])];
}
