import { getCachedMatches, type FootballMatch } from "../football-data";
import type { DataLayerResult } from "./types";
import { wrapWithFreshness } from "./shared";

export interface GetFixturesInput {
  competitionId?: string;
}

export function getFixtures(input: GetFixturesInput = {}): DataLayerResult<FootballMatch[]> {
  const cache = getCachedMatches();
  const all = [...cache.upcoming, ...cache.recent];
  const rows = input.competitionId
    ? all.filter((match) => match.competitionId === input.competitionId)
    : all;
  const asOf = cache.lastUpdated?.toISOString() ?? new Date().toISOString();
  return wrapWithFreshness(
    rows,
    [{
      id: "espn-public-scoreboard",
      label: "ESPN schedule and results",
      trustTier: "fixture-spine",
      observedAt: asOf,
      url: "https://site.api.espn.com/apis/site/v2/sports/soccer",
    }],
    asOf,
    cache.lastUpdated === null,
  );
}
