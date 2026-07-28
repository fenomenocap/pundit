import { getCachedModelData, getModelFixtureKey, ModelFixture } from "./model-data";
import { fetchAllMarketOdds } from "./fixture-market-sources";

// Market prices move fastest on match day; 30 minutes keeps the comparison
// honest while staying trivial for three public endpoints.
export const MARKET_ODDS_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
export const MARKET_ODDS_COLD_RETRY_MS = 2 * 60 * 1000;

export interface ThreeWayOdds {
  pHome: number;
  pDraw: number;
  pAway: number;
}

export interface FixtureMarketOdds {
  stake: ThreeWayOdds | null;
  polymarket: ThreeWayOdds | null;
  kalshi: ThreeWayOdds | null;
}

interface SourceCoverage {
  matched: number;
  total: number;
}

interface MarketOddsCache {
  byFixture: Map<string, FixtureMarketOdds>;
  lastUpdated: Date | null;
  error: string | null;
  sourceWarnings: Record<string, string | null>;
  coverage: Record<string, SourceCoverage>;
}

const cache: MarketOddsCache = {
  byFixture: new Map(),
  lastUpdated: null,
  error: null,
  sourceWarnings: {},
  coverage: {},
};

export function marketOddsFixtureKey(fixture: ModelFixture): string {
  return getModelFixtureKey(fixture);
}

export function getCachedFixtureMarketOdds(fixture: ModelFixture): FixtureMarketOdds | null {
  return cache.byFixture.get(getModelFixtureKey(fixture)) ?? null;
}

export function getModelMarketOddsStatus() {
  return {
    ready: cache.lastUpdated !== null,
    lastUpdated: cache.lastUpdated,
    error: cache.error,
    sourceWarnings: { ...cache.sourceWarnings },
    coverage: { ...cache.coverage },
  };
}

export async function refreshModelMarketOdds(): Promise<void> {
  console.log("[ModelMarketOdds] Refreshing active fixture odds...");
  try {
    const model = getCachedModelData();
    if (model.lastUpdated === null) {
      cache.error = "Active model is not ready.";
      console.warn("[ModelMarketOdds] Active model is not ready; refresh deferred.");
      return;
    }
    const active = model.fixtures;
    const sources = await fetchAllMarketOdds(active);
    const names = ["stake", "polymarket", "kalshi"] as const;
    cache.sourceWarnings = {};
    for (const name of names) {
      const fetched = sources[name];
      cache.sourceWarnings[name] = active.length > 0 && fetched.size === 0
        ? `${name} returned no matching fixtures (0/${active.length})`
        : null;
      if (cache.sourceWarnings[name]) {
        console.warn(`[ModelMarketOdds] ${cache.sourceWarnings[name]}`);
      }
    }
    cache.coverage = Object.fromEntries(names.map((name) => [
      name,
      { matched: sources[name].size, total: active.length },
    ]));
    console.log(JSON.stringify({
      event: "market_odds_coverage",
      ...Object.fromEntries(names.map((name) =>
        [name, `${sources[name].size}/${active.length}`])),
    }));
    cache.byFixture = new Map(active.map((fixture) => {
      const key = getModelFixtureKey(fixture);
      return [key, {
        stake: sources.stake.get(key) ?? null,
        polymarket: sources.polymarket.get(key) ?? null,
        kalshi: sources.kalshi.get(key) ?? null,
      }];
    }));
    cache.lastUpdated = new Date();
    cache.error = null;
    console.log(`[ModelMarketOdds] ${cache.byFixture.size}/${active.length} active fixtures cached.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    cache.error = message;
    console.error(`[ModelMarketOdds] Refresh error: ${message}`);
  }
}

export function marketOddsRefreshDelay(
  status: Pick<MarketOddsCache, "lastUpdated" | "error">
): number {
  return status.lastUpdated === null && status.error === "Active model is not ready."
    ? MARKET_ODDS_COLD_RETRY_MS
    : MARKET_ODDS_REFRESH_INTERVAL_MS;
}

let cronTimer: ReturnType<typeof setTimeout> | null = null;
let cronEnabled = false;

function scheduleModelMarketOddsRefresh(): void {
  if (!cronEnabled) return;
  const delay = marketOddsRefreshDelay(cache);
  cronTimer = setTimeout(() => {
    cronTimer = null;
    void refreshModelMarketOdds().finally(() => {
      if (cronEnabled) scheduleModelMarketOddsRefresh();
    });
  }, delay);
}

export async function startModelMarketOddsCron(): Promise<void> {
  cronEnabled = true;
  if (cronTimer) clearTimeout(cronTimer);
  await refreshModelMarketOdds();
  scheduleModelMarketOddsRefresh();
  console.log(
    `[ModelMarketOdds] Cron started — next refresh in ${marketOddsRefreshDelay(cache) / 1000}s`
  );
}

export function stopModelMarketOddsCron(): void {
  cronEnabled = false;
  if (cronTimer) clearTimeout(cronTimer);
  cronTimer = null;
}
