const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MatchResponse {
  id: number;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  utcDate: string;
  status: string;
  stage: string | null; // group-stage, round-of-32, round-of-16, quarterfinals, semifinals, 3rd-place-match, final
  matchday: number | null;
  group: string | null;
  score: {
    home: number | null;
    away: number | null;
  } | null;
}

export interface StandingResponse {
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

// ─── Fetch helper ───────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `API error ${res.status}`);
  }

  return res.json();
}

// ─── Matches ───────────────────────────────────────────────────────────────

export async function getUpcomingMatches() {
  return apiFetch<{ matches: MatchResponse[]; lastUpdated: string | null }>(
    "/api/matches/upcoming"
  );
}

export async function getRecentMatches() {
  return apiFetch<{ matches: MatchResponse[]; lastUpdated: string | null }>(
    "/api/matches/recent"
  );
}

export async function getStandings() {
  return apiFetch<{ standings: StandingResponse[]; lastUpdated: string | null }>(
    "/api/matches/standings"
  );
}

// ─── Polymarket types + endpoints ───────────────────────────────────────────

export interface PolymarketMarket {
  id: string;
  question: string;
  outcomes: string[];
  outcomePrices: number[];  // 0–1 floats e.g. 0.34
  liquidity: number;
  volume: number;
  endDate: string;
  resolved: boolean;
  active: boolean;
  type?: "outright" | "group";
  group?: string | null;    // "A"–"L" for group winner markets
  onchainMarketId?: string;
}

export async function getPolymarketMarkets(): Promise<{
  markets: PolymarketMarket[];
  lastUpdated: string | null;
}> {
  return apiFetch<{ markets: PolymarketMarket[]; lastUpdated: string | null }>(
    "/api/polymarkets/wc"
  );
}

export async function getPolymarketGroupMarkets(): Promise<{
  markets: PolymarketMarket[];
  lastUpdated: string | null;
}> {
  return apiFetch<{ markets: PolymarketMarket[]; lastUpdated: string | null }>(
    "/api/polymarkets/groups"
  );
}

// ─── worldcup-model types + endpoints (reference only, not tradeable) ───────

export interface ModelTeamProbability {
  team: string;
  winProb: number;    // 0–1
  sfProb: number;     // 0–1
  qfProb: number;     // 0–1
  marketPrice: number; // 0–1
  edge: number;        // winProb - marketPrice
}

export interface ModelFixture {
  date: string;
  group: string | null;
  stage: string;
  home: string;
  away: string;
  pHome: number;
  pDraw: number;
  pAway: number;
  stakePHome: number | null;
  stakePDraw: number | null;
  stakePAway: number | null;
  result: { homeScore: number; awayScore: number; status: string } | null;
}

export async function getModelWcProbabilities(): Promise<{
  teams: ModelTeamProbability[];
  lastUpdated: string | null;
  error: string | null;
}> {
  return apiFetch<{ teams: ModelTeamProbability[]; lastUpdated: string | null; error: string | null }>(
    "/api/model/wc"
  );
}

export async function getModelFixtures(): Promise<{
  fixtures: ModelFixture[];
  lastUpdated: string | null;
  error: string | null;
}> {
  return apiFetch<{ fixtures: ModelFixture[]; lastUpdated: string | null; error: string | null }>(
    "/api/model/fixtures"
  );
}

// ─── Ask (conversational match analysis) ────────────────────────────────────

export interface AskGrounding {
  date: string;
  stage: string;
  home: string;
  away: string;
  pHome: number;
  pDraw: number;
  pAway: number;
  stakePHome: number | null;
  stakePDraw: number | null;
  stakePAway: number | null;
}

export async function askQuestion(question: string): Promise<{
  answer: string;
  grounding: AskGrounding;
}> {
  return apiFetch<{ answer: string; grounding: AskGrounding }>("/api/ask", {
    method: "POST",
    body: JSON.stringify({ question }),
  });
}

// ─── Health ─────────────────────────────────────────────────────────────────

export async function getHealth() {
  return apiFetch<{ status: string }>("/health");
}
