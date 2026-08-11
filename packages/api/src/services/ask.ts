// Pundit's chat backend runs on MiniMax, not Anthropic. The Anthropic SDK is
// retained deliberately as the wire client: MiniMax publishes an
// Anthropic-compatible endpoint, so this keeps the message/stream/error types
// and the retry classification below working unchanged. Do not "correct" this
// to an Anthropic model or key -- see MINIMAX_BASE_URL.
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
import { getCachedClubRatings } from "./club-ratings";
import { searchWeb } from "./web-search";
import {
  isSeasonOutlookQuestion,
  remainingScheduledFixtures,
  simulateSeasonOutlook,
  SeasonOutlook,
  SEASON_QUESTION_PATTERNS,
} from "./season-simulator";

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

export interface SeasonGrounding {
  kind: "season";
  competitionId: string;
  competition: string;
  updatedAt: string | null;
  standings: CompetitionGrounding["standings"];
  seasonOutlook: SeasonOutlook;
}

export type AskGrounding = Grounding | CompetitionGrounding | SeasonGrounding | null;

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export type TeamContext = [string, string];
export type AnalysisTier = "match" | "competition" | "season" | "general";

export type ResolvedAskContext =
  | { tier: "match"; fixture: ModelFixture }
  | { tier: "competition"; competitionId: string }
  | { tier: "season"; competitionId: string }
  | { tier: "model-unavailable"; teams: TeamContext }
  | { tier: "general" };

type TeamFixture = Pick<ModelFixture, "home" | "away">;

// The date field matters: ATTRIBUTION_RULES makes the model name a source and
// date for every team-news claim, and web-search.ts normalizes what the search
// backend returns into ISO form or "".
const WEB_SEARCH_TOOL = {
  name: "web_search" as const,
  description:
    "Search the web for current football information: transfers, injuries, "
    + "manager changes, team news, player form and recent results. Returns a "
    + "JSON array of {title, link, snippet, date}, where date is ISO "
    + "yyyy-mm-dd or empty when the source published none. Never cite a date "
    + "that is not present in these results.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string" as const,
        description: "The search query.",
      },
    },
    required: ["query"],
  },
};

const MINIMAX_MODEL = process.env.MINIMAX_MODEL ?? "MiniMax-M3";
// The international host. Keys are region-scoped: a key issued for mainland
// China authenticates only against https://api.minimaxi.com/anthropic, so that
// deployment overrides this rather than editing the default.
const MINIMAX_BASE_URL =
  process.env.MINIMAX_BASE_URL ?? "https://api.minimax.io/anthropic";
const MAX_TOKENS = 4_096;
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_CONTINUATIONS = 5;
const OVERALL_DEADLINE_MS = 240_000;

const ATTRIBUTION_RULES = `The grounding JSON in the message is supplied by the Pundit app, never by
the user -- do not describe it as data the user provided or "prices you supplied". Attribute market
prices to their named source (Stake, Kalshi, Polymarket) as live prices Pundit fetched.
Every team-news claim -- player, injury, suspension, lineup, availability, form -- must come from a
web_search result in this conversation and name its source and date. Your pre-training squad
knowledge is outdated, so searching is how you answer these, not a fallback for when you cannot.
Where a search genuinely returns nothing on a specific point, say so for that point and carry on
with the rest of the answer; do not let one unresolved detail become a blanket refusal to report
team news.
"No injury concerns" is itself a team-news claim and needs the same dated source. A preview that
simply does not mention a player is not evidence that the player is available.
Check each result's date against today's date before using it. A result more than about two months
old is history, not team news -- either say plainly that it is the most recent thing found and give
its date, or leave the point unresolved; never present it as the current situation. A result with no
date cannot support a dated claim, so do not invent a date for it or imply it is recent. Prefer
football news outlets and club sources over social posts and video listings, which are frequently
undated or recycled.
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

export const MATCH_ANSWER_GUARDS = `The match grounding describes this fixture only, not the state of
an aggregate tie. Even if web search finds a first-leg result, do not calculate or state which
current-leg scorelines advance, eliminate, level the aggregate, or force extra time unless aggregate
context is supplied as a structured grounding field. You may report a verified first-leg result with
its source and date, but say that aggregate advancement is outside this model payload.
The scorelines array is the complete set at or above 0.1%. Never claim that a scoreline you merely
omitted from your prose is below 0.1%; check that exact score against the full scorelines array first.
Do not generalize from topScores or from the 1-2 scorelines you choose to mention.
The grounding does not decompose why the probabilities differ. You may say home-field advantage is
applied when homeFieldAdvantage is true, but never say it entirely causes the edge, quantify its
contribution, or invent attacking, defensive, form, or team-strength drivers that are not supplied.
For knockout or qualifier fixtures, use win/draw/loss language only. Never describe an outcome as
earning, sharing, taking, or securing league points.`;

// Match grounding is retained across a conversation on purpose: dropping it on a
// bare follow-up ("Why?") sent the turn to the general tier, whose prompt then
// disclaimed model data the user could see on screen. Retention means the
// grounding also rides along on turns that have nothing to do with the fixture,
// so the scoping is done here in the prompt rather than by routing keywords --
// a cue list cannot anticipate real phrasings, and the failure it produces
// (a genuine follow-up getting a hedged non-answer) is far worse than the one it
// fixes. Hence the deliberate asymmetry below: anything arguably about the match
// is answered from the grounding, and only a plainly unrelated question is
// answered without it.
export const MATCH_QUESTION_SCOPE = `The fixture grounding is attached to every turn in this
conversation, including turns that are not about the fixture. Answer the question the user actually
asked. Anything that bears on this matchup counts as a question about it, however short or indirect
-- "Why?", "Tell me more", "Is that a good bet?", "the underdog", a question about either club, or
anything that follows on from your previous answer. Read those as questions about this fixture and
answer them in full from the grounding; never tell the user you have no model data for this matchup.
Only when a question is plainly about something else -- a different match, era or competition, a
rule or concept of the game in general, a non-football topic -- answer that question on its own
terms, leave the fixture data out instead of steering back to the matchup, and say briefly that the
answer does not come from Pundit's model. When it is unclear which of the two a question is, treat
it as a question about the fixture.`;

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
You have a web_search tool. Search before answering whenever the question touches
injuries, suspensions, lineups, availability, form, transfers, or a recent result.
For a specific fixture that information materially changes the read, so treat
searching as the way you answer those questions rather than an optional extra.
Search again if the first query comes back thin, and search silently.
For player-level questions (goalscorer, assists, cards, player props), Pundit's
model has no player data -- say so briefly, then use web_search for current
player-prop odds and player news, and present anything found as market- or
search-sourced with its source and date, never as Pundit model output. If search
returns nothing solid, say no verified player data is available.
${MATCH_QUESTION_SCOPE}
${MATCH_ANSWER_GUARDS}
${ATTRIBUTION_RULES}
${FORMAT_RULES}
Whenever the answer covers this fixture, state the headline win/draw/win and
O/U 2.5 numbers, mention 1-2 most likely scorelines, and give a one-line read on
what would need to be true for the underdog.`;

const COMPETITION_SYSTEM_PROMPT = `You are a club-football competition-analysis assistant for Pundit.
You are given the current league or cup standings table from ESPN for a specific competition.
Treat those standings as ground truth for table position, points, and games played. Do not invent
or contradict them. Pre-season tables may show all zeros -- say so plainly rather than guessing form.
Do not infer why equally ranked rows appear in their supplied order. Never call the order alphabetical,
placeholder, default-sorted, or an ordering artifact unless that mechanism is an explicit field.
You may use the web_search tool for current transfer, injury, or manager news that would change the
title or qualification picture, but do not search merely to re-verify the supplied table.
For historical World Cup 2026 questions, note that Pundit's frozen backtest lives at /evaluation/wc-2026
and this payload does not include WC title probabilities.
${ATTRIBUTION_RULES}
${FORMAT_RULES}`;

const SEASON_SYSTEM_PROMPT = `You are a club-football season-outlook assistant for Pundit.
You are given the current league standings from ESPN plus Monte Carlo title and top-four
probabilities from Pundit's remaining-fixture simulation. Treat those numbers as ground truth.
Do not invent or contradict them. Explain that the outlook simulates the rest of the season from
the current table and scheduled fixtures (~10,000 runs). Pre-season tables with all zeros should
be described plainly. Do not infer why equally ranked rows appear in their supplied order. Never
call the order alphabetical, placeholder, default-sorted, or an ordering artifact unless that
mechanism is an explicit field. You may use web_search for transfer, injury, or manager news that would
change the picture, but do not search merely to re-verify the supplied table or probabilities.
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

const COMPETITION_KEYWORDS: ReadonlyArray<{
  competitionId: string;
  keywords: Array<string | RegExp>;
}> = [
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
      // The season tier is only reachable through eng.1, so every phrasing the
      // outlook recognises has to resolve a competition here too. Sharing the
      // patterns keeps the two lists from drifting apart, which is how
      // "Who gets relegated?" ended up in a different tier from
      // "Relegation battle?".
      ...SEASON_QUESTION_PATTERNS,
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
    if (entry.keywords.some((keyword) => (typeof keyword === "string"
      ? normalized.includes(keyword)
      : keyword.test(normalized)))) {
      return entry.competitionId;
    }
  }
  return undefined;
}

export function isCompetitionQuestion(question: string): boolean {
  return resolveCompetitionQuestion(question) !== undefined;
}

// A question about the table or the standings asks for rows the match payload
// does not contain, so it has to reach competition grounding even mid-match --
// while following a fixture, "How's the table looking?" and "Who's top right
// now?" were held by match retention and answered from a payload with no
// standings in it at all.
const LEAGUE_TABLE_CUES = [
  "the table",
  "the standings",
  "the ranking",
  "the rankings",
  "league table",
  "league position",
  "in the standings",
  "top of the league",
  "who's top",
  "whos top",
  "who is top",
];

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
  ...LEAGUE_TABLE_CUES,
];

function hasCompetitionFollowUpCue(question: string): boolean {
  const normalized = normalizeTeamText(question);
  return COMPETITION_FOLLOW_UP_CUES.some((cue) => normalized.includes(cue));
}

function hasLeagueTableCue(question: string): boolean {
  const normalized = normalizeTeamText(question);
  return LEAGUE_TABLE_CUES.some((cue) => normalized.includes(cue));
}

export function resolveCompetitionContext(
  question: string,
  history: ConversationTurn[]
): string | undefined {
  const explicitCompetitionId = resolveCompetitionQuestion(question);
  if (explicitCompetitionId) return explicitCompetitionId;
  if (!hasCompetitionFollowUpCue(question)) return undefined;

  const historyCompetitionId = history
    .filter(({ role }) => role === "user")
    .map(({ content }) => resolveCompetitionQuestion(content))
    .reverse()
    .find((competitionId): competitionId is string => competitionId !== undefined);
  if (historyCompetitionId) return historyCompetitionId;

  // A bare table question with no competition in view still has one sensible
  // answer: of the two competitions Pundit covers, only the league has a table
  // -- the qualifiers are ties, not rows. Falling back to it is what lets a
  // standings question asked mid-match be answered instead of retained.
  return hasLeagueTableCue(question) ? "eng.1" : undefined;
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
  "that edge",
  "model case",
  "model input",
  "which side",
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

// Questions that have plainly left the followed match: standalone football
// explainers, methodology, and all-time/global trivia.
const MATCH_CONTEXT_EXIT_PATTERNS = [
  /\bexplain how\b/,
  /\bhow does a\b/,
  /\bhow do (?:teams|players|managers|clubs)\b/,
  /\bwhat is a\b/,
  /\bin general\b/,
  /\bhow (?:does|do) (?:your|the) model(?:s)? work\b/,
  /\bbest (?:player|striker|keeper|goalkeeper|manager|team) in the (?:world|league|country)\b/,
  /\bhistory of\b/,
  /\ball[- ]time\b/,
  /\bof all time\b/,
];

function mentionsTeamOutsideContext(
  question: string,
  teamContext: TeamContext,
  fixtures: TeamFixture[]
): boolean {
  const pair = new Set<string>(teamContext);
  return [...mentionedTeamPositions(question, fixtures).keys()]
    .some((team) => !pair.has(team));
}

// A follow-up keeps the active match's grounding unless it points somewhere
// else. Retention is the safe default: carrying grounding into a question that
// did not need it costs a little unused context, whereas dropping it sends the
// turn to the general tier, whose prompt then disclaims that Pundit has no
// model data for a match the user is visibly still discussing.
export function leavesMatchContext(
  question: string,
  teamContext: TeamContext,
  fixtures: TeamFixture[]
): boolean {
  if (mentionsTeamOutsideContext(question, teamContext, fixtures)) return true;
  const normalized = normalizeTeamText(question);
  return MATCH_CONTEXT_EXIT_PATTERNS.some((pattern) => pattern.test(normalized));
}

// Every team named in the question, mapped to where it first appears, so
// callers can both order a matchup and detect a team the question has moved on
// to.
function mentionedTeamPositions(
  question: string,
  fixtures: TeamFixture[]
): Map<string, number> {
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

  return teamPositions;
}

// Error codes for the two ways team resolution fails. The frontend collapses
// every other 400 into one generic "try rephrasing" line, so a code is what
// lets a specific, actionable message through.
export const MULTIPLE_TEAMS_CODE = "MULTIPLE_TEAMS";
export const MULTIPLE_FIXTURES_CODE = "MULTIPLE_FIXTURES";
export const TEAMS_NOT_IDENTIFIED_CODE = "TEAMS_NOT_IDENTIFIED";

// The fixtures the named teams actually form, deduplicated across the two legs
// of a tie so a home-and-away pair is offered once.
function fixturesAmongTeams(teams: string[], fixtures: TeamFixture[]): TeamFixture[] {
  const named = new Set(teams);
  const seen = new Set<string>();
  const found: TeamFixture[] = [];
  for (const fixture of fixtures) {
    if (!named.has(fixture.home) || !named.has(fixture.away)) continue;
    const key = [fixture.home, fixture.away].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(fixture);
  }
  return found;
}

function listMatchups(fixtures: TeamFixture[]): string {
  const names = fixtures.map((fixture) => `${fixture.home} vs ${fixture.away}`);
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}`;
}

export function resolveTeams(question: string, fixtures: TeamFixture[]): [string, string] {
  const orderedTeams = [...mentionedTeamPositions(question, fixtures).entries()]
    .sort(([, positionA], [, positionB]) => positionA - positionB)
    .map(([team]) => team);

  if (orderedTeams.length > 2) {
    // Grounding models exactly one match, so more than one matchup cannot be
    // answered in a turn. Naming the fixtures the question actually contains
    // turns that limit into a next step instead of a dead end -- the previous
    // message told the user the request was wrong without saying what to ask
    // instead, and the frontend replaced even that with generic copy.
    const named = fixturesAmongTeams(orderedTeams, fixtures).slice(0, 3);
    if (named.length > 0) {
      throw new AppError(
        400,
        `I can analyse one match at a time — did you mean ${listMatchups(named)}?`,
        MULTIPLE_FIXTURES_CODE
      );
    }
    throw new AppError(
      400,
      "Please name exactly one matchup with two teams, e.g. 'Arsenal vs Liverpool'.",
      MULTIPLE_TEAMS_CODE
    );
  }

  if (orderedTeams.length < 2) {
    throw new AppError(
      400,
      "Could not identify two teams in your question. Try naming both teams, e.g. 'Arsenal vs Liverpool'.",
      TEAMS_NOT_IDENTIFIED_CODE
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
    // Matched on the error code rather than its wording: the multi-team message
    // now names the fixtures it found, so a prefix check would silently stop
    // recognising it.
    const isMissingTeams = err.code === TEAMS_NOT_IDENTIFIED_CODE;
    const isCompetitionMultiTeam =
      (err.code === MULTIPLE_TEAMS_CODE || err.code === MULTIPLE_FIXTURES_CODE)
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

function competitionStandingsRows(
  competitionId: string,
  standings: FootballStanding[]
): CompetitionGrounding["standings"] {
  return standings
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
}

export function buildSeasonGrounding(
  competitionId: string,
  standings: FootballStanding[],
  lastUpdated: Date | null
): SeasonGrounding | null {
  const competition = getCompetitionById(competitionId);
  if (!competition || competitionId !== "eng.1") return null;

  const football = getCachedMatches();
  const scheduled = remainingScheduledFixtures(
    [...football.upcoming, ...football.recent],
    competitionId
  );
  const ratings = getCachedClubRatings();
  if (ratings.fetchedAt === null) return null;

  const seasonOutlook = simulateSeasonOutlook(
    competitionId,
    standings,
    scheduled,
    ratings.byProfile
  );
  if (!seasonOutlook) return null;

  return {
    kind: "season",
    competitionId,
    competition: competition.name,
    updatedAt: lastUpdated?.toISOString() ?? null,
    standings: competitionStandingsRows(competitionId, standings),
    seasonOutlook,
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

  if (
    competitionId === "eng.1"
    && isSeasonOutlookQuestion(question)
    && standings.some((row) => row.competitionId === competitionId)
  ) {
    return { tier: "season", competitionId };
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

  if (
    !teams
    && !competitionId
    && teamContext
    && (shouldUseMatchGrounding(question)
      || !leavesMatchContext(question, teamContext, [...fixtures, ...activeFixtures]))
  ) {
    const contextualFixture = findFixture(teamContext[0], teamContext[1], fixtures);
    if (contextualFixture) return { tier: "match", fixture: contextualFixture };
    const activeFixture = findFixture(teamContext[0], teamContext[1], activeFixtures);
    if (activeFixture) {
      return { tier: "model-unavailable", teams: [activeFixture.home, activeFixture.away] };
    }
  }

  return { tier: "general" };
}

function todayPreamble(): string {
  return `Today's date is ${new Date().toISOString().slice(0, 10)}. Your own knowledge of squads, `
    + "transfers, injuries, managers and league positions is out of date -- defer to the grounding "
    + "data and to web_search results, and judge whether a search result is current by comparing its "
    + "date to today's.";
}

function analysisRequestParams(systemPrompt: string, messages: Anthropic.MessageParam[]) {
  return {
    model: MINIMAX_MODEL,
    max_tokens: MAX_TOKENS,
    // Anthropic's output_config/effort was dropped in the MiniMax migration: the
    // endpoint accepts the field without erroring but does not act on it, so
    // keeping it would read as a live control that does nothing. MiniMax's own
    // depth lever is `thinking: { type: "adaptive" }`, deliberately left off --
    // it emits an extra thinking block and costs latency against the 90s
    // per-call ceiling that search turns were already dying on before 7f491a7.
    // Turn it on only if answer depth measurably suffers.
    // The date is prepended rather than baked into each prompt constant
    // because the model has no clock: MiniMax-M3's training data ends in
    // January 2026, so without today's date it read a January 2026 article as
    // current team news and cited it as the live squad situation.
    system: `${todayPreamble()}\n\n${systemPrompt}`,
    // Client-defined, unlike Anthropic's hosted server tool: MiniMax returns a
    // tool_use block and Pundit runs the search itself. See runToolUses.
    tools: [WEB_SEARCH_TOOL],
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

const SCORELINE_PERCENTAGE_PATTERN = /\b(\d+-\d+)\b([^%\n]{0,45}?)(\d+(?:\.\d+)?)%/g;

// ATTRIBUTION_RULES requires every team-news claim to name its source and date,
// so a line carrying one is reported fact, not a model reading. The guards below
// rewrite model claims; a sourced line must survive them untouched. Without this
// a legitimate "Villa beat Arsenal 2-1 in the first leg (BBC Sport, 12 Apr)" was
// swallowed by the underdog guard and deleted from the answer.
const MONTH = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
const SOURCED_NEWS_LINE = new RegExp([
  // "(BBC Sport, 12 Apr)" -- the source-and-date parenthetical the attribution
  // rules mandate. Requires both a comma and a digit inside, so a bare
  // probability aside like "(7.1%)" does not qualify.
  /\([^)]*,[^)]*\d[^)]*\)/.source,
  `\\b(?:${MONTH})[a-z]*\\.?\\s+\\d{1,2}\\b`,
  `\\b\\d{1,2}\\s+(?:${MONTH})[a-z]*\\b`,
  /\b20\d{2}\b/.source,
  /\b(?:according to|reported|confirmed by)\b/.source,
].join("|"), "i");

// A percentage that names its own unit belongs to that metric, not to the
// scoreline that happens to precede it, and a comma between the two puts them in
// separate clauses. Either way the figure is not a scoreline-probability claim
// and must not be rewritten as one -- "won 2-1, with 65% possession" was being
// turned into "65%" of the model's 2-1 probability.
const NON_PROBABILITY_METRIC =
  /^\W*(?:possession|xg|conversion|accuracy|share|duels?|aerials?|of\s+(?:the\s+)?(?:shots|passes|duels|possession))\b/i;

function groundedScoreline(score: string, grounding: Grounding) {
  return grounding.scorelines.find((row) => row.score === score);
}

// The model may quote a grounded probability at any precision ("10%", "10.4%"),
// so a figure is correct when it rounds to the grounded value at the precision
// the model actually used. A fixed tolerance treated ordinary rounding as a
// hallucination and discarded correct answers.
function roundingTolerance(percentageText: string): number {
  const decimals = percentageText.split(".")[1]?.length ?? 0;
  return 0.5 / 10 ** decimals + 1e-9;
}

function percentageMatches(percentageText: string, probability: number): boolean {
  return Math.abs(probability * 100 - Number(percentageText))
    <= roundingTolerance(percentageText);
}

function scorelinePercentageMatches(
  score: string,
  percentageText: string,
  grounding: Grounding
): boolean {
  const row = groundedScoreline(score, grounding);
  if (!row) return false;
  return percentageMatches(percentageText, row.probability);
}

// Corrects a misquoted percentage in place, leaving the rest of the sentence
// intact. Returns null when the line cites a scoreline absent from the
// grounding entirely -- a fabrication the caller must replace rather than
// patch.
function correctScorelinePercentages(line: string, grounding: Grounding): string | null {
  let citesUnknownScoreline = false;
  const corrected = line.replace(
    SCORELINE_PERCENTAGE_PATTERN,
    (
      whole: string,
      score: string,
      gap: string,
      percentageText: string,
      offset: number,
      full: string
    ) => {
      if (gap.includes(",")) return whole;
      if (NON_PROBABILITY_METRIC.test(full.slice(offset + whole.length))) return whole;
      if (scorelinePercentageMatches(score, percentageText, grounding)) return whole;
      const row = groundedScoreline(score, grounding);
      if (!row) {
        citesUnknownScoreline = true;
        return whole;
      }
      return `${score}${gap}${(row.probability * 100).toFixed(1)}%`;
    }
  );
  return citesUnknownScoreline ? null : corrected;
}

const GOAL_MARKET_LINE = /both teams to score|\bbtts\b|\b(?:over|under)\s*2\.5/i;

// Works out which goal-market number a percentage in the line is describing, so
// a misquoted figure can be corrected where it stands instead of the whole
// sentence being discarded. Returns null when the figure cannot be attributed
// with confidence -- an unattributed number is left untouched.
// Only punctuation, or a short connector, may sit between a label and the
// figure it describes: "no at 44.1%", "over 2.5: 51%", "56.0% yes".
const LABEL_ADJACENT = /^\W*(?:at|of|is|to|=|:)?\W*$/;
// A label followed by a connector and then a digit is describing the figure
// that comes next, not the one just before it. This is what separates
// "55.9% (no at 44.1%)" -- where "no" belongs to 44.1% -- from
// "56.0% yes and 43.4% no", where each label trails its own figure.
const LABELS_NEXT_FIGURE = /^\W*(?:at|of|is|to|=|:)\W*\d/;

/**
 * Finds the label that describes the figure at [figureStart, figureEnd).
 *
 * Search is bounded by the neighbouring percentages so a label can never be
 * claimed by a figure on the far side of another figure. Labels are matched in
 * both directions because the two phrasings are equally common, and preferring
 * only one silently corrupts the other: reading labels solely from the text
 * *after* a figure made "55.9% (no at 44.1%)" bind "no" to the 55.9%, which
 * overwrote a correct both-teams-to-score yes figure with the no probability.
 */
function nearestLabel(
  line: string,
  figureStart: number,
  figureEnd: number,
  pattern: RegExp
): string | null {
  const lower = line.toLowerCase();

  const precedingFigure = [...lower.slice(0, figureStart).matchAll(/\d+(?:\.\d+)?%/g)].at(-1);
  const gapStart = precedingFigure
    ? (precedingFigure.index ?? 0) + precedingFigure[0].length
    : 0;
  const gap = lower.slice(gapStart, figureStart);

  // Label before the figure: take the closest one still adjacent to it.
  const leading = [...gap.matchAll(pattern)].at(-1);
  if (leading && LABEL_ADJACENT.test(gap.slice((leading.index ?? 0) + leading[0].length))) {
    return leading[1];
  }

  const followingFigure = /\d+(?:\.\d+)?%/.exec(lower.slice(figureEnd));
  const aheadEnd = followingFigure ? figureEnd + followingFigure.index : lower.length;
  const ahead = lower.slice(figureEnd, aheadEnd);

  // Label after the figure, unless it is really introducing the next one.
  const trailing = [...ahead.matchAll(pattern)][0];
  if (
    trailing
    && LABEL_ADJACENT.test(ahead.slice(0, trailing.index ?? 0))
    && !LABELS_NEXT_FIGURE.test(lower.slice(figureEnd + (trailing.index ?? 0) + trailing[0].length))
  ) {
    return trailing[1];
  }

  return null;
}

function goalMarketProbability(
  line: string,
  figureStart: number,
  figureEnd: number,
  grounding: Grounding
): number | null {
  const total = nearestLabel(line, figureStart, figureEnd, /\b(over|under)\s*2\.5/g);
  if (total === "under") return usableProbability(grounding.pUnder2_5);
  if (total === "over") return usableProbability(grounding.pOver2_5);

  if (!/both teams to score|\bbtts\b/i.test(line)) return null;
  const btts = nearestLabel(line, figureStart, figureEnd, /\b(yes|no)\b/g);
  if (btts === "yes") return usableProbability(grounding.pBttsYes);
  if (btts === "no") return usableProbability(grounding.pBttsNo);
  return null;
}

// A grounding payload missing a goal-market field must leave the text alone
// rather than substitute a number that does not exist.
function usableProbability(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Rewrites only the goal-market percentages that disagree with the grounding.
// The previous guard replaced any line mentioning both-teams-to-score with a
// canonical sentence, which answered a different question than the user asked
// and repeated itself whenever two lines mentioned the market.
function correctGoalMarketPercentages(line: string, grounding: Grounding): string {
  if (!GOAL_MARKET_LINE.test(line)) return line;
  let corrected = "";
  let cursor = 0;
  for (const match of line.matchAll(/(\d+(?:\.\d+)?)%/g)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const expected = goalMarketProbability(line, start, end, grounding);
    corrected += line.slice(cursor, start);
    cursor = end;
    corrected += expected === null || percentageMatches(match[1], expected)
      ? match[0]
      : `${(expected * 100).toFixed(1)}%`;
  }
  return corrected + line.slice(cursor);
}

// A single-leg result only settles a tie in a two-legged cup competition, and
// only when the model actually ties a result to advancing. Bare words like
// "progress" in league commentary are not aggregate claims.
const AGGREGATE_OUTCOME_TERM = /\b(?:advance[ds]?|advancement|progress(?:es|ed|ion)?|through|qualif(?:y|ies|ied|ication))\b/i;
const AGGREGATE_CLAIM_CUE = /\b(?:extra time|two[- ]goal swing|aggregate|need(?:s|ed)?|must|enough to|sends?|level(?:s)? the tie|settle(?:s)? the tie)\b|\b\d+-\d+\b/i;

export function mentionsAggregateOutcome(line: string): boolean {
  if (/\bextra time\b|\btwo[- ]goal swing\b|\bon aggregate\b/i.test(line)) return true;
  return AGGREGATE_OUTCOME_TERM.test(line) && AGGREGATE_CLAIM_CUE.test(line);
}

function awayWinSummary(grounding: Grounding): string {
  const awayWins = grounding.scorelines.filter(({ score }) => {
    const [homeGoals, awayGoals] = score.split("-").map(Number);
    return awayGoals > homeGoals;
  }).slice(0, 2);
  if (awayWins.length === 0) {
    return `Pundit's payload does not include a reportable away-win scoreline for ${grounding.away}.`;
  }
  const examples = awayWins.map(({ score, probability }) =>
    `**${score} (${(probability * 100).toFixed(1)}%)**`
  );
  return `For ${grounding.away} to win, the model's most likely away-win scorelines are ${examples.join(" and ")}.`;
}

function replaceInvalidScorelineLines(answer: string, grounding: Grounding): string {
  return answer.split("\n").map((line) => {
    if (SOURCED_NEWS_LINE.test(line)) return line;
    const isUnderdogInterpretation = line.toLowerCase().includes(grounding.away.toLowerCase())
      && /\b(?:path|route|prevail|overturn|away-win|beat|win|winning|spring|upset|come out on top)\b/i.test(line)
      && /\b\d+-\d+\b/.test(line);
    if (isUnderdogInterpretation) return awayWinSummary(grounding);
    return correctScorelinePercentages(line, grounding) ?? awayWinSummary(grounding);
  }).join("\n");
}

export function sanitizeMatchAnswer(answer: string, grounding?: Grounding): string {
  let sanitized = answer;
  sanitized = sanitized.replace(
    /(?:(?:Any|All|Every) scorelines?|anything) not (?:listed|mentioned|shown)(?: here)?[^.!?\n]*(?:below|under|falls below)[^.!?\n]*(?:0\.1%|threshold)[^.!?\n]*[.!?]?/gi,
    "The scorelines above are selected examples, not the full set at or above the model's 0.1% reporting threshold."
  );
  const aggregateDisclaimer = "Aggregate advancement is outside Pundit's match payload, so this model does not determine which result would settle the tie.";
  sanitized = sanitized.replace(
    /[^.!?\n]*(?:(?:entirely|solely)[^.!?\n]*(?:home[- ]field|home advantage|HFA|edge)|(?:home[- ]field|home advantage|HFA|edge)[^.!?\n]*(?:entirely|solely))[^.!?\n]*[.!?]?/gi,
    " Home-field advantage is applied, but this payload does not decompose the probability gap by cause."
  );
  sanitized = sanitized.replace(
    /\(\d+(?:\.\d+)?%\s+no[^)]*\bactually\s+(\d+(?:\.\d+)?)%\s+no\)/gi,
    "($1% no)"
  );
  if (grounding) {
    sanitized = replaceInvalidScorelineLines(sanitized, grounding);
    sanitized = sanitized
      .split("\n")
      .map((line) => correctGoalMarketPercentages(line, grounding))
      .join("\n");
    if (grounding.competitionId === "uefa.champions_qual") {
      sanitized = sanitized
        .replace(/\b(?:a )?share of the points\b/gi, "a draw")
        .replace(/\b(?:take|claim|earn|secure)(?:s|ed|ing)? (?:all )?(?:three|3) points\b/gi, "win")
        .replace(/\broute to (?:three|3) points\b/gi, "route to victory")
        .replace(/\b(?:one|1) point\b/gi, "a draw");
    }
  }
  // Only two-legged cup ties can be settled on aggregate. An ungrounded answer
  // keeps the guard, since the competition cannot be checked.
  const competitionType = grounding
    ? getCompetitionById(grounding.competitionId)?.type
    : undefined;
  if (competitionType !== "league") {
    sanitized = sanitized.split("\n")
      .map((line) => (mentionsAggregateOutcome(line) ? aggregateDisclaimer : line))
      .join("\n");
  }
  sanitized = sanitized
    .replace(
      /\s+[—-]\s+this is[^.!?\n]*(?:territorial|dominat)[^.!?\n]*[.!?]?/gi,
      "."
    )
    .split("\n")
    .filter((line, index, lines) =>
      line.trim() !== aggregateDisclaimer
      || lines.findIndex((candidate) => candidate.trim() === aggregateDisclaimer) === index
    )
    .join("\n");
  return sanitized.replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ").trim();
}

function sanitizeStandingsLanguage(answer: string): string {
  const orderCorrection = "The supplied all-zero table does not establish an on-field ranking or explain why equally ranked teams appear in this order.";
  return answer.split("\n").map((line) => {
    if (/\b(?:alphabet|placeholder|default sort|default-sorted|artifact of ordering)/i.test(line)) {
      return orderCorrection;
    }
    return line.replace(/\bzero predictive value\b/gi, "no predictive evidence from played matches");
  }).join("\n").trim();
}

// Competition grounding carries standings only -- position, team, played games,
// points, goal difference -- and no probabilities of any kind. So a percentage
// presented at this tier as a Pundit model output is fabricated: one answer
// produced a "Title odds (Pundit model)" list giving Arsenal 15.4% when the
// season tier's actual simulation, in the same run, said 45.4%.
//
// The season tier is deliberately not subject to this guard: SeasonGrounding
// does supply a simulated outlook, so model-attributed probabilities are
// legitimate there.
const PROBABILITY_CLAIM = /\d+(?:\.\d+)?%|\b(?:title|winner|top[- ]four|relegation)\s+odds\b/i;

const MODEL_CLAIM = /\bpundit'?s?\s+model\b|\bthe model\b|\bmodel'?s\b|\(\s*pundit[^)]*\)/i;

const FABRICATED_ODDS_CORRECTION =
  "Pundit's model does not produce title or placing probabilities for a standings question -- "
  + "the table above is the grounded data for this competition.";

const ODDS_BULLET = /^\s*[-*]\s.*\d+(?:\.\d+)?%/;

export function sanitizeCompetitionAnswer(answer: string): string {
  let corrected = false;
  let inOddsList = false;
  const kept: string[] = [];

  for (const line of sanitizeStandingsLanguage(answer).split("\n")) {
    if (PROBABILITY_CLAIM.test(line) && MODEL_CLAIM.test(line)) {
      // The heading names the model; its bullets usually do not, so the list
      // that follows has to be dropped with it or orphaned percentages remain.
      inOddsList = true;
      if (!corrected) {
        corrected = true;
        kept.push(FABRICATED_ODDS_CORRECTION);
      }
      continue;
    }
    if (inOddsList && ODDS_BULLET.test(line)) continue;
    if (line.trim() !== "") inOddsList = false;
    kept.push(line);
  }

  return kept.join("\n").trim();
}

export function sanitizeSeasonAnswer(answer: string): string {
  return sanitizeStandingsLanguage(answer)
    .replace(
      /\b(?:90|ninety)\+?\s*[- ]?game Premier League season\b/gi,
      "38-match-per-club Premier League season"
    );
}

export function sanitizeUnsupportedTeamNews(answer: string): string {
  return answer.replace(
    /(?:^[-*]\s*[^:\n]{1,40}:\s*)?\bNo (?:other )?(?:verified )?(?:injury\/lineup|injury or lineup|injury|lineup) (?:issues|concerns|updates)?\s*(?:were )?(?:reported|found|identified)\b[^.\n]*[.]?/gim,
    "No additional verified, dated injury or lineup update was established by the available evidence."
  ).trim();
}

// FORMAT_RULES already forbids narrating tool use, but MiniMax does it anyway
// ("I'll search for the latest Arsenal injury news."), and because every text
// block is shown verbatim the narration reaches the user -- typically run
// together with the first bold label, as in "...injury news.**Latest**".
// Prompt-level instruction did not hold, so it is removed deterministically.
// Narration is matched as a clause rather than a whole sentence: it arrives
// both on its own ("Let me check for the new season.") and tacked onto a
// legitimate one ("I don't have verified data, so let me search for the
// latest."), where only the trailing clause should go.
//
// The verb list is deliberately broad. It began as the obvious retrieval verbs
// and missed "Let me get more concrete details from the Telegraph", which
// reached production; the intent-phrase prefix ("let me", "I'll", ...) is what
// makes a clause narration, so the verb only has to name the act.
const NARRATION_VERBS =
  "search|look|check|find|pull|gather|research|browse|get|dig|confirm|verify"
  + "|review|read|see|retrieve|fetch|scan";

const PROCESS_NARRATION = new RegExp(
  "(^|\\n|(?<=[.!?])[ \\t]|[,;][ \\t]*(?:so|then|and)?[ \\t]*)"
  + "(?:let me|let'?s|i'?ll|i will|i'?m going to|i am going to|i need to|now i'?ll"
  + "|first,?[ \\t]+let me)\\b"
  + `[^.!?\\n]*?\\b(?:${NARRATION_VERBS})\\w*\\b`
  + "[^.!?\\n]*[.!?]*[ \\t]*",
  "gi"
);

// A negation attached to the verb makes the clause a statement of limitation,
// not narration -- "I'm not pulling this from Pundit's model data" is the
// disclaimer the general tier requires. The negation has to sit before the
// verb to count: testing the whole clause let real narration through whenever
// an unrelated later phrase happened to contain "not".
const NARRATION_EXEMPT = /\b(?:not|cannot|unable|never)\b|n't/i;
const NARRATION_VERB = new RegExp(`\\b(?:${NARRATION_VERBS})\\w*\\b`, "i");

export function stripProcessNarration(answer: string): string {
  return answer
    .replace(PROCESS_NARRATION, (match: string, lead: string) => {
      const verb = NARRATION_VERB.exec(match);
      if (NARRATION_EXEMPT.test(verb ? match.slice(0, verb.index) : match)) return match;
      // A clause cut from mid-sentence leaves the sentence needing an ending;
      // one cut at a boundary just gives its boundary back.
      return /^[,;]/.test(lead) ? ". " : lead;
    })
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

// FORMAT_RULES requires every bold section label to begin its own line, but
// MiniMax regularly runs one onto the end of the preceding sentence
// ("...my squad knowledge is out of date. **Top scorer**"). Only labels that
// already end their line are moved, and only when made of words -- so inline
// emphasis on a figure, like "Arsenal **15.4%**", is left where it is.
const INLINE_SECTION_LABEL = /([^\n\s])[ \t]*(\*\*[A-Za-z][A-Za-z \-/&']{2,30}\*\*)(?=\n|$)/g;

export function normalizeSectionBreaks(answer: string): string {
  return answer.replace(INLINE_SECTION_LABEL, "$1\n\n$2");
}

// The general tier must say it is not model-grounded. GENERAL_SYSTEM_PROMPT
// asks for it, but MiniMax supplies it only sometimes -- it labelled a player
// question and left an adjacent tactical question unlabelled -- so the
// guarantee is enforced here rather than left to prompt compliance.
const GENERAL_DISCLAIMER =
  "This is general football analysis, not based on Pundit's model data.";

const HAS_GENERAL_DISCLAIMER =
  /general (?:football )?analysis|(?:not|n't|outside|beyond)[^.\n]{0,80}(?:pundit'?s model|model data|model output|model's data)/i;

export function ensureGeneralDisclaimer(answer: string): string {
  if (!answer.trim()) return answer;
  return HAS_GENERAL_DISCLAIMER.test(answer)
    ? answer
    : `${answer.trimEnd()}\n\n${GENERAL_DISCLAIMER}`;
}

// The deterministic guard chain for a tier, factored out of
// validateAnalysisResponse so the streaming path can run exactly the same
// guards over a settled prefix of the answer instead of a second, weaker copy.
//
// The MiniMax guards run first and for every tier: narration and fused section
// labels are properties of the raw text, so stripping them before the
// tier-specific guards means those guards see the same shape they were written
// against.
//
// `final` gates the general-tier disclaimer, which appends rather than rewrites
// and so is a property of the whole answer, not of any prefix of it. Running it
// on settled prefixes put the disclaimer after the first line, and the next,
// longer prefix then no longer extended what had already been sent -- the
// flusher read that as divergence and stopped streaming after one delta.
function sanitizeAnswerForTier(
  answer: string,
  tier: AnalysisTier,
  grounding?: AskGrounding,
  final = false
): string {
  const commonSafeAnswer = sanitizeUnsupportedTeamNews(
    normalizeSectionBreaks(stripProcessNarration(answer))
  );
  if (tier === "match") {
    return sanitizeMatchAnswer(
      commonSafeAnswer,
      grounding?.kind === "match" ? grounding : undefined
    );
  }
  if (tier === "season") return sanitizeSeasonAnswer(commonSafeAnswer);
  if (tier === "competition") return sanitizeCompetitionAnswer(commonSafeAnswer);
  return final ? ensureGeneralDisclaimer(commonSafeAnswer) : commonSafeAnswer;
}

// Separate text blocks that would otherwise collide. MiniMax splits an answer
// across blocks without carrying whitespace at the seam, so a plain
// concatenation produced "...from web searches.This is a web-search answer" --
// two sentences fused mid-line.
function joinTextBlocks(blocks: Anthropic.ContentBlock[]): string {
  return blocks.reduce((text, block) => {
    if (block.type !== "text") return text;
    const fuses = text !== "" && !/\s$/.test(text) && !/^\s/.test(block.text);
    return `${text}${fuses ? " " : ""}${block.text}`;
  }, "").trim();
}

function validateAnalysisResponse(
  responses: Anthropic.Message[],
  tier: AnalysisTier,
  startedAt: number,
  grounding?: AskGrounding
): string {
  const blocks = responses.flatMap((response) => response.content);
  // Only the settled turn's text is the answer. MiniMax drafts a provisional
  // answer, calls the search tool, then rewrites it once results arrive, so
  // concatenating every turn shipped both: a live reply carried a short
  // pre-search injury list, the giveaway line "I have a clear recent picture
  // now.", and then a fuller list that repeated and partly contradicted it.
  // Anthropic's hosted search never did this -- it resumed one answer rather
  // than restarting it. Turns before the last are drafts and are dropped.
  const finalBlocks = responses.at(-1)?.content ?? [];
  const answer = joinTextBlocks(finalBlocks) || joinTextBlocks(blocks);
  const usedWebSearch = blocks.some((block) =>
    block.type === "tool_use" && block.name === WEB_SEARCH_TOOL.name
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
  return sanitizeAnswerForTier(answer, tier, grounding, true);
}

function appendAssistantTurn(
  convo: Anthropic.MessageParam[],
  response: Anthropic.Message
): Anthropic.MessageParam[] {
  return [...convo, { role: "assistant", content: response.content as Anthropic.ContentBlockParam[] }];
}

/**
 * Runs every tool_use block in a response and returns the user turn carrying
 * the results. Anthropic's hosted search did this server-side and handed back
 * pause_turn; on MiniMax the round trip is ours to complete.
 *
 * A failed or empty search still yields a tool_result -- the API rejects a
 * conversation where a tool_use has no matching result, and an explicit "no
 * results" tells the model to fall back rather than silently retry.
 */
async function runToolUses(
  response: Anthropic.Message
): Promise<Anthropic.MessageParam | null> {
  const toolUses = response.content.filter(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  if (toolUses.length === 0) return null;

  const results = await Promise.all(toolUses.map(async (toolUse) => {
    const query =
      toolUse.name === WEB_SEARCH_TOOL.name
      && typeof (toolUse.input as { query?: unknown })?.query === "string"
        ? (toolUse.input as { query: string }).query
        : "";
    const found = query ? await searchWeb(query) : [];
    return {
      type: "tool_result" as const,
      tool_use_id: toolUse.id,
      content: found.length
        ? JSON.stringify(found)
        : "No search results were returned for this query.",
    };
  }));

  return { role: "user", content: results };
}

export async function generateAnalysis(
  client: Pick<Anthropic, "messages">,
  systemPrompt: string,
  messages: ConversationTurn[],
  tier: AnalysisTier,
  grounding?: AskGrounding
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
    if (response.stop_reason !== "tool_use") break;
    const toolResults = await runToolUses(response);
    if (!toolResults) break;
    convo = [...appendAssistantTurn(convo, response), toolResults];
  }
  if (collected.at(-1)?.stop_reason === "tool_use") {
    throw new AppError(504, "Analysis service timed out. Please try again.");
  }
  return validateAnalysisResponse(collected, tier, startedAt, grounding);
}

const RETRYABLE_STATUS = new Set([408, 429, 529]);

function isRetryableStreamError(error: unknown): boolean {
  if (error instanceof Anthropic.APIConnectionError) return true;
  return error instanceof Anthropic.APIError
    && typeof error.status === "number"
    && (RETRYABLE_STATUS.has(error.status) || error.status >= 500);
}

// Number of completed lines held back behind the line the model is still
// writing. The guards are line-scoped, but a handful of their patterns can
// begin on the previous line (a parenthetical carried over, a trailing
// " -- this is ..." clause opening a new line), so a line is only released once
// the following line exists to give the guards their context.
const GUARD_BAND_LINES = 1;

// Everything up to the last newline is "complete", minus the guard band. An
// answer shorter than the band never settles early and is delivered whole by
// `finish`.
function settledPrefix(raw: string): string {
  const lines = raw.split("\n");
  const settledCount = lines.length - 1 - GUARD_BAND_LINES;
  return settledCount > 0 ? lines.slice(0, settledCount).join("\n") : "";
}

/**
 * Releases the answer to the client progressively without ever sending text
 * the deterministic guards have not seen.
 *
 * Each chunk is appended to a raw buffer; the settled prefix of that buffer is
 * put through the full tier guard chain, and only the part of the *sanitized*
 * output beyond what was already sent is emitted. Because the guards are
 * line-scoped, sanitizing a longer prefix normally extends the previous
 * sanitized output rather than rewriting it. If it ever does rewrite it -- a
 * guard reaching back further than the band -- the already-sent bytes cannot be
 * recalled, so progressive flushing stops for the rest of the turn and the
 * authoritative answer is left to the `done` event, which the client uses to
 * replace the message content wholesale.
 */
class GuardedFlusher {
  private raw = "";
  private emitted = "";
  private diverged = false;

  constructor(
    private readonly tier: AnalysisTier,
    private readonly grounding: AskGrounding | undefined,
    private readonly onDelta: (text: string) => void
  ) {}

  push(text: string): void {
    this.raw += text;
    if (this.diverged) return;
    const settled = settledPrefix(this.raw);
    if (!settled) return;
    this.emit(sanitizeAnswerForTier(settled, this.tier, this.grounding));
  }

  // `answer` is the validated whole-answer result, which is authoritative.
  finish(answer: string): void {
    this.emit(answer);
  }

  /**
   * Called when a turn ends in a tool call. Everything streamed so far was a
   * draft MiniMax is about to rewrite, and validateAnalysisResponse keeps only
   * the settled turn -- so the authoritative answer will not extend what has
   * been sent. Progressive flushing stops here rather than appending the
   * rewrite beneath the draft, and the `done` event replaces the message
   * wholesale, which is the same recovery divergence already uses.
   */
  discardDraft(): void {
    if (this.diverged) return;
    this.diverged = true;
    console.log(JSON.stringify({
      event: "analysis_stream_draft_discarded",
      tier: this.tier,
      emittedChars: this.emitted.length,
    }));
  }

  private emit(sanitized: string): void {
    if (this.diverged) return;
    if (!sanitized.startsWith(this.emitted)) {
      this.diverged = true;
      console.log(JSON.stringify({
        event: "analysis_stream_flush_diverged",
        tier: this.tier,
        emittedChars: this.emitted.length,
      }));
      return;
    }
    const delta = sanitized.slice(this.emitted.length);
    if (!delta) return;
    this.emitted = sanitized;
    this.onDelta(delta);
  }
}

export async function generateAnalysisStream(
  client: Pick<Anthropic, "messages">,
  systemPrompt: string,
  messages: ConversationTurn[],
  tier: AnalysisTier,
  onDelta: (text: string) => void,
  shouldContinue: () => boolean = () => true,
  grounding?: AskGrounding
): Promise<string> {
  const startedAt = Date.now();
  const collected: Anthropic.Message[] = [];
  let convo = toMessageParams(messages);
  let anyDeltaSeen = false;
  const flusher = new GuardedFlusher(tier, grounding, onDelta);
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
          // Retries are already gated on `anyDeltaSeen`, so nothing buffered
          // here can be replayed by a second attempt and duplicated.
          flusher.push(text);
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
    if (response.stop_reason !== "tool_use") break;
    flusher.discardDraft();
    const toolResults = await runToolUses(response);
    if (!toolResults) break;
    convo = [...appendAssistantTurn(convo, response), toolResults];
  }
  if (collected.at(-1)?.stop_reason === "tool_use") {
    throw new AppError(504, "Analysis service timed out. Please try again.");
  }
  const answer = validateAnalysisResponse(collected, tier, startedAt, grounding);
  flusher.finish(answer);
  return answer;
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
  } else if (context.tier === "season") {
    const seasonGrounding = buildSeasonGrounding(
      context.competitionId,
      football.standings,
      football.lastUpdated
    );
    if (!seasonGrounding) {
      throw new AppError(
        503,
        "Pundit's season outlook is temporarily unavailable. Try a table question instead.",
        "MODEL_UNAVAILABLE"
      );
    }
    grounding = seasonGrounding;
    systemPrompt = SEASON_SYSTEM_PROMPT;
    currentMessage = `Season outlook: ${JSON.stringify(grounding)}\nUser question: ${question}`;
  } else if (context.tier === "match") {
    grounding = buildGrounding(context.fixture);
    systemPrompt = MATCH_SYSTEM_PROMPT;
    currentMessage = `Model data: ${JSON.stringify(grounding)}\nUser question: ${question}`;
  } else {
    grounding = null;
    systemPrompt = GENERAL_SYSTEM_PROMPT;
    currentMessage = `User question: ${question}`;
  }

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new AppError(502, "Analysis service is temporarily unavailable.");

  return {
    grounding,
    systemPrompt,
    messages: [...history, { role: "user", content: currentMessage }],
    tier: grounding?.kind ?? "general",
    client: new Anthropic({ apiKey, baseURL: MINIMAX_BASE_URL, maxRetries: 2 }),
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
    const answer = await generateAnalysis(
      client,
      systemPrompt,
      messages,
      tier,
      grounding
    );
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
      handlers.shouldContinue ?? (() => true),
      grounding
    );
    return { answer, grounding };
  } catch (err) {
    mapAnalysisError(err);
  }
}
