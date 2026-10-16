import { getCachedMatches, type FootballStanding } from "../football-data";
import type { DataLayerResult } from "./types";
import { wrapWithFreshness } from "./shared";

export interface GetStandingsInput {
  competitionId: string;
}

export function getStandings(input: GetStandingsInput): DataLayerResult<FootballStanding[]> {
  const cache = getCachedMatches();
  const rows = cache.standings.filter((row) => row.competitionId === input.competitionId);
  const asOf = cache.lastUpdated?.toISOString() ?? new Date().toISOString();
  return wrapWithFreshness(
    rows,
    [{
      id: "espn-public-scoreboard",
      label: "ESPN standings",
      trustTier: "fixture-spine",
      observedAt: asOf,
    }],
    asOf,
    cache.lastUpdated === null,
  );
}
