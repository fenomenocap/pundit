import { buildAgentFreshnessMetadata } from "../../config/freshness-policy";
import { footballMatchesForFreshness, getCachedMatches } from "../football-data";
import { getCachedClubRatings } from "../club-ratings";
import { getCachedModelData } from "../model-data";
import { getModelMarketOddsStatus } from "../model-market-odds";
import type { DataLayerResult } from "./types";
import { dataLayerResult } from "./types";

export function currentFreshnessBlock(now = new Date()) {
  const football = getCachedMatches();
  const model = getCachedModelData();
  const marketStatus = getModelMarketOddsStatus();
  const ratings = getCachedClubRatings();
  return buildAgentFreshnessMetadata({
    matches: footballMatchesForFreshness(),
    espnLastUpdated: football.lastUpdated,
    modelLastUpdated: model.lastUpdated,
    marketOddsLastUpdated: marketStatus.lastUpdated,
    ratingsAsOf: ratings.fetchedAt,
    now,
  });
}

export function wrapWithFreshness<T>(
  data: T,
  sources: DataLayerResult<T>["sources"],
  asOf: string,
  stale = false,
  now = new Date(),
): DataLayerResult<T> {
  return dataLayerResult({
    data,
    sources,
    asOf,
    stale,
    freshness: currentFreshnessBlock(now),
  });
}
