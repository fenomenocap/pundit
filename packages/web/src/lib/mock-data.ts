import { MatchResponse, StandingResponse } from "./api";

const now = Date.now();
const DAY = 86_400_000;

function futureISO(days: number): string {
  return new Date(now + days * DAY).toISOString();
}

function pastISO(days: number): string {
  return new Date(now - days * DAY).toISOString();
}

// ─── Data layer (mock ↔ real API swap) ──────────────────────────────────────

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== "false";

export interface MatchesPayload {
  matches: MatchResponse[];
  lastUpdated: string | null;
  error: string | null;
}

export interface StandingsPayload {
  standings: StandingResponse[];
  lastUpdated: string | null;
  error: string | null;
}

// ─── Live WC fixtures / standings (reference only, not tradeable) ───────────
// Sourced from ESPN's public scoreboard API via the backend. Mock fallback is
// deliberately thin — this data is meant to be live, current tournament state.

const MOCK_UPCOMING_MATCHES: MatchResponse[] = [
  {
    id: 1, competition: "FIFA World Cup", homeTeam: "Argentina", awayTeam: "Cape Verde",
    utcDate: futureISO(0), status: "SCHEDULED", stage: "round-of-32", matchday: null, group: null, score: null,
  },
  {
    id: 2, competition: "FIFA World Cup", homeTeam: "France", awayTeam: "Paraguay",
    utcDate: futureISO(1), status: "SCHEDULED", stage: "round-of-16", matchday: null, group: null, score: null,
  },
];

const MOCK_RECENT_MATCHES: MatchResponse[] = [
  {
    id: 3, competition: "FIFA World Cup", homeTeam: "Portugal", awayTeam: "Croatia",
    utcDate: pastISO(1), status: "FINISHED", stage: "round-of-32", matchday: null, group: null,
    score: { home: 2, away: 1 },
  },
  {
    id: 4, competition: "FIFA World Cup", homeTeam: "Spain", awayTeam: "Austria",
    utcDate: pastISO(1), status: "FINISHED", stage: "round-of-32", matchday: null, group: null,
    score: { home: 3, away: 0 },
  },
];

const MOCK_STANDINGS: StandingResponse[] = [
  { position: 1, team: "Mexico", playedGames: 3, won: 3, draw: 0, lost: 0, points: 9, goalsFor: 6, goalsAgainst: 0, goalDifference: 6, group: "A", advanced: true },
  { position: 2, team: "South Africa", playedGames: 3, won: 1, draw: 1, lost: 1, points: 4, goalsFor: 2, goalsAgainst: 3, goalDifference: -1, group: "A", advanced: true },
];

export async function fetchUpcomingMatches(): Promise<MatchesPayload> {
  if (!USE_MOCK) {
    try {
      const { getUpcomingMatches } = await import("./api");
      const res = await getUpcomingMatches();
      return {
        matches: res.matches ?? [],
        lastUpdated: res.lastUpdated ?? null,
        error: res.error ?? null,
      };
    } catch (reason) {
      return {
        matches: [],
        lastUpdated: null,
        error: reason instanceof Error ? reason.message : "Could not load upcoming matches.",
      };
    }
  }
  return { matches: MOCK_UPCOMING_MATCHES, lastUpdated: new Date(now).toISOString(), error: null };
}

export async function fetchRecentMatches(): Promise<MatchesPayload> {
  if (!USE_MOCK) {
    try {
      const { getRecentMatches } = await import("./api");
      const res = await getRecentMatches();
      return {
        matches: res.matches ?? [],
        lastUpdated: res.lastUpdated ?? null,
        error: res.error ?? null,
      };
    } catch (reason) {
      return {
        matches: [],
        lastUpdated: null,
        error: reason instanceof Error ? reason.message : "Could not load recent matches.",
      };
    }
  }
  return { matches: MOCK_RECENT_MATCHES, lastUpdated: new Date(now).toISOString(), error: null };
}

export async function fetchStandings(): Promise<StandingsPayload> {
  if (!USE_MOCK) {
    try {
      const { getStandings } = await import("./api");
      const res = await getStandings();
      return {
        standings: res.standings ?? [],
        lastUpdated: res.lastUpdated ?? null,
        error: res.error ?? null,
      };
    } catch (reason) {
      return {
        standings: [],
        lastUpdated: null,
        error: reason instanceof Error ? reason.message : "Could not load standings.",
      };
    }
  }
  return { standings: MOCK_STANDINGS, lastUpdated: new Date(now).toISOString(), error: null };
}
