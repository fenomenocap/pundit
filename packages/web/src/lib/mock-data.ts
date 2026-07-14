import { PolymarketMarket, MatchResponse, StandingResponse, ModelTeamProbability } from "./api";

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

// ─── Polymarket mock markets ─────────────────────────────────────────────────
// Realistic WC 2026 markets as they appear on Polymarket's Gamma API.

const MOCK_POLYMARKET_MARKETS: PolymarketMarket[] = [
  {
    id: "pm-wc-brazil",
    question: "Will Brazil win the 2026 FIFA World Cup?",
    outcomes: ["Yes", "No"],
    outcomePrices: [0.34, 0.66],
    volume: 1_840_000,
    liquidity: 420_000,
    endDate: futureISO(45),
    resolved: false,
    active: true,
  },
  {
    id: "pm-wc-argentina",
    question: "Will Argentina win the 2026 FIFA World Cup?",
    outcomes: ["Yes", "No"],
    outcomePrices: [0.28, 0.72],
    volume: 1_560_000,
    liquidity: 380_000,
    endDate: futureISO(45),
    resolved: false,
    active: true,
  },
  {
    id: "pm-wc-france",
    question: "Will France win the 2026 FIFA World Cup?",
    outcomes: ["Yes", "No"],
    outcomePrices: [0.22, 0.78],
    volume: 1_230_000,
    liquidity: 310_000,
    endDate: futureISO(45),
    resolved: false,
    active: true,
  },
  {
    id: "pm-wc-england",
    question: "Will England win the 2026 FIFA World Cup?",
    outcomes: ["Yes", "No"],
    outcomePrices: [0.14, 0.86],
    volume: 890_000,
    liquidity: 210_000,
    endDate: futureISO(45),
    resolved: false,
    active: true,
  },
  {
    id: "pm-wc-spain",
    question: "Will Spain win the 2026 FIFA World Cup?",
    outcomes: ["Yes", "No"],
    outcomePrices: [0.18, 0.82],
    volume: 760_000,
    liquidity: 180_000,
    endDate: futureISO(45),
    resolved: false,
    active: true,
  },
  {
    id: "pm-wc-usa-mexico",
    question: "USA vs Mexico — 2026 FIFA World Cup Group Stage",
    outcomes: ["USA Win", "Draw", "Mexico Win"],
    outcomePrices: [0.38, 0.28, 0.34],
    volume: 540_000,
    liquidity: 120_000,
    endDate: futureISO(8),
    resolved: false,
    active: true,
  },
  {
    id: "pm-wc-england-france",
    question: "England vs France — 2026 FIFA World Cup Group Stage",
    outcomes: ["England Win", "Draw", "France Win"],
    outcomePrices: [0.32, 0.27, 0.41],
    volume: 680_000,
    liquidity: 160_000,
    endDate: futureISO(12),
    resolved: false,
    active: true,
  },
  {
    id: "pm-wc-brazil-argentina",
    question: "Brazil vs Argentina — 2026 FIFA World Cup Group Stage",
    outcomes: ["Brazil Win", "Draw", "Argentina Win"],
    outcomePrices: [0.44, 0.26, 0.30],
    volume: 920_000,
    liquidity: 230_000,
    endDate: futureISO(17),
    resolved: false,
    active: true,
  },
];

// ─── Polymarket fetch (mock ↔ real API swap) ─────────────────────────────────

export async function fetchPolymarketMarkets(): Promise<PolymarketMarket[]> {
  if (!USE_MOCK) {
    try {
      const { getPolymarketMarkets, getPolymarketGroupMarkets } = await import("./api");
      const [outright, groups] = await Promise.all([
        getPolymarketMarkets(),
        getPolymarketGroupMarkets(),
      ]);
      // Interleave: show a mix of outright and group winner markets, sorted by liquidity
      return [...(outright.markets ?? []), ...(groups.markets ?? [])]
        .sort((a, b) => b.liquidity - a.liquidity);
    } catch {
      return [];
    }
  }
  return MOCK_POLYMARKET_MARKETS;
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

export async function fetchModelProbabilities(): Promise<ModelTeamProbability[]> {
  if (!USE_MOCK) {
    try {
      const { getModelWcProbabilities } = await import("./api");
      const res = await getModelWcProbabilities();
      return res.teams ?? [];
    } catch {
      return [];
    }
  }
  return [];
}
