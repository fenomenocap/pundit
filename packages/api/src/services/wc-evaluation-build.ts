import { DEFAULT_ELO } from "./dixon-coles";
import { fetchEloRatings } from "./elo-ratings";
import { fetchWorldCupMatches, FootballMatch } from "./football-data";
import { WORLD_CUP_TEAM_SET } from "./world-cup-teams";
import {
  buildEvaluationFixture,
  computeEvaluationMetrics,
  EvaluationFixture,
  EvaluationMethod,
  Wc2026EvaluationArtifact,
} from "./wc-evaluation";

const ELO_K = 20;
const ELO_SCALE = 400;

type OutcomeScore = 0 | 0.5 | 1;

function isValidTeam(name: string): boolean {
  return name !== "TBD" && name !== "Unknown" && WORLD_CUP_TEAM_SET.has(name);
}

function matchOutcomeScores(match: FootballMatch): {
  homeScore: number;
  awayScore: number;
  homeActual: OutcomeScore;
  awayActual: OutcomeScore;
} | null {
  if (match.status !== "FINISHED" || !match.score) return null;
  const homeScore = match.score.home;
  const awayScore = match.score.away;
  if (homeScore === null || awayScore === null) return null;
  let homeActual: OutcomeScore = 0.5;
  let awayActual: OutcomeScore = 0.5;
  if (homeScore > awayScore) {
    homeActual = 1;
    awayActual = 0;
  } else if (homeScore < awayScore) {
    homeActual = 0;
    awayActual = 1;
  }
  return { homeScore, awayScore, homeActual, awayActual };
}

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / ELO_SCALE));
}

function applyEloUpdate(
  ratings: Map<string, number>,
  home: string,
  away: string,
  homeActual: OutcomeScore,
  awayActual: OutcomeScore
): void {
  const homeRating = ratings.get(home) ?? DEFAULT_ELO;
  const awayRating = ratings.get(away) ?? DEFAULT_ELO;
  const expectedHome = expectedScore(homeRating, awayRating);
  const expectedAway = expectedScore(awayRating, homeRating);
  ratings.set(home, homeRating + ELO_K * (homeActual - expectedHome));
  ratings.set(away, awayRating + ELO_K * (awayActual - expectedAway));
}

function reverseEloUpdate(
  ratings: Map<string, number>,
  home: string,
  away: string,
  homeActual: OutcomeScore,
  awayActual: OutcomeScore
): void {
  const homeRating = ratings.get(home) ?? DEFAULT_ELO;
  const awayRating = ratings.get(away) ?? DEFAULT_ELO;
  const expectedHome = expectedScore(homeRating, awayRating);
  const expectedAway = expectedScore(awayRating, homeRating);
  ratings.set(home, homeRating - ELO_K * (homeActual - expectedHome));
  ratings.set(away, awayRating - ELO_K * (awayActual - expectedAway));
}

function eligibleFinishedMatches(matches: FootballMatch[]): FootballMatch[] {
  return matches
    .filter((match) => {
      if (match.status !== "FINISHED") return false;
      if (!isValidTeam(match.homeTeam) || !isValidTeam(match.awayTeam)) return false;
      return matchOutcomeScores(match) !== null;
    })
    .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());
}

export function reconstructPreTournamentRatings(
  finishedMatches: FootballMatch[],
  postTournamentRatings: Map<string, number>
): Map<string, number> {
  const ratings = new Map(postTournamentRatings);
  const reversed = [...finishedMatches].reverse();
  for (const match of reversed) {
    const outcome = matchOutcomeScores(match);
    if (!outcome) continue;
    reverseEloUpdate(
      ratings,
      match.homeTeam,
      match.awayTeam,
      outcome.homeActual,
      outcome.awayActual
    );
  }
  return ratings;
}

export function buildReconstructedFixtures(
  finishedMatches: FootballMatch[],
  preTournamentRatings: Map<string, number>,
  method: EvaluationMethod = "reconstructed"
): EvaluationFixture[] {
  const ratings = new Map(preTournamentRatings);
  const fixtures: EvaluationFixture[] = [];

  for (const match of finishedMatches) {
    const outcome = matchOutcomeScores(match);
    if (!outcome) continue;

    const homeElo = ratings.get(match.homeTeam) ?? DEFAULT_ELO;
    const awayElo = ratings.get(match.awayTeam) ?? DEFAULT_ELO;
    fixtures.push(buildEvaluationFixture({
      id: match.id,
      utcDate: match.utcDate,
      stage: match.stage,
      group: match.group,
      home: match.homeTeam,
      away: match.awayTeam,
      homeElo,
      awayElo,
      homeScore: outcome.homeScore,
      awayScore: outcome.awayScore,
      method,
    }));

    applyEloUpdate(
      ratings,
      match.homeTeam,
      match.awayTeam,
      outcome.homeActual,
      outcome.awayActual
    );
  }

  return fixtures;
}

export async function buildWc2026EvaluationArtifact(): Promise<Wc2026EvaluationArtifact> {
  const [matches, postTournamentRatings] = await Promise.all([
    fetchWorldCupMatches(),
    fetchEloRatings(),
  ]);

  const finishedMatches = eligibleFinishedMatches(matches);
  if (finishedMatches.length === 0) {
    throw new Error("No finished World Cup fixtures available for evaluation.");
  }

  for (const team of WORLD_CUP_TEAM_SET) {
    if (!postTournamentRatings.has(team)) {
      postTournamentRatings.set(team, DEFAULT_ELO);
    }
  }

  const preTournamentRatings = reconstructPreTournamentRatings(
    finishedMatches,
    postTournamentRatings
  );
  const fixtures = buildReconstructedFixtures(
    finishedMatches,
    preTournamentRatings,
    "reconstructed"
  );
  const metrics = computeEvaluationMetrics(fixtures);

  return {
    competition: "fifa.world",
    method: "reconstructed",
    builtAt: new Date().toISOString(),
    disclaimer:
      "Pre-kickoff probabilities are reconstructed by rewinding current eloratings.net "
      + "World ratings through tournament results, then walking forward with Dixon-Coles "
      + "at neutral venues. This is look-ahead-free but approximate versus true pre-match snapshots.",
    fixtures,
    metrics,
  };
}
