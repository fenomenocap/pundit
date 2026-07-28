import { getEnabledCompetitions } from "../config/competitions";
import { normalizedTeamPairKey } from "../lib/team-names";
import { getActiveFixtures } from "./active-fixtures";
import { FootballMatch, getCachedMatches } from "./football-data";
import { ModelFixture, getCachedModelData } from "./model-data";

const PLACEHOLDER_TEAM = /^(tbd|unknown)$/i;
const BRACKET_PLACEHOLDER = /\b(?:winner|loser)\b/i;
const FEATURED_LIMIT = 6;

export interface FeaturedFixture {
  football: FootballMatch;
  model: ModelFixture;
}

function isKnownTeam(team: string): boolean {
  const normalized = team.trim().toLowerCase();
  return normalized.length > 0
    && !PLACEHOLDER_TEAM.test(normalized)
    && !BRACKET_PLACEHOLDER.test(team);
}

export function selectFeaturedActiveFixtures(
  activeFixtures: FootballMatch[],
  limit = FEATURED_LIMIT
): FootballMatch[] {
  const enabled = new Set(getEnabledCompetitions().map((competition) => competition.id));
  const priority = new Map(
    getEnabledCompetitions().map((competition) => [competition.id, competition.priority])
  );
  return activeFixtures
    .filter((fixture) => enabled.has(fixture.competitionId))
    .filter((fixture) => isKnownTeam(fixture.homeTeam) && isKnownTeam(fixture.awayTeam))
    .sort((left, right) => {
      const priorityDiff = (priority.get(left.competitionId) ?? 99)
        - (priority.get(right.competitionId) ?? 99);
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(left.utcDate).getTime() - new Date(right.utcDate).getTime();
    })
    .slice(0, limit);
}

export function joinFeaturedFixtures(
  footballMatches: FootballMatch[],
  modelFixtures: ModelFixture[]
): FeaturedFixture[] {
  const modelsByPair = new Map<string, ModelFixture[]>();
  for (const fixture of modelFixtures) {
    const key = normalizedTeamPairKey(fixture.home, fixture.away);
    const candidates = modelsByPair.get(key) ?? [];
    candidates.push(fixture);
    modelsByPair.set(key, candidates);
  }

  return footballMatches.flatMap((football) => {
    const candidates = modelsByPair.get(normalizedTeamPairKey(
      football.homeTeam,
      football.awayTeam
    )) ?? [];
    const model = candidates.find((fixture) => fixture.competitionId === football.competitionId)
      ?? candidates[0];
    return model ? [{ football, model }] : [];
  });
}

export function getFeaturedFixtures(): FeaturedFixture[] {
  const active = getActiveFixtures();
  const football = selectFeaturedActiveFixtures(active);
  const model = getCachedModelData();
  return joinFeaturedFixtures(football, model.fixtures);
}

export function getFeaturedModelFixtures(): ModelFixture[] {
  return getFeaturedFixtures().map((fixture) => fixture.model);
}

// Backward-compatible export for tests expecting WC stage filter removal.
export function isFeaturedFootballMatch(match: FootballMatch): boolean {
  return (match.status === "SCHEDULED" || match.status === "IN_PLAY")
    && isKnownTeam(match.homeTeam)
    && isKnownTeam(match.awayTeam);
}

export function selectFeaturedFixtures(
  matches: FootballMatch[],
  modelFixtures: ModelFixture[]
): FeaturedFixture[] {
  return joinFeaturedFixtures(selectFeaturedActiveFixtures(matches), modelFixtures);
}
