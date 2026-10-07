import { createHash } from "node:crypto";
import { matrixTo1x2, matrixToBtts, matrixToTotals, scoreMatrix } from "./dixon-coles";

/** Offline EPL research. No runtime selector or production artifact is changed here. */
export interface HistoricalGoalRow {
  sourceEventId: string;
  kickoff: string;
  homeCanonicalName: string;
  awayCanonicalName: string;
  homeGoals: number;
  awayGoals: number;
  homeElo?: number;
  awayElo?: number;
  ratingDate?: string;
}

export interface GoalCalibrationOptions {
  decayDays: number;
  teamPrecision: number;
}

export interface HistoricalGoalFit {
  methodId: "shrunk-event-rate-elo-allocation-v1";
  origin: string;
  options: GoalCalibrationOptions;
  intercept: number;
  teamEffects: Record<string, number>;
  allocationSlope: number;
  homeOffset: number;
  rho: number;
  trainingCount: number;
  allocationTrainingCount: number;
  trainingThrough: string;
  trainingSha256: string;
  converged: boolean;
  gradientNorm: number;
}

export const GOAL_CALIBRATION_CANDIDATES: readonly GoalCalibrationOptions[] = [
  { decayDays: 180, teamPrecision: 100 },
  { decayDays: 180, teamPrecision: 25 },
  { decayDays: 365, teamPrecision: 100 },
  { decayDays: 90, teamPrecision: 100 },
  { decayDays: 180, teamPrecision: 1_000_000 },
];

function validateRow(row: HistoricalGoalRow): void {
  if (!row.sourceEventId || !Number.isFinite(Date.parse(row.kickoff))
    || !row.homeCanonicalName || !row.awayCanonicalName
    || row.homeCanonicalName === row.awayCanonicalName
    || ![row.homeGoals, row.awayGoals].every((v) => Number.isSafeInteger(v) && v >= 0 && v <= 30)) {
    throw new Error("Invalid historical goal row");
  }
  if (row.homeElo !== undefined || row.awayElo !== undefined) {
    if (![row.homeElo, row.awayElo].every((v) => typeof v === "number" && Number.isFinite(v))
      || !row.ratingDate || !/^\d{4}-\d{2}-\d{2}$/.test(row.ratingDate)
      || !Number.isFinite(Date.parse(`${row.ratingDate}T00:00:00Z`))
      || new Date(`${row.ratingDate}T00:00:00Z`).toISOString().slice(0, 10) !== row.ratingDate
      || Date.parse(`${row.ratingDate}T00:00:00Z`) >= Date.parse(row.kickoff.slice(0, 10))) {
      throw new Error("Missing or post-kickoff historical rating");
    }
  }
}

function sigmoid(x: number): number {
  return x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
}

function solve(matrix: number[][], rhs: number[]): number[] {
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < rhs.length; col += 1) {
    let pivot = col;
    for (let i = col + 1; i < rhs.length; i += 1) {
      if (Math.abs(a[i][col]) > Math.abs(a[pivot][col])) pivot = i;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) throw new Error("Singular calibration information");
    [a[pivot], a[col]] = [a[col], a[pivot]];
    const divisor = a[col][col];
    for (let j = col; j <= rhs.length; j += 1) a[col][j] /= divisor;
    for (let i = 0; i < rhs.length; i += 1) {
      if (i === col) continue;
      const factor = a[i][col];
      for (let j = col; j <= rhs.length; j += 1) a[i][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row[rhs.length]);
}

type Evaluation = { value: number; gradient: number[]; information: number[][] };

function stableSum(values: number[]): number {
  let sum = 0, correction = 0;
  for (const value of values) {
    const next = sum + value;
    correction += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum;
    sum = next;
  }
  return sum + correction;
}

function optimize(initial: number[], evaluate: (x: number[]) => Evaluation,
  difference: (from: number[], to: number[]) => number): {
  x: number[]; converged: boolean; gradientNorm: number;
} {
  let x = initial;
  let current = evaluate(x);
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const norm = Math.hypot(...current.gradient);
    if (norm <= 1e-7) return { x, converged: true, gradientNorm: norm };
    const step = solve(current.information, current.gradient);
    let accepted = false;
    for (let rate = 1; rate >= 1 / 65536; rate /= 2) {
      const next = x.map((v, i) => v - rate * step[i]);
      const candidate = evaluate(next);
      if (Number.isFinite(candidate.value) && difference(x, next)
        <= -1e-4 * rate * current.gradient.reduce((sum, v, i) => sum + v * step[i], 0)) {
        x = next;
        current = candidate;
        accepted = true;
        break;
      }
    }
    if (!accepted) return { x, converged: false, gradientNorm: Math.hypot(...current.gradient) };
  }
  return { x, converged: false, gradientNorm: Math.hypot(...current.gradient) };
}

function information(n: number): number[][] {
  return Array.from({ length: n }, () => new Array<number>(n).fill(0));
}

/** Every included result must be available at least 24 hours before origin. */
export function fitHistoricalGoalRates(
  input: readonly HistoricalGoalRow[], origin: string, options: GoalCalibrationOptions,
): HistoricalGoalFit {
  const now = Date.parse(origin);
  if (!Number.isFinite(now) || !Number.isFinite(options.decayDays) || options.decayDays < 30
    || !Number.isFinite(options.teamPrecision) || options.teamPrecision <= 0) {
    throw new Error("Invalid historical calibration options/origin");
  }
  const rows = [...input].sort((a, b) => a.kickoff.localeCompare(b.kickoff)
    || a.sourceEventId.localeCompare(b.sourceEventId));
  const ids = new Set<string>();
  for (const row of rows) {
    validateRow(row);
    if (Date.parse(row.kickoff) > now - 86_400_000 || ids.has(row.sourceEventId)) {
      throw new Error("Duplicate or unavailable training outcome");
    }
    ids.add(row.sourceEventId);
  }
  if (rows.length < 100) throw new Error("Need 100 earlier goal outcomes");
  const clubs = [...new Set(rows.flatMap((r) => [r.homeCanonicalName, r.awayCanonicalName]))].sort();
  const clubIndex = new Map(clubs.map((c, i) => [c, i + 1]));
  const weights = rows.map((r) => Math.exp(-Math.LN2 * (now - Date.parse(r.kickoff))
    / (options.decayDays * 86_400_000)));
  const totalFit = optimize([Math.log(2.7), ...clubs.map(() => 0)], (x) => {
    const gradient = new Array<number>(x.length).fill(0);
    const hessian = information(x.length);
    let value = 0;
    rows.forEach((row, i) => {
      const features = [0, clubIndex.get(row.homeCanonicalName)!, clubIndex.get(row.awayCanonicalName)!];
      const eta = features.reduce((sum, j) => sum + x[j], 0);
      const mu = Math.exp(eta);
      const y = row.homeGoals + row.awayGoals;
      value += weights[i] * (mu - y * eta);
      for (const j of features) {
        gradient[j] += weights[i] * (mu - y);
        for (const k of features) hessian[j][k] += weights[i] * mu;
      }
    });
    x.forEach((v, i) => {
      const precision = i === 0 ? 10 : options.teamPrecision;
      const delta = v - (i === 0 ? Math.log(2.7) : 0);
      value += precision * delta * delta / 2;
      gradient[i] += precision * delta;
      hessian[i][i] += precision;
    });
    return { value, gradient, information: hessian };
  }, (from, to) => {
    const terms = rows.map((row, i) => {
      const features = [0, clubIndex.get(row.homeCanonicalName)!, clubIndex.get(row.awayCanonicalName)!];
      const eta = features.reduce((sum, j) => sum + from[j], 0);
      const delta = features.reduce((sum, j) => sum + (to[j] - from[j]), 0);
      return weights[i] * (Math.exp(eta) * Math.expm1(delta) - (row.homeGoals + row.awayGoals) * delta);
    });
    from.forEach((v, i) => {
      const precision = i === 0 ? 10 : options.teamPrecision, delta = to[i] - v;
      terms.push(precision * ((v - (i === 0 ? Math.log(2.7) : 0)) * delta + delta * delta / 2));
    });
    return stableSum(terms);
  });
  const rated = rows.map((row, i) => ({ row, weight: weights[i] }))
    .filter(({ row }) => row.homeElo !== undefined);
  if (rated.length < 30) throw new Error("Need 30 earlier dated-rating outcomes");
  const allocationFit = optimize([1, 42 * Math.LN10 / 400], (x) => {
    const gradient = [0, 0];
    const hessian = information(2);
    let value = 0;
    for (const { row, weight } of rated) {
      const features = [Math.LN10 * (row.homeElo! - row.awayElo!) / 400, 1];
      const eta = features[0] * x[0] + x[1];
      const p = sigmoid(eta), n = row.homeGoals + row.awayGoals;
      const logDenominator = Math.max(eta, 0) + Math.log1p(Math.exp(-Math.abs(eta)));
      value += weight * (n * logDenominator - row.homeGoals * eta);
      features.forEach((f, j) => {
        gradient[j] += weight * (n * p - row.homeGoals) * f;
        features.forEach((g, k) => { hessian[j][k] += weight * n * p * (1 - p) * f * g; });
      });
    }
    [1, 42 * Math.LN10 / 400].forEach((prior, j) => {
      const delta = x[j] - prior;
      value += 10 * delta * delta / 2;
      gradient[j] += 10 * delta;
      hessian[j][j] += 10;
    });
    return { value, gradient, information: hessian };
  }, (from, to) => {
    const softplus = (x: number) => Math.max(x, 0) + Math.log1p(Math.exp(-Math.abs(x)));
    const terms = rated.map(({ row, weight }) => {
      const feature = Math.LN10 * (row.homeElo! - row.awayElo!) / 400;
      const eta = feature * from[0] + from[1], delta = feature * (to[0] - from[0]) + (to[1] - from[1]);
      const partition = Math.abs(delta) <= 20 ? Math.log1p(sigmoid(eta) * Math.expm1(delta))
        : softplus(eta + delta) - softplus(eta);
      return weight * ((row.homeGoals + row.awayGoals) * partition - row.homeGoals * delta);
    });
    [1, 42 * Math.LN10 / 400].forEach((prior, i) => {
      const delta = to[i] - from[i];
      terms.push(10 * ((from[i] - prior) * delta + delta * delta / 2));
    });
    return stableSum(terms);
  });
  const fit: HistoricalGoalFit = {
    methodId: "shrunk-event-rate-elo-allocation-v1", origin, options: { ...options },
    intercept: totalFit.x[0], teamEffects: Object.fromEntries(clubs.map((c, i) => [c, totalFit.x[i + 1]])),
    allocationSlope: allocationFit.x[0], homeOffset: allocationFit.x[1], rho: 0,
    trainingCount: rows.length, allocationTrainingCount: rated.length,
    trainingThrough: rows.at(-1)!.kickoff,
    trainingSha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    converged: totalFit.converged && allocationFit.converged,
    gradientNorm: Math.max(totalFit.gradientNorm, allocationFit.gradientNorm),
  };
  // One-dimensional low-score correction; bounded for every allowed rate pair.
  let best = Infinity;
  for (let step = -20; step <= 15; step += 1) {
    const rho = step / 100;
    let value = 10 * (rho + 0.1) ** 2;
    for (const { row, weight } of rated) {
      const [home, away] = historicalGoalLambdas(fit, row);
      let tau = 1;
      if (row.homeGoals === 0 && row.awayGoals === 0) tau = 1 - home * away * rho;
      else if (row.homeGoals === 0 && row.awayGoals === 1) tau = 1 + home * rho;
      else if (row.homeGoals === 1 && row.awayGoals === 0) tau = 1 + away * rho;
      else if (row.homeGoals === 1 && row.awayGoals === 1) tau = 1 - rho;
      value -= weight * Math.log(tau);
    }
    if (value < best) { best = value; fit.rho = rho; }
  }
  if (![fit.intercept, fit.allocationSlope, fit.homeOffset, fit.rho, ...Object.values(fit.teamEffects)]
    .every(Number.isFinite) || fit.allocationSlope <= 0) fit.converged = false;
  return fit;
}

export function historicalGoalLambdas(
  fit: HistoricalGoalFit, row: Pick<HistoricalGoalRow, "homeCanonicalName" | "awayCanonicalName" | "homeElo" | "awayElo">,
): [number, number] {
  if (![row.homeElo, row.awayElo].every((v) => typeof v === "number" && Number.isFinite(v))) {
    throw new Error("Forecast requires dated Elo for both teams");
  }
  const total = Math.exp(fit.intercept
    + (fit.teamEffects[row.homeCanonicalName] ?? 0) + (fit.teamEffects[row.awayCanonicalName] ?? 0));
  if (!Number.isFinite(total) || total < 1.5 || total > 4.5) {
    throw new Error("Fitted scoring rate outside the declared 1.5–4.5 domain");
  }
  const share = sigmoid(fit.allocationSlope * Math.LN10 * (row.homeElo! - row.awayElo!) / 400 + fit.homeOffset);
  return [total * share, total * (1 - share)];
}

export function forecastHistoricalGoalRates(fit: HistoricalGoalFit, row: HistoricalGoalRow) {
  validateRow(row);
  if (!fit.converged || !Number.isFinite(fit.gradientNorm) || fit.gradientNorm < 0 || fit.gradientNorm > 1e-7
    || !Number.isFinite(Date.parse(fit.origin))
    || ![fit.intercept, fit.allocationSlope, fit.homeOffset, fit.rho, ...Object.values(fit.teamEffects)].every(Number.isFinite)
    || fit.allocationSlope <= 0 || fit.rho < -0.2 || fit.rho > 0.15
    || Date.parse(row.kickoff) < Date.parse(fit.origin)) {
    throw new Error("Unconverged or post-outcome model cannot forecast");
  }
  const [lambdaHome, lambdaAway] = historicalGoalLambdas(fit, row);
  const matrix = scoreMatrix(lambdaHome, lambdaAway, fit.rho);
  if (matrix.some((r) => r.some((p) => !Number.isFinite(p) || p < 0))
    || Math.abs(matrix.flat().reduce((a, b) => a + b, 0) - 1) > 1e-10) {
    throw new Error("Invalid calibrated probability distribution");
  }
  return { lambdaHome, lambdaAway, rho: fit.rho, matrix, oneXTwo: matrixTo1x2(matrix),
    overUnder: matrixToTotals(matrix, 2.5), btts: matrixToBtts(matrix) };
}
