import { normalizedTeamPairKey } from "../lib/team-names";
import { getFeaturedFixtures } from "./featured-fixtures";
import {
  fetchKalshiOdds,
  fetchPolymarketOdds,
  fetchStakeOdds,
} from "./fixture-market-sources";
import { ModelFixture } from "./model-data";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

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

function probability(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 && raw < 1
    ? raw
    : null;
}

export function parseActiveMatchResult(raw: unknown): ThreeWayOdds | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const matchResult = source.match_result;
  if (!matchResult || typeof matchResult !== "object") return null;
  const market = matchResult as Record<string, unknown>;
  if (market.status !== "active" || !market.outcomes || typeof market.outcomes !== "object") {
    return null;
  }

  const outcomes = market.outcomes as Record<string, unknown>;
  const read = (name: string): number | null => {
    const outcome = outcomes[name];
    if (!outcome || typeof outcome !== "object") return null;
    return probability((outcome as Record<string, unknown>).implied_probability);
  };
  const pHome = read("home");
  const pDraw = read("draw");
  const pAway = read("away");
  if (pHome === null || pDraw === null || pAway === null) return null;
  const total = pHome + pDraw + pAway;
  if (!Number.isFinite(total) || total <= 0) return null;
  return { pHome: pHome / total, pDraw: pDraw / total, pAway: pAway / total };
}

export function parseFeaturedMarketOdds(
  raw: unknown,
  featured: ModelFixture[]
): Map<string, FixtureMarketOdds> {
  if (!raw || typeof raw !== "object") throw new Error("market odds payload must be an object.");
  const payload = raw as Record<string, unknown>;
  if (!Array.isArray(payload.fixtures)) throw new Error("market odds fixtures must be an array.");
  const featuredKeys = new Set(featured.map((fixture) =>
    marketOddsFixtureKey(fixture.date, fixture.home, fixture.away)
  ));
  const next = new Map<string, FixtureMarketOdds>();

  for (const value of payload.fixtures) {
    if (!value || typeof value !== "object") continue;
    const fixture = value as Record<string, unknown>;
    if (typeof fixture.date !== "string"
      || typeof fixture.home !== "string"
      || typeof fixture.away !== "string") continue;
    const key = marketOddsFixtureKey(fixture.date, fixture.home, fixture.away);
    if (!featuredKeys.has(key)) continue;
    next.set(key, {
      stake: parseActiveMatchResult(fixture.stake),
      polymarket: parseActiveMatchResult(fixture.polymarket),
      kalshi: parseActiveMatchResult(fixture.kalshi),
    });
  }
  return next;
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
  cronTimer = setInterval(refreshModelMarketOdds, SIX_HOURS_MS);
  console.log("[ModelMarketOdds] Cron started — refreshing every 6 hours");
}

export function stopModelMarketOddsCron(): void {
  if (cronTimer) clearInterval(cronTimer);
  cronTimer = null;
}
