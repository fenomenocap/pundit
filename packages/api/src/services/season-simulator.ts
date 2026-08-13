import { DEFAULT_HOME_ADVANTAGE_ELO } from "./dixon-coles";
import { FootballMatch, FootballStanding } from "./football-data";
import { lookupClubRating, ClubRatingsCache } from "./club-ratings";
import { getCompetitionById } from "../config/competitions";
import { ELO_CHAMPION, ForecastContributor } from "./model-contributors";

export const SEASON_SIM_RUNS = 10_000;

export interface TeamStandingState {
  team: string;
  points: number;
  goalDifference: number;
  goalsFor: number;
  playedGames: number;
}

export interface SeasonProbability {
  team: string;
  probability: number;
}

export interface SeasonOutlook {
  competitionId: string;
  competition: string;
  runs: number;
  titleProbabilities: SeasonProbability[];
  topFourProbabilities: SeasonProbability[];
  remainingFixtures: number;
  updatedAt: string;
}

function rounded(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function standingState(standings: FootballStanding[]): Map<string, TeamStandingState> {
  const state = new Map<string, TeamStandingState>();
  for (const row of standings) {
    state.set(row.team, {
      team: row.team,
      points: row.points,
      goalDifference: row.goalDifference,
      goalsFor: row.goalsFor,
      playedGames: row.playedGames,
    });
  }
  return state;
}

function cloneState(state: Map<string, TeamStandingState>): Map<string, TeamStandingState> {
  return new Map([...state.entries()].map(([team, row]) => [team, { ...row }]));
}

function applyResult(
  state: Map<string, TeamStandingState>,
  home: string,
  away: string,
  homeGoals: number,
  awayGoals: number
): void {
  const homeRow = state.get(home);
  const awayRow = state.get(away);
  if (!homeRow || !awayRow) return;
  homeRow.playedGames += 1;
  awayRow.playedGames += 1;
  homeRow.goalsFor += homeGoals;
  awayRow.goalsFor += awayGoals;
  homeRow.goalDifference += homeGoals - awayGoals;
  awayRow.goalDifference += awayGoals - homeGoals;
  if (homeGoals > awayGoals) homeRow.points += 3;
  else if (awayGoals > homeGoals) awayRow.points += 3;
  else {
    homeRow.points += 1;
    awayRow.points += 1;
  }
}

function rankTeams(state: Map<string, TeamStandingState>): string[] {
  return [...state.values()]
    .sort((a, b) =>
      b.points - a.points
      || b.goalDifference - a.goalDifference
      || b.goalsFor - a.goalsFor
      || a.team.localeCompare(b.team)
    )
    .map((row) => row.team);
}

export function remainingScheduledFixtures(
  matches: FootballMatch[],
  competitionId: string
): FootballMatch[] {
  return matches
    .filter((match) =>
      match.competitionId === competitionId
      && match.status === "SCHEDULED"
    )
    .sort((a, b) => a.utcDate.localeCompare(b.utcDate));
}

export function hasCompleteLeagueSchedule(
  standings: FootballStanding[],
  fixtures: FootballMatch[]
): boolean {
  const teamRows = new Map(standings.map((row) => [row.team, row]));
  const teamCount = teamRows.size;
  if (teamCount < 2 || new Set(fixtures.map((fixture) => fixture.id)).size !== fixtures.length) {
    return false;
  }
  const playedAppearances = standings.reduce((sum, row) => sum + row.playedGames, 0);
  if (playedAppearances % 2 !== 0) return false;
  const expectedRemaining = teamCount * (teamCount - 1) - playedAppearances / 2;
  if (fixtures.length !== expectedRemaining) return false;

  const scheduledAppearances = new Map<string, number>();
  for (const fixture of fixtures) {
    if (!teamRows.has(fixture.homeTeam) || !teamRows.has(fixture.awayTeam)) return false;
    scheduledAppearances.set(
      fixture.homeTeam,
      (scheduledAppearances.get(fixture.homeTeam) ?? 0) + 1
    );
    scheduledAppearances.set(
      fixture.awayTeam,
      (scheduledAppearances.get(fixture.awayTeam) ?? 0) + 1
    );
  }
  return standings.every((row) =>
    (scheduledAppearances.get(row.team) ?? 0) === 2 * (teamCount - 1) - row.playedGames
  );
}

export function simulateSeasonOutlook(
  competitionId: string,
  standings: FootballStanding[],
  scheduledFixtures: FootballMatch[],
  ratings: ClubRatingsCache["byProfile"],
  runs = SEASON_SIM_RUNS,
  random: () => number = Math.random,
  contributor: ForecastContributor = ELO_CHAMPION
): SeasonOutlook | null {
  const competition = getCompetitionById(competitionId);
  if (!competition || competition.type !== "league") return null;

  const baseState = standingState(
    standings.filter((row) => row.competitionId === competitionId)
  );
  if (baseState.size === 0) return null;

  const fixtures = scheduledFixtures.filter((fixture) =>
    baseState.has(fixture.homeTeam) && baseState.has(fixture.awayTeam)
  );
  const competitionStandings = standings.filter((row) => row.competitionId === competitionId);
  if (fixtures.length === 0 || !hasCompleteLeagueSchedule(competitionStandings, fixtures)) {
    return null;
  }
  const ratedFixtures = fixtures.map((fixture) => ({
    fixture,
    homeElo: lookupClubRating(fixture.homeTeam, competition.ratingProfile, ratings),
    awayElo: lookupClubRating(fixture.awayTeam, competition.ratingProfile, ratings),
  }));
  if (ratedFixtures.some(({ homeElo, awayElo }) => homeElo === undefined || awayElo === undefined)) {
    return null;
  }

  const titleCounts = new Map<string, number>();
  const topFourCounts = new Map<string, number>();

  for (let run = 0; run < runs; run += 1) {
    const state = cloneState(baseState);
    for (const { fixture, homeElo, awayElo } of ratedFixtures) {
      const homeAdvantage = competition.homeFieldAdvantage ? DEFAULT_HOME_ADVANTAGE_ELO : 0;
      const [homeGoals, awayGoals] = contributor.sampleScore({
        homeStrength: homeElo!,
        awayStrength: awayElo!,
        homeAdvantageElo: homeAdvantage,
      }, random);
      applyResult(state, fixture.homeTeam, fixture.awayTeam, homeGoals, awayGoals);
    }
    const ranked = rankTeams(state);
    const champion = ranked[0];
    titleCounts.set(champion, (titleCounts.get(champion) ?? 0) + 1);
    for (const team of ranked.slice(0, 4)) {
      topFourCounts.set(team, (topFourCounts.get(team) ?? 0) + 1);
    }
  }

  const toProbabilities = (counts: Map<string, number>): SeasonProbability[] =>
    [...counts.entries()]
      .map(([team, count]) => ({ team, probability: rounded(count / runs) }))
      .sort((a, b) => b.probability - a.probability);

  return {
    competitionId,
    competition: competition.name,
    runs,
    titleProbabilities: toProbabilities(titleCounts),
    topFourProbabilities: toProbabilities(topFourCounts),
    remainingFixtures: fixtures.length,
    updatedAt: new Date().toISOString(),
  };
}

export const SEASON_QUESTION_CUES = [
  "title race",
  "win the league",
  "wins the league",
  "who wins the league",
  "who will win the league",
  "league winner",
  "win the premier league",
  "wins the premier league",
  "top four",
  "top 4",
  "champions league spot",
  "relegation",
];

// Literal cues only fire on the exact phrasing a user happened to type, so two
// wordings of one question landed in different tiers: "Relegation battle?" got
// the season outlook while "Who gets relegated?" and "Which teams go down?"
// fell through to the disclaiming general tier. These patterns cover the
// inflections of the same question.
//
// Deliberately narrow where a phrase is ambiguous: "go down" alone also means a
// price or a probability falling, so it only counts when the subject is a team
// ("who goes down", "which clubs go down"), never on its own.
export const SEASON_QUESTION_PATTERNS: RegExp[] = [
  /\brelegat(?:e|es|ed|ing|ion)\b/,
  /\b(?:who|which (?:teams?|clubs?|sides?))\b[^?.!]*\b(?:go|goes|going|drop|drops|dropping) down\b/,
  /\b(?:who|which (?:teams?|clubs?|sides?))\b[^?.!]*\b(?:stay|stays|staying) up\b/,
  /\bfinish(?:es|ing)? (?:first|top|1st|in the top)\b/,
  /\b(?:win|wins|winning|take|takes) the title\b/,
];

export function isSeasonOutlookQuestion(question: string): boolean {
  const normalized = question.toLowerCase();
  return SEASON_QUESTION_CUES.some((cue) => normalized.includes(cue))
    || SEASON_QUESTION_PATTERNS.some((pattern) => pattern.test(normalized));
}
