import {
  MatchResponse,
  ModelFixtureResponse,
  RecognizedFixtureSnapshotRow,
  StandingResponse,
} from "./api";

const now = Date.now();
const DAY = 86_400_000;

function modelIdentity(competitionId: string, fixtureId: number): string {
  return `espn:${competitionId}:${fixtureId}`;
}

function futureISO(days: number): string {
  return new Date(now + days * DAY).toISOString();
}

function pastISO(days: number): string {
  return new Date(now - days * DAY).toISOString();
}

function hoursAgo(hours: number): string {
  return new Date(now - hours * 3_600_000).toISOString();
}

// ─── Data layer (mock ↔ real API swap) ──────────────────────────────────────

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== "false";

function e2eFixtureState(): string | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { __PUNDIT_E2E_FIXTURE_STATE__?: string }).__PUNDIT_E2E_FIXTURE_STATE__ ?? null;
}

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

const MOCK_LIVE_MATCH: MatchResponse = {
  id: 5, competitionId: "eng.1", competition: "Premier League",
  homeTeam: "Chelsea", awayTeam: "Tottenham Hotspur",
  utcDate: hoursAgo(0.5), status: "IN_PLAY", stage: null, matchday: null, group: null,
  score: { home: 1, away: 0 },
};

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
  const e2e = e2eFixtureState();
  if (e2e === "loading") {
    await new Promise(() => undefined);
  }
  if (e2e === "unavailable") {
    return { matches: [], lastUpdated: null, error: "e2e: fixture list unavailable" };
  }
  if (e2e === "no-fixtures") {
    return { matches: [], lastUpdated: new Date(now).toISOString(), error: null };
  }
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
  return {
    matches: [...MOCK_UPCOMING_MATCHES, MOCK_LIVE_MATCH],
    lastUpdated: new Date(now).toISOString(),
    error: null,
  };
}

export async function fetchRecognizedFixtures(): Promise<{
  fixtures: RecognizedFixtureSnapshotRow[];
  error: string | null;
}> {
  if (!USE_MOCK) {
    try {
      const { getRecognizedFixtures } = await import("./api");
      const res = await getRecognizedFixtures();
      return { fixtures: res.fixtures ?? [], error: res.registry.error ?? null };
    } catch (reason) {
      return {
        fixtures: [],
        error: reason instanceof Error ? reason.message : "Could not load fixture capabilities.",
      };
    }
  }

  const priced = new Set(MOCK_MODEL_FIXTURES.map((fixture) => (
    modelIdentity(fixture.competitionId, fixture.fixtureId)
  )));
  return {
    fixtures: MOCK_UPCOMING_MATCHES.map((match) => {
      const fixtureId = modelIdentity(match.competitionId, match.id);
      return {
        fixture: {
          fixtureId,
          primarySource: "espn" as const,
          primarySourceFixtureId: String(match.id),
          homeTeam: { id: match.homeTeam.toLowerCase().replaceAll(" ", "-"), name: match.homeTeam },
          awayTeam: { id: match.awayTeam.toLowerCase().replaceAll(" ", "-"), name: match.awayTeam },
          kickoff: match.utcDate,
          venue: null,
          neutralVenue: false,
          competition: {
            id: match.competitionId,
            name: match.competition,
            category: match.competitionId === "eng.1" ? "domestic-league" as const : "club-continental" as const,
          },
          status: "scheduled" as const,
          recognition: "authoritative" as const,
        },
        capability: priced.has(fixtureId)
          ? { status: "priced" as const, modelFixtureId: fixtureId }
          : { status: "insufficient-model-input" as const, reason: "required-context-missing" as const },
      };
    }),
    error: null,
  };
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
    oddsSources: [
      { source: "polymarket", observedAt: futureISO(0), pHome: 0.68, pDraw: 0.20, pAway: 0.12 },
    ],
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
  // A two-legged qualifier. Both legs carry the same two clubs, which is the
  // shape that used to make a suggestion chip ambiguous, and roughly a quarter
  // of the live active set looks like this -- so mock mode has to contain one.
  {
    competitionId: "uefa.champions_qual",
    competition: "UEFA Champions League Qualifying",
    fixtureId: 3,
    utcDate: futureISO(5),
    date: new Date(futureISO(5)).toISOString().slice(0, 10),
    group: null,
    stage: "qualifying",
    home: "Dinamo Zagreb",
    away: "Viking",
    homeElo: 1660,
    awayElo: 1520,
    pHome: 0.56,
    pDraw: 0.24,
    pAway: 0.20,
    pOver2_5: 0.51,
    pUnder2_5: 0.49,
    pBttsYes: 0.50,
    pBttsNo: 0.50,
    topScores: [{ score: "2-1", probability: 0.10 }],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    result: null,
  },
  {
    competitionId: "uefa.champions_qual",
    competition: "UEFA Champions League Qualifying",
    fixtureId: 4,
    utcDate: futureISO(12),
    date: new Date(futureISO(12)).toISOString().slice(0, 10),
    group: null,
    stage: "qualifying",
    home: "Viking",
    away: "Dinamo Zagreb",
    homeElo: 1520,
    awayElo: 1660,
    pHome: 0.33,
    pDraw: 0.26,
    pAway: 0.41,
    pOver2_5: 0.53,
    pUnder2_5: 0.47,
    pBttsYes: 0.52,
    pBttsNo: 0.48,
    topScores: [{ score: "1-2", probability: 0.10 }],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    result: null,
  },
  {
    competitionId: "eng.1",
    competition: "Premier League",
    fixtureId: 5,
    utcDate: hoursAgo(0.5),
    status: "IN_PLAY",
    date: new Date(hoursAgo(0.5)).toISOString().slice(0, 10),
    group: null,
    stage: "match",
    home: "Chelsea",
    away: "Tottenham Hotspur",
    homeElo: 1840,
    awayElo: 1780,
    pHome: 0.46,
    pDraw: 0.28,
    pAway: 0.26,
    pOver2_5: 0.51,
    pUnder2_5: 0.49,
    pBttsYes: 0.50,
    pBttsNo: 0.50,
    topScores: [{ score: "1-1", probability: 0.12 }],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    result: null,
  },
  {
    competitionId: "eng.1",
    competition: "Premier League",
    fixtureId: 3,
    utcDate: pastISO(1),
    status: "FINISHED",
    date: new Date(pastISO(1)).toISOString().slice(0, 10),
    group: null,
    stage: "match",
    home: "Manchester United",
    away: "Hull City",
    homeElo: 1915,
    awayElo: 1533,
    pHome: 0.82,
    pDraw: 0.14,
    pAway: 0.04,
    pOver2_5: 0.51,
    pUnder2_5: 0.49,
    pBttsYes: 0.26,
    pBttsNo: 0.74,
    topScores: [{ score: "2-0", probability: 0.13 }],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    result: {
      homeScore: 2,
      awayScore: 1,
      status: "FT",
      winner: "Manchester United",
    },
  },
];

export async function fetchActiveModelFixtures(): Promise<{
  fixtures: ModelFixtureResponse[];
  lastUpdated: string | null;
  error: string | null;
}> {
  const e2e = e2eFixtureState();
  if (e2e === "loading") {
    await new Promise(() => undefined);
  }
  if (e2e === "unavailable") {
    return { fixtures: [], lastUpdated: null, error: "e2e: model unavailable" };
  }
  if (e2e === "unpriced" || e2e === "no-fixtures") {
    return { fixtures: [], lastUpdated: new Date(now).toISOString(), error: null };
  }
  if (e2e === "partial") {
    return {
      fixtures: MOCK_MODEL_FIXTURES.slice(0, 1),
      lastUpdated: new Date(now).toISOString(),
      error: "e2e: some fixtures unpriced",
    };
  }
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
  schemaVersion: 2 as const,
  competitions: ["eng.1"],
  method: "snapshot" as const,
  builtAt: new Date(now).toISOString(),
  updatedAt: new Date(now).toISOString(),
  disclaimer: "Immutable pre-kickoff Pundit Fundamental forecasts captured by a deterministic checkpoint policy.",
  fixtures: [],
  missedCheckpoints: [],
  metrics: {
    fixtureCount: 0,
    calibrationForecastCount: 0,
    forecastsPerFixture: 3 as const,
    calibrationMethod: "one-vs-rest-1x2" as const,
    brierScore: null,
    logLoss: null,
    winnerAccuracy: null,
    drawCount: 0,
    calibration: [],
  },
  evaluation: {
    metricVersion: "multiclass-v1" as const,
    segments: [],
    exclusions: {
      total: 0,
      byReason: {
        legacyPartialProvenance: 0,
        incompleteInputProvenance: 0,
        postKickoffForecast: 0,
        invalidForecastTimestamp: 0,
      },
    },
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
    calibrationForecastCount: 0,
    forecastsPerFixture: 3 as const,
    calibrationMethod: "one-vs-rest-1x2" as const,
    brierScore: null,
    logLoss: null,
    winnerAccuracy: null,
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
