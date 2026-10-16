import type { OneXTwoOutcome } from "./response-correctness";

export const MARKET_STALE_MS = 60 * 60 * 1000;
export const MARKET_DISAGREEMENT_POINTS = 3;

export interface ExternalMarketSourceRow {
  source: string;
  observedAt: string;
  pHome: number;
  pDraw: number;
  pAway: number;
  /** Trade volume or open interest when the collector supplies it; else 1. */
  weight?: number;
}

export interface ExternalMarketConsensus {
  label: "Market consensus";
  pHome: number;
  pDraw: number;
  pAway: number;
  asOf: string;
  stale: boolean;
  staleSources: string[];
  disagreement: boolean;
  maxSpreadPoints: number;
  sourceCount: number;
  sources: Array<{ source: string; observedAt: string; weight: number }>;
}

const OUTCOMES: OneXTwoOutcome[] = ["home", "draw", "away"];

function completeRow(row: ExternalMarketSourceRow): row is ExternalMarketSourceRow & {
  pDraw: number;
} {
  return OUTCOMES.every((leg) => {
    const value = row[leg === "home" ? "pHome" : leg === "draw" ? "pDraw" : "pAway"];
    return Number.isFinite(value) && value > 0 && value < 1;
  });
}

/** Volume-weighted median of finite values; equal weight when volume is missing. */
export function weightedMedian(values: ReadonlyArray<{ value: number; weight: number }>): number | null {
  const rows = values.filter((row) => Number.isFinite(row.value) && Number.isFinite(row.weight) && row.weight > 0);
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, row) => sum + row.weight, 0);
  let cumulative = 0;
  for (const row of sorted) {
    cumulative += row.weight;
    if (cumulative >= total / 2) return row.value;
  }
  return sorted[sorted.length - 1].value;
}

function spreadPoints(values: number[]): number {
  if (values.length < 2) return 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return Math.round((max - min) * 1000) / 10;
}

/**
 * De-margined source rows → one consensus line (volume-weighted median per leg),
 * plus stale (>60m) and disagreement (>3pt on any leg) flags.
 */
export function buildExternalMarketConsensus(
  rows: readonly ExternalMarketSourceRow[],
  now = Date.now(),
): ExternalMarketConsensus | null {
  const complete = rows.filter(completeRow);
  if (!complete.length) return null;

  const staleSources = complete
    .filter((row) => {
      const observed = Date.parse(row.observedAt);
      return !Number.isFinite(observed) || now - observed > MARKET_STALE_MS;
    })
    .map((row) => row.source);

  const legs: Record<OneXTwoOutcome, number | null> = { home: null, draw: null, away: null };
  let maxSpread = 0;
  for (const outcome of OUTCOMES) {
    const key = outcome === "home" ? "pHome" : outcome === "draw" ? "pDraw" : "pAway";
    const rawValues = complete.map((row) => row[key]);
    maxSpread = Math.max(maxSpread, spreadPoints(rawValues));
    legs[outcome] = weightedMedian(complete.map((row) => ({
      value: row[key],
      weight: row.weight && row.weight > 0 ? row.weight : 1,
    })));
  }
  if (OUTCOMES.some((outcome) => legs[outcome] === null)) return null;

  const total = legs.home! + legs.draw! + legs.away!;
  const normalized = {
    pHome: legs.home! / total,
    pDraw: legs.draw! / total,
    pAway: legs.away! / total,
  };

  const asOf = complete
    .map((row) => row.observedAt)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? new Date(now).toISOString();

  return {
    label: "Market consensus",
    ...normalized,
    asOf,
    stale: staleSources.length > 0,
    staleSources,
    disagreement: maxSpread > MARKET_DISAGREEMENT_POINTS,
    maxSpreadPoints: maxSpread,
    sourceCount: complete.length,
    sources: complete.map((row) => ({
      source: row.source,
      observedAt: row.observedAt,
      weight: row.weight && row.weight > 0 ? row.weight : 1,
    })),
  };
}
