// Competition registry for the club-season pipeline (Phase 2+).
// EPL and UCL are the first enabled targets once multi-competition fixtures land.

export type CompetitionType = "league" | "cup";
export type RatingProfile = "world" | "eng-clubs" | "uefa-clubs";
export type MarketProfile = "world-cup" | "premier-league" | "uefa-champions-league";

export interface CompetitionConfig {
  id: string;
  name: string;
  espnScoreboardPath: string;
  espnStandingsPath?: string;
  seasonDateRange: string;
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
    seasonDateRange: "20260701-20270531",
    type: "league",
    enabled: false,
    priority: 1,
    ratingProfile: "eng-clubs",
    marketProfile: "premier-league",
    homeFieldAdvantage: true,
  },
  {
    id: "uefa.champions",
    name: "UEFA Champions League",
    espnScoreboardPath: "uefa.champions",
    seasonDateRange: "20260701-20270531",
    type: "cup",
    enabled: false,
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
    enabled: true,
    priority: 0,
    ratingProfile: "world",
    marketProfile: "world-cup",
    homeFieldAdvantage: false,
  },
] as const;

export function getEnabledCompetitions(): CompetitionConfig[] {
  return COMPETITIONS.filter((competition) => competition.enabled)
    .sort((a, b) => a.priority - b.priority);
}
