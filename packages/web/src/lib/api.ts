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

/**
 * The identity `/api/ask` accepts as `fixtureContext`, derived from a model row
 * exactly as the API derives it (`espnFixtureIdentity`). Match grounding hands
 * the same string back, so a suggestion chip and a follow-up address a fixture
 * the same way -- which is what stops a chip for one leg of a two-legged tie
 * from resolving to the other leg.
 */
export function modelFixtureIdentity(
  fixture: Pick<ModelFixtureResponse, "competitionId" | "fixtureId">
): string {
  return `espn:${fixture.competitionId}:${fixture.fixtureId}`;
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
  stakeObservedAt?: string;
  oddsSources?: Array<{
    source: "kalshi" | "polymarket";
    observedAt?: string;
    pHome: number;
    pDraw: number | null;
    pAway: number;
  }>;
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
    calibrationForecastCount: number;
    forecastsPerFixture: 3;
    calibrationMethod: "one-vs-rest-1x2";
    brierScore: number | null;
    logLoss: number | null;
    winnerAccuracy: number | null;
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
    public status: number,
    public code?: string
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
    const body = await res.json().catch(() => ({ error: res.statusText, code: undefined }));
    throw new ApiError(body.error || `API error ${res.status}`, res.status, body.code);
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

export interface ClubSeasonEvaluationFixture {
  schemaVersion: 1 | 2;
  forecastId: string;
  competitionId: string;
  fixtureId: number;
  utcDate: string;
  date: string;
  stage: string;
  home: string;
  away: string;
  pHome: number;
  pDraw: number;
  pAway: number;
  result: {
    homeScore: number;
    awayScore: number;
    winner: "home" | "draw" | "away";
  } | null;
  method: "snapshot";
}

export interface ClubSeasonEvaluationResponse {
  schemaVersion: 2;
  competitions: string[];
  method: "snapshot";
  builtAt: string;
  updatedAt: string;
  disclaimer: string;
  fixtures: ClubSeasonEvaluationFixture[];
  missedCheckpoints: Array<{
    competitionId: string;
    fixtureId: number;
    utcDate: string;
    home: string;
    away: string;
    checkpointPolicyId: string;
    recordedAt: string;
    reason: "fixture_unpriced" | "no_eligible_pre_kickoff_forecast";
  }>;
  metrics: Omit<Wc2026EvaluationResponse["metrics"], "brierScore" | "logLoss" | "winnerAccuracy"> & {
    brierScore: number | null;
    logLoss: number | null;
    winnerAccuracy: number | null;
  };
  evaluation: {
    metricVersion: "multiclass-v1";
    segments: Array<{
      modelId: string;
      modelVersion: string;
      contributorId: string;
      contributorVersion: string;
      competitionId: string;
      seasonId: string;
      checkpointPolicyId: string;
      ratingSourceState: string;
      sampleCount: number;
      metrics: ClubSeasonEvaluationResponse["metrics"];
    }>;
    exclusions: {
      total: number;
      byReason: {
        legacyPartialProvenance: number;
        incompleteInputProvenance: number;
        postKickoffForecast: number;
        invalidForecastTimestamp: number;
      };
    };
  };
}

export async function getClubSeasonEvaluation() {
  return apiFetch<ClubSeasonEvaluationResponse>("/api/evaluation/club-season");
}

// ─── Ask (conversational match analysis) ────────────────────────────────────

export interface OddsSource {
  source: "kalshi" | "polymarket";
  observedAt?: string;
  pHome: number;
  pDraw: number | null;
  pAway: number;
}

export type OneXTwoOutcome = "home" | "draw" | "away";
export type EdgeBand = "noise" | "thin" | "real" | "fat-and-fragile";
export type RiskBand = "low" | "medium" | "high";

export interface PricingLeg {
  outcome: OneXTwoOutcome;
  modelP: number;
  fairOdds: number;
  decimalOdds: number | null;
  impliedP: number | null;
  evPct: number | null;
}

export interface MarketPricingRow {
  source: string;
  observedAt: string;
  legs: Record<OneXTwoOutcome, PricingLeg>;
  edgeBand: EdgeBand | null;
}

export interface PricingObject {
  fixtureId: string;
  home: string;
  away: string;
  kickoff: string;
  modelVersion: string;
  pricedAt: string;
  model: Record<OneXTwoOutcome, { p: number; fairOdds: number }>;
  markets: MarketPricingRow[];
  userLine: {
    outcome: OneXTwoOutcome;
    decimalOdds: number;
    evPct: number;
    edgeBand: EdgeBand;
    passPrice: number;
    playPrice: number;
    riskBand: RiskBand;
  } | null;
  stakeFrac: null;
}

export interface MatchGrounding {
  kind: "match";
  fixtureId: string;
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
  stakeObservedAt?: string;
  oddsSources: OddsSource[];
  pricing: PricingObject;
}

export type FixtureCapability =
  | { status: "priced"; modelFixtureId: string }
  | { status: "temporarily-unpriced"; reason: "model-initializing" | "ratings-refreshing" }
  | { status: "outside-coverage"; reason: "unsupported-competition" | "friendly-policy-disabled" | "model-policy-disabled" }
  | { status: "insufficient-model-input"; reason: "ratings-unavailable" | "neutral-venue-unknown" | "required-context-missing" };

export interface RecognizedFixture {
  fixtureId: string;
  primarySource: "espn" | "official-competition" | "official-federation" | "official-club";
  primarySourceFixtureId: string;
  homeTeam: { id: string; name: string };
  awayTeam: { id: string; name: string };
  kickoff: string;
  venue: string | null;
  neutralVenue: boolean | null;
  competition: {
    id: string;
    name: string;
    category: "domestic-league" | "domestic-cup" | "club-continental" | "club-friendly" | "international-tournament" | "international-qualifier" | "international-friendly";
  };
  status: "scheduled" | "in-play" | "completed" | "postponed" | "cancelled";
  recognition: "authoritative" | "corroborated";
}

export interface FixtureGrounding {
  kind: "fixture";
  fixture: RecognizedFixture;
  capability: Exclude<FixtureCapability, { status: "priced" }>;
}

export interface RecognizedFixtureSnapshotRow {
  fixture: RecognizedFixture;
  capability: FixtureCapability;
}

export interface RecognizedFixturesResponse {
  registry: {
    enabled: boolean;
    mode: "enabled" | "shadow";
    fixtureCount: number;
    updatedAt: string | null;
    loadedFrom: "empty" | "primary" | "last-good";
    error: string | null;
    storageBlocked: boolean;
  };
  fixtures: RecognizedFixtureSnapshotRow[];
}

export async function getRecognizedFixtures() {
  return apiFetch<RecognizedFixturesResponse>("/api/fixtures/recognized");
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

export interface SeasonGrounding {
  kind: "season";
  competitionId: string;
  competition: string;
  updatedAt: string | null;
  standings: CompetitionGrounding["standings"];
  seasonOutlook: {
    competitionId: string;
    competition: string;
    runs: number;
    titleProbabilities: Array<{ team: string; probability: number }>;
    topFourProbabilities: Array<{ team: string; probability: number }>;
    remainingFixtures: number;
    updatedAt: string;
  };
}

export type AskGrounding = MatchGrounding | FixtureGrounding | CompetitionGrounding | SeasonGrounding | null;

export interface AskCitation {
  id: string;
  title: string;
  url: string;
  date: string;
}

export type ResponseMode =
  | "match-preview"
  | "match-follow-up"
  | "exact-score"
  | "fair-price"
  | "market-comparison"
  | "player-or-scorer"
  | "team-news"
  | "lineup-counterfactual"
  | "table"
  | "season"
  | "coverage"
  | "general";

export interface AskPresentation {
  responseMode: ResponseMode;
  fixtureCard: "expanded" | "compact" | "none";
}

export interface AskResult {
  answer: string;
  grounding: AskGrounding;
  presentation?: AskPresentation;
  citations?: AskCitation[];
  verification: {
    status: "not-required" | "verified" | "conflict" | "abstain" | "unavailable";
    supportedClaimCount: number;
    removedClaimCount: number;
  };
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export type TeamContext = [string, string];
export interface FixtureContext { fixtureId: string }
export interface UserLine {
  outcome: OneXTwoOutcome;
  decimalOdds: number;
}

/**
 * Build a chat deep link while keeping the optional fixture address opaque.
 * The API resolves and validates the identity against its server-owned
 * fixture data; the browser must not infer or trust team details from it.
 * Keep the q-only form byte-compatible with existing shared links.
 */
export function buildAskUrl(question: string, fixtureId?: string): string {
  const query = `q=${encodeURIComponent(question)}`;
  return fixtureId
    ? `/?${query}&fixture=${encodeURIComponent(fixtureId)}`
    : `/?${query}`;
}

export async function askQuestion(
  question: string,
  history: ConversationTurn[] = [],
  teamContext?: TeamContext,
  fixtureContext?: FixtureContext,
  userLine?: UserLine
): Promise<AskResult> {
  return apiFetch<AskResult>("/api/ask", {
    method: "POST",
    body: JSON.stringify({
      question,
      history,
      teamContext,
      fixtureContext,
      ...(userLine ? { userLine } : {}),
    }),
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
  fixtureContext: FixtureContext | undefined,
  userLine: UserLine | undefined,
  handlers: AskStreamHandlers,
  signal?: AbortSignal
): Promise<AskResult> {
  signal?.throwIfAborted();
  const res = await fetch(`${API_URL}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      history,
      teamContext,
      fixtureContext,
      ...(userLine ? { userLine } : {}),
      stream: true,
    }),
    signal,
  });

  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !contentType.includes("text/event-stream") || !res.body) {
    const body = await res.json().catch(() => ({ error: res.statusText, code: undefined }));
    signal?.throwIfAborted();
    throw new ApiError(body.error || `API error ${res.status}`, res.status, body.code);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const onAbort = () => { void reader.cancel(signal?.reason).catch(() => undefined); };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = parseSseChunk(buffer);
      buffer = rest;
      for (const { event, data } of events) {
        signal?.throwIfAborted();
        const payload = JSON.parse(data);
        if (event === "grounding") handlers.onGrounding?.(payload.grounding);
        else if (event === "delta") handlers.onDelta(payload.text);
        else if (event === "done") return payload;
        else if (event === "error") {
          throw new ApiError(
            payload.error,
            typeof payload.status === "number" ? payload.status : 502,
            typeof payload.code === "string" ? payload.code : undefined
          );
        }
      }
    }
    throw new ApiError("Analysis stream ended unexpectedly.", 502);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
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
      ratingsAsOf: string | null;
      ratingsAgeDays: number | null;
      ratingsServedFromCache: boolean;
      ratingArtifactId: string | null;
      ratingArtifactSha256: string | null;
    };
    football: {
      ready: boolean;
      lastUpdated: string | null;
      error: string | null;
      competitionErrors: Record<string, string | null>;
    };
    seasonSchedule: {
      ready: boolean;
      competitionId: string;
      seasonId: string;
      fixtureCount: number;
      lastUpdated: string | null;
      error: string | null;
    };
    activeFixtures: {
      count: number;
      byCompetition: Record<string, number>;
      lastUpdated: string | null;
    };
    askRateLimit: {
      perMinute: number;
      replicas: number;
      perInstance: number;
      scope: "deployment";
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
