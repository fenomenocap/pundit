/** Reconstruct production Elo→λ. Totals on the desk come from the live API row. */

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
  homeElo: number;
  awayElo: number;
  pOver2_5: number;
  forecastProvenance?: {
    homeAdvantageElo?: number;
    config?: { baseGoals?: number; eloScale?: number; lambdaCap?: number };
  };
};

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

/** xG from production λ; Over 2.5 is the server probability, never a second grid. */
export function deskNumbersFromModelRow(row: ModelRowLambdas): {
  xg: [number, number];
  over25: number;
} {
  const [lh, la] = impliedLambdas(row.homeElo, row.awayElo, {
    hfa: row.forecastProvenance?.homeAdvantageElo ?? 42,
    baseGoals: row.forecastProvenance?.config?.baseGoals,
    eloScale: row.forecastProvenance?.config?.eloScale,
    lambdaCap: row.forecastProvenance?.config?.lambdaCap,
  });
  return {
    xg: [Math.round(lh * 100) / 100, Math.round(la * 100) / 100],
    over25: row.pOver2_5,
  };
}
