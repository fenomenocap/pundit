import { MatchResponse, ModelFixtureResponse, StandingResponse } from "./api";

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

const MOCK_UPCOMING_MATCHES: MatchResponse[] = [
  {
    id: 1, competitionId: "eng.1", competition: "Premier League",
    homeTeam: "Arsenal", awayTeam: "Coventry City",
    utcDate: futureISO(2), status: "SCHEDULED", stage: null, matchday: null, group: null, score: null,
  },
  {
    id: 2, competitionId: "uefa.champions_qual", competition: "UEFA Champions League Qualifiers",
    homeTeam: "Riga FC", awayTeam: "Ararat-Armenia",
    utcDate: futureISO(3), status: "SCHEDULED", stage: null, matchday: null, group: null, score: null,
  },
];

const MOCK_RECENT_MATCHES: MatchResponse[] = [
  {
    id: 3, competitionId: "eng.1", competition: "Premier League",
    homeTeam: "Manchester United", awayTeam: "Hull City",
    utcDate: pastISO(1), status: "FINISHED", stage: null, matchday: null, group: null,
    score: { home: 2, away: 1 },
  },
];

const MOCK_STANDINGS: StandingResponse[] = [
  {
    competitionId: "eng.1", position: 1, team: "Arsenal", playedGames: 0, won: 0, draw: 0,
    lost: 0, points: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, group: null, advanced: false,
  },
  {
    competitionId: "eng.1", position: 2, team: "Liverpool", playedGames: 0, won: 0, draw: 0,
    lost: 0, points: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, group: null, advanced: false,
  },
];

export async function fetchCompetitions() {
  if (!USE_MOCK) {
    const { getCompetitions } = await import("./api");
    return getCompetitions();
  }
  return {
    competitions: [
      { id: "eng.1", name: "Premier League", type: "league" as const, enabled: true, priority: 1 },
      {
        id: "uefa.champions_qual",
        name: "UEFA Champions League Qualifiers",
        type: "cup" as const,
        enabled: true,
        priority: 2,
      },
    ],
    enabled: ["eng.1", "uefa.champions_qual"],
    lastUpdated: new Date(now).toISOString(),
  };
}

export async function fetchActiveFixtures(): Promise<MatchesPayload> {
  if (!USE_MOCK) {
    try {
      const { getActiveFixtures } = await import("./api");
      const res = await getActiveFixtures();
      return {
        matches: res.fixtures ?? [],
        lastUpdated: res.lastUpdated ?? null,
        error: res.error ?? null,
      };
    } catch (reason) {
      return {
        matches: [],
        lastUpdated: null,
        error: reason instanceof Error ? reason.message : "Could not load active fixtures.",
      };
    }
  }
  return { matches: MOCK_UPCOMING_MATCHES, lastUpdated: new Date(now).toISOString(), error: null };
}

export async function fetchUpcomingMatches(competition?: string): Promise<MatchesPayload> {
  if (!USE_MOCK) {
    try {
      const { getUpcomingMatches } = await import("./api");
      const res = await getUpcomingMatches(competition);
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
  const matches = competition
    ? MOCK_UPCOMING_MATCHES.filter((match) => match.competitionId === competition)
    : MOCK_UPCOMING_MATCHES;
  return { matches, lastUpdated: new Date(now).toISOString(), error: null };
}

export async function fetchRecentMatches(competition?: string): Promise<MatchesPayload> {
  if (!USE_MOCK) {
    try {
      const { getRecentMatches } = await import("./api");
      const res = await getRecentMatches(competition);
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
  const matches = competition
    ? MOCK_RECENT_MATCHES.filter((match) => match.competitionId === competition)
    : MOCK_RECENT_MATCHES;
  return { matches, lastUpdated: new Date(now).toISOString(), error: null };
}

const MOCK_MODEL_FIXTURES: ModelFixtureResponse[] = [
  {
    competitionId: "eng.1",
    competition: "Premier League",
    fixtureId: 1,
    utcDate: futureISO(2),
    date: new Date(futureISO(2)).toISOString().slice(0, 10),
    group: null,
    stage: "match",
    home: "Arsenal",
    away: "Coventry City",
    homeElo: 1850,
    awayElo: 1520,
    pHome: 0.72,
    pDraw: 0.18,
    pAway: 0.10,
    pOver2_5: 0.55,
    pUnder2_5: 0.45,
    pBttsYes: 0.48,
    pBttsNo: 0.52,
    topScores: [{ score: "2-0", probability: 0.14 }],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    result: null,
  },
  {
    competitionId: "eng.1",
    competition: "Premier League",
    fixtureId: 2,
    utcDate: futureISO(4),
    date: new Date(futureISO(4)).toISOString().slice(0, 10),
    group: null,
    stage: "match",
    home: "Liverpool",
    away: "Brighton & Hove Albion",
    homeElo: 1880,
    awayElo: 1680,
    pHome: 0.58,
    pDraw: 0.22,
    pAway: 0.20,
    pOver2_5: 0.62,
    pUnder2_5: 0.38,
    pBttsYes: 0.55,
    pBttsNo: 0.45,
    topScores: [{ score: "2-1", probability: 0.11 }],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    result: null,
  },
];

export async function fetchActiveModelFixtures(): Promise<{
  fixtures: ModelFixtureResponse[];
  lastUpdated: string | null;
  error: string | null;
}> {
  if (!USE_MOCK) {
    try {
      const { getActiveModelFixtures } = await import("./api");
      const res = await getActiveModelFixtures();
      return {
        fixtures: res.fixtures ?? [],
        lastUpdated: res.lastUpdated ?? null,
        error: res.error ?? null,
      };
    } catch (reason) {
      return {
        fixtures: [],
        lastUpdated: null,
        error: reason instanceof Error ? reason.message : "Could not load model fixtures.",
      };
    }
  }
  return {
    fixtures: MOCK_MODEL_FIXTURES,
    lastUpdated: new Date(now).toISOString(),
    error: null,
  };
}

export async function fetchStandings(competition?: string): Promise<StandingsPayload> {
  if (!USE_MOCK) {
    try {
      const { getStandings } = await import("./api");
      const res = await getStandings(competition);
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
  const standings = competition
    ? MOCK_STANDINGS.filter((row) => row.competitionId === competition)
    : MOCK_STANDINGS;
  return { standings, lastUpdated: new Date(now).toISOString(), error: null };
}

const MOCK_CLUB_SEASON_EVALUATION = {
  competitions: ["eng.1"],
  method: "snapshot" as const,
  builtAt: new Date(now).toISOString(),
  updatedAt: new Date(now).toISOString(),
  disclaimer: "Pre-kickoff probabilities captured when fixtures leave the scheduled "
    + "window. Rolling club-season calibration — not a frozen backtest.",
  fixtures: [],
  metrics: {
    fixtureCount: 0,
    brierScore: 0,
    logLoss: 0,
    winnerAccuracy: 0,
    drawCount: 0,
    calibration: [],
  },
};

const MOCK_WC2026_EVALUATION = {
  competition: "fifa.world" as const,
  method: "reconstructed" as const,
  builtAt: new Date(now).toISOString(),
  disclaimer: "Immutable pre-kickoff probabilities reconstructed for backtesting.",
  fixtures: [],
  metrics: {
    fixtureCount: 0,
    brierScore: 0,
    logLoss: 0,
    winnerAccuracy: 0,
    drawCount: 0,
    calibration: [],
  },
};

export async function fetchClubSeasonEvaluation() {
  if (!USE_MOCK) {
    const { getClubSeasonEvaluation } = await import("./api");
    return getClubSeasonEvaluation();
  }
  return MOCK_CLUB_SEASON_EVALUATION;
}

export async function fetchWc2026Evaluation() {
  if (!USE_MOCK) {
    const { getWc2026Evaluation } = await import("./api");
    return getWc2026Evaluation();
  }
  return MOCK_WC2026_EVALUATION;
}
