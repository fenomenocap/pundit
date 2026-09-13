import fs from "node:fs";
import path from "node:path";
import { HistoricalFixture, sha256 } from "./club-history-corpus";
import { PreKickoffEloRow } from "./clubelo-pre-kickoff-corpus";
import {
  dixonColesTau,
  matrixTo1x2,
  matrixToBtts,
  matrixToTotals,
  scoreMatrix,
} from "./dixon-coles";

/**
 * Offline fitted Dixon-Coles trainer. Time-decayed attack/defence MLE with a
 * ClubElo prior for promoted / low-sample clubs. Fail closed without reviewed
 * research artifacts. Not wired into model-data, chat, or readiness.
 * Registration is a separate fail-closed helper that stays empty without
 * research/dixon-coles-mle/latest.json.
 */
export const FITTED_DIXON_COLES_METHOD_ID = "fitted-attack-defence-dixon-coles";
export const FITTED_DIXON_COLES_CONTRIBUTOR_ID = "dixon-coles-mle";
export const FITTED_DIXON_COLES_SCHEMA_VERSION = 1;
export const FIT_SCOPE_ALL_JOINED_PL_ROWS = "all-joined-pl-rows" as const;
export const FIT_SCOPE_JOINED_WITH_PRE_KICKOFF_ELO =
  "joined-pl-rows-with-pre-kickoff-elo" as const;
export type FittedDixonColesFitScope =
  | typeof FIT_SCOPE_ALL_JOINED_PL_ROWS
  | typeof FIT_SCOPE_JOINED_WITH_PRE_KICKOFF_ELO;
export const DEFAULT_TIME_DECAY_XI = 0.0065;
export const DEFAULT_CLUB_ELO_PRIOR_STRENGTH = 8;
export const DEFAULT_ROLLING_ORIGINS = [
  "2025-01-01T00:00:00.000Z",
  "2025-08-01T00:00:00.000Z",
  "2026-01-01T00:00:00.000Z",
] as const;

const ELO_SCALE = 400;
const RHO_BOUND = 0.35;
const UNPINNED_SHA = "unpinned-in-memory";

export type FittedDixonColesTrainStatus = "blocked" | "trained";

export interface RollingOriginSplit {
  origin: string;
  trainEventIds: string[];
  holdoutEventIds: string[];
}

export interface FittedDixonColesTrainingRow {
  sourceEventId: string;
  competitionId: string;
  kickoff: string;
  homeCanonicalName: string;
  awayCanonicalName: string;
  homeGoals: number;
  awayGoals: number;
  homeElo: number;
  awayElo: number;
  rankingDate: string;
}

export interface FittedDixonColesArtifact {
  schemaVersion: 1;
  contributor: {
    id: typeof FITTED_DIXON_COLES_CONTRIBUTOR_ID;
    methodId: typeof FITTED_DIXON_COLES_METHOD_ID;
    status: "challenger";
  };
  params: {
    intercept: number;
    homeAdvantage: number;
    rho: number;
    timeDecayXi: number;
    attack: Record<string, number>;
    defence: Record<string, number>;
    clubEloPriorStrength: number;
  };
  training: {
    clubHistoryDatasetSha256: string;
    preKickoffEloDatasetSha256: string;
    splitManifest: RollingOriginSplit[];
    rowCount: number;
    clubCount: number;
    fitScope: FittedDixonColesFitScope;
    excludedFixtureCount: number;
    plFixtureCoverage: { covered: number; n: number };
    converged: boolean;
    iterations: number;
    logLikelihood: number;
  };
}

export interface FittedDixonColesTrainResult {
  status: FittedDixonColesTrainStatus;
  reason: string;
  artifact: FittedDixonColesArtifact | null;
  trainingRowCount: number;
}

export interface OfflineTrainingCorpus {
  fixtures: HistoricalFixture[];
  preKickoffRows: PreKickoffEloRow[];
  historyStatus: "pass" | "inconclusive" | "fail";
  preKickoffStatus: "pass" | "inconclusive" | "fail";
  requiredMissingCount: number;
  requiredCoveredCount: number;
  inventedRatingCount: number;
  eligibleForOfflineTraining: boolean;
  clubHistoryDatasetSha256: string;
  preKickoffEloDatasetSha256: string;
}

export function rollingOriginSplit(
  rows: readonly { sourceEventId: string; kickoff: string }[],
  origin: string
): RollingOriginSplit {
  const originMs = Date.parse(origin);
  if (!Number.isFinite(originMs)) {
    throw new Error(`Invalid rolling-origin split ${origin}`);
  }
  const sorted = [...rows].sort((a, b) => a.kickoff.localeCompare(b.kickoff)
    || a.sourceEventId.localeCompare(b.sourceEventId));
  return {
    origin,
    trainEventIds: sorted
      .filter((row) => Date.parse(row.kickoff) < originMs)
      .map((row) => row.sourceEventId),
    holdoutEventIds: sorted
      .filter((row) => Date.parse(row.kickoff) >= originMs)
      .map((row) => row.sourceEventId),
  };
}

export function joinTrainingRows(
  fixtures: readonly HistoricalFixture[],
  preKickoff: readonly PreKickoffEloRow[]
): FittedDixonColesTrainingRow[] {
  const eloByEvent = new Map(preKickoff.map((row) => [row.sourceEventId, row]));
  const rows: FittedDixonColesTrainingRow[] = [];
  for (const fixture of fixtures) {
    if (!fixture.trainingEligible || fixture.competitionId !== "eng.1") continue;
    const elo = eloByEvent.get(fixture.sourceEventId);
    if (!elo) continue;
    rows.push({
      sourceEventId: fixture.sourceEventId,
      competitionId: fixture.competitionId,
      kickoff: fixture.kickoff,
      homeCanonicalName: elo.homeCanonicalName,
      awayCanonicalName: elo.awayCanonicalName,
      homeGoals: fixture.homeGoals,
      awayGoals: fixture.awayGoals,
      homeElo: elo.homeElo,
      awayElo: elo.awayElo,
      rankingDate: elo.rankingDate,
    });
  }
  return rows.sort((a, b) => a.kickoff.localeCompare(b.kickoff)
    || a.sourceEventId.localeCompare(b.sourceEventId));
}

export type OfflineTrainingMode = "full" | "partial-exclude-incomplete";

export function resolveOfflineTrainingMode(input: {
  historyStatus: "pass" | "inconclusive" | "fail";
  preKickoffStatus: "pass" | "inconclusive" | "fail";
  requiredMissingCount: number;
  requiredCoveredCount: number;
  inventedRatingCount?: number;
  eligibleForOfflineTraining?: boolean;
}): { ok: true; mode: OfflineTrainingMode } | { ok: false; reason: string } {
  if (input.historyStatus === "fail" || input.eligibleForOfflineTraining === false) {
    return { ok: false, reason: "club-history-not-pass" };
  }
  if ((input.inventedRatingCount ?? 0) > 0) {
    return { ok: false, reason: "invented-pre-kickoff-elo" };
  }
  if (input.requiredMissingCount === 0 && input.preKickoffStatus !== "fail") {
    return { ok: true, mode: "full" };
  }
  if (input.requiredMissingCount > 0 && input.requiredCoveredCount > 0) {
    return { ok: true, mode: "partial-exclude-incomplete" };
  }
  return { ok: false, reason: "pre-kickoff-elo-incomplete" };
}

/** @deprecated use resolveOfflineTrainingMode */
export function assertOfflineTrainingInputs(input: {
  historyStatus: "pass" | "inconclusive" | "fail";
  preKickoffStatus: "pass" | "inconclusive" | "fail";
  requiredMissingCount: number;
  requiredCoveredCount?: number;
  inventedRatingCount?: number;
  eligibleForOfflineTraining?: boolean;
}): { ok: true } | { ok: false; reason: string } {
  const resolved = resolveOfflineTrainingMode({
    ...input,
    requiredCoveredCount: input.requiredCoveredCount ?? (
      input.requiredMissingCount === 0 ? 1 : 0
    ),
  });
  return resolved.ok ? { ok: true } : resolved;
}

export function assertJoinedTrainingRowsComplete(
  rows: readonly FittedDixonColesTrainingRow[]
): { ok: true } | { ok: false; reason: string; eventId?: string } {
  for (const row of rows) {
    if (!Number.isFinite(row.homeElo) || !Number.isFinite(row.awayElo)) {
      return {
        ok: false,
        reason: "included-row-missing-pre-kickoff-elo",
        eventId: row.sourceEventId,
      };
    }
  }
  return { ok: true };
}

export function researchArtifactPath(dataDir: string, relativePath: string): string {
  return path.join(dataDir, "research", relativePath);
}

export function loadFittedDixonColesArtifact(dataDir: string): FittedDixonColesArtifact | null {
  const latestPath = researchArtifactPath(dataDir, "dixon-coles-mle/latest.json");
  if (!fs.existsSync(latestPath)) return null;
  const latest = JSON.parse(fs.readFileSync(latestPath, "utf8")) as { artifactPath: string };
  const artifactPath = path.join(dataDir, "research/dixon-coles-mle", latest.artifactPath);
  if (!fs.existsSync(artifactPath)) return null;
  return JSON.parse(fs.readFileSync(artifactPath, "utf8")) as FittedDixonColesArtifact;
}

export function timeDecayWeight(kickoffIso: string, referenceIso: string, xi: number): number {
  const kickoff = Date.parse(kickoffIso);
  const reference = Date.parse(referenceIso);
  if (!Number.isFinite(kickoff) || !Number.isFinite(reference)) return 0;
  const days = Math.max(0, (reference - kickoff) / 86_400_000);
  return Math.exp(-xi * days);
}

export function clubEloAttackDefencePrior(
  elo: number,
  meanElo: number
): { attack: number; defence: number } {
  const delta = Math.LN10 * (elo - meanElo) / ELO_SCALE;
  return { attack: delta / 2, defence: -delta / 2 };
}

export function clubEloPriorPrecision(matchCount: number, priorStrength: number): number {
  return (priorStrength * priorStrength) / (priorStrength + matchCount);
}

export interface FittedDixonColesForecast {
  pHome: number;
  pDraw: number;
  pAway: number;
  pOver2_5: number;
  pUnder2_5: number;
  pBttsYes: number;
  pBttsNo: number;
  lambdaHome: number;
  lambdaAway: number;
  totalXg: number;
}

/** Attack/defence λ. Missing club parameters fail closed; ratings are not invented. */
export function fittedDixonColesLambdas(
  params: FittedDixonColesArtifact["params"],
  homeCanonicalName: string,
  awayCanonicalName: string
): [number, number] | null {
  const attackHome = params.attack[homeCanonicalName];
  const attackAway = params.attack[awayCanonicalName];
  const defenceHome = params.defence[homeCanonicalName];
  const defenceAway = params.defence[awayCanonicalName];
  if (
    !Number.isFinite(attackHome)
    || !Number.isFinite(attackAway)
    || !Number.isFinite(defenceHome)
    || !Number.isFinite(defenceAway)
  ) {
    return null;
  }
  const etaHome = params.intercept + params.homeAdvantage + attackHome + defenceAway;
  const etaAway = params.intercept + attackAway + defenceHome;
  return [
    Math.exp(Math.min(8, Math.max(-8, etaHome))),
    Math.exp(Math.min(8, Math.max(-8, etaAway))),
  ];
}

export function forecastFittedDixonColes(
  params: FittedDixonColesArtifact["params"],
  homeCanonicalName: string,
  awayCanonicalName: string
): FittedDixonColesForecast | null {
  const lambdas = fittedDixonColesLambdas(params, homeCanonicalName, awayCanonicalName);
  if (!lambdas) return null;
  const [lambdaHome, lambdaAway] = lambdas;
  const matrix = scoreMatrix(lambdaHome, lambdaAway, params.rho);
  const [pHome, pDraw, pAway] = matrixTo1x2(matrix);
  const [pOver2_5, pUnder2_5] = matrixToTotals(matrix, 2.5);
  const [pBttsYes, pBttsNo] = matrixToBtts(matrix);
  return {
    pHome,
    pDraw,
    pAway,
    pOver2_5,
    pUnder2_5,
    pBttsYes,
    pBttsNo,
    lambdaHome,
    lambdaAway,
    totalXg: lambdaHome + lambdaAway,
  };
}

function uniqueClubs(rows: readonly FittedDixonColesTrainingRow[]): string[] {
  const names = new Set<string>();
  for (const row of rows) {
    names.add(row.homeCanonicalName);
    names.add(row.awayCanonicalName);
  }
  return [...names].sort();
}

function clubEloMeans(rows: readonly FittedDixonColesTrainingRow[]): {
  meanElo: number;
  byClub: Map<string, number>;
  matchCount: Map<string, number>;
} {
  const eloSum = new Map<string, number>();
  const eloN = new Map<string, number>();
  const matchCount = new Map<string, number>();
  let total = 0;
  let n = 0;
  for (const row of rows) {
    for (const [club, elo] of [
      [row.homeCanonicalName, row.homeElo],
      [row.awayCanonicalName, row.awayElo],
    ] as const) {
      eloSum.set(club, (eloSum.get(club) ?? 0) + elo);
      eloN.set(club, (eloN.get(club) ?? 0) + 1);
      total += elo;
      n += 1;
    }
    matchCount.set(row.homeCanonicalName, (matchCount.get(row.homeCanonicalName) ?? 0) + 1);
    matchCount.set(row.awayCanonicalName, (matchCount.get(row.awayCanonicalName) ?? 0) + 1);
  }
  const byClub = new Map<string, number>();
  for (const club of eloSum.keys()) {
    byClub.set(club, (eloSum.get(club) ?? 0) / (eloN.get(club) ?? 1));
  }
  return { meanElo: n > 0 ? total / n : 1500, byClub, matchCount };
}

function rhoFromFree(z: number): number {
  return RHO_BOUND * Math.tanh(z);
}

function unpack(
  x: Float64Array,
  clubs: readonly string[]
): { intercept: number; homeAdvantage: number; rho: number; attack: number[]; defence: number[] } {
  const n = clubs.length;
  const intercept = x[0];
  const homeAdvantage = x[1];
  const rho = rhoFromFree(x[2]);
  const attack = new Array<number>(n).fill(0);
  const defence = new Array<number>(n).fill(0);
  let attackSum = 0;
  let defenceSum = 0;
  for (let i = 0; i < n - 1; i += 1) {
    attack[i] = x[3 + i];
    defence[i] = x[3 + (n - 1) + i];
    attackSum += attack[i];
    defenceSum += defence[i];
  }
  if (n > 0) {
    attack[n - 1] = -attackSum;
    defence[n - 1] = -defenceSum;
  }
  return { intercept, homeAdvantage, rho, attack, defence };
}

function objectiveAndGradient(
  x: Float64Array,
  rows: readonly FittedDixonColesTrainingRow[],
  clubs: readonly string[],
  indexOf: ReadonlyMap<string, number>,
  weights: readonly number[],
  priorAttack: readonly number[],
  priorDefence: readonly number[],
  priorPrecision: readonly number[]
): { value: number; grad: Float64Array } {
  const n = clubs.length;
  const { intercept, homeAdvantage, rho, attack, defence } = unpack(x, clubs);
  const dAttack = new Array<number>(n).fill(0);
  const dDefence = new Array<number>(n).fill(0);
  let dMu = 0;
  let dGamma = 0;
  let dRho = 0;
  let value = 0;

  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r];
    const h = indexOf.get(row.homeCanonicalName);
    const a = indexOf.get(row.awayCanonicalName);
    if (h === undefined || a === undefined) continue;
    const w = weights[r];
    const etaHome = intercept + homeAdvantage + attack[h] + defence[a];
    const etaAway = intercept + attack[a] + defence[h];
    const lambdaHome = Math.exp(Math.min(8, Math.max(-8, etaHome)));
    const lambdaAway = Math.exp(Math.min(8, Math.max(-8, etaAway)));
    const tau = dixonColesTau(row.homeGoals, row.awayGoals, lambdaHome, lambdaAway, rho);
    if (!(tau > 1e-12) || !(lambdaHome > 0) || !(lambdaAway > 0)) {
      const grad = new Float64Array(x.length);
      return { value: Number.NEGATIVE_INFINITY, grad };
    }
    value += w * (
      Math.log(tau)
      + row.homeGoals * Math.log(lambdaHome)
      - lambdaHome
      + row.awayGoals * Math.log(lambdaAway)
      - lambdaAway
    );

    let dTauDLh = 0;
    let dTauDLa = 0;
    let dTauDRho = 0;
    if (row.homeGoals === 0 && row.awayGoals === 0) {
      dTauDLh = -lambdaAway * rho;
      dTauDLa = -lambdaHome * rho;
      dTauDRho = -lambdaHome * lambdaAway;
    } else if (row.homeGoals === 0 && row.awayGoals === 1) {
      dTauDLh = rho;
      dTauDRho = lambdaHome;
    } else if (row.homeGoals === 1 && row.awayGoals === 0) {
      dTauDLa = rho;
      dTauDRho = lambdaAway;
    } else if (row.homeGoals === 1 && row.awayGoals === 1) {
      dTauDRho = -1;
    }
    const dLlh = w * (row.homeGoals / lambdaHome - 1 + dTauDLh / tau);
    const dLla = w * (row.awayGoals / lambdaAway - 1 + dTauDLa / tau);
    dMu += dLlh * lambdaHome + dLla * lambdaAway;
    dGamma += dLlh * lambdaHome;
    dRho += w * (dTauDRho / tau);
    dAttack[h] += dLlh * lambdaHome;
    dDefence[a] += dLlh * lambdaHome;
    dAttack[a] += dLla * lambdaAway;
    dDefence[h] += dLla * lambdaAway;
  }

  for (let i = 0; i < n; i += 1) {
    const kappa = priorPrecision[i];
    const da = attack[i] - priorAttack[i];
    const dd = defence[i] - priorDefence[i];
    value -= 0.5 * kappa * (da * da + dd * dd);
    dAttack[i] -= kappa * da;
    dDefence[i] -= kappa * dd;
  }

  const grad = new Float64Array(x.length);
  grad[0] = dMu;
  grad[1] = dGamma;
  const sech2 = 1 - (x[2] === 0 ? 0 : Math.tanh(x[2]) ** 2);
  grad[2] = dRho * RHO_BOUND * sech2;
  for (let i = 0; i < n - 1; i += 1) {
    grad[3 + i] = dAttack[i] - dAttack[n - 1];
    grad[3 + (n - 1) + i] = dDefence[i] - dDefence[n - 1];
  }
  return { value, grad };
}

function initialVector(
  rows: readonly FittedDixonColesTrainingRow[],
  clubs: readonly string[],
  priorAttack: readonly number[],
  priorDefence: readonly number[]
): Float64Array {
  const n = clubs.length;
  const x = new Float64Array(3 + 2 * Math.max(n - 1, 0));
  const meanHome = rows.reduce((sum, row) => sum + row.homeGoals, 0) / Math.max(rows.length, 1);
  const meanAway = rows.reduce((sum, row) => sum + row.awayGoals, 0) / Math.max(rows.length, 1);
  x[0] = Math.log(Math.max(meanAway, 0.2));
  x[1] = Math.log(Math.max(meanHome, 0.2)) - x[0];
  x[2] = Math.atanh(-0.1 / RHO_BOUND);
  for (let i = 0; i < n - 1; i += 1) {
    x[3 + i] = priorAttack[i];
    x[3 + (n - 1) + i] = priorDefence[i];
  }
  return x;
}

function maximize(
  x0: Float64Array,
  evalFn: (x: Float64Array) => { value: number; grad: Float64Array },
  maxIterations: number
): { x: Float64Array; value: number; iterations: number; converged: boolean } {
  let x = Float64Array.from(x0);
  let current = evalFn(x);
  let step = 0.05;
  let iterations = 0;
  for (; iterations < maxIterations; iterations += 1) {
    const gradNorm = Math.hypot(...current.grad);
    if (gradNorm < 1e-6) {
      return { x, value: current.value, iterations, converged: true };
    }
    let improved = false;
    let trialStep = step;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const next = Float64Array.from(x, (value, index) => value + trialStep * current.grad[index]);
      const candidate = evalFn(next);
      if (Number.isFinite(candidate.value) && candidate.value > current.value + 1e-12) {
        const deltaX = Float64Array.from(next, (value, index) => value - x[index]);
        const deltaG = Float64Array.from(candidate.grad, (value, index) => value - current.grad[index]);
        let sDotS = 0;
        let sDotY = 0;
        for (let i = 0; i < deltaX.length; i += 1) {
          sDotS += deltaX[i] * deltaX[i];
          sDotY += deltaX[i] * deltaG[i];
        }
        step = Math.min(1, Math.max(1e-5, sDotY !== 0 ? Math.abs(sDotS / sDotY) : trialStep));
        x = next;
        current = candidate;
        improved = true;
        break;
      }
      trialStep *= 0.5;
    }
    if (!improved) {
      return { x, value: current.value, iterations, converged: gradNorm < 1e-3 };
    }
  }
  return { x, value: current.value, iterations, converged: false };
}

export function fitTimeDecayedDixonColes(
  rows: readonly FittedDixonColesTrainingRow[],
  options: {
    timeDecayXi?: number;
    clubEloPriorStrength?: number;
    maxIterations?: number;
  } = {}
): {
  params: FittedDixonColesArtifact["params"];
  converged: boolean;
  iterations: number;
  logLikelihood: number;
} {
  if (rows.length === 0) {
    throw new Error("Cannot fit Dixon-Coles MLE on zero training rows.");
  }
  const clubs = uniqueClubs(rows);
  if (clubs.length < 2) {
    throw new Error("Cannot fit Dixon-Coles MLE with fewer than two clubs.");
  }
  const timeDecayXi = options.timeDecayXi ?? DEFAULT_TIME_DECAY_XI;
  const clubEloPriorStrength = options.clubEloPriorStrength ?? DEFAULT_CLUB_ELO_PRIOR_STRENGTH;
  const { meanElo, byClub, matchCount } = clubEloMeans(rows);
  const priorAttack = clubs.map((club) => clubEloAttackDefencePrior(byClub.get(club) ?? meanElo, meanElo).attack);
  const priorDefence = clubs.map((club) => clubEloAttackDefencePrior(byClub.get(club) ?? meanElo, meanElo).defence);
  const priorPrecision = clubs.map((club) => (
    clubEloPriorPrecision(matchCount.get(club) ?? 0, clubEloPriorStrength)
  ));
  const referenceIso = rows[rows.length - 1].kickoff;
  const weights = rows.map((row) => timeDecayWeight(row.kickoff, referenceIso, timeDecayXi));
  const indexOf = new Map(clubs.map((club, index) => [club, index]));
  const x0 = initialVector(rows, clubs, priorAttack, priorDefence);
  const fitted = maximize(
    x0,
    (x) => objectiveAndGradient(
      x,
      rows,
      clubs,
      indexOf,
      weights,
      priorAttack,
      priorDefence,
      priorPrecision
    ),
    options.maxIterations ?? 250
  );
  const unpacked = unpack(fitted.x, clubs);
  const attack: Record<string, number> = {};
  const defence: Record<string, number> = {};
  for (let i = 0; i < clubs.length; i += 1) {
    attack[clubs[i]] = unpacked.attack[i];
    defence[clubs[i]] = unpacked.defence[i];
  }
  return {
    params: {
      intercept: unpacked.intercept,
      homeAdvantage: unpacked.homeAdvantage,
      rho: unpacked.rho,
      timeDecayXi,
      attack,
      defence,
      clubEloPriorStrength,
    },
    converged: fitted.converged,
    iterations: fitted.iterations,
    logLikelihood: fitted.value,
  };
}

function readJsonIfExists<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export function loadOfflineTrainingCorpus(dataDir: string):
  | { ok: true; corpus: OfflineTrainingCorpus }
  | { ok: false; reason: string } {
  const historyLatestPath = path.join(dataDir, "research/club-history/latest.json");
  const historyLatest = readJsonIfExists<{ manifestPath: string; datasetSha256?: string }>(historyLatestPath);
  if (!historyLatest) {
    return { ok: false, reason: "missing-research-artifacts" };
  }
  const historyManifest = readJsonIfExists<{
    datasetPath: string;
    datasetSha256: string;
    corpusStatus: "pass" | "inconclusive" | "fail";
    promotionGate?: { eligibleForOfflineTraining?: boolean };
  }>(path.join(dataDir, "research/club-history", historyLatest.manifestPath));
  if (!historyManifest) {
    return { ok: false, reason: "missing-research-artifacts" };
  }
  const historyDataset = readJsonIfExists<{ seasons: Array<{ fixtures: HistoricalFixture[] }> }>(
    path.join(dataDir, "research/club-history", historyManifest.datasetPath)
  );
  if (!historyDataset) {
    return { ok: false, reason: "missing-research-artifacts" };
  }

  const eloLatestPath = path.join(dataDir, "research/clubelo-history/latest.json");
  const eloLatest = readJsonIfExists<{ manifestPath: string; datasetSha256?: string }>(eloLatestPath);
  if (!eloLatest) {
    return { ok: false, reason: "pre-kickoff-elo-incomplete" };
  }
  const eloManifest = readJsonIfExists<{
    datasetPath: string;
    datasetSha256: string;
    corpusStatus: "pass" | "inconclusive" | "fail";
    validation?: {
      requiredMissingCount?: number;
      requiredCoveredCount?: number;
      inventedRatingCount?: number;
    };
    plFixtureCoverage?: { covered: number; n: number };
    promotionGate?: { eligibleForOfflineTraining?: boolean };
  }>(path.join(dataDir, "research/clubelo-history", eloLatest.manifestPath));
  if (!eloManifest) {
    return { ok: false, reason: "pre-kickoff-elo-incomplete" };
  }
  const eloDataset = readJsonIfExists<{ fixtures: PreKickoffEloRow[] }>(
    path.join(dataDir, "research/clubelo-history", eloManifest.datasetPath)
  );
  if (!eloDataset) {
    return { ok: false, reason: "pre-kickoff-elo-incomplete" };
  }

  return {
    ok: true,
    corpus: {
      fixtures: historyDataset.seasons.flatMap((season) => season.fixtures),
      preKickoffRows: eloDataset.fixtures,
      historyStatus: historyManifest.corpusStatus,
      preKickoffStatus: eloManifest.corpusStatus,
      requiredMissingCount: eloManifest.validation?.requiredMissingCount ?? 0,
      requiredCoveredCount: eloManifest.validation?.requiredCoveredCount
        ?? eloManifest.plFixtureCoverage?.covered
        ?? 0,
      inventedRatingCount: eloManifest.validation?.inventedRatingCount ?? 0,
      eligibleForOfflineTraining: historyManifest.promotionGate?.eligibleForOfflineTraining !== false,
      clubHistoryDatasetSha256: historyLatest.datasetSha256 ?? historyManifest.datasetSha256,
      preKickoffEloDatasetSha256: eloLatest.datasetSha256 ?? eloManifest.datasetSha256,
    },
  };
}

function atomicWrite(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, value);
  fs.renameSync(temp, filePath);
}

export function writeFittedDixonColesArtifact(
  dataDir: string,
  artifact: FittedDixonColesArtifact
): { artifactPath: string; artifactSha256: string } {
  const body = `${JSON.stringify(artifact, null, 2)}\n`;
  const artifactSha256 = sha256(body);
  const fileName = `${artifactSha256}.json`;
  const dir = path.join(dataDir, "research/dixon-coles-mle");
  atomicWrite(path.join(dir, fileName), body);
  atomicWrite(path.join(dir, "splits.json"), `${JSON.stringify({
    schemaVersion: FITTED_DIXON_COLES_SCHEMA_VERSION,
    artifactSha256,
    splits: artifact.training.splitManifest,
  }, null, 2)}\n`);
  atomicWrite(path.join(dir, "latest.json"), `${JSON.stringify({
    artifactPath: fileName,
    artifactSha256,
    methodId: FITTED_DIXON_COLES_METHOD_ID,
    trainingRowCount: artifact.training.rowCount,
  }, null, 2)}\n`);
  return { artifactPath: fileName, artifactSha256 };
}

function buildArtifact(input: {
  rows: FittedDixonColesTrainingRow[];
  clubHistoryDatasetSha256: string;
  preKickoffEloDatasetSha256: string;
  fitScope: FittedDixonColesFitScope;
  excludedFixtureCount: number;
  plFixtureCoverage: { covered: number; n: number };
  timeDecayXi?: number;
  clubEloPriorStrength?: number;
  rollingOrigins?: readonly string[];
}): FittedDixonColesArtifact {
  const fitted = fitTimeDecayedDixonColes(input.rows, {
    timeDecayXi: input.timeDecayXi,
    clubEloPriorStrength: input.clubEloPriorStrength,
  });
  const origins = input.rollingOrigins ?? DEFAULT_ROLLING_ORIGINS;
  return {
    schemaVersion: 1,
    contributor: {
      id: FITTED_DIXON_COLES_CONTRIBUTOR_ID,
      methodId: FITTED_DIXON_COLES_METHOD_ID,
      status: "challenger",
    },
    params: fitted.params,
    training: {
      clubHistoryDatasetSha256: input.clubHistoryDatasetSha256,
      preKickoffEloDatasetSha256: input.preKickoffEloDatasetSha256,
      splitManifest: origins.map((origin) => rollingOriginSplit(input.rows, origin)),
      rowCount: input.rows.length,
      clubCount: uniqueClubs(input.rows).length,
      fitScope: input.fitScope,
      excludedFixtureCount: input.excludedFixtureCount,
      plFixtureCoverage: input.plFixtureCoverage,
      converged: fitted.converged,
      iterations: fitted.iterations,
      logLikelihood: fitted.logLikelihood,
    },
  };
}

export function trainFittedDixonColes(input: {
  historyStatus?: "pass" | "inconclusive" | "fail";
  preKickoffStatus?: "pass" | "inconclusive" | "fail";
  requiredMissingCount?: number;
  requiredCoveredCount?: number;
  inventedRatingCount?: number;
  eligibleForOfflineTraining?: boolean;
  fixtures?: readonly HistoricalFixture[];
  preKickoffRows?: readonly PreKickoffEloRow[];
  dataDir?: string;
  forceRetrain?: boolean;
  clubHistoryDatasetSha256?: string;
  preKickoffEloDatasetSha256?: string;
  timeDecayXi?: number;
  clubEloPriorStrength?: number;
  rollingOrigins?: readonly string[];
}): FittedDixonColesTrainResult {
  if (input.dataDir && !input.forceRetrain && !input.fixtures && !input.preKickoffRows) {
    const existing = loadFittedDixonColesArtifact(input.dataDir);
    if (existing) {
      return {
        status: "trained",
        reason: "artifact-present",
        artifact: existing,
        trainingRowCount: existing.training.rowCount ?? 0,
      };
    }
  }

  let fixtures = input.fixtures;
  let preKickoffRows = input.preKickoffRows;
  let historyStatus = input.historyStatus;
  let preKickoffStatus = input.preKickoffStatus;
  let requiredMissingCount = input.requiredMissingCount;
  let requiredCoveredCount = input.requiredCoveredCount;
  let inventedRatingCount = input.inventedRatingCount;
  let eligibleForOfflineTraining = input.eligibleForOfflineTraining;
  let clubHistoryDatasetSha256 = input.clubHistoryDatasetSha256;
  let preKickoffEloDatasetSha256 = input.preKickoffEloDatasetSha256;
  let plFixtureCoverage = { covered: 0, n: 760 };

  if (input.dataDir && (!fixtures || !preKickoffRows || historyStatus === undefined || preKickoffStatus === undefined)) {
    const loaded = loadOfflineTrainingCorpus(input.dataDir);
    if (!loaded.ok) {
      return {
        status: "blocked",
        reason: loaded.reason,
        artifact: null,
        trainingRowCount: 0,
      };
    }
    fixtures = fixtures ?? loaded.corpus.fixtures;
    preKickoffRows = preKickoffRows ?? loaded.corpus.preKickoffRows;
    historyStatus = historyStatus ?? loaded.corpus.historyStatus;
    preKickoffStatus = preKickoffStatus ?? loaded.corpus.preKickoffStatus;
    requiredMissingCount = requiredMissingCount ?? loaded.corpus.requiredMissingCount;
    requiredCoveredCount = requiredCoveredCount ?? loaded.corpus.requiredCoveredCount;
    inventedRatingCount = inventedRatingCount ?? loaded.corpus.inventedRatingCount;
    eligibleForOfflineTraining = eligibleForOfflineTraining ?? loaded.corpus.eligibleForOfflineTraining;
    clubHistoryDatasetSha256 = clubHistoryDatasetSha256 ?? loaded.corpus.clubHistoryDatasetSha256;
    preKickoffEloDatasetSha256 = preKickoffEloDatasetSha256 ?? loaded.corpus.preKickoffEloDatasetSha256;
    plFixtureCoverage = {
      covered: loaded.corpus.requiredCoveredCount,
      n: loaded.corpus.requiredCoveredCount + loaded.corpus.requiredMissingCount,
    };
  }

  if (historyStatus !== undefined || preKickoffStatus !== undefined) {
    const gate = resolveOfflineTrainingMode({
      historyStatus: historyStatus ?? "fail",
      preKickoffStatus: preKickoffStatus ?? "fail",
      requiredMissingCount: requiredMissingCount ?? 1,
      requiredCoveredCount: requiredCoveredCount ?? 0,
      inventedRatingCount,
      eligibleForOfflineTraining,
    });
    if (!gate.ok) {
      return {
        status: "blocked",
        reason: gate.reason,
        artifact: null,
        trainingRowCount: 0,
      };
    }
  } else if (!fixtures || !preKickoffRows) {
    return {
      status: "blocked",
      reason: "missing-research-artifacts",
      artifact: null,
      trainingRowCount: 0,
    };
  }

  const trainingRows = fixtures && preKickoffRows ? joinTrainingRows(fixtures, preKickoffRows) : [];
  const joinedIntegrity = assertJoinedTrainingRowsComplete(trainingRows);
  if (!joinedIntegrity.ok) {
    return {
      status: "blocked",
      reason: joinedIntegrity.reason,
      artifact: null,
      trainingRowCount: trainingRows.length,
    };
  }
  if (trainingRows.length === 0) {
    return {
      status: "blocked",
      reason: "no-joined-training-rows",
      artifact: null,
      trainingRowCount: 0,
    };
  }
  if (uniqueClubs(trainingRows).length < 2) {
    return {
      status: "blocked",
      reason: "insufficient-training-clubs",
      artifact: null,
      trainingRowCount: trainingRows.length,
    };
  }

  const missingCount = requiredMissingCount ?? 0;
  const fitScope = missingCount === 0
    ? FIT_SCOPE_ALL_JOINED_PL_ROWS
    : FIT_SCOPE_JOINED_WITH_PRE_KICKOFF_ELO;
  const effectivePlCoverage = missingCount > 0
    ? {
      covered: requiredCoveredCount ?? plFixtureCoverage.covered ?? trainingRows.length,
      n: (requiredCoveredCount ?? plFixtureCoverage.covered ?? trainingRows.length) + missingCount,
    }
    : { covered: trainingRows.length, n: trainingRows.length };
  const artifact = buildArtifact({
    rows: trainingRows,
    clubHistoryDatasetSha256: clubHistoryDatasetSha256 ?? UNPINNED_SHA,
    preKickoffEloDatasetSha256: preKickoffEloDatasetSha256 ?? UNPINNED_SHA,
    fitScope,
    excludedFixtureCount: missingCount,
    plFixtureCoverage: effectivePlCoverage,
    timeDecayXi: input.timeDecayXi,
    clubEloPriorStrength: input.clubEloPriorStrength,
    rollingOrigins: input.rollingOrigins,
  });
  if (input.dataDir) {
    writeFittedDixonColesArtifact(input.dataDir, artifact);
  }
  return {
    status: "trained",
    reason: artifact.training.converged ? "mle-converged" : "mle-max-iterations",
    artifact,
    trainingRowCount: trainingRows.length,
  };
}
