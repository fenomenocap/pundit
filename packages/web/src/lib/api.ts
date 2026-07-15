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

// ─── Health ─────────────────────────────────────────────────────────────────

export async function getHealth() {
  return apiFetch<{ status: string }>("/health");
}
