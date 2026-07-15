import { normalizedTeamPairKey } from "../lib/team-names";
import { FootballMatch, getCachedMatches } from "./football-data";
import { ModelFixture, getCachedModelData } from "./model-data";

const FEATURED_STAGES = new Set(["semifinals", "final"]);

export interface FeaturedFixture {
  football: FootballMatch;
  model: ModelFixture;
}

export function isFeaturedFootballMatch(match: FootballMatch): boolean {
  return FEATURED_STAGES.has(match.stage ?? "")
    && (match.status === "SCHEDULED" || match.status === "IN_PLAY")
    && match.homeTeam !== "TBD"
    && match.awayTeam !== "TBD";
}

export function selectFeaturedFixtures(
  matches: FootballMatch[],
  modelFixtures: ModelFixture[]
): FeaturedFixture[] {
  const modelsByPair = new Map<string, ModelFixture[]>();
  for (const fixture of modelFixtures) {
    const key = normalizedTeamPairKey(fixture.home, fixture.away);
    const candidates = modelsByPair.get(key) ?? [];
    candidates.push(fixture);
    modelsByPair.set(key, candidates);
  }

  return matches
    .filter(isFeaturedFootballMatch)
    .flatMap((football) => {
      const candidates = modelsByPair.get(normalizedTeamPairKey(
        football.homeTeam,
        football.awayTeam
      )) ?? [];
      const model = candidates.find((fixture) => fixture.stage === football.stage)
        ?? candidates[0];
      return model ? [{ football, model }] : [];
    })
    .sort((a, b) => new Date(a.football.utcDate).getTime() - new Date(b.football.utcDate).getTime());
}

export function getFeaturedFixtures(): FeaturedFixture[] {
  const football = getCachedMatches();
  const model = getCachedModelData();
  return selectFeaturedFixtures(football.upcoming, model.fixtures);
}

export function getFeaturedModelFixtures(): ModelFixture[] {
  return getFeaturedFixtures().map((fixture) => fixture.model);
}
