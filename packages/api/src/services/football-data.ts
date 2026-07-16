// ─── ESPN Public Scoreboard Integration ─────────────────────────────────────
//
// Public JSON, no auth/API key required.
// Fetches WC 2026 fixtures, results, and group standings from ESPN's public
// site API. Covers the full tournament (group stage → final) with real,
// per-round stage labels (group-stage, round-of-32, round-of-16,
// quarterfinals, semifinals, 3rd-place-match, final) — unresolved knockout
// fixtures correctly show as "Round of X Winner" until earlier rounds finish.
//
// A cron runs every 6 hours to refresh the in-memory cache.

import { canonicalTeamName } from "../lib/team-names";

const SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
const STANDINGS_URL = "https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings";

// Tournament window: 11 June – 19 July 2026. Padded a day on each side.
const TOURNAMENT_DATE_RANGE = "20260609-20260721";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FootballMatch {
  id: number;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  utcDate: string;
  status: string; // SCHEDULED, IN_PLAY, FINISHED, POSTPONED, CANCELLED
  stage: string | null; // group-stage, round-of-32, round-of-16, quarterfinals, semifinals, 3rd-place-match, final
  matchday: number | null;
  group: string | null;
  score: {
    home: number | null;
    away: number | null;
  } | null;
  winner?: string | null;
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
  advanced: boolean;
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

async function espnFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ESPN API error ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

// ─── Data Transformers ──────────────────────────────────────────────────────

function statusFromState(state: string): string {
  if (state === "post") return "FINISHED";
  if (state === "in") return "IN_PLAY";
  return "SCHEDULED";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseEvent(e: any): FootballMatch {
  const competition = e.competitions?.[0];
  const competitors = competition?.competitors || [];
  const home = competitors.find((c: any) => c.homeAway === "home"); // eslint-disable-line @typescript-eslint/no-explicit-any
  const away = competitors.find((c: any) => c.homeAway === "away"); // eslint-disable-line @typescript-eslint/no-explicit-any
  const statusType = competition?.status?.type || {};
  const completed = Boolean(statusType.completed);

  // altGameNote looks like "FIFA World Cup, Group A" — pull the group letter if present.
  const groupMatch = /Group ([A-Z])/.exec(competition?.altGameNote || "");

  return {
    id: Number(e.id),
    competition: "FIFA World Cup",
    homeTeam: canonicalTeamName(home?.team?.displayName || "TBD"),
    awayTeam: canonicalTeamName(away?.team?.displayName || "TBD"),
    utcDate: e.date,
    status: statusFromState(statusType.state),
    stage: e.season?.slug || null,
    matchday: null,
    group: groupMatch ? groupMatch[1] : null,
    score: completed
      ? { home: Number(home?.score ?? 0), away: Number(away?.score ?? 0) }
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

// ─── Fetch Functions ────────────────────────────────────────────────────────

async function fetchAllMatches(): Promise<FootballMatch[]> {
  const data = await espnFetch<{ events?: unknown[] }>(
    `${SCOREBOARD_URL}?dates=${TOURNAMENT_DATE_RANGE}&limit=200`
  );

  return (data.events || []).map(parseEvent);
}

async function fetchStandings(): Promise<FootballStanding[]> {
  const data = await espnFetch<{ children?: any[] }>(STANDINGS_URL); // eslint-disable-line @typescript-eslint/no-explicit-any

  const standings: FootballStanding[] = [];

  for (const group of data.children || []) {
    const groupName = (group.name || "").replace(/^Group /, "") || null;

    for (const entry of group.standings?.entries || []) {
      const stat = (name: string): number => {
        const found = entry.stats?.find((s: any) => s.name === name); // eslint-disable-line @typescript-eslint/no-explicit-any
        return Number(found?.value) || 0;
      };

      standings.push({
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
        group: groupName,
        advanced: stat("advanced") === 1,
      });
    }
  }

  return standings;
}

// ─── Refresh All Data ───────────────────────────────────────────────────────

export async function refreshFootballData(): Promise<void> {
  console.log("[FootballData] Refreshing data from ESPN...");

  try {
    const all = await fetchAllMatches();

    // The whole tournament is 104 matches — keep every fixture so /fixtures can
    // render the full bracket (group stage included) at any point in the event.
    cache.upcoming = all
      .filter((m) => m.status !== "FINISHED")
      .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());

    cache.recent = all
      .filter((m) => m.status === "FINISHED")
      .sort((a, b) => new Date(b.utcDate).getTime() - new Date(a.utcDate).getTime());

    console.log(
      `[FootballData]   ${cache.upcoming.length} upcoming, ${cache.recent.length} recent`
    );

    cache.standings = await fetchStandings();
    console.log(`[FootballData]   ${cache.standings.length} standing entries`);

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

export async function startFootballCron(): Promise<void> {
  // Run immediately on startup
  await refreshFootballData();

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
