import type { Grounding } from "../ask";
import type { MarketPricingRow } from "../response-correctness";
import { MARKET_STALE_MS } from "../external-market-consensus";

export function isLiveMarketObservedAt(observedAt: string, nowMs: number): boolean {
  const ts = Date.parse(observedAt);
  return Number.isFinite(ts) && nowMs - ts <= MARKET_STALE_MS;
}

/** Pricing rows with complete 1X2 legs and observedAt within MARKET_STALE_MS. */
export function livePricingMarkets(
  grounding: Grounding,
  nowMs = Date.now(),
): MarketPricingRow[] {
  return grounding.pricing.markets.filter(
    (row) => (row.legs.draw.decimalOdds != null || row.legs.draw.impliedP != null)
      && isLiveMarketObservedAt(row.observedAt, nowMs),
  );
}
