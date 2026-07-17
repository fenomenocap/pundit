import { normalizedTeamPairKey } from "../lib/team-names";
import { getFeaturedFixtures } from "./featured-fixtures";
import {
  fetchKalshiOdds,
  fetchPolymarketOdds,
  fetchStakeOdds,
} from "./fixture-market-sources";
import { ModelFixture } from "./model-data";

// Market prices move fastest on match day; 30 minutes keeps the comparison
// honest while staying trivial for three public endpoints.
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

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

interface MarketOddsCache {
  byFixture: Map<string, FixtureMarketOdds>;
  lastUpdated: Date | null;
  error: string | null;
  sourceWarnings: Record<string, string | null>;
}

const cache: MarketOddsCache = {
  byFixture: new Map(),
  lastUpdated: null,
  error: null,
  sourceWarnings: {},
};

export function marketOddsFixtureKey(date: string, home: string, away: string): string {
  return `${date}::${normalizedTeamPairKey(home, away)}`;
}

export function getCachedFixtureMarketOdds(fixture: ModelFixture): FixtureMarketOdds | null {
  return cache.byFixture.get(marketOddsFixtureKey(fixture.date, fixture.home, fixture.away)) ?? null;
}

export function getModelMarketOddsStatus() {
  return {
    ready: cache.lastUpdated !== null,
    lastUpdated: cache.lastUpdated,
    error: cache.error,
    sourceWarnings: { ...cache.sourceWarnings },
  };
}

export async function refreshModelMarketOdds(): Promise<void> {
  console.log("[ModelMarketOdds] Refreshing featured fixture odds...");
  try {
    const featured = getFeaturedFixtures().map((fixture) => fixture.model);
    const sources = await Promise.allSettled([
      fetchStakeOdds(featured),
      fetchPolymarketOdds(featured),
      fetchKalshiOdds(featured),
    ]);
    const names = ["stake", "polymarket", "kalshi"] as const;
    const fetched: Array<Map<string, ThreeWayOdds>> = [];
    cache.sourceWarnings = {};
    sources.forEach((result, index) => {
      const name = names[index];
      if (result.status === "fulfilled") {
        fetched[index] = result.value;
        cache.sourceWarnings[name] = null;
      } else {
        fetched[index] = new Map();
        const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
        cache.sourceWarnings[name] = `${name} odds fetch failed (${message})`;
        console.warn(`[ModelMarketOdds] ${cache.sourceWarnings[name]}`);
      }
    });
    cache.byFixture = new Map(featured.map((fixture) => {
      const pair = normalizedTeamPairKey(fixture.home, fixture.away);
      return [marketOddsFixtureKey(fixture.date, fixture.home, fixture.away), {
        stake: fetched[0].get(pair) ?? null,
        polymarket: fetched[1].get(pair) ?? null,
        kalshi: fetched[2].get(pair) ?? null,
      }];
    }));
    cache.lastUpdated = new Date();
    cache.error = null;
    console.log(`[ModelMarketOdds] ${cache.byFixture.size}/${featured.length} featured fixtures cached.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    cache.error = message;
    console.error(`[ModelMarketOdds] Refresh error: ${message}`);
  }
}

let cronTimer: ReturnType<typeof setInterval> | null = null;

export async function startModelMarketOddsCron(): Promise<void> {
  await refreshModelMarketOdds();
  cronTimer = setInterval(refreshModelMarketOdds, REFRESH_INTERVAL_MS);
  console.log("[ModelMarketOdds] Cron started — refreshing every 30 minutes");
}

export function stopModelMarketOddsCron(): void {
  if (cronTimer) clearInterval(cronTimer);
  cronTimer = null;
}
