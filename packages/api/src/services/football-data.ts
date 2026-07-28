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

export function getCachedMatches(): CachedData {
  return { ...cache };
}

export function getCachedMatchesForCompetition(competitionId: string): CompetitionCache {
  return cache.byCompetition[competitionId] ?? {
    upcoming: [],
    recent: [],
    standings: [],
    error: null,
  };
}

// ─── API Fetcher ────────────────────────────────────────────────────────────

async function espnFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });

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

// ─── Data Transformers ──────────────────────────────────────────────────────

function statusFromState(state: string): string {
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
    status: statusFromState(state),
    stage: e.season?.slug || null,
    matchday: null,
    group: groupMatch ? groupMatch[1] : null,
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

export async function refreshFootballData(): Promise<void> {
  console.log("[FootballData] Refreshing data from ESPN...");
  const enabled = getEnabledCompetitions();
  if (enabled.length === 0) {
    cache.error = "No competitions enabled.";
    console.warn("[FootballData] No competitions enabled.");
    return;
  }

  const results = await Promise.allSettled(
    enabled.map(async (competition) => {
      const data = await refreshCompetition(competition);
      return { competition, data };
    })
  );

  const byCompetition: Record<string, CompetitionCache> = { ...cache.byCompetition };
  const competitionErrors: Record<string, string> = {};

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
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

const REFRESH_INTERVAL_MS = 30 * 60 * 1000;
let cronTimer: ReturnType<typeof setInterval> | null = null;

export async function startFootballCron(): Promise<void> {
  await refreshFootballData();
  cronTimer = setInterval(refreshFootballData, REFRESH_INTERVAL_MS);
  console.log("[FootballData] Cron started — refreshing every 30 minutes");
}

export function stopFootballCron(): void {
  if (cronTimer) {
    clearInterval(cronTimer);
    cronTimer = null;
  }
}
