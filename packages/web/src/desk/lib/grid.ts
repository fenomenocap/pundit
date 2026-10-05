/** Reconstruct production Elo→λ. Totals on the desk come from the live API row. */

import type { ModelFixtureResponse } from "@/lib/api";

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
  forecastInputs?: ModelFixtureResponse["forecastInputs"];
  forecastProvenance?: {
    ratingArtifactId?: string;
    ratingArtifactSha256?: string;
    ratingSnapshotAt?: string | null;
    homeAdvantageElo?: number;
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

/** xG from production λ; Over 2.5 is the server probability, never a second grid. */
export function deskNumbersFromModelRow(row: ModelRowLambdas): {
  xg: [number, number];
  over25: number;
} {
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
