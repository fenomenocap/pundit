import { buildExternalMarketConsensus } from "../external-market-consensus";
import { getCachedFixtureMarketOdds, type TimestampedFixtureMarketOdds } from "../model-market-odds";
import { getModelFixtureKey, type ModelFixture } from "../model-data";
import type { DataLayerResult } from "./types";
import { wrapWithFreshness } from "./shared";

export interface MarketOddsBundle {
  fixtureKey: string;
  markets: TimestampedFixtureMarketOdds | null;
  externalConsensus: ReturnType<typeof buildExternalMarketConsensus>;
}

export function getMarketOdds(fixture: ModelFixture): DataLayerResult<MarketOddsBundle> {
  const markets = getCachedFixtureMarketOdds(fixture);
  const oddsSources = [];
  if (markets?.kalshi) {
    oddsSources.push({
      source: "kalshi",
      observedAt: markets.observedAt,
      pHome: markets.kalshi.pHome,
      pDraw: markets.kalshi.pDraw,
      pAway: markets.kalshi.pAway,
    });
  }
  if (markets?.polymarket) {
    oddsSources.push({
      source: "polymarket",
      observedAt: markets.observedAt,
      pHome: markets.polymarket.pHome,
      pDraw: markets.polymarket.pDraw,
      pAway: markets.polymarket.pAway,
    });
  }
  const externalConsensus = buildExternalMarketConsensus(oddsSources);
  const asOf = markets?.observedAt ?? new Date().toISOString();
  return wrapWithFreshness(
    {
      fixtureKey: getModelFixtureKey(fixture),
      markets,
      externalConsensus,
    },
    oddsSources.map((row) => ({
      id: `market-${row.source}`,
      label: `${row.source} no-vig 1X2`,
      trustTier: "market-fetch" as const,
      observedAt: row.observedAt,
    })),
    asOf,
    externalConsensus?.stale ?? false,
  );
}
