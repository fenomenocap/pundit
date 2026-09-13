import fs from "node:fs";
import path from "node:path";
import { sha256 } from "./club-history-corpus";
import {
  BASE_GOALS,
  DEFAULT_HOME_ADVANTAGE_ELO,
  ELO_SCALE,
  LAMBDA_CAP,
  MAX_GOALS,
  RHO,
  eloToLambdas,
  matrixTo1x2,
  matrixToTotals,
  scoreMatrix,
} from "./dixon-coles";
import {
  ClubSeasonEvaluationArtifact,
  ClubSeasonSnapshotFixture,
  MarketComparisonObservation,
  migrateClubSeasonEvaluationArtifact,
  officialClubSeasonExclusionReason,
} from "./club-season-snapshots";
import { getRepoDataDir, readJsonFile, resolveDataPath, resolveRepoDataPath } from "./persistent-store";

/**
 * Offline calibration of the current champion (ClubElo + fixed-total Dixon-Coles
 * grid). Does not write dixon-coles.ts, does not auto-load in production, and
 * does not register a challenger.
 */
export const CHAMPION_CALIBRATION_SCHEMA_VERSION = 1;
export const CHAMPION_CALIBRATION_METHOD_ID = "clubelo-fixed-total-dixon-coles-calibrated";
export const PRODUCTION_OFFICIAL_N_TARGET = 44;
export const MIN_PL_N_TO_RECOMMEND_SHIP = 40;
export const MIN_COMPETITION_N_FOR_SEPARATE_BASE_GOALS = 20;
export const PREMIER_LEAGUE_COMPETITION_ID = "eng.1";
export const SAMPLE_LEDGER_RELATIVE_PATH = "research/champion-calibration/sample-official-ledger.json";
export const DEFAULT_LEDGER_RELATIVE_PATH = "evaluation/club-season.json";

export interface ChampionConstants {
  baseGoals: number;
  homeAdvantageElo: number;
  rho: number;
  /** Mild total-xG inflation vs mismatch. 0 = Phase 0 fixed total. Not raw f+1/f. */
  mismatchInflation: number;
  baseGoalsByCompetition?: Record<string, number>;
}

export const SHIPPED_CHAMPION_CONSTANTS: ChampionConstants = {
  baseGoals: BASE_GOALS,
  homeAdvantageElo: DEFAULT_HOME_ADVANTAGE_ELO,
  rho: RHO,
  mismatchInflation: 0,
};

export interface EloGapReliabilityBucket {
  label: string;
  minAbsGap: number;
  maxAbsGap: number | null;
  n: number;
  meanAbsGap: number;
  oneXTwo: {
    pHome: { predicted: number; actual: number };
    pDraw: { predicted: number; actual: number };
    pAway: { predicted: number; actual: number };
  };
  over25: { predicted: number; actual: number };
}

export interface OutcomeMetrics {
  n: number;
  brier: number | null;
  logLoss: number | null;
  winnerAccuracy: number | null;
  scoreLogLoss: number | null;
  over25Brier: number | null;
  meanTotalXg: number | null;
  actualMeanGoals: number | null;
  actualOver25Rate: number | null;
}

export interface MarketComparisonMetrics {
  n: number;
  model: { brier: number | null; logLoss: number | null };
  market: { brier: number | null; logLoss: number | null };
}

export interface FittedConstantsUncertainty {
  baseGoals: { p10: number; p50: number; p90: number };
  homeAdvantageElo: { p10: number; p50: number; p90: number };
  rho: { p10: number; p50: number; p90: number };
  mismatchInflation: { p10: number; p50: number; p90: number };
  deltaBrierVsShipped: { p10: number; p50: number; p90: number };
}

export interface ChampionCalibrationDecision {
  recommendProductionChange: boolean;
  changeShippedConstants: false;
  rebuildGoldenCutover: false;
  reasons: string[];
}

export interface ChampionCalibrationConfig {
  schemaVersion: 1;
  id: string;
  sha256: string;
  productionAutoLoad: false;
  recommendedForProduction: boolean;
  methodId: typeof CHAMPION_CALIBRATION_METHOD_ID;
  mapping: "fixed-total-elo-odds-ratio";
  constants: ChampionConstants;
  source: {
    officialN: number;
    premierLeagueN: number;
    uclQualN: number;
    ledgerNote: string;
  };
}

export interface ChampionCalibrationReport {
  schemaVersion: 1;
  builtAt: string;
  methodId: typeof CHAMPION_CALIBRATION_METHOD_ID;
  ledger: {
    path: string;
    usedDocumentedSample: boolean;
    productionOfficialNTarget: typeof PRODUCTION_OFFICIAL_N_TARGET;
    productionDataDirHint: "PUNDIT_DATA_DIR=/data";
    rowCount: number;
    officialN: number;
    officialWithResultN: number;
    premierLeagueN: number;
    uclQualN: number;
    excluded: ReturnType<typeof countExclusions>;
    publishedMappingCounts: { geometricMeanLambdas: number; fixedTotal: number; neither: number };
  };
  shippedConstants: ChampionConstants;
  fitted: {
    constants: ChampionConstants;
    nll: number;
    aic: number;
    nestedNoInflation: { constants: ChampionConstants; nll: number; aic: number };
    uclBaseGoals: "frozen" | "fitted";
    uncertainty: FittedConstantsUncertainty | null;
    fitCompetitionIds: string[];
  };
  metrics: {
    shippedRecomputed: OutcomeMetrics;
    fittedRecomputed: OutcomeMetrics;
    publishedSealed: OutcomeMetrics;
    byCompetition: Record<string, {
      shippedRecomputed: OutcomeMetrics;
      fittedRecomputed: OutcomeMetrics;
    }>;
    vsMarketNoVig: {
      shippedRecomputed: MarketComparisonMetrics;
      fittedRecomputed: MarketComparisonMetrics;
      publishedSealed: MarketComparisonMetrics;
    };
    reliabilityByEloGap: {
      shippedRecomputed: EloGapReliabilityBucket[];
      fittedRecomputed: EloGapReliabilityBucket[];
    };
  };
  decision: ChampionCalibrationDecision;
  config: ChampionCalibrationConfig;
}

export interface CalibrateChampionOptions {
  ledgerPath?: string;
  bootstrapDraws?: number;
  bootstrapSeed?: number;
  allowSampleFallback?: boolean;
}

const ELO_GAP_BUCKETS: Array<{ label: string; minAbsGap: number; maxAbsGap: number | null }> = [
  { label: "close (<50)", minAbsGap: 0, maxAbsGap: 50 },
  { label: "moderate (50–150)", minAbsGap: 50, maxAbsGap: 150 },
  { label: "large (150–250)", minAbsGap: 150, maxAbsGap: 250 },
  { label: "mismatch (≥250)", minAbsGap: 250, maxAbsGap: null },
];

function rounded(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function range(start: number, end: number, step: number): number[] {
  const values: number[] = [];
  for (let value = start; value <= end + 1e-12; value += step) {
    values.push(Number(value.toFixed(6)));
  }
  return values;
}

function displayLedgerPath(ledgerPath: string): string {
  const marker = `${path.sep}packages${path.sep}api${path.sep}`;
  const index = ledgerPath.lastIndexOf(marker);
  if (index >= 0) return ledgerPath.slice(index + 1);
  return ledgerPath;
}

export function defaultClubSeasonLedgerPath(): string {
  return resolveDataPath(DEFAULT_LEDGER_RELATIVE_PATH);
}

export function documentedSampleLedgerPath(): string {
  return resolveRepoDataPath(SAMPLE_LEDGER_RELATIVE_PATH);
}

export function loadClubSeasonLedgerFromPath(ledgerPath: string): ClubSeasonEvaluationArtifact {
  const parsed = readJsonFile<Parameters<typeof migrateClubSeasonEvaluationArtifact>[0]>(ledgerPath);
  if (!parsed) {
    throw new Error(`No club-season ledger JSON at ${ledgerPath}`);
  }
  return migrateClubSeasonEvaluationArtifact(parsed);
}

export function officialCalibrationRows(
  artifact: ClubSeasonEvaluationArtifact
): ClubSeasonSnapshotFixture[] {
  return artifact.fixtures.filter((fixture) => (
    officialClubSeasonExclusionReason(fixture) === null && fixture.result !== null
  ));
}

function countExclusions(fixtures: readonly ClubSeasonSnapshotFixture[]) {
  const byReason = {
    legacyPartialProvenance: 0,
    incompleteInputProvenance: 0,
    postKickoffForecast: 0,
    invalidForecastTimestamp: 0,
  };
  let withoutResult = 0;
  for (const fixture of fixtures) {
    const reason = officialClubSeasonExclusionReason(fixture);
    if (reason) byReason[reason] += 1;
    else if (!fixture.result) withoutResult += 1;
  }
  return {
    total: Object.values(byReason).reduce((sum, count) => sum + count, 0) + withoutResult,
    byReason,
    withoutResult,
  };
}

/**
 * Fixed-total mapping with optional mild mismatch inflation.
 * kappa=0 reproduces production eloToLambdas. kappa>0 raises total xG toward
 * mismatches with m=((r-1)/(r+1))^2, which is 0 at equals and approaches 1
 * for huge gaps. This is not geometric-mean f+1/f.
 */
export function eloToLambdasWithConstants(
  eloHome: number,
  eloAway: number,
  homeAdvantageElo: number,
  constants: ChampionConstants
): [number, number] {
  const d = eloHome + homeAdvantageElo - eloAway;
  const r = 10 ** (d / ELO_SCALE);
  const mismatch = ((r - 1) / (r + 1)) ** 2;
  const totalXg = 2 * constants.baseGoals * (1 + Math.max(0, constants.mismatchInflation) * mismatch);
  return [
    Math.min((totalXg * r) / (1 + r), LAMBDA_CAP),
    Math.min(totalXg / (1 + r), LAMBDA_CAP),
  ];
}

export function appliedHomeAdvantageElo(
  fixture: ClubSeasonSnapshotFixture,
  fittedHomeAdvantageElo: number
): number {
  const sealed = fixture.inputs.homeAdvantageElo;
  if (sealed === null || sealed === 0) return 0;
  return fittedHomeAdvantageElo;
}

function constantsForFixture(
  fixture: ClubSeasonSnapshotFixture,
  constants: ChampionConstants
): ChampionConstants {
  const baseGoals = constants.baseGoalsByCompetition?.[fixture.competitionId] ?? constants.baseGoals;
  return { ...constants, baseGoals };
}

export function forecastWithConstants(
  fixture: ClubSeasonSnapshotFixture,
  constants: ChampionConstants
) {
  const resolved = constantsForFixture(fixture, constants);
  const homeAdvantageElo = appliedHomeAdvantageElo(fixture, resolved.homeAdvantageElo);
  const [lambdaHome, lambdaAway] = eloToLambdasWithConstants(
    fixture.homeElo,
    fixture.awayElo,
    homeAdvantageElo,
    resolved
  );
  const matrix = scoreMatrix(lambdaHome, lambdaAway, resolved.rho);
  const [pHome, pDraw, pAway] = matrixTo1x2(matrix);
  const [pOver2_5] = matrixToTotals(matrix, 2.5);
  const homeGoals = Math.min(fixture.result?.homeScore ?? 0, MAX_GOALS);
  const awayGoals = Math.min(fixture.result?.awayScore ?? 0, MAX_GOALS);
  return {
    lambdaHome,
    lambdaAway,
    totalXg: lambdaHome + lambdaAway,
    pHome,
    pDraw,
    pAway,
    pOver2_5,
    matrix,
    scoreProbability: matrix[homeGoals][awayGoals],
  };
}

function geometricLambdas(
  eloHome: number,
  eloAway: number,
  homeAdvantageElo: number
): [number, number] {
  const d = eloHome + homeAdvantageElo - eloAway;
  const f = 10 ** (d / (2 * ELO_SCALE));
  return [Math.min(BASE_GOALS * f, LAMBDA_CAP), Math.min(BASE_GOALS / f, LAMBDA_CAP)];
}

function oneXTwoError(
  a: { pHome: number; pDraw: number; pAway: number },
  b: { pHome: number; pDraw: number; pAway: number }
): number {
  return Math.abs(a.pHome - b.pHome) + Math.abs(a.pDraw - b.pDraw) + Math.abs(a.pAway - b.pAway);
}

export function classifyPublishedMapping(
  fixture: ClubSeasonSnapshotFixture
): "geometricMeanLambdas" | "fixedTotal" | "neither" {
  const hfa = fixture.inputs.homeAdvantageElo ?? 0;
  const geo = matrixTo1x2(scoreMatrix(...geometricLambdas(fixture.homeElo, fixture.awayElo, hfa)));
  const fixed = matrixTo1x2(scoreMatrix(...eloToLambdas(fixture.homeElo, fixture.awayElo, hfa)));
  const stored = { pHome: fixture.pHome, pDraw: fixture.pDraw, pAway: fixture.pAway };
  const geoErr = oneXTwoError(stored, { pHome: geo[0], pDraw: geo[1], pAway: geo[2] });
  const fixedErr = oneXTwoError(stored, { pHome: fixed[0], pDraw: fixed[1], pAway: fixed[2] });
  if (geoErr < 0.005 && geoErr <= fixedErr) return "geometricMeanLambdas";
  if (fixedErr < 0.005) return "fixedTotal";
  return "neither";
}

function outcomeMetrics(
  rows: readonly ClubSeasonSnapshotFixture[],
  probabilities: (fixture: ClubSeasonSnapshotFixture) => {
    pHome: number;
    pDraw: number;
    pAway: number;
    pOver2_5: number;
    scoreProbability: number;
    totalXg: number;
  }
): OutcomeMetrics {
  if (rows.length === 0) {
    return {
      n: 0,
      brier: null,
      logLoss: null,
      winnerAccuracy: null,
      scoreLogLoss: null,
      over25Brier: null,
      meanTotalXg: null,
      actualMeanGoals: null,
      actualOver25Rate: null,
    };
  }
  let brier = 0;
  let logLoss = 0;
  let scoreLogLoss = 0;
  let winnerHits = 0;
  let overBrier = 0;
  let totalXg = 0;
  let goals = 0;
  let overs = 0;
  for (const fixture of rows) {
    const result = fixture.result!;
    const forecast = probabilities(fixture);
    const actual = result.winner;
    const oneHot = {
      home: actual === "home" ? 1 : 0,
      draw: actual === "draw" ? 1 : 0,
      away: actual === "away" ? 1 : 0,
    };
    brier += (forecast.pHome - oneHot.home) ** 2
      + (forecast.pDraw - oneHot.draw) ** 2
      + (forecast.pAway - oneHot.away) ** 2;
    const realised = actual === "home"
      ? forecast.pHome
      : actual === "draw"
        ? forecast.pDraw
        : forecast.pAway;
    logLoss += -Math.log(Math.max(realised, 1e-15));
    scoreLogLoss += -Math.log(Math.max(forecast.scoreProbability, 1e-15));
    const predicted = forecast.pHome >= forecast.pDraw && forecast.pHome >= forecast.pAway
      ? "home"
      : forecast.pDraw >= forecast.pAway
        ? "draw"
        : "away";
    if (predicted === actual) winnerHits += 1;
    const over = result.homeScore + result.awayScore > 2.5 ? 1 : 0;
    overBrier += (forecast.pOver2_5 - over) ** 2;
    totalXg += forecast.totalXg;
    goals += result.homeScore + result.awayScore;
    overs += over;
  }
  const n = rows.length;
  return {
    n,
    brier: rounded(brier / n),
    logLoss: rounded(logLoss / n),
    winnerAccuracy: rounded(winnerHits / n),
    scoreLogLoss: rounded(scoreLogLoss / n),
    over25Brier: rounded(overBrier / n),
    meanTotalXg: rounded(totalXg / n, 3),
    actualMeanGoals: rounded(goals / n, 3),
    actualOver25Rate: rounded(overs / n),
  };
}

function metricsFromConstants(
  rows: readonly ClubSeasonSnapshotFixture[],
  constants: ChampionConstants
): OutcomeMetrics {
  return outcomeMetrics(rows, (fixture) => {
    const forecast = forecastWithConstants(fixture, constants);
    return {
      pHome: forecast.pHome,
      pDraw: forecast.pDraw,
      pAway: forecast.pAway,
      pOver2_5: forecast.pOver2_5,
      scoreProbability: forecast.scoreProbability,
      totalXg: forecast.totalXg,
    };
  });
}

function metricsFromPublished(rows: readonly ClubSeasonSnapshotFixture[]): OutcomeMetrics {
  const metrics = outcomeMetrics(rows, (fixture) => ({
    pHome: fixture.pHome,
    pDraw: fixture.pDraw,
    pAway: fixture.pAway,
    pOver2_5: fixture.pOver2_5,
    scoreProbability: 1,
    totalXg: 2 * BASE_GOALS,
  }));
  return { ...metrics, scoreLogLoss: null };
}

export function latestMarketNoVig(
  comparisons: readonly MarketComparisonObservation[]
): { pHome: number; pDraw: number; pAway: number } | null {
  if (comparisons.length === 0) return null;
  const latestBySource = new Map<string, MarketComparisonObservation>();
  for (const row of comparisons) {
    const previous = latestBySource.get(row.source);
    if (!previous || row.sourceTimestamp > previous.sourceTimestamp) {
      latestBySource.set(row.source, row);
    }
  }
  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  for (const row of latestBySource.values()) {
    pHome += row.pHome;
    pDraw += row.pDraw;
    pAway += row.pAway;
  }
  const n = latestBySource.size;
  pHome /= n;
  pDraw /= n;
  pAway /= n;
  const total = pHome + pDraw + pAway;
  if (!(total > 0)) return null;
  return { pHome: pHome / total, pDraw: pDraw / total, pAway: pAway / total };
}

function marketMetrics(
  rows: readonly ClubSeasonSnapshotFixture[],
  modelProbs: (fixture: ClubSeasonSnapshotFixture) => { pHome: number; pDraw: number; pAway: number }
): MarketComparisonMetrics {
  const usable = rows.filter((fixture) => latestMarketNoVig(fixture.marketComparisons) !== null);
  if (usable.length === 0) {
    return {
      n: 0,
      model: { brier: null, logLoss: null },
      market: { brier: null, logLoss: null },
    };
  }
  const model = outcomeMetrics(usable, (fixture) => {
    const forecast = modelProbs(fixture);
    return {
      ...forecast,
      pOver2_5: 0,
      scoreProbability: 1e-15,
      totalXg: 0,
    };
  });
  const market = outcomeMetrics(usable, (fixture) => {
    const line = latestMarketNoVig(fixture.marketComparisons)!;
    return {
      ...line,
      pOver2_5: 0,
      scoreProbability: 1e-15,
      totalXg: 0,
    };
  });
  return {
    n: usable.length,
    model: { brier: model.brier, logLoss: model.logLoss },
    market: { brier: market.brier, logLoss: market.logLoss },
  };
}

function eloGap(fixture: ClubSeasonSnapshotFixture): number {
  return fixture.homeElo + (fixture.inputs.homeAdvantageElo ?? 0) - fixture.awayElo;
}

function reliabilityByEloGap(
  rows: readonly ClubSeasonSnapshotFixture[],
  probabilities: (fixture: ClubSeasonSnapshotFixture) => {
    pHome: number;
    pDraw: number;
    pAway: number;
    pOver2_5: number;
  }
): EloGapReliabilityBucket[] {
  return ELO_GAP_BUCKETS.map((bucket) => {
    const members = rows.filter((fixture) => {
      const absGap = Math.abs(eloGap(fixture));
      if (absGap < bucket.minAbsGap) return false;
      return bucket.maxAbsGap === null ? true : absGap < bucket.maxAbsGap;
    });
    if (members.length === 0) {
      return {
        ...bucket,
        n: 0,
        meanAbsGap: 0,
        oneXTwo: {
          pHome: { predicted: 0, actual: 0 },
          pDraw: { predicted: 0, actual: 0 },
          pAway: { predicted: 0, actual: 0 },
        },
        over25: { predicted: 0, actual: 0 },
      };
    }
    let absGap = 0;
    let pHome = 0;
    let pDraw = 0;
    let pAway = 0;
    let aHome = 0;
    let aDraw = 0;
    let aAway = 0;
    let pOver = 0;
    let aOver = 0;
    for (const fixture of members) {
      const forecast = probabilities(fixture);
      const result = fixture.result!;
      absGap += Math.abs(eloGap(fixture));
      pHome += forecast.pHome;
      pDraw += forecast.pDraw;
      pAway += forecast.pAway;
      aHome += result.winner === "home" ? 1 : 0;
      aDraw += result.winner === "draw" ? 1 : 0;
      aAway += result.winner === "away" ? 1 : 0;
      pOver += forecast.pOver2_5;
      aOver += result.homeScore + result.awayScore > 2.5 ? 1 : 0;
    }
    const n = members.length;
    return {
      ...bucket,
      n,
      meanAbsGap: rounded(absGap / n, 1),
      oneXTwo: {
        pHome: { predicted: rounded(pHome / n), actual: rounded(aHome / n) },
        pDraw: { predicted: rounded(pDraw / n), actual: rounded(aDraw / n) },
        pAway: { predicted: rounded(pAway / n), actual: rounded(aAway / n) },
      },
      over25: { predicted: rounded(pOver / n), actual: rounded(aOver / n) },
    };
  }).filter((bucket) => bucket.n > 0);
}

export function scoreNegativeLogLikelihood(
  rows: readonly ClubSeasonSnapshotFixture[],
  constants: ChampionConstants
): number {
  let nll = 0;
  for (const fixture of rows) {
    nll += -Math.log(Math.max(forecastWithConstants(fixture, constants).scoreProbability, 1e-15));
  }
  return nll;
}

function aic(nll: number, parameterCount: number): number {
  return 2 * parameterCount + 2 * nll;
}

function cloneConstants(constants: ChampionConstants): ChampionConstants {
  return {
    ...constants,
    baseGoalsByCompetition: constants.baseGoalsByCompetition
      ? { ...constants.baseGoalsByCompetition }
      : undefined,
  };
}

function bestOnGrid(
  rows: readonly ClubSeasonSnapshotFixture[],
  current: ChampionConstants,
  key: "baseGoals" | "homeAdvantageElo" | "rho" | "mismatchInflation",
  values: readonly number[]
): ChampionConstants {
  let best = cloneConstants(current);
  let bestNll = scoreNegativeLogLikelihood(rows, best);
  for (const value of values) {
    const candidate = cloneConstants(current);
    candidate[key] = value;
    if (key === "mismatchInflation") candidate.mismatchInflation = Math.max(0, value);
    const nll = scoreNegativeLogLikelihood(rows, candidate);
    if (nll + 1e-12 < bestNll) {
      best = candidate;
      bestNll = nll;
    }
  }
  return best;
}

function refineConstants(
  rows: readonly ClubSeasonSnapshotFixture[],
  start: ChampionConstants,
  options: { fitInflation: boolean; iterations: number }
): ChampionConstants {
  let fitted = cloneConstants(start);
  if (!options.fitInflation) fitted.mismatchInflation = 0;
  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    fitted = bestOnGrid(rows, fitted, "baseGoals", range(1.1, 1.6, 0.05));
    fitted = bestOnGrid(rows, fitted, "homeAdvantageElo", range(0, 90, 5));
    fitted = bestOnGrid(rows, fitted, "rho", range(-0.2, 0.05, 0.025));
    if (options.fitInflation) {
      fitted = bestOnGrid(rows, fitted, "mismatchInflation", range(0, 0.3, 0.05));
    } else {
      fitted.mismatchInflation = 0;
    }
  }
  fitted = bestOnGrid(
    rows,
    fitted,
    "baseGoals",
    range(Math.max(1.1, fitted.baseGoals - 0.05), Math.min(1.6, fitted.baseGoals + 0.05), 0.01)
  );
  fitted = bestOnGrid(
    rows,
    fitted,
    "homeAdvantageElo",
    range(Math.max(0, fitted.homeAdvantageElo - 10), Math.min(90, fitted.homeAdvantageElo + 10), 1)
  );
  fitted = bestOnGrid(
    rows,
    fitted,
    "rho",
    range(Math.max(-0.25, fitted.rho - 0.04), Math.min(0.08, fitted.rho + 0.04), 0.01)
  );
  if (options.fitInflation) {
    fitted = bestOnGrid(
      rows,
      fitted,
      "mismatchInflation",
      range(0, Math.min(0.35, fitted.mismatchInflation + 0.1), 0.01)
    );
  } else {
    fitted.mismatchInflation = 0;
  }
  return fitted;
}

function coarseStart(
  rows: readonly ClubSeasonSnapshotFixture[],
  fitInflation: boolean
): ChampionConstants {
  let best = cloneConstants(SHIPPED_CHAMPION_CONSTANTS);
  if (!fitInflation) best.mismatchInflation = 0;
  let bestNll = scoreNegativeLogLikelihood(rows, best);
  for (const baseGoals of [1.2, 1.35, 1.5]) {
    for (const homeAdvantageElo of [20, 42, 65]) {
      for (const rho of [-0.15, -0.1, 0]) {
        for (const mismatchInflation of fitInflation ? [0, 0.15] : [0]) {
          const candidate = { baseGoals, homeAdvantageElo, rho, mismatchInflation };
          const nll = scoreNegativeLogLikelihood(rows, candidate);
          if (nll < bestNll) {
            best = candidate;
            bestNll = nll;
          }
        }
      }
    }
  }
  return best;
}

function fitSharedConstants(
  rows: readonly ClubSeasonSnapshotFixture[],
  options: { fitInflation: boolean; start?: ChampionConstants; search?: "global" | "local" }
): ChampionConstants {
  if (options.search === "local" && options.start) {
    return refineConstants(rows, options.start, { fitInflation: options.fitInflation, iterations: 2 });
  }
  const shipped = cloneConstants(options.start ?? SHIPPED_CHAMPION_CONSTANTS);
  const fromShipped = refineConstants(rows, shipped, {
    fitInflation: options.fitInflation,
    iterations: 4,
  });
  const fromCoarse = refineConstants(rows, coarseStart(rows, options.fitInflation), {
    fitInflation: options.fitInflation,
    iterations: 4,
  });
  return scoreNegativeLogLikelihood(rows, fromCoarse) < scoreNegativeLogLikelihood(rows, fromShipped)
    ? fromCoarse
    : fromShipped;
}

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function resample<T>(rows: readonly T[], random: () => number): T[] {
  const sample: T[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    sample.push(rows[Math.floor(random() * rows.length)]!);
  }
  return sample;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return rounded(sorted[index]!, 4);
}

function bootstrapUncertainty(
  rows: readonly ClubSeasonSnapshotFixture[],
  fitted: ChampionConstants,
  shippedBrier: number | null,
  draws: number,
  seed: number
): FittedConstantsUncertainty | null {
  if (draws <= 0 || rows.length === 0) return null;
  const random = lcg(seed);
  const baseGoals: number[] = [];
  const homeAdvantageElo: number[] = [];
  const rho: number[] = [];
  const mismatchInflation: number[] = [];
  const deltaBrier: number[] = [];
  for (let draw = 0; draw < draws; draw += 1) {
    const sample = resample(rows, random);
    const constants = fitSharedConstants(sample, {
      fitInflation: fitted.mismatchInflation > 0,
      start: fitted,
      search: "local",
    });
    baseGoals.push(constants.baseGoals);
    homeAdvantageElo.push(constants.homeAdvantageElo);
    rho.push(constants.rho);
    mismatchInflation.push(constants.mismatchInflation);
    const brier = metricsFromConstants(sample, constants).brier;
    if (brier !== null && shippedBrier !== null) deltaBrier.push(brier - shippedBrier);
  }
  const spread = (values: number[]) => ({
    p10: percentile(values, 0.1),
    p50: percentile(values, 0.5),
    p90: percentile(values, 0.9),
  });
  return {
    baseGoals: spread(baseGoals),
    homeAdvantageElo: spread(homeAdvantageElo),
    rho: spread(rho),
    mismatchInflation: spread(mismatchInflation),
    deltaBrierVsShipped: spread(deltaBrier),
  };
}

function buildConfig(
  constants: ChampionConstants,
  source: ChampionCalibrationConfig["source"],
  recommendedForProduction: boolean
): ChampionCalibrationConfig {
  const payload = {
    schemaVersion: 1 as const,
    productionAutoLoad: false as const,
    recommendedForProduction,
    methodId: CHAMPION_CALIBRATION_METHOD_ID,
    mapping: "fixed-total-elo-odds-ratio" as const,
    constants: {
      baseGoals: rounded(constants.baseGoals, 4),
      homeAdvantageElo: rounded(constants.homeAdvantageElo, 1),
      rho: rounded(constants.rho, 4),
      mismatchInflation: rounded(constants.mismatchInflation, 4),
      ...(constants.baseGoalsByCompetition
        ? { baseGoalsByCompetition: constants.baseGoalsByCompetition }
        : {}),
    },
    source,
  };
  const digest = sha256(JSON.stringify(payload));
  return {
    ...payload,
    id: `champion-calibration@1:${digest}`,
    sha256: digest,
  };
}

function decide(input: {
  premierLeagueN: number;
  officialN: number;
  fitted: ChampionConstants;
  shippedMetrics: OutcomeMetrics;
  fittedMetrics: OutcomeMetrics;
  nestedAic: number;
  fittedAic: number;
  uncertainty: FittedConstantsUncertainty | null;
}): ChampionCalibrationDecision {
  const reasons: string[] = [
    "Production dixon-coles.ts constants were not changed by this offline report.",
    "Golden-cutover rebuild is reserved for a human decision after shipped constants move.",
  ];
  if (input.premierLeagueN < MIN_PL_N_TO_RECOMMEND_SHIP) {
    reasons.push(
      `Premier League official n=${input.premierLeagueN} is below the ~${MIN_PL_N_TO_RECOMMEND_SHIP} bar for shipping new constants.`
    );
  }
  const brierImproved = input.fittedMetrics.brier !== null
    && input.shippedMetrics.brier !== null
    && input.fittedMetrics.brier + 0.005 < input.shippedMetrics.brier;
  if (!brierImproved) {
    reasons.push("Fitted 1X2 Brier is not clearly better than shipped 1.35/42/−0.1.");
  }
  const deltaExcludesZero = input.uncertainty !== null
    && input.uncertainty.deltaBrierVsShipped.p90 < 0;
  if (input.uncertainty && !deltaExcludesZero) {
    reasons.push("Bootstrap 10–90% interval on ΔBrier vs shipped does not lie entirely below 0.");
  }
  if (input.fittedAic + 1e-9 >= input.nestedAic && input.fitted.mismatchInflation > 0) {
    reasons.push("Fitted mismatch inflation does not improve AIC over the kappa=0 nested model.");
  }
  reasons.push(
    `Production target remains n=${PRODUCTION_OFFICIAL_N_TARGET} official scheduled_window rows on Railway (PUNDIT_DATA_DIR=/data).`
  );
  const recommendProductionChange = input.premierLeagueN >= MIN_PL_N_TO_RECOMMEND_SHIP
    && brierImproved
    && (input.uncertainty === null || deltaExcludesZero);
  if (recommendProductionChange) {
    reasons.unshift(
      "Fit is better on this sample, but production still does not auto-load the config; a human must copy constants."
    );
  }
  return {
    recommendProductionChange,
    changeShippedConstants: false,
    rebuildGoldenCutover: false,
    reasons,
  };
}

export function resolveCalibrationLedger(options: CalibrateChampionOptions = {}): {
  artifact: ClubSeasonEvaluationArtifact;
  path: string;
  usedDocumentedSample: boolean;
} {
  const requested = options.ledgerPath ?? defaultClubSeasonLedgerPath();
  const allowFallback = options.allowSampleFallback !== false;
  const artifact = loadClubSeasonLedgerFromPath(requested);
  const official = officialCalibrationRows(artifact);
  if (official.length > 0 || !allowFallback) {
    return { artifact, path: requested, usedDocumentedSample: false };
  }
  const samplePath = documentedSampleLedgerPath();
  return {
    artifact: loadClubSeasonLedgerFromPath(samplePath),
    path: samplePath,
    usedDocumentedSample: true,
  };
}

export function calibrateChampion(options: CalibrateChampionOptions = {}): ChampionCalibrationReport {
  const resolved = resolveCalibrationLedger(options);
  const rows = officialCalibrationRows(resolved.artifact);
  const premierLeague = rows.filter((row) => row.competitionId === PREMIER_LEAGUE_COMPETITION_ID);
  const ucl = rows.filter((row) => row.competitionId === "uefa.champions_qual");
  const fitRows = premierLeague.length > 0 ? premierLeague : rows;
  const nested = fitSharedConstants(fitRows, { fitInflation: false });
  const withInflation = fitSharedConstants(fitRows, { fitInflation: true, start: nested });
  const nestedNll = scoreNegativeLogLikelihood(fitRows, nested);
  const inflationNll = scoreNegativeLogLikelihood(fitRows, withInflation);
  const nestedAic = aic(nestedNll, 3);
  const inflationAic = aic(inflationNll, 4);
  const shared = inflationAic + 1e-9 < nestedAic ? withInflation : nested;
  const fitted = cloneConstants(shared);
  let uclBaseGoals: "frozen" | "fitted" = "frozen";
  if (ucl.length >= MIN_COMPETITION_N_FOR_SEPARATE_BASE_GOALS && premierLeague.length > 0) {
    const uclFit = bestOnGrid(ucl, { ...shared, mismatchInflation: shared.mismatchInflation }, "baseGoals", range(1.1, 1.6, 0.01));
    fitted.baseGoalsByCompetition = {
      [PREMIER_LEAGUE_COMPETITION_ID]: rounded(shared.baseGoals, 4),
      "uefa.champions_qual": rounded(uclFit.baseGoals, 4),
    };
    uclBaseGoals = "fitted";
  } else if (ucl.length > 0 && premierLeague.length > 0) {
    fitted.baseGoalsByCompetition = {
      [PREMIER_LEAGUE_COMPETITION_ID]: rounded(shared.baseGoals, 4),
      "uefa.champions_qual": BASE_GOALS,
    };
  }
  fitted.baseGoals = rounded(fitted.baseGoals, 4);
  fitted.homeAdvantageElo = rounded(fitted.homeAdvantageElo, 1);
  fitted.rho = rounded(fitted.rho, 4);
  fitted.mismatchInflation = rounded(fitted.mismatchInflation, 4);

  const shippedMetrics = metricsFromConstants(rows, SHIPPED_CHAMPION_CONSTANTS);
  const fittedMetrics = metricsFromConstants(rows, fitted);
  const publishedMetrics = metricsFromPublished(rows);
  const bootstrapDraws = options.bootstrapDraws ?? 0;
  const uncertainty = bootstrapUncertainty(
    fitRows,
    shared,
    metricsFromConstants(fitRows, SHIPPED_CHAMPION_CONSTANTS).brier,
    bootstrapDraws,
    options.bootstrapSeed ?? 20260909
  );
  const mappingCounts = { geometricMeanLambdas: 0, fixedTotal: 0, neither: 0 };
  for (const fixture of rows) mappingCounts[classifyPublishedMapping(fixture)] += 1;

  const byCompetition: ChampionCalibrationReport["metrics"]["byCompetition"] = {};
  for (const competitionId of [...new Set(rows.map((row) => row.competitionId))].sort()) {
    const subset = rows.filter((row) => row.competitionId === competitionId);
    byCompetition[competitionId] = {
      shippedRecomputed: metricsFromConstants(subset, SHIPPED_CHAMPION_CONSTANTS),
      fittedRecomputed: metricsFromConstants(subset, fitted),
    };
  }

  const probsFrom = (constants: ChampionConstants) => (fixture: ClubSeasonSnapshotFixture) => {
    const forecast = forecastWithConstants(fixture, constants);
    return {
      pHome: forecast.pHome,
      pDraw: forecast.pDraw,
      pAway: forecast.pAway,
      pOver2_5: forecast.pOver2_5,
    };
  };

  const decision = decide({
    premierLeagueN: premierLeague.length,
    officialN: rows.length,
    fitted,
    shippedMetrics,
    fittedMetrics,
    nestedAic,
    fittedAic: inflationAic < nestedAic ? inflationAic : nestedAic,
    uncertainty,
  });
  const shownPath = displayLedgerPath(resolved.path);
  const config = buildConfig(fitted, {
    officialN: rows.length,
    premierLeagueN: premierLeague.length,
    uclQualN: ucl.length,
    ledgerNote: resolved.usedDocumentedSample
      ? `In-repo/local ledger had 0 official rows; fitted the documented sample. Production target is n=${PRODUCTION_OFFICIAL_N_TARGET} at PUNDIT_DATA_DIR=/data.`
      : `Official sealed rows from ${shownPath}. Production evidence is Railway PUNDIT_DATA_DIR=/data, not the in-repo seed.`,
  }, decision.recommendProductionChange);

  return {
    schemaVersion: CHAMPION_CALIBRATION_SCHEMA_VERSION,
    builtAt: new Date().toISOString(),
    methodId: CHAMPION_CALIBRATION_METHOD_ID,
    ledger: {
      path: shownPath,
      usedDocumentedSample: resolved.usedDocumentedSample,
      productionOfficialNTarget: PRODUCTION_OFFICIAL_N_TARGET,
      productionDataDirHint: "PUNDIT_DATA_DIR=/data",
      rowCount: resolved.artifact.fixtures.length,
      officialN: resolved.artifact.fixtures.filter(
        (fixture) => officialClubSeasonExclusionReason(fixture) === null
      ).length,
      officialWithResultN: rows.length,
      premierLeagueN: premierLeague.length,
      uclQualN: ucl.length,
      excluded: countExclusions(resolved.artifact.fixtures),
      publishedMappingCounts: mappingCounts,
    },
    shippedConstants: SHIPPED_CHAMPION_CONSTANTS,
    fitted: {
      constants: fitted,
      nll: rounded(scoreNegativeLogLikelihood(fitRows, fitted), 4),
      aic: rounded(inflationAic < nestedAic ? inflationAic : nestedAic, 4),
      nestedNoInflation: {
        constants: {
          ...nested,
          baseGoals: rounded(nested.baseGoals, 4),
          homeAdvantageElo: rounded(nested.homeAdvantageElo, 1),
          rho: rounded(nested.rho, 4),
          mismatchInflation: 0,
        },
        nll: rounded(nestedNll, 4),
        aic: rounded(nestedAic, 4),
      },
      uclBaseGoals,
      uncertainty,
      fitCompetitionIds: [...new Set(fitRows.map((row) => row.competitionId))],
    },
    metrics: {
      shippedRecomputed: shippedMetrics,
      fittedRecomputed: fittedMetrics,
      publishedSealed: publishedMetrics,
      byCompetition,
      vsMarketNoVig: {
        shippedRecomputed: marketMetrics(rows, (fixture) => forecastWithConstants(fixture, SHIPPED_CHAMPION_CONSTANTS)),
        fittedRecomputed: marketMetrics(rows, (fixture) => forecastWithConstants(fixture, fitted)),
        publishedSealed: marketMetrics(rows, (fixture) => ({
          pHome: fixture.pHome,
          pDraw: fixture.pDraw,
          pAway: fixture.pAway,
        })),
      },
      reliabilityByEloGap: {
        shippedRecomputed: reliabilityByEloGap(rows, probsFrom(SHIPPED_CHAMPION_CONSTANTS)),
        fittedRecomputed: reliabilityByEloGap(rows, probsFrom(fitted)),
      },
    },
    decision,
    config,
  };
}

export function formatCalibrationMarkdown(report: ChampionCalibrationReport): string {
  const fitted = report.fitted.constants;
  const shipped = report.shippedConstants;
  const lines = [
    "# Champion calibration (Phase 1b)",
    "",
    `Built at **${report.builtAt}**. Offline fit of the current champion (ClubElo + fixed-total Dixon–Coles grid). Production does **not** auto-load this file. MiniMax does not author probabilities.`,
    "",
    "## Ledger",
    "",
    `- Path: \`${report.ledger.path}\``,
    `- Used documented sample: **${report.ledger.usedDocumentedSample ? "yes" : "no"}**`,
    `- Rows: ${report.ledger.rowCount} · official with result: **${report.ledger.officialWithResultN}** (PL ${report.ledger.premierLeagueN}, UCL quals ${report.ledger.uclQualN})`,
    `- Excluded: ${report.ledger.excluded.total} (legacy ${report.ledger.excluded.byReason.legacyPartialProvenance}, incomplete ${report.ledger.excluded.byReason.incompleteInputProvenance}, post-kickoff ${report.ledger.excluded.byReason.postKickoffForecast})`,
    `- Published sealed mapping: geometric ${report.ledger.publishedMappingCounts.geometricMeanLambdas}, fixed-total ${report.ledger.publishedMappingCounts.fixedTotal}, neither ${report.ledger.publishedMappingCounts.neither}`,
    `- Production target: **n=${report.ledger.productionOfficialNTarget}** official \`scheduled_window\` rows on Railway (\`${report.ledger.productionDataDirHint}\`). Do not treat the in-repo seed as truth.`,
    "",
    "## Constants",
    "",
    "| | BASE_GOALS | HFA (Elo) | rho | mismatch inflation |",
    "|---|---|---|---|---|",
    `| Shipped (production) | ${shipped.baseGoals} | ${shipped.homeAdvantageElo} | ${shipped.rho} | ${shipped.mismatchInflation} |`,
    `| Fitted (research only) | ${fitted.baseGoals} | ${fitted.homeAdvantageElo} | ${fitted.rho} | ${fitted.mismatchInflation} |`,
    "",
    fitted.baseGoalsByCompetition
      ? `Per-competition BASE_GOALS: ${JSON.stringify(fitted.baseGoalsByCompetition)}. UCL: **${report.fitted.uclBaseGoals}**.`
      : "Single BASE_GOALS (no per-competition split).",
    "",
    "## 1X2 / totals vs results",
    "",
    "| Source | n | 3-way Brier | log-loss | winner acc. | O/U 2.5 Brier | mean λ vs goals |",
    "|---|---|---|---|---|---|---|",
    metricRow("Shipped recomputed (fixed-total)", report.metrics.shippedRecomputed),
    metricRow("Fitted recomputed", report.metrics.fittedRecomputed),
    metricRow("Published sealed (historical)", report.metrics.publishedSealed),
    "",
    "Published sealed rows may still be the pre–Phase 0 geometric mapping. Shipped recomputed is the current champion on the same pre-kickoff Elos.",
    "",
    "## vs market no-vig (when `marketComparisons` exist)",
    "",
    marketSection(report.metrics.vsMarketNoVig),
    "",
    "## 1X2 and O/U 2.5 reliability by Elo-gap bucket (shipped recomputed)",
    "",
    reliabilityTable(report.metrics.reliabilityByEloGap.shippedRecomputed),
    "",
    "## Decision",
    "",
    `- Recommend production change: **${report.decision.recommendProductionChange}**`,
    `- Changed shipped constants: **no**`,
    `- Rebuilt golden-cutover: **no**`,
    ...report.decision.reasons.map((reason) => `- ${reason}`),
    "",
    report.config
      ? `Content-addressed research config \`${report.config.id}\` has \`productionAutoLoad: false\`.`
      : "",
    "",
  ];
  return `${lines.filter((line) => line !== undefined).join("\n").trim()}\n`;
}

function metricRow(label: string, metrics: OutcomeMetrics): string {
  return `| ${label} | ${metrics.n} | ${fmt(metrics.brier)} | ${fmt(metrics.logLoss)} | ${fmt(metrics.winnerAccuracy)} | ${fmt(metrics.over25Brier)} | ${fmt(metrics.meanTotalXg)} vs ${fmt(metrics.actualMeanGoals)} |`;
}

function fmt(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : String(value);
}

function marketSection(block: ChampionCalibrationReport["metrics"]["vsMarketNoVig"]): string {
  const rows = [
    "| Forecast | n | model Brier | model log-loss | market Brier | market log-loss |",
    "|---|---|---|---|---|---|",
    marketRow("Shipped recomputed", block.shippedRecomputed),
    marketRow("Fitted recomputed", block.fittedRecomputed),
    marketRow("Published sealed", block.publishedSealed),
  ];
  return rows.join("\n");
}

function marketRow(label: string, metrics: MarketComparisonMetrics): string {
  return `| ${label} | ${metrics.n} | ${fmt(metrics.model.brier)} | ${fmt(metrics.model.logLoss)} | ${fmt(metrics.market.brier)} | ${fmt(metrics.market.logLoss)} |`;
}

function reliabilityTable(buckets: EloGapReliabilityBucket[]): string {
  const header = [
    "| Bucket | n | \\|Elo gap\\| | home pred/act | draw pred/act | away pred/act | O/U 2.5 pred/act |",
    "|---|---|---|---|---|---|---|",
  ];
  const body = buckets.map((bucket) => (
    `| ${bucket.label} | ${bucket.n} | ${bucket.meanAbsGap} | ${bucket.oneXTwo.pHome.predicted}/${bucket.oneXTwo.pHome.actual} | ${bucket.oneXTwo.pDraw.predicted}/${bucket.oneXTwo.pDraw.actual} | ${bucket.oneXTwo.pAway.predicted}/${bucket.oneXTwo.pAway.actual} | ${bucket.over25.predicted}/${bucket.over25.actual} |`
  ));
  return [...header, ...body].join("\n");
}

export function assertCalibrationOutputNotInDataDir(outDir: string): void {
  const configured = process.env.PUNDIT_DATA_DIR?.trim();
  const resolvedOut = path.resolve(outDir);
  if (configured) {
    const dataDir = path.resolve(configured);
    if (resolvedOut === dataDir || resolvedOut.startsWith(`${dataDir}${path.sep}`)) {
      throw new Error("Refusing to write calibration artifacts into PUNDIT_DATA_DIR");
    }
  }
  const evaluationLedger = path.resolve(resolveDataPath(DEFAULT_LEDGER_RELATIVE_PATH));
  if (resolvedOut === path.dirname(evaluationLedger)) {
    throw new Error("Refusing to write calibration artifacts next to the club-season ledger");
  }
}

export function writeChampionCalibrationArtifacts(
  report: ChampionCalibrationReport,
  outDir: string
): { reportJson: string; reportMarkdown: string; configJson: string } {
  assertCalibrationOutputNotInDataDir(outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const reportJson = path.join(outDir, "champion-calibration-report.json");
  const reportMarkdown = path.join(outDir, "champion-calibration-report.md");
  const configJson = path.join(outDir, `${report.config.sha256}.json`);
  fs.writeFileSync(reportJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(reportMarkdown, formatCalibrationMarkdown(report), "utf8");
  fs.writeFileSync(configJson, `${JSON.stringify(report.config, null, 2)}\n`, "utf8");
  return { reportJson, reportMarkdown, configJson };
}

export function calibrationResearchDir(): string {
  return path.join(getRepoDataDir(), "research", "champion-calibration", "reports");
}
