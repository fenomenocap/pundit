import type { MarketKey } from "./data/fixtures";
import { KICKOFF_TIME_ZONE } from "../../lib/fixture-presentation.ts";

/** Matches API `MARKET_OBSERVATION_MAX_AGE_MS` in ask.ts — do not show older lines. */
export const MARKET_OBSERVATION_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Mirrors `MODEL_EDGE_CLAIMS_ALLOWED` in packages/api/src/config/backtest-gate.ts */
export const MODEL_EDGE_CLAIMS_ALLOWED = false;

export type RawOddsSource = {
  source: string;
  observedAt: string;
  pHome: number;
  pDraw: number;
  pAway: number;
};

export type DeskMarketQuote = {
  source: string;
  sourceLabel: string;
  observedAt: string;
  decimals: { home: number; draw: number; away: number };
};

function sourceLabel(source: string): string {
  if (source === "kalshi") return "Kalshi";
  if (source === "polymarket") return "Polymarket";
  if (source === "stake") return "Stake";
  return source;
}

function isCompleteSource(source: RawOddsSource): boolean {
  return source.pHome > 0.02 && source.pDraw > 0.02 && source.pAway > 0.02;
}

export function isFreshMarketObservation(observedAt: string, now = Date.now()): boolean {
  const observed = Date.parse(observedAt);
  if (!Number.isFinite(observed)) return false;
  return Math.abs(now - observed) <= MARKET_OBSERVATION_MAX_AGE_MS;
}

export function pickDeskMarketQuote(
  sources: readonly RawOddsSource[] | undefined,
  now = Date.now(),
): DeskMarketQuote | null {
  for (const source of sources ?? []) {
    if (!isCompleteSource(source) || !isFreshMarketObservation(source.observedAt, now)) continue;
    return {
      source: source.source,
      sourceLabel: sourceLabel(source.source),
      observedAt: source.observedAt,
      decimals: {
        home: 1 / source.pHome,
        draw: 1 / source.pDraw,
        away: 1 / source.pAway,
      },
    };
  }
  return null;
}

export function marketDecimalForPick(quote: DeskMarketQuote, pick: MarketKey): number | null {
  if (pick === "home" || pick === "draw" || pick === "away") return quote.decimals[pick];
  return null;
}

export function formatMarketAsOfUk(observedAt: string): string | null {
  const date = new Date(observedAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: KICKOFF_TIME_ZONE,
  });
}

export function formatDeskMarketLine(
  quote: DeskMarketQuote,
  pick: MarketKey,
  modelProb: number,
): string | null {
  const decimal = marketDecimalForPick(quote, pick);
  if (decimal === null) return null;
  const asOf = formatMarketAsOfUk(quote.observedAt);
  // Source names stay behind the Sources toggle; visible prose says "Mkt" only.
  const base = `Mkt ${decimal.toFixed(2)}${asOf ? ` · as of ${asOf}` : ""}`;
  if (!MODEL_EDGE_CLAIMS_ALLOWED) return base;
  const edgePp = (modelProb - 1 / decimal) * 100;
  const sign = edgePp > 0 ? "+" : "";
  return `${base} · ${sign}${edgePp.toFixed(1)}pp`;
}
