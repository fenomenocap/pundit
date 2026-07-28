// Competition registry — ESPN schedule authority per enabled competition.

export type CompetitionType = "league" | "cup";
export type RatingProfile = "world" | "eng-clubs" | "uefa-clubs";
export type MarketProfile = "world-cup" | "premier-league" | "uefa-champions-league";

export interface CompetitionConfig {
  id: string;
  name: string;
  espnScoreboardPath: string;
  espnStandingsPath?: string;
  /** Fixed ESPN dates= range when fetchDaysPast/future are unset. */
  seasonDateRange?: string;
  fetchDaysPast?: number;
  fetchDaysFuture?: number;
  type: CompetitionType;
  enabled: boolean;
  priority: number;
  ratingProfile: RatingProfile;
  marketProfile: MarketProfile;
  homeFieldAdvantage: boolean;
}

export const COMPETITIONS: readonly CompetitionConfig[] = [
  {
    id: "eng.1",
    name: "Premier League",
    espnScoreboardPath: "eng.1",
    espnStandingsPath: "eng.1",
    fetchDaysPast: 7,
    fetchDaysFuture: 45,
    type: "league",
    enabled: true,
    priority: 1,
    ratingProfile: "eng-clubs",
    marketProfile: "premier-league",
    homeFieldAdvantage: true,
  },
  {
    id: "uefa.champions_qual",
    name: "UEFA Champions League Qualifiers",
    espnScoreboardPath: "uefa.champions_qual",
    fetchDaysPast: 7,
    fetchDaysFuture: 45,
    type: "cup",
    enabled: true,
    priority: 2,
    ratingProfile: "uefa-clubs",
    marketProfile: "uefa-champions-league",
    homeFieldAdvantage: true,
  },
  {
    id: "fifa.world",
    name: "FIFA World Cup 2026",
    espnScoreboardPath: "fifa.world",
    espnStandingsPath: "fifa.world",
    seasonDateRange: "20260609-20260721",
    type: "cup",
    enabled: false,
    priority: 0,
    ratingProfile: "world",
    marketProfile: "world-cup",
    homeFieldAdvantage: false,
  },
] as const;

export function getCompetitionById(id: string): CompetitionConfig | undefined {
  return COMPETITIONS.find((competition) => competition.id === id);
}

export function getEnabledCompetitions(): CompetitionConfig[] {
  return COMPETITIONS.filter((competition) => competition.enabled)
    .sort((a, b) => a.priority - b.priority);
}
