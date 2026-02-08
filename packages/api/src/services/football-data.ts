// ─── football-data.org Integration ──────────────────────────────────────────
//
// Free tier: 10 requests/minute, World Cup competition code: "WC"
// Docs: https://www.football-data.org/documentation/api
//
// This service fetches upcoming qualifiers, recent results, and standings,
// caching results in-memory. A cron runs every 6 hours to refresh.

const API_BASE = "https://api.football-data.org/v4";
const API_KEY = process.env.FOOTBALL_DATA_API_KEY || "";

// Competition codes for World Cup related data
const COMPETITION_WC = "WC"; // FIFA World Cup
const COMPETITION_CL = "CLI"; // Copa Libertadores / international friendlies fallback

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FootballMatch {
  id: number;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  utcDate: string;
  status: string; // SCHEDULED, TIMED, IN_PLAY, PAUSED, FINISHED, POSTPONED, CANCELLED
  matchday: number | null;
  group: string | null;
  score: {
    home: number | null;
    away: number | null;
  } | null;
}

export interface FootballStanding {
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
}

interface CachedData {
  upcoming: FootballMatch[];
  recent: FootballMatch[];
  standings: FootballStanding[];
  lastUpdated: Date | null;
  error: string | null;
}

// ─── Cache ──────────────────────────────────────────────────────────────────

const cache: CachedData = {
  upcoming: [],
  recent: [],
  standings: [],
  lastUpdated: null,
  error: null,
};

export function getCachedMatches(): CachedData {
  return { ...cache };
}

// ─── API Fetcher ────────────────────────────────────────────────────────────

async function footballFetch<T>(path: string): Promise<T> {
  if (!API_KEY) {
    throw new Error("FOOTBALL_DATA_API_KEY not configured");
  }

  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "X-Auth-Token": API_KEY,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`football-data.org API error ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

// ─── Data Transformers ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseMatch(m: any, competition: string): FootballMatch {
  return {
    id: m.id,
    competition,
    homeTeam: m.homeTeam?.name || m.homeTeam?.shortName || "TBD",
    awayTeam: m.awayTeam?.name || m.awayTeam?.shortName || "TBD",
    utcDate: m.utcDate,
    status: m.status,
    matchday: m.matchday ?? null,
    group: m.group ?? null,
    score:
      m.score?.fullTime?.home !== null && m.score?.fullTime?.home !== undefined
        ? { home: m.score.fullTime.home, away: m.score.fullTime.away }
        : null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseStanding(s: any, group: string | null): FootballStanding {
  return {
    position: s.position,
    team: s.team?.name || s.team?.shortName || "Unknown",
    playedGames: s.playedGames,
    won: s.won,
    draw: s.draw,
    lost: s.lost,
    points: s.points,
    goalsFor: s.goalsFor,
    goalsAgainst: s.goalsAgainst,
    goalDifference: s.goalDifference,
    group,
  };
}

// ─── Fetch Functions ────────────────────────────────────────────────────────

async function fetchUpcomingMatches(): Promise<FootballMatch[]> {
  // Get matches with status SCHEDULED or TIMED
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await footballFetch<any>(
    `/competitions/${COMPETITION_WC}/matches?status=SCHEDULED,TIMED`
  );

  const matches: FootballMatch[] = (data.matches || [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((m: any) => parseMatch(m, "FIFA World Cup"))
    .sort(
      (a: FootballMatch, b: FootballMatch) =>
        new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime()
    );

  return matches.slice(0, 50); // Cap at 50
}

async function fetchRecentResults(): Promise<FootballMatch[]> {
  // Get finished matches
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await footballFetch<any>(
    `/competitions/${COMPETITION_WC}/matches?status=FINISHED&limit=20`
  );

  const matches: FootballMatch[] = (data.matches || [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((m: any) => parseMatch(m, "FIFA World Cup"))
    .sort(
      (a: FootballMatch, b: FootballMatch) =>
        new Date(b.utcDate).getTime() - new Date(a.utcDate).getTime()
    );

  return matches.slice(0, 20);
}

async function fetchStandings(): Promise<FootballStanding[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await footballFetch<any>(
    `/competitions/${COMPETITION_WC}/standings`
  );

  const standings: FootballStanding[] = [];

  for (const table of data.standings || []) {
    const group = table.group ?? null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const entry of table.table || []) {
      standings.push(parseStanding(entry, group));
    }
  }

  return standings;
}

// ─── Refresh All Data ───────────────────────────────────────────────────────

export async function refreshFootballData(): Promise<void> {
  if (!API_KEY) {
    cache.error = "FOOTBALL_DATA_API_KEY not configured — skipping football data fetch";
    console.warn(`[FootballData] ${cache.error}`);
    return;
  }

  console.log("[FootballData] Refreshing data from football-data.org...");

  try {
    // Fetch sequentially to respect rate limits (10 req/min on free tier)
    const upcoming = await fetchUpcomingMatches();
    cache.upcoming = upcoming;
    console.log(`[FootballData]   ${upcoming.length} upcoming matches`);

    // Small delay to be kind to rate limit
    await new Promise((r) => setTimeout(r, 1000));

    const recent = await fetchRecentResults();
    cache.recent = recent;
    console.log(`[FootballData]   ${recent.length} recent results`);

    await new Promise((r) => setTimeout(r, 1000));

    const standings = await fetchStandings();
    cache.standings = standings;
    console.log(`[FootballData]   ${standings.length} standing entries`);

    cache.lastUpdated = new Date();
    cache.error = null;

    console.log("[FootballData] Data refresh complete.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    cache.error = msg;
    console.error(`[FootballData] Refresh error: ${msg}`);
    // Keep stale data in cache — better than nothing
  }
}

// ─── Cron Scheduler (6-hour interval) ───────────────────────────────────────

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
let cronTimer: ReturnType<typeof setInterval> | null = null;

export function startFootballCron(): void {
  // Run immediately on startup
  refreshFootballData();

  // Then every 6 hours
  cronTimer = setInterval(refreshFootballData, SIX_HOURS_MS);
  console.log("[FootballData] Cron started — refreshing every 6 hours");
}

export function stopFootballCron(): void {
  if (cronTimer) {
    clearInterval(cronTimer);
    cronTimer = null;
  }
}
