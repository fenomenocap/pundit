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

export async function fetchUpcomingMatches(): Promise<MatchResponse[]> {
  if (!USE_MOCK) {
    try {
      const { getUpcomingMatches } = await import("./api");
      const res = await getUpcomingMatches();
      return res.matches ?? [];
    } catch {
      return [];
    }
  }
  return MOCK_UPCOMING_MATCHES;
}

export async function fetchRecentMatches(): Promise<MatchResponse[]> {
  if (!USE_MOCK) {
    try {
      const { getRecentMatches } = await import("./api");
      const res = await getRecentMatches();
      return res.matches ?? [];
    } catch {
      return [];
    }
  }
  return MOCK_RECENT_MATCHES;
}

export async function fetchStandings(): Promise<StandingResponse[]> {
  if (!USE_MOCK) {
    try {
      const { getStandings } = await import("./api");
      const res = await getStandings();
      return res.standings ?? [];
    } catch {
      return [];
    }
  }
  return MOCK_STANDINGS;
}
