import { getEnabledCompetitions } from "../config/competitions";
import { FootballMatch, getCachedMatches } from "./football-data";

export const ACTIVE_FIXTURE_HORIZON_MS = 14 * 24 * 60 * 60 * 1000;
const PLACEHOLDER_TEAM = /^(tbd|unknown)$/i;
const BRACKET_PLACEHOLDER = /\b(?:winner|loser)\b/i;

export interface ActiveFixture extends FootballMatch {
  featured: boolean;
}

function isKnownTeam(team: string): boolean {
  const normalized = team.trim().toLowerCase();
  return normalized.length > 0
    && !PLACEHOLDER_TEAM.test(normalized)
    && !BRACKET_PLACEHOLDER.test(team);
}

export function isActiveFootballMatch(
  match: FootballMatch,
  now = Date.now(),
  horizonMs = ACTIVE_FIXTURE_HORIZON_MS
): boolean {
  if (match.status !== "SCHEDULED" && match.status !== "IN_PLAY") return false;
  if (!isKnownTeam(match.homeTeam) || !isKnownTeam(match.awayTeam)) return false;
  if (match.status === "IN_PLAY") return true;
  const kickoff = new Date(match.utcDate).getTime();
  return kickoff >= now - 60 * 60 * 1000 && kickoff <= now + horizonMs;
}

export function selectActiveFixtures(
  matches: FootballMatch[],
  enabledCompetitionIds: Set<string>,
  now = Date.now()
): ActiveFixture[] {
  return matches
    .filter((match) => enabledCompetitionIds.has(match.competitionId))
    .filter((match) => isActiveFootballMatch(match, now))
    .map((match) => ({ ...match, featured: false }))
    .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());
}

export function getActiveFixtures(): ActiveFixture[] {
  const football = getCachedMatches();
  const enabledIds = new Set(getEnabledCompetitions().map((competition) => competition.id));
  const candidates = [...football.upcoming, ...football.recent.filter((m) => m.status === "IN_PLAY")];
  return selectActiveFixtures(candidates, enabledIds);
}

export function getActiveFixtureStatus(): {
  count: number;
  lastUpdated: Date | null;
  byCompetition: Record<string, number>;
} {
  const fixtures = getActiveFixtures();
  const byCompetition: Record<string, number> = {};
  for (const fixture of fixtures) {
    byCompetition[fixture.competitionId] = (byCompetition[fixture.competitionId] ?? 0) + 1;
  }
  return {
    count: fixtures.length,
    lastUpdated: getCachedMatches().lastUpdated,
    byCompetition,
  };
}
