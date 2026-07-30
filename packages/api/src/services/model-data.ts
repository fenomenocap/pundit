// Active-club fixture model: Dixon-Coles probabilities for enabled competitions only.
// WC live model/tournament sim is retired — see /api/evaluation/wc-2026 for backtest.

import { getCompetitionById } from "../config/competitions";
import { modelFixtureKey } from "../lib/team-names";
import { ActiveFixture, getActiveFixtures } from "./active-fixtures";
import {
  ClubRatingsCache,
  getCachedClubRatings,
  lookupClubRating,
} from "./club-ratings";
import { computeMatchModel, DEFAULT_HOME_ADVANTAGE_ELO } from "./dixon-coles";
import { getCachedMatches } from "./football-data";
import { updateClubSeasonSnapshots } from "./club-season-snapshots";

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

  const homeElo = lookupClubRating(fixture.homeTeam, competition.ratingProfile, ratings);
  const awayElo = lookupClubRating(fixture.awayTeam, competition.ratingProfile, ratings);
  if (homeElo === undefined || awayElo === undefined) return null;
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

function activeFixtureIdentity(
  fixture: Pick<ActiveFixture, "competitionId" | "id">
): string {
  return `${fixture.competitionId}:${fixture.id}`;
}

function cachedFixtureIdentity(
  fixture: Pick<ModelFixture, "competitionId" | "fixtureId">
): string {
  return `${fixture.competitionId}:${fixture.fixtureId}`;
}

export function modelDataCoversActiveFixtures(
  model: Pick<ModelDataCache, "fixtures" | "lastUpdated">,
  activeFixtures: ActiveFixture[]
): boolean {
  if (model.lastUpdated === null) return false;
  const activeKeys = new Set(activeFixtures.map(activeFixtureIdentity));
  const modelKeys = new Set(model.fixtures.map(cachedFixtureIdentity));
  return activeKeys.size === modelKeys.size
    && [...activeKeys].every((key) => modelKeys.has(key));
}

export function findMissingClubRatingTeams(
  activeFixtures: ActiveFixture[],
  ratings: ClubRatingsCache["byProfile"]
): string[] {
  const missing = new Set<string>();
  for (const fixture of activeFixtures) {
    const competition = getCompetitionById(fixture.competitionId);
    if (!competition || !competition.enabled) continue;
    for (const team of [fixture.homeTeam, fixture.awayTeam]) {
      if (lookupClubRating(team, competition.ratingProfile, ratings) === undefined) {
        missing.add(team);
      }
    }
  }
  return [...missing].sort();
}

function missingRatingsMessage(missingTeams: string[], skippedFixtures: number): string {
  const shown = missingTeams.slice(0, 12);
  const remainder = missingTeams.length - shown.length;
  const suffix = remainder > 0 ? `, and ${remainder} more` : "";
  return `Club ratings are missing for ${missingTeams.length} active team(s): `
    + `${shown.join(", ")}${suffix}. `
    + `${skippedFixtures} fixture(s) are unpriced as a result.`;
}

export async function refreshModelData(activeFixtures: ActiveFixture[]): Promise<void> {
  console.log("[Model] Refreshing active fixture Dixon-Coles model...");
  try {
    // An empty active window is a valid state between rounds or seasons and
    // does not need the ratings provider at all.
    if (activeFixtures.length === 0) {
      cache.fixtures = [];
      cache.lastUpdated = new Date();
      cache.error = null;
      console.log("[Model] 0 active fixtures cached.");
      return;
    }

    const ratings = getCachedClubRatings();
    if (ratings.fetchedAt === null) {
      const detail = ratings.error ? `: ${ratings.error}` : ".";
      throw new Error(`Club ratings are not ready${detail}`);
    }
    // A team the ratings provider does not name costs its own fixtures, not the
    // whole window. This previously threw, so five unmatched names in a
    // twenty-fixture round discarded all twenty and took the match tier down
    // entirely. Partial coverage is already the expected shape downstream:
    // resolveAskContext has a model-unavailable tier for an active fixture with
    // no model row, and readiness still reports not-ready until coverage is
    // complete, so nothing here claims more than it has.
    const missingTeams = findMissingClubRatingTeams(activeFixtures, ratings.byProfile);
    const fixtures = buildActiveModelFixtures(activeFixtures, ratings.byProfile);
    cache.fixtures = fixtures;
    cache.lastUpdated = new Date();
    cache.error = missingTeams.length > 0
      ? missingRatingsMessage(missingTeams, activeFixtures.length - fixtures.length)
      : null;
    if (cache.error) console.warn(`[Model] ${cache.error}`);
    console.log(
      `[Model] ${fixtures.length}/${activeFixtures.length} active fixtures cached.`
    );

    const football = getCachedMatches();
    const trackedMatches = [...football.upcoming, ...football.recent];
    updateClubSeasonSnapshots(trackedMatches, fixtures);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    cache.error = message;
    console.error(`[Model] Refresh error: ${message}`);
  }
}

export const MODEL_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
export const MODEL_COLD_RETRY_MS = 6 * 60 * 1000;

export function modelRefreshDelay(
  cacheState: Pick<ModelDataCache, "fixtures" | "lastUpdated">,
  activeFixtures: ActiveFixture[]
): number {
  return modelDataCoversActiveFixtures(cacheState, activeFixtures)
    ? MODEL_REFRESH_INTERVAL_MS
    : MODEL_COLD_RETRY_MS;
}

let cronTimer: ReturnType<typeof setTimeout> | null = null;
let cronEnabled = false;

function scheduleModelRefresh(): void {
  if (!cronEnabled) return;
  const activeFixtures = getActiveFixtures();
  const delay = modelRefreshDelay(cache, activeFixtures);
  cronTimer = setTimeout(() => {
    cronTimer = null;
    const nextActiveFixtures = getActiveFixtures();
    void refreshModelData(nextActiveFixtures).finally(() => {
      if (cronEnabled) scheduleModelRefresh();
    });
  }, delay);
}

export async function startModelCron(): Promise<void> {
  cronEnabled = true;
  if (cronTimer) clearTimeout(cronTimer);
  const activeFixtures = getActiveFixtures();
  await refreshModelData(activeFixtures);
  scheduleModelRefresh();
  console.log(
    `[Model] Cron started — next refresh in ${modelRefreshDelay(cache, activeFixtures) / 1000}s`
  );
}

export function stopModelCron(): void {
  cronEnabled = false;
  if (cronTimer) clearTimeout(cronTimer);
  cronTimer = null;
}
