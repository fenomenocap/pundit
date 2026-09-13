import fs from "node:fs";
import path from "node:path";
import {
  loadValidatedDixonColesMleArtifact,
} from "./challenger-registration";
import {
  DEFAULT_HOME_ADVANTAGE_ELO,
  eloToLambdas,
  matrixTo1x2,
  scoreMatrix,
} from "./dixon-coles";
import {
  FITTED_DIXON_COLES_CONTRIBUTOR_ID,
  FITTED_DIXON_COLES_METHOD_ID,
  FittedDixonColesArtifact,
  FittedDixonColesTrainingRow,
  RollingOriginSplit,
  forecastFittedDixonColes,
  joinTrainingRows,
  loadOfflineTrainingCorpus,
  researchArtifactPath,
} from "./dixon-coles-mle";
import {
  ELO_CHAMPION,
  REGISTERED_CHALLENGERS,
} from "./model-contributors";

/**
 * Offline paired champion/challenger forecasts on rolling-origin holdouts.
 * Fail-closed without a validated fitted artifact. Does not write the
 * production ledger, does not change shipped 1.35 / 42 / −0.1, and does not
 * activate production (model-data.ts still uses ELO_CHAMPION only).
 */
export const CHALLENGER_EVAL_SCHEMA_VERSION = 1;
export const MIN_HOLDOUT_N_FOR_PROMOTION = 40;
export const MIN_SCORED_ORIGINS_FOR_PROMOTION = 2;
export const CHALLENGER_EVAL_NOT_ACTIVATED =
  "rolling-origin eval is offline only; production forecasts use ELO_CHAMPION";

export type ChallengerEvalStatus = "blocked" | "evaluated";

export interface ChallengerEvalRow {
  sourceEventId: string;
  competitionId: string;
  kickoff: string;
  homeCanonicalName: string;
  awayCanonicalName: string;
  homeGoals: number;
  awayGoals: number;
  homeElo: number;
  awayElo: number;
}

export interface OneXTwoForecast {
  pHome: number;
  pDraw: number;
  pAway: number;
  pOver2_5: number;
  totalXg: number;
}

export interface PairedHoldoutForecast {
  sourceEventId: string;
  origin: string;
  competitionId: string;
  kickoff: string;
  champion: OneXTwoForecast;
  challenger: OneXTwoForecast | null;
  challengerReason?: "missing-club-params";
  result: "home" | "draw" | "away";
}

export interface OriginMetrics {
  n: number;
  brier: number | null;
  logLoss: number | null;
  winnerAccuracy: number | null;
  over25Brier: number | null;
  calibrationMae: number | null;
}

export interface CalibrationBucket {
  label: string;
  min: number;
  max: number;
  n: number;
  predicted: number | null;
  actualRate: number | null;
}

export interface OriginEval {
  origin: string;
  holdoutCount: number;
  scoredCount: number;
  uncoveredCount: number;
  champion: OriginMetrics;
  challenger: OriginMetrics;
  championCalibration: CalibrationBucket[];
  challengerCalibration: CalibrationBucket[];
  deltas: {
    brier: number | null;
    logLoss: number | null;
    calibrationMae: number | null;
  } | null;
  challengerImproves: boolean | null;
  reason?: string;
}

export interface ChallengerEvalDecision {
  recommendPromotion: boolean;
  activateProduction: false;
  changeShippedConstants: false;
  humanDecisionRequired: true;
  reasons: string[];
}

export interface ChallengerEvalResult {
  status: ChallengerEvalStatus;
  reason: string;
  schemaVersion: 1;
  artifactSha256: string | null;
  champion: {
    id: "clubelo";
    methodId: "clubelo-elo-to-goals-dixon-coles";
    constants: {
      baseGoals: 1.35;
      homeAdvantageElo: 42;
      rho: -0.1;
    };
  };
  challenger: {
    id: typeof FITTED_DIXON_COLES_CONTRIBUTOR_ID;
    methodId: typeof FITTED_DIXON_COLES_METHOD_ID;
    version: string;
  } | null;
  origins: OriginEval[];
  pairedForecasts: PairedHoldoutForecast[];
  decision: ChallengerEvalDecision;
  registeredChallengers: number;
}

const HOME_PROB_BUCKETS: ReadonlyArray<{ label: string; min: number; max: number }> = [
  { label: "pHome<0.33", min: 0, max: 0.33 },
  { label: "pHome<0.67", min: 0.33, max: 0.67 },
  { label: "pHome<=1", min: 0.67, max: 1.0000001 },
];

function rounded(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function winnerFromGoals(homeGoals: number, awayGoals: number): "home" | "draw" | "away" {
  if (homeGoals > awayGoals) return "home";
  if (homeGoals < awayGoals) return "away";
  return "draw";
}

function championForecast(row: ChallengerEvalRow): OneXTwoForecast {
  const model = ELO_CHAMPION.forecast({
    homeStrength: row.homeElo,
    awayStrength: row.awayElo,
    homeAdvantageElo: DEFAULT_HOME_ADVANTAGE_ELO,
  });
  const [lambdaHome, lambdaAway] = eloToLambdas(
    row.homeElo,
    row.awayElo,
    DEFAULT_HOME_ADVANTAGE_ELO
  );
  return {
    pHome: model.pHome,
    pDraw: model.pDraw,
    pAway: model.pAway,
    pOver2_5: model.pOver2_5,
    totalXg: lambdaHome + lambdaAway,
  };
}

function emptyMetrics(): OriginMetrics {
  return {
    n: 0,
    brier: null,
    logLoss: null,
    winnerAccuracy: null,
    over25Brier: null,
    calibrationMae: null,
  };
}

function emptyBuckets(): CalibrationBucket[] {
  return HOME_PROB_BUCKETS.map((bucket) => ({
    ...bucket,
    n: 0,
    predicted: null,
    actualRate: null,
  }));
}

function outcomeMetrics(
  rows: readonly { forecast: OneXTwoForecast; result: "home" | "draw" | "away"; homeGoals: number; awayGoals: number }[]
): { metrics: OriginMetrics; buckets: CalibrationBucket[] } {
  if (rows.length === 0) {
    return { metrics: emptyMetrics(), buckets: emptyBuckets() };
  }
  let brier = 0;
  let logLoss = 0;
  let winnerHits = 0;
  let overBrier = 0;
  let calibrationMae = 0;
  const bucketHits = HOME_PROB_BUCKETS.map(() => ({ n: 0, predicted: 0, actual: 0 }));

  for (const row of rows) {
    const oneHot = {
      home: row.result === "home" ? 1 : 0,
      draw: row.result === "draw" ? 1 : 0,
      away: row.result === "away" ? 1 : 0,
    };
    brier += (row.forecast.pHome - oneHot.home) ** 2
      + (row.forecast.pDraw - oneHot.draw) ** 2
      + (row.forecast.pAway - oneHot.away) ** 2;
    const realised = row.result === "home"
      ? row.forecast.pHome
      : row.result === "draw"
        ? row.forecast.pDraw
        : row.forecast.pAway;
    logLoss += -Math.log(Math.max(realised, 1e-15));
    const predicted = row.forecast.pHome >= row.forecast.pDraw
      && row.forecast.pHome >= row.forecast.pAway
      ? "home"
      : row.forecast.pDraw >= row.forecast.pAway
        ? "draw"
        : "away";
    if (predicted === row.result) winnerHits += 1;
    const over = row.homeGoals + row.awayGoals > 2.5 ? 1 : 0;
    overBrier += (row.forecast.pOver2_5 - over) ** 2;
    calibrationMae += (
      Math.abs(row.forecast.pHome - oneHot.home)
      + Math.abs(row.forecast.pDraw - oneHot.draw)
      + Math.abs(row.forecast.pAway - oneHot.away)
    ) / 3;
    const bucketIndex = HOME_PROB_BUCKETS.findIndex((bucket) => (
      row.forecast.pHome >= bucket.min && row.forecast.pHome < bucket.max
    ));
    if (bucketIndex >= 0) {
      bucketHits[bucketIndex].n += 1;
      bucketHits[bucketIndex].predicted += row.forecast.pHome;
      bucketHits[bucketIndex].actual += oneHot.home;
    }
  }

  const n = rows.length;
  return {
    metrics: {
      n,
      brier: rounded(brier / n),
      logLoss: rounded(logLoss / n),
      winnerAccuracy: rounded(winnerHits / n),
      over25Brier: rounded(overBrier / n),
      calibrationMae: rounded(calibrationMae / n),
    },
    buckets: HOME_PROB_BUCKETS.map((bucket, index) => {
      const hits = bucketHits[index];
      if (hits.n === 0) {
        return { ...bucket, n: 0, predicted: null, actualRate: null };
      }
      return {
        ...bucket,
        n: hits.n,
        predicted: rounded(hits.predicted / hits.n),
        actualRate: rounded(hits.actual / hits.n),
      };
    }),
  };
}

function blockedDecision(reasons: string[]): ChallengerEvalDecision {
  return {
    recommendPromotion: false,
    activateProduction: false,
    changeShippedConstants: false,
    humanDecisionRequired: true,
    reasons,
  };
}

function blockedResult(reason: string, extra?: Partial<ChallengerEvalResult>): ChallengerEvalResult {
  return {
    status: "blocked",
    reason,
    schemaVersion: CHALLENGER_EVAL_SCHEMA_VERSION,
    artifactSha256: extra?.artifactSha256 ?? null,
    champion: {
      id: "clubelo",
      methodId: "clubelo-elo-to-goals-dixon-coles",
      constants: {
        baseGoals: 1.35,
        homeAdvantageElo: 42,
        rho: -0.1,
      },
    },
    challenger: extra?.challenger ?? null,
    origins: extra?.origins ?? [],
    pairedForecasts: extra?.pairedForecasts ?? [],
    decision: blockedDecision([reason, CHALLENGER_EVAL_NOT_ACTIVATED]),
    registeredChallengers: REGISTERED_CHALLENGERS.length,
  };
}

export function promotionGateDecision(origins: readonly OriginEval[]): ChallengerEvalDecision {
  const reasons: string[] = [CHALLENGER_EVAL_NOT_ACTIVATED];
  const scored = origins.filter((origin) => origin.scoredCount >= MIN_HOLDOUT_N_FOR_PROMOTION);
  if (scored.length < MIN_SCORED_ORIGINS_FOR_PROMOTION) {
    reasons.unshift(
      `insufficient-holdout: need ${MIN_SCORED_ORIGINS_FOR_PROMOTION} origins with `
      + `n>=${MIN_HOLDOUT_N_FOR_PROMOTION}; scored ${scored.length}`
    );
    return {
      recommendPromotion: false,
      activateProduction: false,
      changeShippedConstants: false,
      humanDecisionRequired: true,
      reasons,
    };
  }
  const incomplete = scored.filter((origin) => origin.uncoveredCount > 0 || origin.challengerImproves !== true);
  if (incomplete.length > 0) {
    reasons.unshift(
      "challenger-does-not-beat-champion-on-all-required-origins"
    );
    return {
      recommendPromotion: false,
      activateProduction: false,
      changeShippedConstants: false,
      humanDecisionRequired: true,
      reasons,
    };
  }
  reasons.unshift(
    "held-out Brier, log-loss, and calibration improve on every required origin; "
    + "deployment remains a separate human decision"
  );
  return {
    recommendPromotion: true,
    activateProduction: false,
    changeShippedConstants: false,
    humanDecisionRequired: true,
    reasons,
  };
}

function pairHoldout(
  row: ChallengerEvalRow,
  origin: string,
  artifact: FittedDixonColesArtifact
): PairedHoldoutForecast {
  const challenger = forecastFittedDixonColes(
    artifact.params,
    row.homeCanonicalName,
    row.awayCanonicalName
  );
  return {
    sourceEventId: row.sourceEventId,
    origin,
    competitionId: row.competitionId,
    kickoff: row.kickoff,
    champion: championForecast(row),
    challenger: challenger
      ? {
        pHome: challenger.pHome,
        pDraw: challenger.pDraw,
        pAway: challenger.pAway,
        pOver2_5: challenger.pOver2_5,
        totalXg: challenger.totalXg,
      }
      : null,
    ...(challenger ? {} : { challengerReason: "missing-club-params" as const }),
    result: winnerFromGoals(row.homeGoals, row.awayGoals),
  };
}

function evaluateOrigin(
  origin: string,
  holdout: readonly ChallengerEvalRow[],
  artifact: FittedDixonColesArtifact
): { eval: OriginEval; pairs: PairedHoldoutForecast[] } {
  const byId = new Map(holdout.map((row) => [row.sourceEventId, row]));
  const pairs = holdout.map((row) => pairHoldout(row, origin, artifact));
  const scored = pairs.filter((pair) => pair.challenger);
  const uncoveredCount = pairs.length - scored.length;
  const scoredSources = scored.map((pair) => {
    const source = byId.get(pair.sourceEventId);
    if (!source || !pair.challenger) {
      throw new Error(`paired eval lost holdout row ${pair.sourceEventId}`);
    }
    return { pair, source };
  });
  const championRows = scoredSources.map(({ pair, source }) => ({
    forecast: pair.champion,
    result: pair.result,
    homeGoals: source.homeGoals,
    awayGoals: source.awayGoals,
  }));
  const challengerRows = scoredSources.map(({ pair, source }) => ({
    forecast: pair.challenger!,
    result: pair.result,
    homeGoals: source.homeGoals,
    awayGoals: source.awayGoals,
  }));
  const champion = outcomeMetrics(championRows);
  const challenger = outcomeMetrics(challengerRows);
  const deltas = champion.metrics.n > 0 && challenger.metrics.n > 0
    && champion.metrics.brier != null
    && challenger.metrics.brier != null
    && champion.metrics.logLoss != null
    && challenger.metrics.logLoss != null
    && champion.metrics.calibrationMae != null
    && challenger.metrics.calibrationMae != null
    ? {
      brier: rounded(challenger.metrics.brier - champion.metrics.brier),
      logLoss: rounded(challenger.metrics.logLoss - champion.metrics.logLoss),
      calibrationMae: rounded(challenger.metrics.calibrationMae - champion.metrics.calibrationMae),
    }
    : null;
  let challengerImproves: boolean | null = null;
  let reason: string | undefined;
  if (pairs.length === 0) {
    reason = "empty-holdout";
  } else if (uncoveredCount > 0) {
    challengerImproves = false;
    reason = "missing-club-params";
  } else if (deltas) {
    challengerImproves = deltas.brier < 0 && deltas.logLoss < 0 && deltas.calibrationMae < 0;
    if (!challengerImproves) reason = "challenger-does-not-improve";
  } else {
    reason = "unavailable-metrics";
  }
  return {
    eval: {
      origin,
      holdoutCount: pairs.length,
      scoredCount: scored.length,
      uncoveredCount,
      champion: champion.metrics,
      challenger: challenger.metrics,
      championCalibration: champion.buckets,
      challengerCalibration: challenger.buckets,
      deltas,
      challengerImproves,
      ...(reason ? { reason } : {}),
    },
    pairs,
  };
}

function toEvalRows(rows: readonly FittedDixonColesTrainingRow[]): ChallengerEvalRow[] {
  return rows.map((row) => ({
    sourceEventId: row.sourceEventId,
    competitionId: row.competitionId,
    kickoff: row.kickoff,
    homeCanonicalName: row.homeCanonicalName,
    awayCanonicalName: row.awayCanonicalName,
    homeGoals: row.homeGoals,
    awayGoals: row.awayGoals,
    homeElo: row.homeElo,
    awayElo: row.awayElo,
  }));
}

function splitsForRows(
  artifact: FittedDixonColesArtifact,
  rows: readonly ChallengerEvalRow[]
): RollingOriginSplit[] {
  if (artifact.training.splitManifest.length > 0) return [...artifact.training.splitManifest];
  return [];
}

export function evaluatePairedRollingOrigin(input: {
  artifact?: FittedDixonColesArtifact | null;
  artifactSha256?: string | null;
  rows?: readonly ChallengerEvalRow[];
  splits?: readonly RollingOriginSplit[];
}): ChallengerEvalResult {
  if (!input.artifact) {
    return blockedResult("missing-fitted-artifact");
  }
  const rows = input.rows ?? [];
  if (rows.length === 0) {
    return blockedResult("no-holdout-rows", {
      artifactSha256: input.artifactSha256 ?? null,
      challenger: {
        id: FITTED_DIXON_COLES_CONTRIBUTOR_ID,
        methodId: FITTED_DIXON_COLES_METHOD_ID,
        version: input.artifactSha256 ?? "unpinned",
      },
    });
  }
  const splits = input.splits ?? splitsForRows(input.artifact, rows);
  if (splits.length === 0) {
    return blockedResult("empty-split-manifest", {
      artifactSha256: input.artifactSha256 ?? null,
      challenger: {
        id: FITTED_DIXON_COLES_CONTRIBUTOR_ID,
        methodId: FITTED_DIXON_COLES_METHOD_ID,
        version: input.artifactSha256 ?? "unpinned",
      },
    });
  }

  const byId = new Map(rows.map((row) => [row.sourceEventId, row]));
  const origins: OriginEval[] = [];
  const pairedForecasts: PairedHoldoutForecast[] = [];
  for (const split of splits) {
    const holdout = split.holdoutEventIds.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
    const evaluated = evaluateOrigin(split.origin, holdout, input.artifact);
    origins.push(evaluated.eval);
    pairedForecasts.push(...evaluated.pairs);
  }

  return {
    status: "evaluated",
    reason: "paired-rolling-origin",
    schemaVersion: CHALLENGER_EVAL_SCHEMA_VERSION,
    artifactSha256: input.artifactSha256 ?? null,
    champion: {
      id: "clubelo",
      methodId: "clubelo-elo-to-goals-dixon-coles",
      constants: {
        baseGoals: 1.35,
        homeAdvantageElo: 42,
        rho: -0.1,
      },
    },
    challenger: {
      id: FITTED_DIXON_COLES_CONTRIBUTOR_ID,
      methodId: FITTED_DIXON_COLES_METHOD_ID,
      version: input.artifactSha256 ?? "unpinned",
    },
    origins,
    pairedForecasts,
    decision: promotionGateDecision(origins),
    registeredChallengers: REGISTERED_CHALLENGERS.length,
  };
}

function atomicWrite(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, value);
  fs.renameSync(temp, filePath);
}

export function evaluatePairedRollingOriginFromDataDir(dataDir: string): ChallengerEvalResult {
  const loaded = loadValidatedDixonColesMleArtifact(dataDir);
  if (!loaded.ok) {
    return blockedResult(loaded.reason);
  }
  const corpus = loadOfflineTrainingCorpus(dataDir);
  if (!corpus.ok) {
    return blockedResult(corpus.reason, {
      artifactSha256: loaded.artifactSha256,
      challenger: {
        id: FITTED_DIXON_COLES_CONTRIBUTOR_ID,
        methodId: FITTED_DIXON_COLES_METHOD_ID,
        version: loaded.artifactSha256,
      },
    });
  }
  const rows = toEvalRows(joinTrainingRows(corpus.corpus.fixtures, corpus.corpus.preKickoffRows));
  const result = evaluatePairedRollingOrigin({
    artifact: loaded.artifact,
    artifactSha256: loaded.artifactSha256,
    rows,
    splits: loaded.artifact.training.splitManifest.length > 0
      ? loaded.artifact.training.splitManifest
      : undefined,
  });
  const reportPath = researchArtifactPath(dataDir, "dixon-coles-mle/eval-report.json");
  atomicWrite(reportPath, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

/** Champion 1X2 from the shipped grid — used by tests to pin Phase 0 constants. */
export function championGrid1x2(
  homeElo: number,
  awayElo: number,
  homeAdvantageElo = DEFAULT_HOME_ADVANTAGE_ELO
): [number, number, number] {
  return matrixTo1x2(scoreMatrix(...eloToLambdas(homeElo, awayElo, homeAdvantageElo)));
}
