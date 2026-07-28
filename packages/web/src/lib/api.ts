const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MatchResponse {
  id: number;
  competitionId: string;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  utcDate: string;
  status: string;
  stage: string | null;
  matchday: number | null;
  group: string | null;
  score: {
    home: number | null;
    away: number | null;
  } | null;
}

export interface StandingResponse {
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

export interface ModelFixtureResponse {
  competitionId: string;
  competition: string;
  fixtureId: number;
  utcDate: string;
  date: string;
  group: string | null;
  stage: string;
  home: string;
  away: string;
  homeElo: number;
  awayElo: number;
  pHome: number;
  pDraw: number;
  pAway: number;
  pOver2_5: number;
  pUnder2_5: number;
  pBttsYes: number;
  pBttsNo: number;
  topScores: Array<{ score: string; probability: number }>;
  stakePHome: number | null;
  stakePDraw: number | null;
  stakePAway: number | null;
  result: {
    homeScore: number;
    awayScore: number;
    status: string;
    winner: string | null;
  } | null;
}

export interface Wc2026EvaluationFixture {
  id: number;
  utcDate: string;
  stage: string | null;
  group: string | null;
  home: string;
  away: string;
  pHome: number;
  pDraw: number;
  pAway: number;
  result: {
    homeScore: number;
    awayScore: number;
    winner: "home" | "draw" | "away";
  };
  predictedOutcome: "home" | "draw" | "away";
  method: "reconstructed" | "snapshot";
}

export interface Wc2026EvaluationResponse {
  competition: "fifa.world";
  method: "reconstructed" | "snapshot";
  builtAt: string;
  disclaimer: string;
  fixtures: Wc2026EvaluationFixture[];
  metrics: {
    fixtureCount: number;
    brierScore: number;
    logLoss: number;
    winnerAccuracy: number;
    drawCount: number;
    calibration: Array<{
      label: string;
      count: number;
      avgPredicted: number;
      actualRate: number;
    }>;
  };
}

// ─── Fetch helper ───────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

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
    throw new ApiError(body.error || `API error ${res.status}`, res.status);
  }

  return res.json();
}

// ─── Matches ───────────────────────────────────────────────────────────────

export async function getStandings(competition?: string) {
  const query = competition ? `?competition=${encodeURIComponent(competition)}` : "";
  return apiFetch<{ standings: StandingResponse[]; lastUpdated: string | null; error?: string | null }>(
    `/api/matches/standings${query}`
  );
}

export interface CompetitionResponse {
  id: string;
  name: string;
  type: "league" | "cup";
  enabled: boolean;
  priority: number;
}

export async function getCompetitions() {
  return apiFetch<{
    competitions: CompetitionResponse[];
    enabled: string[];
    lastUpdated: string | null;
  }>("/api/matches/competitions");
}

export async function getActiveFixtures() {
  return apiFetch<{
    fixtures: MatchResponse[];
    lastUpdated: string | null;
    error?: string | null;
  }>("/api/matches/active");
}

export async function getUpcomingMatches(competition?: string) {
  const query = competition ? `?competition=${encodeURIComponent(competition)}` : "";
  return apiFetch<{ matches: MatchResponse[]; lastUpdated: string | null; error?: string | null }>(
    `/api/matches/upcoming${query}`
  );
}

export async function getRecentMatches(competition?: string) {
  const query = competition ? `?competition=${encodeURIComponent(competition)}` : "";
  return apiFetch<{ matches: MatchResponse[]; lastUpdated: string | null; error?: string | null }>(
    `/api/matches/recent${query}`
  );
}

// Legacy wrappers without competition filter — kept for existing callers.
export async function getUpcomingMatchesAll() {
  return getUpcomingMatches();
}

export async function getRecentMatchesAll() {
  return getRecentMatches();
}

export async function getActiveModelFixtures(competition?: string) {
  const query = competition ? `?competition=${encodeURIComponent(competition)}` : "";
  return apiFetch<{ fixtures: ModelFixtureResponse[]; lastUpdated: string | null; error?: string | null }>(
    `/api/model/active${query}`
  );
}

export async function getModelFixtures(competition?: string) {
  const query = competition ? `?competition=${encodeURIComponent(competition)}` : "";
  return apiFetch<{ fixtures: ModelFixtureResponse[]; lastUpdated: string | null; error?: string | null }>(
    `/api/model/fixtures${query}`
  );
}

export async function getWc2026Evaluation() {
  return apiFetch<Wc2026EvaluationResponse>("/api/evaluation/wc-2026");
}

// ─── Ask (conversational match analysis) ────────────────────────────────────

export interface OddsSource {
  source: "kalshi" | "polymarket";
  pHome: number;
  pDraw: number | null;
  pAway: number;
}

export interface MatchGrounding {
  kind: "match";
  competitionId: string;
  competition: string;
  homeFieldAdvantage: boolean;
  date: string;
  stage: string;
  home: string;
  away: string;
  pHome: number;
  pDraw: number;
  pAway: number;
  pOver2_5: number;
  pUnder2_5: number;
  pBttsYes: number;
  pBttsNo: number;
  topScores: Array<{ score: string; probability: number }>;
  scorelines: Array<{ score: string; probability: number }>;
  stakePHome: number | null;
  stakePDraw: number | null;
  stakePAway: number | null;
  oddsSources: OddsSource[];
}

export interface CompetitionGrounding {
  kind: "competition";
  competitionId: string;
  competition: string;
  updatedAt: string | null;
  standings: Array<{
    position: number;
    team: string;
    playedGames: number;
    points: number;
    goalDifference: number;
  }>;
}

export type AskGrounding = MatchGrounding | CompetitionGrounding | null;

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export type TeamContext = [string, string];

export async function askQuestion(
  question: string,
  history: ConversationTurn[] = [],
  teamContext?: TeamContext
): Promise<{
  answer: string;
  grounding: AskGrounding;
}> {
  return apiFetch<{ answer: string; grounding: AskGrounding }>("/api/ask", {
    method: "POST",
    body: JSON.stringify({ question, history, teamContext }),
  });
}

export interface AskStreamHandlers {
  onGrounding?: (grounding: AskGrounding) => void;
  onDelta: (text: string) => void;
}

interface SseEvent {
  event: string;
  data: string;
}

function parseSseChunk(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = [];
  const blocks = buffer.split("\n\n");
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      if (line.startsWith("data: ")) data += line.slice(6);
    }
    if (data) events.push({ event, data });
  }
  return { events, rest };
}

// Streams /api/ask over SSE, invoking handlers as grounding and text deltas
// arrive. Resolves with the final trimmed answer once the server sends "done".
export async function askQuestionStream(
  question: string,
  history: ConversationTurn[] = [],
  teamContext: TeamContext | undefined,
  handlers: AskStreamHandlers
): Promise<{ answer: string; grounding: AskGrounding }> {
  const res = await fetch(`${API_URL}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, history, teamContext, stream: true }),
  });

  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !contentType.includes("text/event-stream") || !res.body) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error || `API error ${res.status}`, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: { answer: string; grounding: AskGrounding } | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSseChunk(buffer);
    buffer = rest;
    for (const { event, data } of events) {
      const payload = JSON.parse(data);
      if (event === "grounding") handlers.onGrounding?.(payload.grounding);
      else if (event === "delta") handlers.onDelta(payload.text);
      else if (event === "done") result = payload;
      else if (event === "error") {
        throw new ApiError(payload.error, typeof payload.status === "number" ? payload.status : 502);
      }
    }
  }

  if (!result) throw new ApiError("Analysis stream ended unexpectedly.", 502);
  return result;
}

// ─── Health ─────────────────────────────────────────────────────────────────

export async function getHealth() {
  return apiFetch<{ status: string }>("/health");
}

export async function getReadiness() {
  return apiFetch<{
    status: "ready" | "loading";
    model: {
      ready: boolean;
      fixtureCount: number;
      expectedActiveFixtureCount: number;
      lastUpdated: string | null;
      error: string | null;
    };
    football: {
      ready: boolean;
      lastUpdated: string | null;
      error: string | null;
      competitionErrors: Record<string, string | null>;
    };
    activeFixtures: {
      count: number;
      byCompetition: Record<string, number>;
      lastUpdated: string | null;
    };
    marketOdds: {
      ready: boolean;
      lastUpdated: string | null;
      error: string | null;
      sourceWarnings: Record<string, string | null>;
      coverage: Record<string, { matched: number; total: number }>;
    };
  }>("/ready");
}
