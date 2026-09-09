// Active-club fixture model: Dixon-Coles probabilities for enabled competitions only.
// WC live model/tournament sim is retired — see /api/evaluation/wc-2026 for backtest.

import { buildFreshnessSnapshot } from "../config/freshness-policy";
import { getCompetitionById, RatingProfile } from "../config/competitions";
import { canonicalClubName, modelFixtureKey, normalizeTeamName } from "../lib/team-names";
import { ActiveFixture, getActiveFixtures } from "./active-fixtures";
import {
  backfillMissingClubRatings,
  ClubRatingsCache,
  getCachedClubRatings,
  lookupClubRating,
} from "./club-ratings";
import { DEFAULT_HOME_ADVANTAGE_ELO } from "./dixon-coles";
import { footballMatchesForFreshness, getCachedMatches } from "./football-data";
import { updateClubSeasonSnapshots } from "./club-season-snapshots";
import {
  ELO_CHAMPION,
  ELO_CHAMPION_CONFIG,
  PUNDIT_FUNDAMENTAL_MODEL_ID,
  PUNDIT_FUNDAMENTAL_MODEL_VERSION,
} from "./model-contributors";
import { isModelPolicyEligible, recognizeEspnFixture } from "./fixture-registry";

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
  forecastProvenance?: ModelFixtureForecastProvenance;
}

export interface ModelFixtureForecastProvenance {
  modelId: string;
  modelVersion: string;
  contributorId: string;
  contributorVersion: string;
  methodId: string;
  forecastAt: string;
  ratingProfile: RatingProfile;
  ratingSnapshotAt: string | null;
  ratingAgeMinutes: number | null;
  ratingSourceState: "live" | "artifact" | "persisted" | "unknown";
  ratingArtifactId?: string;
  ratingArtifactSha256?: string;
  homeAdvantageElo: number;
  config: typeof ELO_CHAMPION_CONFIG;
}

export interface ForecastBuildContext {
  forecastAt?: Date;
  ratingSnapshotAt?: Date | null;
  ratingSourceState?: ModelFixtureForecastProvenance["ratingSourceState"];
  /** Clubs whose value came from an individual lapsed-window fallback feed. */
  fallbackRatingClubs?: ReadonlySet<string>;
  ratingArtifactId?: string | null;
  ratingArtifactSha256?: string | null;
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
let refreshInProgress = false;
let missingRatingTeamIds = new Set<string>();

export function getCachedModelData(): ModelDataCache {
  return { ...cache };
}

export function getModelRefreshState(): {
  refreshing: boolean;
  missingRatingTeamIds: ReadonlySet<string>;
} {
  return { refreshing: refreshInProgress, missingRatingTeamIds: new Set(missingRatingTeamIds) };
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
  ratings = getCachedClubRatings().byProfile,
  context: ForecastBuildContext = {}
): ModelFixture | null {
  // Recognition is an identity/policy gate, not a source of numeric inputs.
  // Every legacy supported fixture is recognized from the exact same ESPN row
  // before the unchanged champion calculation below, preserving probabilities.
  const recognized = recognizeEspnFixture(fixture);
  if (!isModelPolicyEligible(recognized)) return null;
  // Home-field adjustment is a numeric model input, so an authoritative
  // fixture must establish whether the venue is neutral before construction.
  if (recognized.neutralVenue === null) return null;
  const competition = getCompetitionById(fixture.competitionId);
  if (!competition || !competition.enabled) return null;

  const homeElo = lookupClubRating(fixture.homeTeam, competition.ratingProfile, ratings);
  const awayElo = lookupClubRating(fixture.awayTeam, competition.ratingProfile, ratings);
  if (homeElo === undefined || awayElo === undefined) return null;
  const homeAdvantageElo = competition.homeFieldAdvantage && !recognized.neutralVenue
    ? DEFAULT_HOME_ADVANTAGE_ELO
    : 0;
  const model = ELO_CHAMPION.forecast({
    homeStrength: homeElo,
    awayStrength: awayElo,
    homeAdvantageElo,
  });
  const completed = fixture.status === "FINISHED" && fixture.score;
  const forecastAt = context.forecastAt ?? new Date();
  const usesFallbackRating = context.fallbackRatingClubs?.has(canonicalClubName(fixture.homeTeam))
    || context.fallbackRatingClubs?.has(canonicalClubName(fixture.awayTeam));
  // A fixture mixing the daily snapshot with an individual lapsed-window feed
  // has no single honest snapshot timestamp. Keep the exact input values but
  // mark the aggregate source provenance unknown instead of attributing both
  // ratings to the daily snapshot.
  const ratingSnapshotAt = usesFallbackRating ? null : context.ratingSnapshotAt ?? null;
  const ratingAgeMinutes = ratingSnapshotAt
    ? Math.max(0, Math.floor((forecastAt.getTime() - ratingSnapshotAt.getTime()) / 60_000))
    : null;

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
    forecastProvenance: {
      modelId: PUNDIT_FUNDAMENTAL_MODEL_ID,
      modelVersion: PUNDIT_FUNDAMENTAL_MODEL_VERSION,
      contributorId: ELO_CHAMPION.id,
      contributorVersion: ELO_CHAMPION.version,
      methodId: ELO_CHAMPION.methodId,
      forecastAt: forecastAt.toISOString(),
      ratingProfile: competition.ratingProfile,
      ratingSnapshotAt: ratingSnapshotAt?.toISOString() ?? null,
      ratingAgeMinutes,
      ratingSourceState: usesFallbackRating ? "unknown" : context.ratingSourceState ?? "unknown",
      ...(context.ratingArtifactId ? { ratingArtifactId: context.ratingArtifactId } : {}),
      ...(context.ratingArtifactSha256 ? { ratingArtifactSha256: context.ratingArtifactSha256 } : {}),
      homeAdvantageElo,
      config: ELO_CHAMPION_CONFIG,
    },
  };
}

export function buildActiveModelFixtures(
  fixtures: ActiveFixture[],
  ratings = getCachedClubRatings().byProfile,
  context: ForecastBuildContext = {}
): ModelFixture[] {
  return fixtures
    .map((fixture) => buildModelFixtureFromActive(fixture, ratings, context))
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

/**
 * Readiness accepts an initialized current subset because missing ratings are
 * represented explicitly as unpriced fixture capabilities. It still rejects
 * stale/foreign model rows; exact coverage remains the refresh-cadence gate.
 */
export function modelDataIsCurrentSubset(
  model: Pick<ModelDataCache, "fixtures" | "lastUpdated">,
  activeFixtures: ActiveFixture[]
): boolean {
  if (model.lastUpdated === null) return false;
  const activeKeys = new Set(activeFixtures.map(activeFixtureIdentity));
  return model.fixtures.every((fixture) => activeKeys.has(cachedFixtureIdentity(fixture)));
}

export function findMissingClubRatingTeams(
  activeFixtures: ActiveFixture[],
  ratings: ClubRatingsCache["byProfile"]
): string[] {
  return findMissingClubRatings(activeFixtures, ratings).map(({ team }) => team);
}

/** As findMissingClubRatingTeams, keeping the profile each lookup failed under. */
export function findMissingClubRatings(
  activeFixtures: ActiveFixture[],
  ratings: ClubRatingsCache["byProfile"]
): Array<{ team: string; profile: RatingProfile }> {
  const missing = new Map<string, RatingProfile>();
  for (const fixture of activeFixtures) {
    const competition = getCompetitionById(fixture.competitionId);
    if (!competition || !competition.enabled) continue;
    for (const team of [fixture.homeTeam, fixture.awayTeam]) {
      if (lookupClubRating(team, competition.ratingProfile, ratings) === undefined) {
        missing.set(team, competition.ratingProfile);
      }
    }
  }
  return [...missing]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([team, profile]) => ({ team, profile }));
}

function missingRatingsMessage(missingTeams: string[], skippedFixtures: number): string {
  const shown = missingTeams.slice(0, 12);
  const remainder = missingTeams.length - shown.length;
  const suffix = remainder > 0 ? `, and ${remainder} more` : "";
  return `Club ratings are missing for ${missingTeams.length} active team(s): `
    + `${shown.join(", ")}${suffix}. `
    + `${skippedFixtures} fixture(s) are unpriced as a result.`;
}

function syncClubSeasonEvidence(fixtures: ModelFixture[], now = new Date()): void {
  const football = getCachedMatches();
  updateClubSeasonSnapshots([...football.upcoming, ...football.recent], fixtures, now);
}

export async function refreshModelData(activeFixtures: ActiveFixture[]): Promise<void> {
  console.log("[Model] Refreshing active fixture Dixon-Coles model...");
  refreshInProgress = true;
  try {
    // An empty active window is a valid state between rounds or seasons and
    // does not need the ratings provider at all.
    if (activeFixtures.length === 0) {
      cache.fixtures = [];
      cache.lastUpdated = new Date();
      cache.error = null;
      missingRatingTeamIds = new Set();
      syncClubSeasonEvidence([], cache.lastUpdated);
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
    let ratingState = ratings;
    let profiles = ratingState.byProfile;
    let missing = findMissingClubRatings(activeFixtures, profiles);
    if (missing.length > 0) {
      // Correctly named clubs can still be absent from the daily snapshot once
      // their rating window lapses. Recover those from their own feeds before
      // writing anyone off; whatever stays missing genuinely cannot be priced.
      await backfillMissingClubRatings(missing);
      ratingState = getCachedClubRatings();
      profiles = ratingState.byProfile;
      missing = findMissingClubRatings(activeFixtures, profiles);
    }
    const missingTeams = missing.map(({ team }) => team);
    missingRatingTeamIds = new Set(missingTeams.map(normalizeTeamName));
    const forecastAt = new Date();
    const fixtures = buildActiveModelFixtures(activeFixtures, profiles, {
      forecastAt,
      ratingSnapshotAt: ratingState.fetchedAt,
      ratingSourceState: ratingState.servingPersisted ? "persisted" : "artifact",
      ratingArtifactId: ratingState.artifactId,
      ratingArtifactSha256: ratingState.artifactSha256,
      fallbackRatingClubs: new Set(ratingState.staleRatings.map((entry) => entry.club)),
    });
    cache.fixtures = fixtures;
    cache.lastUpdated = new Date();
    cache.error = missingTeams.length > 0
      ? missingRatingsMessage(missingTeams, activeFixtures.length - fixtures.length)
      : null;
    if (cache.error) console.warn(`[Model] ${cache.error}`);
    console.log(
      `[Model] ${fixtures.length}/${activeFixtures.length} active fixtures cached.`
    );

    syncClubSeasonEvidence(fixtures, forecastAt);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    cache.error = message;
    if (getCachedClubRatings().fetchedAt === null) {
      missingRatingTeamIds = new Set(
        activeFixtures.flatMap((fixture) => [fixture.homeTeam, fixture.awayTeam])
          .map(normalizeTeamName)
      );
    }
    console.error(`[Model] Refresh error: ${message}`);
    // Even an unpriced scheduled fixture must enter the checkpoint state so a
    // later transition can be recorded as a miss instead of disappearing from
    // the evidence trail. Existing cached forecasts remain immutable inputs;
    // this does not make an unavailable model ready.
    syncClubSeasonEvidence(cache.fixtures);
  } finally {
    refreshInProgress = false;
  }
}

export const MODEL_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
export const MODEL_COLD_RETRY_MS = 6 * 60 * 1000;

export function modelRefreshDelay(
  cacheState: Pick<ModelDataCache, "fixtures" | "lastUpdated">,
  activeFixtures: ActiveFixture[]
): number {
  if (!modelDataCoversActiveFixtures(cacheState, activeFixtures)) {
    return MODEL_COLD_RETRY_MS;
  }
  return buildFreshnessSnapshot(footballMatchesForFreshness()).modelRefreshMs;
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
