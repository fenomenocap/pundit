import { getCachedModelData, getModelFixtureKey, ModelFixture } from "./model-data";
import {
  disabledSourceReason,
  fetchAllMarketOdds,
  isSourceConfiguredForProfile,
  marketProfilesForFixtures,
} from "./fixture-market-sources";
import { getCachedMatches } from "./football-data";
import {
  appendMarketComparisons,
  MarketComparisonObservation,
  updateClubSeasonSnapshots,
} from "./club-season-snapshots";

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

export interface TimestampedFixtureMarketOdds extends FixtureMarketOdds {
  observedAt: string;
}

interface SourceCoverage {
  matched: number;
  total: number;
}

interface MarketOddsCache {
  byFixture: Map<string, TimestampedFixtureMarketOdds>;
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

export function getCachedFixtureMarketOdds(fixture: ModelFixture): TimestampedFixtureMarketOdds | null {
  return cache.byFixture.get(getModelFixtureKey(fixture)) ?? null;
}

export interface PublicModelOddsSource {
  source: "kalshi" | "polymarket";
  observedAt: string;
  pHome: number;
  pDraw: number;
  pAway: number;
}

export type PublicModelFixture = Omit<ModelFixture, "scorelines"> & {
  stakeObservedAt?: string;
  oddsSources: PublicModelOddsSource[];
};

function completeThreeWay(odds: ThreeWayOdds | null): ThreeWayOdds | null {
  if (
    !odds
    || !Number.isFinite(odds.pHome)
    || !Number.isFinite(odds.pDraw)
    || !Number.isFinite(odds.pAway)
  ) {
    return null;
  }
  return odds;
}

/**
 * Join the 30-minute market cache onto a model row at read time.
 * The hourly model cache stays model-only; Stake stays on the existing
 * stakeP* fields; Kalshi/Polymarket ride `oddsSources`, matching chat.
 * Incomplete legs are dropped rather than shown as a partial 1X2.
 */
export function publicModelFixture(
  fixture: ModelFixture,
  markets: TimestampedFixtureMarketOdds | null
): PublicModelFixture {
  const { scorelines: _scorelines, ...rest } = fixture;
  const stake = completeThreeWay(markets?.stake ?? null);
  const oddsSources: PublicModelOddsSource[] = [];
  const kalshi = completeThreeWay(markets?.kalshi ?? null);
  const polymarket = completeThreeWay(markets?.polymarket ?? null);
  if (kalshi && markets) {
    oddsSources.push({ source: "kalshi", observedAt: markets.observedAt, ...kalshi });
  }
  if (polymarket && markets) {
    oddsSources.push({ source: "polymarket", observedAt: markets.observedAt, ...polymarket });
  }
  return {
    ...rest,
    stakePHome: stake?.pHome ?? fixture.stakePHome,
    stakePDraw: stake?.pDraw ?? fixture.stakePDraw,
    stakePAway: stake?.pAway ?? fixture.stakePAway,
    ...(stake && markets ? { stakeObservedAt: markets.observedAt } : {}),
    oddsSources,
  };
}

export function publicModelFixtures(fixtures: ModelFixture[]): PublicModelFixture[] {
  return fixtures.map((fixture) =>
    publicModelFixture(fixture, getCachedFixtureMarketOdds(fixture))
  );
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

export function buildLedgerMarketComparisons(
  fixtures: ModelFixture[],
  byFixture: Map<string, FixtureMarketOdds>,
  sourceTimestamp: string
): Map<string, MarketComparisonObservation[]> {
  const comparisons = new Map<string, MarketComparisonObservation[]>();
  for (const fixture of fixtures) {
    const odds = byFixture.get(getModelFixtureKey(fixture));
    const rows: MarketComparisonObservation[] = [];
    for (const source of ["stake", "polymarket", "kalshi"] as const) {
      const value = odds?.[source];
      if (!value) continue;
      rows.push({ source, sourceTimestamp, ...value });
    }
    if (rows.length > 0) {
      comparisons.set(`${fixture.competitionId}:${fixture.fixtureId}`, rows);
    }
  }
  return comparisons;
}

export function changedMarketSourceWarnings(
  previous: Record<string, string | null>,
  next: Record<string, string | null>
): string[] {
  return Object.keys(next)
    .filter((name) => next[name] !== null && next[name] !== previous[name])
    .map((name) => next[name]!);
}

function sealClubSeasonFromReadyModel(model: { fixtures: ModelFixture[] }, now: Date): void {
  // The 30-minute market cadence is also a second deterministic checkpoint
  // opportunity between hourly model refreshes. Odds failures must not skip
  // this: market rows are comparison-only and never enter the Fundamental
  // calculation.
  const football = getCachedMatches();
  updateClubSeasonSnapshots(
    [...football.upcoming, ...football.recent],
    model.fixtures,
    now
  );
}

export async function refreshModelMarketOdds(): Promise<void> {
  console.log("[ModelMarketOdds] Refreshing active fixture odds...");
  const model = getCachedModelData();
  if (model.lastUpdated === null) {
    cache.error = "Active model is not ready.";
    console.warn("[ModelMarketOdds] Active model is not ready; refresh deferred.");
    return;
  }
  const active = model.fixtures;
  let oddsUpdatedAt: Date | null = null;
  try {
    const { odds: sources, errors } = await fetchAllMarketOdds(active);
    const names = ["stake", "polymarket", "kalshi"] as const;
    const profiles = marketProfilesForFixtures(active);
    const previousWarnings = cache.sourceWarnings;
    const nextWarnings: Record<string, string | null> = {};
    for (const name of names) {
      const fetched = sources[name];
      const configuredProfiles = profiles
        .filter((profile) => isSourceConfiguredForProfile(name, profile));
      const disabled = disabledSourceReason(name);
      if (active.length === 0 || fetched.size > 0) {
        nextWarnings[name] = null;
      } else if (disabled) {
        // Switched off on purpose and never queried. Distinct from both a
        // failure and a miss: there is nothing here to investigate.
        nextWarnings[name] = `${name} is disabled — ${disabled}`;
      } else if (errors[name]) {
        // The request itself failed. Distinct from matching nothing, and the
        // only one of these three states that points at us rather than at the
        // fixture names.
        nextWarnings[name] = `${name} request failed: ${errors[name]}`;
      } else if (configuredProfiles.length === 0) {
        // Never queried. Saying it "returned no matching fixtures" invites a
        // hunt for a broken request that was never issued.
        nextWarnings[name] =
          `${name} is not configured for ${profiles.join(", ") || "any active competition"}`;
      } else {
        nextWarnings[name] =
          `${name} returned no matching fixtures (0/${active.length})`;
      }
    }
    cache.sourceWarnings = nextWarnings;
    for (const warning of changedMarketSourceWarnings(previousWarnings, nextWarnings)) {
      console.warn(`[ModelMarketOdds] ${warning}`);
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
    const observedAt = new Date().toISOString();
    cache.byFixture = new Map(active.map((fixture) => {
      const key = getModelFixtureKey(fixture);
      return [key, {
        observedAt,
        stake: sources.stake.get(key) ?? null,
        polymarket: sources.polymarket.get(key) ?? null,
        kalshi: sources.kalshi.get(key) ?? null,
      }];
    }));
    cache.lastUpdated = new Date(observedAt);
    cache.error = null;
    oddsUpdatedAt = cache.lastUpdated;
    console.log(`[ModelMarketOdds] ${cache.byFixture.size}/${active.length} active fixtures cached.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    cache.error = message;
    console.error(`[ModelMarketOdds] Refresh error: ${message}`);
  }

  sealClubSeasonFromReadyModel(model, oddsUpdatedAt ?? new Date());
  if (oddsUpdatedAt) {
    appendMarketComparisons(
      buildLedgerMarketComparisons(active, cache.byFixture, oddsUpdatedAt.toISOString()),
      oddsUpdatedAt
    );
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
