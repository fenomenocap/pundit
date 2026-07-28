// Active-club fixture model: Dixon-Coles probabilities for enabled competitions only.
// WC live model/tournament sim is retired — see /api/evaluation/wc-2026 for backtest.

import { getCompetitionById } from "../config/competitions";
import { modelFixtureKey } from "../lib/team-names";
import { ActiveFixture, getActiveFixtures } from "./active-fixtures";
import { getCachedClubRatings, lookupClubRating } from "./club-ratings";
import { computeMatchModel, DEFAULT_ELO, DEFAULT_HOME_ADVANTAGE_ELO } from "./dixon-coles";

export interface ModelScoreline {
  score: string;
  probability: number;
}

export interface ModelFixture {
  competitionId: string;
  competition: string;
  fixtureId: number;
  utcDate: string;
  date: string;
  group: string | null;
  stage: string;
  home: string;
  away: string;
  homeElo: number;
  awayElo: number;
  pHome: number;
  pDraw: number;
  pAway: number;
  pOver2_5: number;
  pUnder2_5: number;
  pBttsYes: number;
  pBttsNo: number;
  topScores: ModelScoreline[];
  scorelines: ModelScoreline[];
  stakePHome: number | null;
  stakePDraw: number | null;
  stakePAway: number | null;
  result: {
    homeScore: number;
    awayScore: number;
    status: string;
    winner: string | null;
  } | null;
}

export interface ModelDataCache {
  fixtures: ModelFixture[];
  lastUpdated: Date | null;
  error: string | null;
}

const cache: ModelDataCache = {
  fixtures: [],
  lastUpdated: null,
  error: null,
};

export function getCachedModelData(): ModelDataCache {
  return { ...cache };
}

function rounded(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function modelStage(stage: string | null): string {
  if (!stage) return "match";
  return stage === "group-stage" ? "group" : stage.replaceAll("-", "_");
}

function matchWinner(fixture: ActiveFixture): string | null {
  if (fixture.winner) return fixture.winner;
  if (!fixture.score || fixture.score.home === null || fixture.score.away === null) return null;
  if (fixture.score.home > fixture.score.away) return fixture.homeTeam;
  if (fixture.score.away > fixture.score.home) return fixture.awayTeam;
  return null;
}

export function buildModelFixtureFromActive(
  fixture: ActiveFixture,
  ratings = getCachedClubRatings().byProfile
): ModelFixture | null {
  const competition = getCompetitionById(fixture.competitionId);
  if (!competition || !competition.enabled) return null;

  const homeElo = lookupClubRating(fixture.homeTeam, competition.ratingProfile, ratings)
    ?? DEFAULT_ELO;
  const awayElo = lookupClubRating(fixture.awayTeam, competition.ratingProfile, ratings)
    ?? DEFAULT_ELO;
  const homeAdvantageElo = competition.homeFieldAdvantage ? DEFAULT_HOME_ADVANTAGE_ELO : 0;
  const model = computeMatchModel(homeElo, awayElo, homeAdvantageElo);
  const completed = fixture.status === "FINISHED" && fixture.score;

  return {
    competitionId: fixture.competitionId,
    competition: fixture.competition,
    fixtureId: fixture.id,
    utcDate: fixture.utcDate,
    date: fixture.utcDate.slice(0, 10),
    group: fixture.group,
    stage: modelStage(fixture.stage),
    home: fixture.homeTeam,
    away: fixture.awayTeam,
    homeElo: rounded(homeElo, 1),
    awayElo: rounded(awayElo, 1),
    pHome: rounded(model.pHome),
    pDraw: rounded(model.pDraw),
    pAway: rounded(model.pAway),
    pOver2_5: rounded(model.pOver2_5),
    pUnder2_5: rounded(model.pUnder2_5),
    pBttsYes: rounded(model.pBttsYes),
    pBttsNo: rounded(model.pBttsNo),
    topScores: model.topScores.map(([[home, away], probability]) => ({
      score: `${home}-${away}`,
      probability: rounded(probability),
    })),
    scorelines: model.scorelines.map(([[home, away], probability]) => ({
      score: `${home}-${away}`,
      probability: rounded(probability),
    })),
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    result: completed
      ? {
          homeScore: fixture.score!.home!,
          awayScore: fixture.score!.away!,
          status: fixture.status === "FINISHED" ? "FT" : fixture.status,
          winner: matchWinner(fixture),
        }
      : null,
  };
}

export function buildActiveModelFixtures(
  fixtures: ActiveFixture[],
  ratings = getCachedClubRatings().byProfile
): ModelFixture[] {
  return fixtures
    .map((fixture) => buildModelFixtureFromActive(fixture, ratings))
    .filter((fixture): fixture is ModelFixture => fixture !== null)
    .sort((a, b) => a.utcDate.localeCompare(b.utcDate));
}

export function findModelFixtureByTeams(
  teamA: string,
  teamB: string,
  fixtures: ModelFixture[] = cache.fixtures
): ModelFixture | undefined {
  const pair = new Set([teamA, teamB]);
  return fixtures.find((fixture) =>
    pair.has(fixture.home) && pair.has(fixture.away) && fixture.home !== fixture.away
  );
}

export function getModelFixtureKey(fixture: ModelFixture): string {
  return modelFixtureKey(fixture.competitionId, fixture.date, fixture.home, fixture.away);
}

export async function refreshModelData(activeFixtures: ActiveFixture[]): Promise<void> {
  console.log("[Model] Refreshing active fixture Dixon-Coles model...");
  try {
    const ratings = getCachedClubRatings();
    if (ratings.fetchedAt === null && ratings.error) {
      throw new Error(`Club ratings are not ready: ${ratings.error}`);
    }
    cache.fixtures = buildActiveModelFixtures(activeFixtures, ratings.byProfile);
    cache.lastUpdated = new Date();
    cache.error = null;
    console.log(`[Model] ${cache.fixtures.length} active fixtures cached.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    cache.error = message;
    console.error(`[Model] Refresh error: ${message}`);
  }
}

const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
let cronTimer: ReturnType<typeof setInterval> | null = null;

export async function startModelCron(): Promise<void> {
  await refreshModelData(getActiveFixtures());
  cronTimer = setInterval(() => refreshModelData(getActiveFixtures()), REFRESH_INTERVAL_MS);
  console.log("[Model] Cron started — refreshing every hour");
}

export function stopModelCron(): void {
  if (cronTimer) clearInterval(cronTimer);
  cronTimer = null;
}
