// ─── ESPN Public Scoreboard Integration ─────────────────────────────────────
//
// Multi-competition schedule authority via the competition registry.
// Each enabled competition is fetched in parallel; failures stay isolated.

import { canonicalTeamName } from "../lib/team-names";
import {
  CompetitionConfig,
  getCompetitionById,
  getEnabledCompetitions,
} from "../config/competitions";
import { readJsonFile, resolveDataPath, writeJsonFileAtomic } from "./persistent-store";

const ESPN_SCOREBOARD_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const ESPN_STANDINGS_BASE = "https://site.api.espn.com/apis/v2/sports/soccer";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FootballMatch {
  id: number;
  competitionId: string;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  utcDate: string;
  status: string; // SCHEDULED, IN_PLAY, FINISHED, POSTPONED, CANCELLED
  stage: string | null;
  matchday: number | null;
  group: string | null;
  venue?: string | null;
  neutralVenue?: boolean | null;
  score: {
    home: number | null;
    away: number | null;
  } | null;
  winner?: string | null;
}

export interface FootballStanding {
  competitionId: string;
  position: number;
  team: string;
  playedGames: number;
  won: number;
  draw: number;
  lost: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  group: string | null;
  advanced: boolean;
}

interface CompetitionCache {
  upcoming: FootballMatch[];
  recent: FootballMatch[];
  standings: FootballStanding[];
  error: string | null;
}

interface CachedData {
  byCompetition: Record<string, CompetitionCache>;
  upcoming: FootballMatch[];
  recent: FootballMatch[];
  standings: FootballStanding[];
  lastUpdated: Date | null;
  error: string | null;
  competitionErrors: Record<string, string>;
}

export interface SeasonScheduleCache {
  competitionId: string;
  seasonId: string;
  fixtures: FootballMatch[];
  lastUpdated: Date | null;
  error: string | null;
  servingLastGood: boolean;
}

interface PersistedSeasonSchedule {
  schemaVersion: 1;
  competitionId: "eng.1";
  seasonId: string;
  fixtures: FootballMatch[];
  lastUpdated: string;
}

const SEASON_SCHEDULE_FILE = "cache/eng-1-season-schedule.json";
const SEASON_SCHEDULE_RECOVERY_FILE = "cache/eng-1-season-schedule.last-good.json";
export const FOOTBALL_DATA_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
export const SEASON_SCHEDULE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const ESPN_FETCH_TIMEOUT_MS = 15_000;
// The scheduler only wakes every 30 minutes and a bounded ESPN request can use
// the full timeout. Keep a small event-loop/network-completion margin as well,
// so the latest possible scheduler tick still finishes before the strict
// six-hour readiness deadline rather than racing it.
export const SEASON_SCHEDULE_REFRESH_SAFETY_MARGIN_MS = 60_000;
export const SEASON_SCHEDULE_REFRESH_LEAD_MS = FOOTBALL_DATA_REFRESH_INTERVAL_MS
  + ESPN_FETCH_TIMEOUT_MS
  + SEASON_SCHEDULE_REFRESH_SAFETY_MARGIN_MS;
export const SEASON_SCHEDULE_REFRESH_DUE_AFTER_MS = SEASON_SCHEDULE_MAX_AGE_MS
  - SEASON_SCHEDULE_REFRESH_LEAD_MS;

// ─── Cache ──────────────────────────────────────────────────────────────────

const cache: CachedData = {
  byCompetition: {},
  upcoming: [],
  recent: [],
  standings: [],
  lastUpdated: null,
  error: null,
  competitionErrors: {},
};

// The ordinary fixture cache is deliberately a small rolling window for chat
// and model freshness. The season simulator needs a different contract: every
// remaining Premier League fixture. Keep that complete schedule in its own
// cache so a transient ESPN failure cannot replace the last-good season with a
// truncated rolling window.
const seasonScheduleCache: SeasonScheduleCache = {
  competitionId: "eng.1",
  seasonId: "unknown",
  fixtures: [],
  lastUpdated: null,
  error: null,
  servingLastGood: false,
};

export function getCachedMatches(): CachedData {
  return { ...cache };
}

export function replaceFootballDataForTests(state: Partial<CachedData>): void {
  Object.assign(cache, state);
}

export function getCachedMatchesForCompetition(competitionId: string): CompetitionCache {
  return cache.byCompetition[competitionId] ?? {
    upcoming: [],
    recent: [],
    standings: [],
    error: null,
  };
}

export function getCachedSeasonSchedule(competitionId = "eng.1"): SeasonScheduleCache {
  if (competitionId !== seasonScheduleCache.competitionId) {
    return {
      competitionId,
      seasonId: "unknown",
      fixtures: [],
      lastUpdated: null,
      error: "Complete season schedule is not configured for this competition.",
      servingLastGood: false,
    };
  }
  return { ...seasonScheduleCache, fixtures: [...seasonScheduleCache.fixtures] };
}

export function replaceSeasonScheduleForTests(state: SeasonScheduleCache): void {
  Object.assign(seasonScheduleCache, { ...state, fixtures: [...state.fixtures] });
}

export function seasonScheduleStatus(state: SeasonScheduleCache, now = new Date()): {
  ready: boolean;
  ageMinutes: number | null;
  servingLastGood: boolean;
} {
  const ageMs = state.lastUpdated === null
    ? null
    : Math.max(0, now.getTime() - state.lastUpdated.getTime());
  const ageMinutes = ageMs === null ? null : Math.floor(ageMs / 60_000);
  let complete = false;
  try {
    validateCompletePremierLeagueSchedule(state.fixtures);
    complete = true;
  } catch {
    complete = false;
  }
  const currentSeason = state.seasonId === premierLeagueSeasonWindow(now).seasonId;
  const fresh = ageMs !== null && ageMs < SEASON_SCHEDULE_MAX_AGE_MS;
  return {
    ready: complete && currentSeason && fresh && state.error === null,
    ageMinutes,
    servingLastGood: state.servingLastGood,
  };
}

export function seasonScheduleRefreshDue(
  state: Pick<SeasonScheduleCache, "seasonId" | "lastUpdated">,
  now = new Date()
): boolean {
  return state.seasonId !== premierLeagueSeasonWindow(now).seasonId
    || state.lastUpdated === null
    || now.getTime() - state.lastUpdated.getTime() >= SEASON_SCHEDULE_REFRESH_DUE_AFTER_MS;
}

export function serialiseSeasonSchedule(
  state: SeasonScheduleCache
): PersistedSeasonSchedule | null {
  if (state.competitionId !== "eng.1" || state.lastUpdated === null || state.fixtures.length === 0) {
    return null;
  }
  try {
    validateCompletePremierLeagueSchedule(state.fixtures);
  } catch {
    return null;
  }
  return {
    schemaVersion: 1,
    competitionId: "eng.1",
    seasonId: state.seasonId,
    fixtures: state.fixtures,
    lastUpdated: state.lastUpdated.toISOString(),
  };
}

export function deserialiseSeasonSchedule(
  persisted: PersistedSeasonSchedule
): SeasonScheduleCache | null {
  const lastUpdated = new Date(persisted?.lastUpdated ?? "");
  if (persisted?.schemaVersion !== 1 || persisted?.competitionId !== "eng.1"
    || !persisted.seasonId || !Array.isArray(persisted.fixtures)
    || persisted.fixtures.length === 0 || !Number.isFinite(lastUpdated.getTime())) {
    return null;
  }
  const validFixtures = persisted.fixtures.every((fixture) =>
    Number.isFinite(fixture?.id) && fixture.competitionId === "eng.1"
    && typeof fixture.homeTeam === "string" && typeof fixture.awayTeam === "string"
    && Number.isFinite(Date.parse(fixture.utcDate))
  );
  if (!validFixtures) return null;
  try {
    validateCompletePremierLeagueSchedule(persisted.fixtures);
  } catch {
    return null;
  }
  return {
    ...persisted,
    fixtures: [...persisted.fixtures],
    lastUpdated,
    error: null,
    servingLastGood: true,
  };
}

export function persistSeasonSchedule(
  state: SeasonScheduleCache,
  write: typeof writeJsonFileAtomic = writeJsonFileAtomic
): void {
  const persisted = serialiseSeasonSchedule(state);
  if (!persisted) return;
  try {
    const primaryPath = resolveDataPath(SEASON_SCHEDULE_FILE);
    const recoveryPath = resolveDataPath(SEASON_SCHEDULE_RECOVERY_FILE);
    const current = readJsonFile<PersistedSeasonSchedule>(primaryPath);
    const validatedCurrent = current ? deserialiseSeasonSchedule(current) : null;
    if (validatedCurrent) {
      const previous = serialiseSeasonSchedule(validatedCurrent);
      if (previous) write(recoveryPath, previous);
      write(primaryPath, persisted);
    } else {
      // With no usable prior generation, install the primary first. Only then
      // seed recovery; a failed primary write must not claim a usable release.
      write(primaryPath, persisted);
      write(recoveryPath, persisted);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.warn(`[FootballData] Could not persist complete season schedule: ${message}`);
  }
}

export function loadPersistedSeasonSchedule(): boolean {
  const candidates = [SEASON_SCHEDULE_FILE, SEASON_SCHEDULE_RECOVERY_FILE];
  for (const relativePath of candidates) {
    const persisted = readJsonFile<PersistedSeasonSchedule>(resolveDataPath(relativePath));
    const restored = persisted ? deserialiseSeasonSchedule(persisted) : null;
    if (!restored) continue;
    Object.assign(seasonScheduleCache, restored);
    console.log(
      `[FootballData] Restored ${restored.fixtures.length} fixtures for `
      + `${restored.seasonId} from persisted complete-season schedule.`
    );
    return true;
  }
  return false;
}

// ─── API Fetcher ────────────────────────────────────────────────────────────

export async function espnFetch<T>(
  url: string,
  timeoutMs = ESPN_FETCH_TIMEOUT_MS
): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ESPN API error ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

function formatEspnDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export function buildFetchDateRange(competition: CompetitionConfig): string {
  if (competition.seasonDateRange && competition.fetchDaysPast === undefined
    && competition.fetchDaysFuture === undefined) {
    return competition.seasonDateRange;
  }
  const now = new Date();
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - (competition.fetchDaysPast ?? 7));
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() + (competition.fetchDaysFuture ?? 21));
  return `${formatEspnDate(start)}-${formatEspnDate(end)}`;
}

export function premierLeagueSeasonWindow(now = new Date()): {
  seasonId: string;
  dateRange: string;
} {
  const year = now.getUTCFullYear();
  // July is treated as the start of the next English season so the published
  // schedule can be loaded before the first August kickoff.
  const startYear = now.getUTCMonth() >= 6 ? year : year - 1;
  return {
    seasonId: `${startYear}-${String(startYear + 1).slice(-2)}`,
    dateRange: `${startYear}0701-${startYear + 1}0630`,
  };
}

export function validateCompletePremierLeagueSchedule(fixtures: FootballMatch[]): void {
  const fixtureIds = new Set(fixtures.map((fixture) => fixture.id));
  const teams = new Set(fixtures.flatMap((fixture) => [fixture.homeTeam, fixture.awayTeam]));
  const appearances = new Map<string, number>();
  const directedPairs = new Set<string>();
  for (const fixture of fixtures) {
    if (!Number.isFinite(fixture.id) || fixture.competitionId !== "eng.1"
      || !fixture.homeTeam || !fixture.awayTeam || fixture.homeTeam === fixture.awayTeam) {
      throw new Error("Premier League complete-season response contains an invalid fixture.");
    }
    appearances.set(fixture.homeTeam, (appearances.get(fixture.homeTeam) ?? 0) + 1);
    appearances.set(fixture.awayTeam, (appearances.get(fixture.awayTeam) ?? 0) + 1);
    directedPairs.add(`${fixture.homeTeam}>${fixture.awayTeam}`);
  }
  const complete = fixtures.length === 380
    && fixtureIds.size === 380
    && teams.size === 20
    && directedPairs.size === 380
    && [...teams].every((team) => appearances.get(team) === 38);
  if (!complete) {
    throw new Error(
      "Premier League complete-season response failed the 380-fixture, 20-team round-robin gate."
    );
  }
}

// ─── Data Transformers ──────────────────────────────────────────────────────

function statusFromState(state: string, statusName = ""): string {
  const normalizedName = statusName.toUpperCase();
  if (/CANCEL/.test(normalizedName)) return "CANCELLED";
  if (/POSTPON/.test(normalizedName)) return "POSTPONED";
  if (state === "post") return "FINISHED";
  if (state === "in") return "IN_PLAY";
  return "SCHEDULED";
}

function parseScore(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface ParseEventContext {
  competitionId: string;
  competitionName: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseEvent(e: any, context: ParseEventContext): FootballMatch {
  const competitionMeta = e.competitions?.[0];
  const competitors = competitionMeta?.competitors || [];
  const home = competitors.find((c: any) => c.homeAway === "home"); // eslint-disable-line @typescript-eslint/no-explicit-any
  const away = competitors.find((c: any) => c.homeAway === "away"); // eslint-disable-line @typescript-eslint/no-explicit-any
  const statusType = competitionMeta?.status?.type || {};
  const completed = Boolean(statusType.completed);
  const state = statusType.state;
  const homeScore = parseScore(home?.score);
  const awayScore = parseScore(away?.score);
  const hasScore = homeScore !== null && awayScore !== null;
  const groupMatch = /Group ([A-Z])/.exec(competitionMeta?.altGameNote || "");

  return {
    id: Number(e.id),
    competitionId: context.competitionId,
    competition: context.competitionName,
    homeTeam: canonicalTeamName(home?.team?.displayName || "TBD"),
    awayTeam: canonicalTeamName(away?.team?.displayName || "TBD"),
    utcDate: e.date,
    // ESPN marks cancelled events `state=post` even though they were never
    // played. The exact status name must win over the broad state bucket or a
    // cancellation is silently normalized as a completed match.
    status: statusFromState(state, statusType.name || statusType.description || ""),
    stage: e.season?.slug || null,
    matchday: null,
    group: groupMatch ? groupMatch[1] : null,
    venue: typeof competitionMeta?.venue?.fullName === "string"
      ? competitionMeta.venue.fullName
      : null,
    // ESPN omits `neutralSite` for ordinary home/away fixtures. In the two
    // explicitly validated model competitions, that omission is the provider's
    // false representation; preserving it as unknown would unprice the entire
    // legacy model set. Unsupported competitions retain null and fail closed.
    neutralVenue: typeof competitionMeta?.neutralSite === "boolean"
      ? competitionMeta.neutralSite
      : getCompetitionById(context.competitionId)?.enabled
        ? false
        : null,
    score: completed || state === "in" || hasScore
      ? { home: homeScore ?? 0, away: awayScore ?? 0 }
      : null,
    winner: completed
      ? home?.winner
        ? canonicalTeamName(home?.team?.displayName || "")
        : away?.winner
          ? canonicalTeamName(away?.team?.displayName || "")
          : null
      : null,
  };
}

function splitMatches(matches: FootballMatch[]): Pick<CompetitionCache, "upcoming" | "recent"> {
  return {
    upcoming: matches
      .filter((match) => match.status !== "FINISHED")
      .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime()),
    recent: matches
      .filter((match) => match.status === "FINISHED")
      .sort((a, b) => new Date(b.utcDate).getTime() - new Date(a.utcDate).getTime()),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseStandingsEntries(
  competitionId: string,
  entries: any[], // eslint-disable-line @typescript-eslint/no-explicit-any
  group: string | null
): FootballStanding[] {
  return entries.map((entry) => {
    const stat = (name: string): number => {
      const found = entry.stats?.find((s: any) => s.name === name); // eslint-disable-line @typescript-eslint/no-explicit-any
      return Number(found?.value) || 0;
    };
    return {
      competitionId,
      position: stat("rank"),
      team: canonicalTeamName(entry.team?.displayName || "Unknown"),
      playedGames: stat("gamesPlayed"),
      won: stat("wins"),
      draw: stat("ties"),
      lost: stat("losses"),
      points: stat("points"),
      goalsFor: stat("pointsFor"),
      goalsAgainst: stat("pointsAgainst"),
      goalDifference: stat("pointDifferential"),
      group,
      advanced: stat("advanced") === 1,
    };
  });
}

async function fetchCompetitionMatches(competition: CompetitionConfig): Promise<FootballMatch[]> {
  const dateRange = buildFetchDateRange(competition);
  const data = await espnFetch<{ events?: unknown[] }>(
    `${ESPN_SCOREBOARD_BASE}/${competition.espnScoreboardPath}/scoreboard?dates=${dateRange}&limit=200`
  );
  const context = { competitionId: competition.id, competitionName: competition.name };
  return (data.events || []).map((event) => parseEvent(event, context));
}

export async function fetchCompletePremierLeagueSchedule(
  now = new Date()
): Promise<{ seasonId: string; fixtures: FootballMatch[] }> {
  const competition = getCompetitionById("eng.1");
  if (!competition) throw new Error("Premier League competition is not configured.");
  const { seasonId, dateRange } = premierLeagueSeasonWindow(now);
  const data = await espnFetch<{ events?: unknown[] }>(
    `${ESPN_SCOREBOARD_BASE}/${competition.espnScoreboardPath}`
      + `/scoreboard?dates=${dateRange}&limit=1000`
  );
  const context = { competitionId: competition.id, competitionName: competition.name };
  const fixtures = (data.events ?? []).map((event) => parseEvent(event, context));
  // Validate the source rows before deduplication so duplicate identifiers or
  // pairings cannot masquerade as a complete response and replace last-good.
  validateCompletePremierLeagueSchedule(fixtures);
  return { seasonId, fixtures };
}

export function nextSeasonScheduleCache(
  previous: SeasonScheduleCache,
  result: PromiseSettledResult<{ seasonId: string; fixtures: FootballMatch[] }>,
  updatedAt = new Date()
): SeasonScheduleCache {
  if (result.status === "fulfilled") {
    return {
      competitionId: "eng.1",
      seasonId: result.value.seasonId,
      fixtures: result.value.fixtures,
      lastUpdated: updatedAt,
      error: null,
      servingLastGood: false,
    };
  }
  const message = result.reason instanceof Error ? result.reason.message : "Unknown error";
  return {
    ...previous,
    fixtures: [...previous.fixtures],
    error: message,
    servingLastGood: previous.fixtures.length > 0,
  };
}

async function fetchCompetitionStandings(competition: CompetitionConfig): Promise<FootballStanding[]> {
  if (!competition.espnStandingsPath) return [];
  const data = await espnFetch<{ children?: any[] }>( // eslint-disable-line @typescript-eslint/no-explicit-any
    `${ESPN_STANDINGS_BASE}/${competition.espnStandingsPath}/standings`
  );

  const standings: FootballStanding[] = [];
  for (const child of data.children || []) {
    const groupName = (child.name || "").replace(/^Group /, "") || null;
    const isGrouped = /^Group [A-Z]$/i.test(child.name || "");
    standings.push(
      ...parseStandingsEntries(
        competition.id,
        child.standings?.entries || [],
        isGrouped ? groupName?.replace(/^Group /, "") ?? groupName : null
      )
    );
  }
  return standings;
}

export async function fetchCompetitionMatchesById(competitionId: string): Promise<FootballMatch[]> {
  const competition = getCompetitionById(competitionId);
  if (!competition) throw new Error(`Unknown competition: ${competitionId}`);
  return fetchCompetitionMatches(competition);
}

export async function fetchWorldCupMatches(): Promise<FootballMatch[]> {
  return fetchCompetitionMatchesById("fifa.world");
}

function mergeUniqueById(matches: FootballMatch[]): FootballMatch[] {
  const byId = new Map<number, FootballMatch>();
  for (const match of matches) byId.set(match.id, match);
  return Array.from(byId.values());
}

async function refreshCompetition(competition: CompetitionConfig): Promise<CompetitionCache> {
  const [matches, standings] = await Promise.all([
    fetchCompetitionMatches(competition),
    fetchCompetitionStandings(competition),
  ]);
  const split = splitMatches(matches);
  return {
    ...split,
    standings,
    error: null,
  };
}

function mergeCaches(byCompetition: Record<string, CompetitionCache>): void {
  const upcoming = mergeUniqueById(
    Object.values(byCompetition).flatMap((entry) => entry.upcoming)
  ).sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());
  const recent = mergeUniqueById(
    Object.values(byCompetition).flatMap((entry) => entry.recent)
  ).sort((a, b) => new Date(b.utcDate).getTime() - new Date(a.utcDate).getTime());
  const standings = Object.values(byCompetition).flatMap((entry) => entry.standings);

  cache.byCompetition = byCompetition;
  cache.upcoming = upcoming;
  cache.recent = recent;
  cache.standings = standings;
}

// ─── Refresh All Data ───────────────────────────────────────────────────────

export async function refreshFootballData(dependencies: {
  fetchSeason?: typeof fetchCompletePremierLeagueSchedule;
} = {}): Promise<void> {
  console.log("[FootballData] Refreshing data from ESPN...");
  const enabled = getEnabledCompetitions();
  if (enabled.length === 0) {
    cache.error = "No competitions enabled.";
    console.warn("[FootballData] No competitions enabled.");
    return;
  }

  const shouldRefreshSeason = seasonScheduleRefreshDue(seasonScheduleCache);
  const [competitionResults, seasonResult] = await Promise.all([
    Promise.allSettled(enabled.map(async (competition) => {
      const data = await refreshCompetition(competition);
      return { competition, data };
    })),
    shouldRefreshSeason
      ? Promise.allSettled([
        (dependencies.fetchSeason ?? fetchCompletePremierLeagueSchedule)(),
      ]).then(([result]) => result)
      : Promise.resolve(null),
  ]);

  const byCompetition: Record<string, CompetitionCache> = { ...cache.byCompetition };
  const competitionErrors: Record<string, string> = {};

  for (let index = 0; index < competitionResults.length; index += 1) {
    const result = competitionResults[index];
    const competition = enabled[index];
    if (result.status === "fulfilled") {
      const { data } = result.value;
      byCompetition[competition.id] = data;
      console.log(
        `[FootballData]   ${competition.id}: ${data.upcoming.length} upcoming, `
        + `${data.recent.length} recent, ${data.standings.length} standings`
      );
    } else {
      const message = result.reason instanceof Error
        ? result.reason.message
        : "Unknown error";
      competitionErrors[competition.id] = message;
      console.error(`[FootballData] ${competition.id} refresh error: ${message}`);
      byCompetition[competition.id] ??= {
        upcoming: [],
        recent: [],
        standings: [],
        error: message,
      };
      byCompetition[competition.id].error = message;
    }
  }

  if (seasonResult !== null) {
    const nextSeason = nextSeasonScheduleCache(seasonScheduleCache, seasonResult);
    Object.assign(seasonScheduleCache, nextSeason);
    if (seasonResult.status === "fulfilled") {
      persistSeasonSchedule(nextSeason);
      console.log(
        `[FootballData]   eng.1 season ${seasonResult.value.seasonId}: `
        + `${seasonResult.value.fixtures.length} complete-schedule fixtures`
      );
    } else {
      // Retain the prior fixture rows and timestamp. Consumers can distinguish a
      // last-good schedule from a fresh one through `error` without losing the
      // only complete input during a transient source failure.
      console.error(`[FootballData] eng.1 complete-season refresh error: ${nextSeason.error}`);
    }
  }

  mergeCaches(byCompetition);
  cache.competitionErrors = competitionErrors;
  cache.error = Object.keys(competitionErrors).length === enabled.length
    ? "All competition refreshes failed."
    : null;
  cache.lastUpdated = new Date();
  console.log(
    `[FootballData] ${cache.upcoming.length} upcoming, ${cache.recent.length} recent total`
  );
  console.log("[FootballData] Data refresh complete.");
}

// ─── Cron Scheduler ─────────────────────────────────────────────────────────

let cronTimer: ReturnType<typeof setInterval> | null = null;

export async function startFootballCron(): Promise<void> {
  loadPersistedSeasonSchedule();
  await refreshFootballData();
  cronTimer = setInterval(refreshFootballData, FOOTBALL_DATA_REFRESH_INTERVAL_MS);
  console.log("[FootballData] Cron started — refreshing every 30 minutes");
}

export function stopFootballCron(): void {
  if (cronTimer) {
    clearInterval(cronTimer);
    cronTimer = null;
  }
}
