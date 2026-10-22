/**
 * Offline recency-weighted attack/defence Poisson fit.
 * Not used by the live score model. Walk-forward code passes only rows whose
 * kickoff is at least 24 hours before the origin.
 */
import { createHash } from "node:crypto";

export interface AttackDefenceRow {
  sourceEventId: string;
  kickoff: string;
  homeCanonicalName: string;
  awayCanonicalName: string;
  homeGoals: number;
  awayGoals: number;
}

export interface AttackDefenceFit {
  origin: string;
  decayDays: number;
  teamPrecision: number;
  mu: number;
  homeAdvantage: number;
  attack: Record<string, number>;
  defence: Record<string, number>;
  rho: number;
  trainingCount: number;
  trainingThrough: string;
  trainingSha256: string;
  converged: boolean;
  gradientNorm: number;
}

const DAY = 86_400_000;

function solve(matrix: number[][], rhs: number[]): number[] {
  const rows = matrix.map((row, index) => [...row, rhs[index]]);
  for (let column = 0; column < rhs.length; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < rhs.length; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) < 1e-10) throw new Error("Singular attack/defence information");
    [rows[pivot], rows[column]] = [rows[column], rows[pivot]];
    const divisor = rows[column][column];
    for (let col = column; col <= rhs.length; col += 1) rows[column][col] /= divisor;
    for (let row = 0; row < rhs.length; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let col = column; col <= rhs.length; col += 1) rows[row][col] -= factor * rows[column][col];
    }
  }
  return rows.map((row) => row[rhs.length]);
}

function nllParts(x: number[], rows: AttackDefenceRow[], weights: number[], index: Map<string, number>,
  teamPrecision: number, withHessian: boolean): { value: number; gradient: number[]; hessian: number[][] } {
  const clubs = index.size;
  const gradient = new Array<number>(x.length).fill(0);
  const hessian = withHessian ? Array.from({ length: x.length }, () => new Array<number>(x.length).fill(0)) : [];
  let value = 0;
  const attackAt = (club: string) => 2 + index.get(club)!;
  const defenceAt = (club: string) => 2 + clubs + index.get(club)!;
  rows.forEach((row, rowIndex) => {
    const homeAttack = attackAt(row.homeCanonicalName);
    const awayAttack = attackAt(row.awayCanonicalName);
    const homeDefence = defenceAt(row.homeCanonicalName);
    const awayDefence = defenceAt(row.awayCanonicalName);
    const logHome = x[0] + x[1] + x[homeAttack] - x[awayDefence];
    const logAway = x[0] + x[awayAttack] - x[homeDefence];
    const lambdaHome = Math.exp(logHome);
    const lambdaAway = Math.exp(logAway);
    const weight = weights[rowIndex];
    value += weight * (lambdaHome - row.homeGoals * logHome + lambdaAway - row.awayGoals * logAway);
    const homeResidual = weight * (lambdaHome - row.homeGoals);
    const awayResidual = weight * (lambdaAway - row.awayGoals);
    const homeFeatures: Array<[number, number]> = [[0, 1], [1, 1], [homeAttack, 1], [awayDefence, -1]];
    const awayFeatures: Array<[number, number]> = [[0, 1], [awayAttack, 1], [homeDefence, -1]];
    for (const [feature, sign] of homeFeatures) gradient[feature] += homeResidual * sign;
    for (const [feature, sign] of awayFeatures) gradient[feature] += awayResidual * sign;
    if (!withHessian) return;
    for (const [left, leftSign] of homeFeatures) {
      for (const [right, rightSign] of homeFeatures) {
        hessian[left][right] += weight * lambdaHome * leftSign * rightSign;
      }
    }
    for (const [left, leftSign] of awayFeatures) {
      for (const [right, rightSign] of awayFeatures) {
        hessian[left][right] += weight * lambdaAway * leftSign * rightSign;
      }
    }
  });
  const prior = (position: number, center: number, precision: number) => {
    const delta = x[position] - center;
    value += precision * delta * delta / 2;
    gradient[position] += precision * delta;
    if (withHessian) hessian[position][position] += precision;
  };
  prior(0, Math.log(1.35), 10);
  prior(1, 0.1, 10);
  for (let club = 0; club < clubs; club += 1) {
    prior(2 + club, 0, teamPrecision);
    prior(2 + clubs + club, 0, teamPrecision);
  }
  return { value, gradient, hessian };
}

export function fitAttackDefence(
  input: readonly AttackDefenceRow[], origin: string, decayDays = 180, teamPrecision = 10,
): AttackDefenceFit {
  const now = Date.parse(origin);
  if (!Number.isFinite(now) || decayDays < 30 || teamPrecision <= 0) throw new Error("Invalid attack/defence fit");
  const rows = [...input].sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.sourceEventId.localeCompare(b.sourceEventId));
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row.sourceEventId || !Number.isFinite(Date.parse(row.kickoff)) || row.homeCanonicalName === row.awayCanonicalName
      || ![row.homeGoals, row.awayGoals].every((goals) => Number.isSafeInteger(goals) && goals >= 0 && goals <= 30)) {
      throw new Error("Invalid attack/defence row");
    }
    if (Date.parse(row.kickoff) > now - DAY || ids.has(row.sourceEventId)) throw new Error("Future or duplicate attack/defence row");
    ids.add(row.sourceEventId);
  }
  if (rows.length < 100) throw new Error("Need 100 earlier attack/defence outcomes");
  const clubs = [...new Set(rows.flatMap((row) => [row.homeCanonicalName, row.awayCanonicalName]))].sort();
  const index = new Map(clubs.map((club, clubIndex) => [club, clubIndex]));
  const weights = rows.map((row) => Math.exp(-Math.LN2 * (now - Date.parse(row.kickoff)) / (decayDays * DAY)));
  let x = new Array<number>(2 + clubs.length * 2).fill(0);
  x[0] = Math.log(1.35);
  x[1] = 0.1;
  let current = nllParts(x, rows, weights, index, teamPrecision, false);
  let converged = false;
  let gradientNorm = Math.hypot(...current.gradient);
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const derived = nllParts(x, rows, weights, index, teamPrecision, true);
    gradientNorm = Math.hypot(...derived.gradient);
    // Newton stops in a flat region before 1e-6. A norm of 0.01 across the
    // whole parameter vector is a negligible per-match gradient.
    if (gradientNorm <= 1e-2) { converged = true; current = derived; break; }
    const step = solve(derived.hessian, derived.gradient);
    let accepted = false;
    for (let rate = 1; rate >= 1 / 4096; rate /= 2) {
      const next = x.map((value, position) => value - rate * step[position]);
      if (next.some((value) => !Number.isFinite(value))) continue;
      const candidate = nllParts(next, rows, weights, index, teamPrecision, false);
      if (candidate.value < current.value - 1e-8) {
        x = next;
        current = candidate;
        accepted = true;
        break;
      }
    }
    if (!accepted) { converged = gradientNorm <= 1e-2; break; }
  }
  const fit: AttackDefenceFit = {
    origin, decayDays, teamPrecision, mu: x[0], homeAdvantage: x[1],
    attack: Object.fromEntries(clubs.map((club, clubIndex) => [club, x[2 + clubIndex]])),
    defence: Object.fromEntries(clubs.map((club, clubIndex) => [club, x[2 + clubs.length + clubIndex]])),
    rho: -0.1, trainingCount: rows.length, trainingThrough: rows.at(-1)!.kickoff,
    trainingSha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    converged, gradientNorm,
  };
  let best = Infinity;
  for (let step = -20; step <= 15; step += 1) {
    const rho = step / 100;
    let value = 10 * (rho + 0.1) ** 2;
    let valid = true;
    rows.forEach((row, rowIndex) => {
      const [home, away] = attackDefenceLambdas(fit, row.homeCanonicalName, row.awayCanonicalName);
      let tau = 1;
      if (row.homeGoals === 0 && row.awayGoals === 0) tau = 1 - home * away * rho;
      else if (row.homeGoals === 0 && row.awayGoals === 1) tau = 1 + home * rho;
      else if (row.homeGoals === 1 && row.awayGoals === 0) tau = 1 + away * rho;
      else if (row.homeGoals === 1 && row.awayGoals === 1) tau = 1 - rho;
      if (!(tau > 0)) valid = false;
      else value -= weights[rowIndex] * Math.log(tau);
    });
    if (valid && value < best) { best = value; fit.rho = rho; }
  }
  if (![fit.mu, fit.homeAdvantage, fit.rho, ...Object.values(fit.attack), ...Object.values(fit.defence)].every(Number.isFinite)) {
    fit.converged = false;
  }
  return fit;
}

export function attackDefenceLambdas(fit: AttackDefenceFit, home: string, away: string): [number, number] {
  const lambdaHome = Math.exp(fit.mu + fit.homeAdvantage + (fit.attack[home] ?? 0) - (fit.defence[away] ?? 0));
  const lambdaAway = Math.exp(fit.mu + (fit.attack[away] ?? 0) - (fit.defence[home] ?? 0));
  if (![lambdaHome, lambdaAway].every((lambda) => Number.isFinite(lambda) && lambda > 0)) {
    throw new Error("Attack/defence rates are not finite");
  }
  return [lambdaHome, lambdaAway];
}
