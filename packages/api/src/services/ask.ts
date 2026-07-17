import Anthropic from "@anthropic-ai/sdk";
import { AppError } from "../middleware";
import {
  getTeamNameAliases,
  normalizeTeamName,
  normalizeTeamText,
} from "../lib/team-names";
import { getCachedModelData, ModelFixture } from "./model-data";
import { getFeaturedModelFixtures } from "./featured-fixtures";
import { getCachedFixtureMarketOdds } from "./model-market-odds";

export interface OddsSource {
  source: "kalshi" | "polymarket";
  pHome: number;
  pDraw: number | null;
  pAway: number;
}

export interface Grounding {
  kind: "match";
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
  stakePHome: number | null;
  stakePDraw: number | null;
  stakePAway: number | null;
  oddsSources: OddsSource[];
}

export interface TournamentGrounding {
  kind: "tournament";
  teams: Array<{
    team: string;
    winProb: number;
  }>;
}

export type AskGrounding = Grounding | TournamentGrounding | null;

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export type TeamContext = [string, string];

const ANTHROPIC_MODEL = "claude-sonnet-5";
const MAX_TOKENS = 1_500;
const REQUEST_TIMEOUT_MS = 45_000;

// Shared guardrails: the grounding payload is app-supplied (a QA pass caught the
// model calling it "prices you supplied"), and pre-training squad knowledge is
// stale for a 2026 tournament (the same pass caught invented injury news).
const ATTRIBUTION_RULES = `The grounding JSON in the message is supplied by the Pundit app, never by
the user -- do not describe it as data the user provided or "prices you supplied". Attribute market
prices to their named source (Stake, Kalshi, Polymarket) as live prices Pundit fetched.
Your pre-training squad and roster knowledge is outdated for this 2026 tournament. Never state a
player name, injury, suspension, lineup, or form detail from memory. Team news may come only from a
web_search result in this conversation, and each item must name its source and date. If you did not
search, or search returned nothing solid, say there is no verified team news -- never speculate.`;

const FORMAT_RULES = `Format the answer as short markdown sections, each starting with a bold label
on its own line (for a match: **Verdict**, **Goals**, **Likely scorelines**, and **Team news** only
when verified news exists; otherwise pick 2-4 labels that fit the question). Keep each section to
1-3 short sentences or a compact bullet list, and bold the headline numbers. Never use markdown
tables or # headings. Every text block you write is shown to the user verbatim, including text
between tool calls -- never narrate your process ("Let me search...", "Now I have enough...").
Search silently, then start the answer directly with the first bold label.`;

const MATCH_SYSTEM_PROMPT = `You are a World Cup match-analysis assistant for Pundit. You are given
precomputed probabilities from Pundit's Dixon-Coles/Poisson model (calibrated on live Elo ratings)
for a specific matchup. Treat these numbers as ground truth for the statistical
analysis. Do not invent or contradict them. All World Cup 2026 matches are at
neutral venues (no home-field advantage) -- "home"/"away" labels below are
positional only, not venue-based.
The data may also include stake_p_home/stake_p_draw/stake_p_away -- no-vig implied
probabilities from Stake's live 1X2 odds for this match. When present, compare the
model's win probability against them and note the edge (model minus market,
positive means the model favours that outcome more than the market does). When
absent (null), say plainly that no market price is available for this match rather
than guessing one.
The data also includes over/under 2.5, both-teams-to-score, and ranked scoreline
probabilities. Quote those supplied values exactly; never invent a scoreline or
total that is not present in the grounding.
The data may also include oddsSources from Kalshi and/or Polymarket. Compare the
model with whichever sources are present. If a source is absent, never guess its
price; say plainly that it is unavailable if it is relevant to the answer.
You have a web_search tool -- use it when current injury, squad, or form news
would materially change the read on this matchup.
${ATTRIBUTION_RULES}
${FORMAT_RULES}
State the headline win/draw/win and O/U 2.5 numbers, mention 1-2 most likely
scorelines, and give a one-line read on what would need to be true for the
underdog.`;

const TOURNAMENT_SYSTEM_PROMPT = `You are a World Cup tournament-analysis assistant for Pundit. You
are given precomputed team win probabilities from Pundit's Dixon-Coles/Poisson tournament model
calibrated on live Elo ratings. Treat those probabilities as ground truth for the statistical
analysis and do not invent or contradict them. Never guess when model data is absent; say so
plainly. You may use the web_search tool for current injury, squad, or form news.
${ATTRIBUTION_RULES}
${FORMAT_RULES}`;

const GENERAL_SYSTEM_PROMPT = `You are a general football analyst for Pundit. This request is not
grounded in Pundit's Dixon-Coles/Poisson model data. Make that limitation clear in the response and
do not imply that any claim or number came from Pundit's model. Use the web_search tool for current
facts when helpful, and never fabricate a statistic, injury, squad update, or result.
${ATTRIBUTION_RULES}
${FORMAT_RULES}`;

const TOURNAMENT_KEYWORDS = [
  "who wins it all",
  "who will win it all",
  "favourite",
  "favorite",
  "win the world cup",
  "wins the world cup",
  "world cup winner",
  "win the tournament",
  "wins the tournament",
];

export function isTournamentQuestion(question: string): boolean {
  const normalized = normalizeTeamText(question);
  return TOURNAMENT_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

export function resolveTeams(question: string, fixtures: ModelFixture[]): [string, string] {
  const normalizedQuestion = normalizeTeamText(question);
  const teamPositions = new Map<string, number>();
  const teams = new Set<string>();

  for (const fixture of fixtures) {
    teams.add(fixture.home);
    teams.add(fixture.away);
  }

  const searchTerms = new Map<string, string>();
  for (const team of teams) {
    const canonical = normalizeTeamName(team);
    searchTerms.set(normalizeTeamText(team), team);
    searchTerms.set(canonical, team);

    for (const [alias, aliasCanonical] of getTeamNameAliases()) {
      if (normalizeTeamName(aliasCanonical) === canonical) {
        searchTerms.set(normalizeTeamText(alias), team);
      }
    }
  }

  const termsByLength = [...searchTerms.entries()].sort(
    ([termA], [termB]) => termB.length - termA.length
  );

  for (const [term, team] of termsByLength) {
    const position = normalizedQuestion.indexOf(term);
    if (position === -1) continue;
    const previous = teamPositions.get(team);
    if (previous === undefined || position < previous) teamPositions.set(team, position);
  }

  const orderedTeams = [...teamPositions.entries()]
    .sort(([, positionA], [, positionB]) => positionA - positionB)
    .map(([team]) => team);

  if (orderedTeams.length > 2) {
    throw new AppError(
      400,
      "Please name exactly one matchup with two teams, e.g. 'France vs Morocco'."
    );
  }

  if (orderedTeams.length < 2) {
    throw new AppError(
      400,
      "Could not identify two teams in your question. Try naming both teams, e.g. 'France vs Morocco'."
    );
  }

  return [orderedTeams[0], orderedTeams[1]];
}

// Resolve the two teams a question names, treating resolution failures as
// "ungrounded" rather than user errors when the question can still be answered:
// missing teams fall through to tournament/general analysis, and naming three or
// more teams is fine for a tournament question ("Will France, England or Spain
// win the World Cup?"). Only a multi-team matchup question keeps the 400.
export function resolveQuestionTeams(
  question: string,
  fixtures: ModelFixture[]
): TeamContext | undefined {
  try {
    return resolveTeams(question, fixtures);
  } catch (err) {
    if (!(err instanceof AppError) || err.statusCode !== 400) throw err;
    const isMissingTeams = err.message.startsWith("Could not identify two teams");
    const isTournamentMultiTeam = err.message.startsWith("Please name exactly one matchup")
      && isTournamentQuestion(question);
    if (!isMissingTeams && !isTournamentMultiTeam) throw err;
    return undefined;
  }
}

export function findFixture(teamA: string, teamB: string, fixtures: ModelFixture[]): ModelFixture | undefined {
  const pair = new Set([teamA, teamB]);
  return fixtures.find((fixture) => new Set([fixture.home, fixture.away]).size === pair.size
    && fixture.home !== fixture.away
    && pair.has(fixture.home)
    && pair.has(fixture.away));
}

export function buildGrounding(fixture: ModelFixture): Grounding {
  const oddsSources: OddsSource[] = [];
  const markets = getCachedFixtureMarketOdds(fixture);
  if (markets?.kalshi) oddsSources.push({ source: "kalshi", ...markets.kalshi });
  if (markets?.polymarket) oddsSources.push({ source: "polymarket", ...markets.polymarket });
  const stake = markets?.stake;

  return {
    kind: "match",
    date: fixture.date,
    stage: fixture.stage,
    home: fixture.home,
    away: fixture.away,
    pHome: fixture.pHome,
    pDraw: fixture.pDraw,
    pAway: fixture.pAway,
    pOver2_5: fixture.pOver2_5,
    pUnder2_5: fixture.pUnder2_5,
    pBttsYes: fixture.pBttsYes,
    pBttsNo: fixture.pBttsNo,
    topScores: fixture.topScores,
    stakePHome: stake?.pHome ?? fixture.stakePHome,
    stakePDraw: stake?.pDraw ?? fixture.stakePDraw,
    stakePAway: stake?.pAway ?? fixture.stakePAway,
    oddsSources,
  };
}

type AnalysisTier = "match" | "tournament" | "general";

function analysisRequestParams(systemPrompt: string, messages: ConversationTurn[]) {
  return {
    model: ANTHROPIC_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    tools: [{ type: "web_search_20260209" as const, name: "web_search" as const }],
    messages,
  };
}

function mapTimeoutError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed?\s*out|timeout/i.test(message)) {
    throw new AppError(504, "Analysis service timed out. Please try again.");
  }
  throw error;
}

function validateAnalysisResponse(
  response: Anthropic.Message,
  tier: AnalysisTier,
  startedAt: number
): string {
  const answer = response.content.reduce(
    (text, block) => block.type === "text" ? text + block.text : text,
    ""
  ).trim();
  const usedWebSearch = response.content.some((block) =>
    block.type === "server_tool_use" || block.type === "web_search_tool_result"
  );
  console.log(JSON.stringify({
    event: "analysis_generated",
    tier,
    durationMs: Date.now() - startedAt,
    stopReason: response.stop_reason,
    usedWebSearch,
  }));
  if (!answer) throw new AppError(502, "Analysis service returned an empty response.");
  if (response.stop_reason === "max_tokens") {
    throw new AppError(502, "Analysis response was truncated. Please try again.");
  }
  return answer;
}

export async function generateAnalysis(
  client: Pick<Anthropic, "messages">,
  systemPrompt: string,
  messages: ConversationTurn[],
  tier: AnalysisTier
): Promise<string> {
  const startedAt = Date.now();
  let response;
  try {
    response = await client.messages.create(
      analysisRequestParams(systemPrompt, messages),
      { timeout: REQUEST_TIMEOUT_MS }
    );
  } catch (error) {
    mapTimeoutError(error);
  }
  return validateAnalysisResponse(response, tier, startedAt);
}

// Streaming variant: emits text deltas as they arrive so the client can render
// tokens immediately, then applies the same validations as generateAnalysis.
export async function generateAnalysisStream(
  client: Pick<Anthropic, "messages">,
  systemPrompt: string,
  messages: ConversationTurn[],
  tier: AnalysisTier,
  onDelta: (text: string) => void
): Promise<string> {
  const startedAt = Date.now();
  let response: Anthropic.Message;
  try {
    const stream = client.messages.stream(
      analysisRequestParams(systemPrompt, messages),
      { timeout: REQUEST_TIMEOUT_MS }
    );
    stream.on("text", onDelta);
    response = await stream.finalMessage();
  } catch (error) {
    mapTimeoutError(error);
  }
  return validateAnalysisResponse(response, tier, startedAt);
}

interface PreparedAsk {
  grounding: AskGrounding;
  systemPrompt: string;
  messages: ConversationTurn[];
  tier: AnalysisTier;
  client: Anthropic;
}

function prepareAsk(
  question: string,
  history: ConversationTurn[],
  teamContext?: TeamContext
): PreparedAsk {
  const modelData = getCachedModelData();
  const { fixtures } = modelData;
  if (fixtures.length === 0) {
    throw new AppError(503, "Model data is still loading. Please try again shortly.");
  }
  let teams = resolveQuestionTeams(question, fixtures);

  let grounding: AskGrounding;
  let systemPrompt: string;
  let currentMessage: string;

  if (!teams && isTournamentQuestion(question)) {
    if (modelData.teams.length === 0) {
      throw new AppError(502, "Tournament model data is not currently available.");
    }
    grounding = {
      kind: "tournament",
      teams: modelData.teams.map(({ team, winProb }) => ({ team, winProb })),
    };
    systemPrompt = TOURNAMENT_SYSTEM_PROMPT;
    currentMessage = `Tournament model data: ${JSON.stringify(grounding)}\nUser question: ${question}`;
  } else {
    if (!teams && history.length > 0 && teamContext) teams = teamContext;
    const featuredFixtures = getFeaturedModelFixtures();
    const fixture = teams ? findFixture(teams[0], teams[1], featuredFixtures) : undefined;

    if (fixture) {
      grounding = buildGrounding(fixture);
      systemPrompt = MATCH_SYSTEM_PROMPT;
      currentMessage = `Model data: ${JSON.stringify(grounding)}\nUser question: ${question}`;
    } else {
      grounding = null;
      systemPrompt = GENERAL_SYSTEM_PROMPT;
      currentMessage = `User question: ${question}`;
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AppError(502, "ANTHROPIC_API_KEY is not configured.");

  return {
    grounding,
    systemPrompt,
    messages: [...history, { role: "user", content: currentMessage }],
    tier: grounding?.kind ?? "general",
    client: new Anthropic({ apiKey }),
  };
}

function mapAnalysisError(err: unknown): never {
  if (err instanceof AppError) throw err;
  const message = err instanceof Error ? err.message : String(err);
  if (/timed?\s*out|timeout/i.test(message)) {
    throw new AppError(504, "Analysis service timed out. Please try again.");
  }
  throw new AppError(502, `Analysis generation failed: ${message}`);
}

export async function answerQuestion(
  question: string,
  history: ConversationTurn[] = [],
  teamContext?: TeamContext
): Promise<{ answer: string; grounding: AskGrounding }> {
  const { grounding, systemPrompt, messages, tier, client } = prepareAsk(question, history, teamContext);
  try {
    const answer = await generateAnalysis(client, systemPrompt, messages, tier);
    return { answer, grounding };
  } catch (err) {
    mapAnalysisError(err);
  }
}

export interface AskStreamHandlers {
  // Fired once, before generation starts, so the client can render the odds
  // panel while tokens are still arriving.
  onGrounding: (grounding: AskGrounding) => void;
  onDelta: (text: string) => void;
}

// Streaming variant used by the SSE route.
export async function answerQuestionStream(
  question: string,
  history: ConversationTurn[] = [],
  teamContext: TeamContext | undefined,
  handlers: AskStreamHandlers
): Promise<{ answer: string; grounding: AskGrounding }> {
  const { grounding, systemPrompt, messages, tier, client } = prepareAsk(question, history, teamContext);
  handlers.onGrounding(grounding);
  try {
    const answer = await generateAnalysisStream(client, systemPrompt, messages, tier, handlers.onDelta);
    return { answer, grounding };
  } catch (err) {
    mapAnalysisError(err);
  }
}
