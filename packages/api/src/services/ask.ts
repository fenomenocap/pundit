import Anthropic from "@anthropic-ai/sdk";
import { getCompetitionById } from "../config/competitions";
import { AppError } from "../middleware";
import {
  getTeamNameAliases,
  normalizeTeamName,
  normalizeTeamText,
} from "../lib/team-names";
import {
  getCachedModelData,
  ModelFixture,
} from "./model-data";
import { getCachedMatches, FootballStanding } from "./football-data";
import { getActiveFixtures } from "./active-fixtures";
import { getCachedFixtureMarketOdds } from "./model-market-odds";

export interface OddsSource {
  source: "kalshi" | "polymarket";
  pHome: number;
  pDraw: number | null;
  pAway: number;
}

export interface Grounding {
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

export type AskGrounding = Grounding | CompetitionGrounding | null;

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export type TeamContext = [string, string];
export type AnalysisTier = "match" | "competition" | "general";

export type ResolvedAskContext =
  | { tier: "match"; fixture: ModelFixture }
  | { tier: "competition"; competitionId: string }
  | { tier: "model-unavailable"; teams: TeamContext }
  | { tier: "general" };

type TeamFixture = Pick<ModelFixture, "home" | "away">;

const ANTHROPIC_MODEL = "claude-sonnet-5";
const MAX_TOKENS = 4_096;
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_CONTINUATIONS = 5;
const OVERALL_DEADLINE_MS = 240_000;

const ATTRIBUTION_RULES = `The grounding JSON in the message is supplied by the Pundit app, never by
the user -- do not describe it as data the user provided or "prices you supplied". Attribute market
prices to their named source (Stake, Kalshi, Polymarket) as live prices Pundit fetched.
Your pre-training squad and roster knowledge may be outdated. Never state a
player name, injury, suspension, lineup, or form detail from memory. Team news may come only from a
web_search result in this conversation, and each item must name its source and date. If you did not
search, or search returned nothing solid, say there is no verified team news -- never speculate.
Do not name internal methodology (Dixon-Coles, Poisson, Elo, ClubElo, eloratings.net, or similar)
in user-facing answers -- say "Pundit's model" or "the model" instead.`;

const FORMAT_RULES = `Format the answer as short markdown sections, each starting with a bold label
on its own line (for a match: **Verdict**, **Goals**, **Likely scorelines**, and **Team news** only
when verified news exists; otherwise pick 2-4 labels that fit the question). Keep each section to
1-3 short sentences or a compact bullet list, and bold the headline numbers. Never use markdown
tables or # headings. Every text block you write is shown to the user verbatim, including text
between tool calls -- never narrate your process ("Let me search...", "Now I have enough...").
Search silently, then start the answer directly with the first bold label.
Never reproduce raw JSON, field names, or key-value syntax from the grounding data in your answer --
express its values as plain prose and percentages (write "2.26%", not {"score":"2-3","probability":0.0226}).`;

const MATCH_SYSTEM_PROMPT = `You are a club-football match-analysis assistant for Pundit. You are given
precomputed probabilities from Pundit's match model for a specific matchup. Treat these numbers as ground truth for the statistical
analysis. Do not invent or contradict them. When homeFieldAdvantage is true, the model applies a
home-field boost to the home side before computing probabilities -- mention that when relevant.
The data may include oddsSources -- no-vig implied 1X2 probabilities from live
market prices (Kalshi and/or Polymarket). Compare the model's win probability
against whichever sources are present and note the edge (model minus market,
positive means the model favours that outcome more than the market does). It may
also include stakePHome/stakePDraw/stakePAway from Stake, though those are often
absent (null) -- when a source is absent, never guess its price; if no market
source is present at all, say plainly that no market line is available.
The data also includes over/under 2.5, both-teams-to-score, topScores (the
top-ranked scorelines), and scorelines (every scoreline at or above a 0.1%
probability). Quote those supplied values exactly; a score missing from the
scorelines list has a probability below 0.1% -- say that rather than refusing
or inventing a number.
You have a web_search tool -- use it when current injury, squad, or form news
would materially change the read on this matchup.
For player-level questions (goalscorer, assists, cards, player props), Pundit's
model has no player data -- say so briefly, then use web_search for current
player-prop odds and player news, and present anything found as market- or
search-sourced with its source and date, never as Pundit model output. If search
returns nothing solid, say no verified player data is available.
${ATTRIBUTION_RULES}
${FORMAT_RULES}
State the headline win/draw/win and O/U 2.5 numbers, mention 1-2 most likely
scorelines, and give a one-line read on what would need to be true for the
underdog.`;

const COMPETITION_SYSTEM_PROMPT = `You are a club-football competition-analysis assistant for Pundit.
You are given the current league or cup standings table from ESPN for a specific competition.
Treat those standings as ground truth for table position, points, and games played. Do not invent
or contradict them. Pre-season tables may show all zeros -- say so plainly rather than guessing form.
You may use the web_search tool for current transfer, injury, or manager news that would change the
title or qualification picture, but do not search merely to re-verify the supplied table.
For historical World Cup 2026 questions, note that Pundit's frozen backtest lives at /evaluation/wc-2026
and this payload does not include WC title probabilities.
${ATTRIBUTION_RULES}
${FORMAT_RULES}`;

const GENERAL_SYSTEM_PROMPT = `You are a general football analyst for Pundit. This request is not
grounded in Pundit's model data. Make that limitation clear in the response and
do not imply that any claim or number came from Pundit's model. Use the web_search tool for current
facts when helpful, and never fabricate a statistic, injury, squad update, or result.
For historical World Cup 2026 backtest statistics, you may mention Pundit's frozen evaluation at
/evaluation/wc-2026 but do not invent numbers from it unless search returns them.
For player-level questions (goalscorer, assists, cards, player props), use web_search for current
player-prop odds and player news, and present anything found as market- or search-sourced with its
source and date. If search returns nothing solid, say no verified player data is available.
${ATTRIBUTION_RULES}
${FORMAT_RULES}`;

const COMPETITION_KEYWORDS: ReadonlyArray<{ competitionId: string; keywords: string[] }> = [
  {
    competitionId: "eng.1",
    keywords: [
      "premier league",
      "pl title",
      "epl",
      "english league",
      "top of the table",
      "title race",
      "who wins the league",
      "who will win the league",
      "league winner",
      "win the premier league",
      "wins the premier league",
      "relegation",
      "top four",
      "top 4",
      "champions league spot",
    ],
  },
  {
    competitionId: "uefa.champions_qual",
    keywords: [
      "champions league qual",
      "ucl qual",
      "qualifying round",
      "qualification tie",
    ],
  },
];

export function resolveCompetitionQuestion(question: string): string | undefined {
  const normalized = normalizeTeamText(question);
  for (const entry of COMPETITION_KEYWORDS) {
    if (entry.keywords.some((keyword) => normalized.includes(keyword))) {
      return entry.competitionId;
    }
  }
  return undefined;
}

export function isCompetitionQuestion(question: string): boolean {
  return resolveCompetitionQuestion(question) !== undefined;
}

const COMPETITION_FOLLOW_UP_CUES = [
  "that table",
  "that standing",
  "those standings",
  "that ranking",
  "those rankings",
  "that race",
  "top of the table",
  "title race",
  "the league",
  "premier league",
];

function hasCompetitionFollowUpCue(question: string): boolean {
  const normalized = normalizeTeamText(question);
  return COMPETITION_FOLLOW_UP_CUES.some((cue) => normalized.includes(cue));
}

export function resolveCompetitionContext(
  question: string,
  history: ConversationTurn[]
): string | undefined {
  const explicitCompetitionId = resolveCompetitionQuestion(question);
  if (explicitCompetitionId) return explicitCompetitionId;
  if (!hasCompetitionFollowUpCue(question)) return undefined;

  return history
    .filter(({ role }) => role === "user")
    .map(({ content }) => resolveCompetitionQuestion(content))
    .reverse()
    .find((competitionId): competitionId is string => competitionId !== undefined);
}

export function shouldUseCompetitionGrounding(
  question: string,
  history: ConversationTurn[]
): boolean {
  return resolveCompetitionContext(question, history) !== undefined;
}

const MATCHUP_CUE_PATTERNS = [
  /\b(?:vs|v)\b\.?/,
  /\bagainst\b/,
  /\bmatch(?:up)?\b/,
  /\bfixture\b/,
  /\bgame\b/,
  /\b(?:beat|beats|defeat|defeats)\b/,
];

function hasExplicitMatchupCue(question: string): boolean {
  const normalized = normalizeTeamText(question);
  return MATCHUP_CUE_PATTERNS.some((pattern) => pattern.test(normalized));
}

const MATCH_FOLLOW_UP_CUES = [
  "that match",
  "the match",
  "that game",
  "the game",
  "those teams",
  "either team",
  "home side",
  "away side",
  "the draw",
  "draw chance",
  "win chance",
  "over 2.5",
  "under 2.5",
  "btts",
  "both teams to score",
  "scoreline",
  "score line",
  "goals",
  "the odds",
  "market price",
  "the edge",
  "the underdog",
  "the favourite",
  "the favorite",
  "team news",
  "injury",
  "lineup",
  "what about them",
];

export function shouldUseMatchGrounding(question: string): boolean {
  const normalized = normalizeTeamText(question);
  return MATCH_FOLLOW_UP_CUES.some((cue) => normalized.includes(cue));
}

export function resolveTeams(question: string, fixtures: TeamFixture[]): [string, string] {
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
      "Please name exactly one matchup with two teams, e.g. 'Arsenal vs Liverpool'."
    );
  }

  if (orderedTeams.length < 2) {
    throw new AppError(
      400,
      "Could not identify two teams in your question. Try naming both teams, e.g. 'Arsenal vs Liverpool'."
    );
  }

  return [orderedTeams[0], orderedTeams[1]];
}

export function resolveQuestionTeams(
  question: string,
  fixtures: TeamFixture[]
): TeamContext | undefined {
  try {
    return resolveTeams(question, fixtures);
  } catch (err) {
    if (!(err instanceof AppError) || err.statusCode !== 400) throw err;
    const isMissingTeams = err.message.startsWith("Could not identify two teams");
    const isCompetitionMultiTeam = err.message.startsWith("Please name exactly one matchup")
      && isCompetitionQuestion(question);
    if (!isMissingTeams && !isCompetitionMultiTeam) throw err;
    return undefined;
  }
}

export function findFixture<T extends TeamFixture>(
  teamA: string,
  teamB: string,
  fixtures: T[]
): T | undefined {
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
  const competition = getCompetitionById(fixture.competitionId);

  return {
    kind: "match",
    competitionId: fixture.competitionId,
    competition: fixture.competition,
    homeFieldAdvantage: competition?.homeFieldAdvantage ?? false,
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
    scorelines: fixture.scorelines,
    stakePHome: stake?.pHome ?? fixture.stakePHome,
    stakePDraw: stake?.pDraw ?? fixture.stakePDraw,
    stakePAway: stake?.pAway ?? fixture.stakePAway,
    oddsSources,
  };
}

export function buildCompetitionGrounding(
  competitionId: string,
  standings: FootballStanding[],
  lastUpdated: Date | null
): CompetitionGrounding {
  const competition = getCompetitionById(competitionId);
  const rows = standings
    .filter((row) => row.competitionId === competitionId)
    .sort((a, b) => a.position - b.position)
    .slice(0, 20)
    .map((row) => ({
      position: row.position,
      team: row.team,
      playedGames: row.playedGames,
      points: row.points,
      goalDifference: row.goalDifference,
    }));
  return {
    kind: "competition",
    competitionId,
    competition: competition?.name ?? competitionId,
    updatedAt: lastUpdated?.toISOString() ?? null,
    standings: rows,
  };
}

export function resolveAskContext(
  question: string,
  history: ConversationTurn[],
  teamContext: TeamContext | undefined,
  fixtures: ModelFixture[],
  standings: FootballStanding[],
  activeFixtures: TeamFixture[] = []
): ResolvedAskContext {
  const teams = resolveQuestionTeams(question, fixtures);
  const explicitFixture = teams ? findFixture(teams[0], teams[1], fixtures) : undefined;
  const competitionId = resolveCompetitionContext(question, history);

  if (explicitFixture && (!competitionId || hasExplicitMatchupCue(question))) {
    return { tier: "match", fixture: explicitFixture };
  }

  if (competitionId && standings.some((row) => row.competitionId === competitionId)) {
    return { tier: "competition", competitionId };
  }

  if (!competitionId) {
    const activeTeams = resolveQuestionTeams(question, activeFixtures);
    const activeFixture = activeTeams
      ? findFixture(activeTeams[0], activeTeams[1], activeFixtures)
      : undefined;
    if (activeFixture) {
      return { tier: "model-unavailable", teams: [activeFixture.home, activeFixture.away] };
    }
  }

  if (!teams && !competitionId && teamContext && shouldUseMatchGrounding(question)) {
    const contextualFixture = findFixture(teamContext[0], teamContext[1], fixtures);
    if (contextualFixture) return { tier: "match", fixture: contextualFixture };
    const activeFixture = findFixture(teamContext[0], teamContext[1], activeFixtures);
    if (activeFixture) {
      return { tier: "model-unavailable", teams: [activeFixture.home, activeFixture.away] };
    }
  }

  return { tier: "general" };
}

function analysisRequestParams(systemPrompt: string, messages: Anthropic.MessageParam[]) {
  return {
    model: ANTHROPIC_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    tools: [{ type: "web_search_20260209" as const, name: "web_search" as const }],
    messages,
  };
}

function toMessageParams(messages: ConversationTurn[]): Anthropic.MessageParam[] {
  return messages.map(({ role, content }) => ({ role, content }));
}

function mapTimeoutError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed?\s*out|timeout/i.test(message)) {
    throw new AppError(504, "Analysis service timed out. Please try again.");
  }
  throw error;
}

function validateAnalysisResponse(
  responses: Anthropic.Message[],
  tier: AnalysisTier,
  startedAt: number
): string {
  const blocks = responses.flatMap((response) => response.content);
  const answer = blocks.reduce(
    (text, block) => block.type === "text" ? text + block.text : text,
    ""
  ).trim();
  const usedWebSearch = blocks.some((block) =>
    block.type === "server_tool_use" || block.type === "web_search_tool_result"
  );
  const stopReason = responses.at(-1)?.stop_reason ?? null;
  console.log(JSON.stringify({
    event: "analysis_generated",
    tier,
    durationMs: Date.now() - startedAt,
    stopReason,
    usedWebSearch,
    continuations: responses.length - 1,
  }));
  if (!answer) throw new AppError(502, "Analysis service returned an empty response.");
  if (stopReason === "max_tokens") {
    throw new AppError(502, "Analysis response was truncated. Please try again.");
  }
  return answer;
}

function appendPausedTurn(
  convo: Anthropic.MessageParam[],
  response: Anthropic.Message
): Anthropic.MessageParam[] {
  return [...convo, { role: "assistant", content: response.content as Anthropic.ContentBlockParam[] }];
}

export async function generateAnalysis(
  client: Pick<Anthropic, "messages">,
  systemPrompt: string,
  messages: ConversationTurn[],
  tier: AnalysisTier
): Promise<string> {
  const startedAt = Date.now();
  const collected: Anthropic.Message[] = [];
  let convo = toMessageParams(messages);
  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn += 1) {
    if (turn > 0 && Date.now() - startedAt > OVERALL_DEADLINE_MS) break;
    let response;
    try {
      response = await client.messages.create(
        analysisRequestParams(systemPrompt, convo),
        { timeout: REQUEST_TIMEOUT_MS }
      );
    } catch (error) {
      mapTimeoutError(error);
    }
    collected.push(response);
    if (response.stop_reason !== "pause_turn") break;
    convo = appendPausedTurn(convo, response);
  }
  if (collected.at(-1)?.stop_reason === "pause_turn") {
    throw new AppError(504, "Analysis service timed out. Please try again.");
  }
  return validateAnalysisResponse(collected, tier, startedAt);
}

const RETRYABLE_STATUS = new Set([408, 429, 529]);

function isRetryableStreamError(error: unknown): boolean {
  if (error instanceof Anthropic.APIConnectionError) return true;
  return error instanceof Anthropic.APIError
    && typeof error.status === "number"
    && (RETRYABLE_STATUS.has(error.status) || error.status >= 500);
}

export async function generateAnalysisStream(
  client: Pick<Anthropic, "messages">,
  systemPrompt: string,
  messages: ConversationTurn[],
  tier: AnalysisTier,
  onDelta: (text: string) => void,
  shouldContinue: () => boolean = () => true
): Promise<string> {
  const startedAt = Date.now();
  const collected: Anthropic.Message[] = [];
  let convo = toMessageParams(messages);
  let anyDeltaSeen = false;
  const abort = new AbortController();
  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn += 1) {
    if (!shouldContinue()) {
      abort.abort();
      throw new AppError(499, "Client disconnected.");
    }
    if (turn > 0 && Date.now() - startedAt > OVERALL_DEADLINE_MS) break;
    let response: Anthropic.Message | undefined;
    let retried = false;
    while (response === undefined) {
      if (!shouldContinue()) {
        abort.abort();
        throw new AppError(499, "Client disconnected.");
      }
      let deltaSeen = false;
      try {
        const stream = client.messages.stream(
          analysisRequestParams(systemPrompt, convo),
          { timeout: REQUEST_TIMEOUT_MS, signal: abort.signal }
        );
        stream.on("text", (text) => {
          if (!shouldContinue()) {
            abort.abort();
            return;
          }
          deltaSeen = true;
          anyDeltaSeen = true;
          onDelta(text);
        });
        response = await stream.finalMessage();
      } catch (error) {
        if (!shouldContinue()) throw new AppError(499, "Client disconnected.");
        if (deltaSeen || anyDeltaSeen || retried || !isRetryableStreamError(error)) {
          mapTimeoutError(error);
        }
        retried = true;
      }
    }
    collected.push(response);
    if (response.stop_reason !== "pause_turn") break;
    convo = appendPausedTurn(convo, response);
  }
  if (collected.at(-1)?.stop_reason === "pause_turn") {
    throw new AppError(504, "Analysis service timed out. Please try again.");
  }
  return validateAnalysisResponse(collected, tier, startedAt);
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
  const football = getCachedMatches();
  const activeFixtures = getActiveFixtures().map((fixture) => ({
    home: fixture.homeTeam,
    away: fixture.awayTeam,
  }));
  const context = resolveAskContext(
    question,
    history,
    teamContext,
    fixtures,
    football.standings,
    activeFixtures
  );

  if (context.tier === "model-unavailable") {
    throw new AppError(
      503,
      `Pundit's match model is temporarily unavailable for ${context.teams[0]} vs ${context.teams[1]}. Please try again shortly.`,
      "MODEL_UNAVAILABLE"
    );
  }

  let grounding: AskGrounding;
  let systemPrompt: string;
  let currentMessage: string;

  if (context.tier === "competition") {
    grounding = buildCompetitionGrounding(
      context.competitionId,
      football.standings,
      football.lastUpdated
    );
    systemPrompt = COMPETITION_SYSTEM_PROMPT;
    currentMessage = `Competition standings: ${JSON.stringify(grounding)}\nUser question: ${question}`;
  } else if (context.tier === "match") {
    grounding = buildGrounding(context.fixture);
    systemPrompt = MATCH_SYSTEM_PROMPT;
    currentMessage = `Model data: ${JSON.stringify(grounding)}\nUser question: ${question}`;
  } else {
    grounding = null;
    systemPrompt = GENERAL_SYSTEM_PROMPT;
    currentMessage = `User question: ${question}`;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AppError(502, "Analysis service is temporarily unavailable.");

  return {
    grounding,
    systemPrompt,
    messages: [...history, { role: "user", content: currentMessage }],
    tier: grounding?.kind ?? "general",
    client: new Anthropic({ apiKey, maxRetries: 2 }),
  };
}

function mapAnalysisError(err: unknown): never {
  if (err instanceof AppError) throw err;
  const message = err instanceof Error ? err.message : String(err);
  if (/timed?\s*out|timeout/i.test(message)) {
    throw new AppError(504, "Analysis service timed out. Please try again.");
  }
  if (err instanceof Anthropic.APIError && err.status === 429) {
    throw new AppError(429, "Analysis service is busy right now. Please try again in a moment.");
  }
  console.error(JSON.stringify({
    event: "analysis_failed",
    message: message.slice(0, 500),
    status: err instanceof Anthropic.APIError ? err.status : undefined,
  }));
  throw new AppError(502, "Analysis generation failed. Please try again.");
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
  onGrounding: (grounding: AskGrounding) => void;
  onDelta: (text: string) => void;
  shouldContinue?: () => boolean;
}

export async function answerQuestionStream(
  question: string,
  history: ConversationTurn[] = [],
  teamContext: TeamContext | undefined,
  handlers: AskStreamHandlers
): Promise<{ answer: string; grounding: AskGrounding }> {
  const { grounding, systemPrompt, messages, tier, client } = prepareAsk(question, history, teamContext);
  handlers.onGrounding(grounding);
  try {
    const answer = await generateAnalysisStream(
      client,
      systemPrompt,
      messages,
      tier,
      handlers.onDelta,
      handlers.shouldContinue ?? (() => true)
    );
    return { answer, grounding };
  } catch (err) {
    mapAnalysisError(err);
  }
}
