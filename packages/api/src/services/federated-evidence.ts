import type { AgentFreshnessMetadata } from "../config/freshness-policy";
import type { ResultMark } from "./club-form";
import { evidenceTier, type EvidenceTier } from "./evidence-authority";
import { isSchematicMatchTake, planResponse } from "./response-plan";
import type { WebSearchOutcome } from "./web-search";
import { getTeamNameAliases, normalizeTeamName, normalizeTeamText } from "../lib/team-names";

export const MAX_FEDERATED_QUERIES = 6;

const CURRENT_NEWS_QUESTION =
  /\b(latest|current|today|tomorrow|this weekend|next (?:match|fixture|game)|recent(?:ly| form)?|dated?|when (?:is|does)|kickoff|kick-off|schedule|injur(?:y|ies|ed)|suspension|availability|available|unavailable|lineup|line-up|team news|transfer|manager|coach|odds|price|market|last (?:five|six|\d+) (?:games|matches)|form)\b/i;

const AMBIGUOUS_CURRENT_QUESTION = /\b(news|update|anything changed|what(?:'s| is) happening|what about)\b/i;

const STATS_QUESTION = /\b(stats?|statistics|statistically|xg|assists?|appearances?)\b/i;

const PLAYER_MARKET_QUESTION =
  /\b(?:scorer?|score|goalscorer|assist|card|booked|penalty|prop|props|anytime|player)\b/i;

const RECENT_FORM_QUERY = /recent form last 5 matches results/i;

const ANALYTICS_SOURCE_HINTS = [
  "fbref",
  "whoscored",
  "fotmob",
  "theanalyst",
  "transfermarkt",
] as const;

export type FederatedMatchGrounding = {
  kind: "match";
  home: string;
  away: string;
  homeForm?: ResultMark[];
  awayForm?: ResultMark[];
  freshness?: AgentFreshnessMetadata;
};

/** Minimal grounding shape for federated query planning — avoids importing ask.ts. */
export type FederatedGrounding = FederatedMatchGrounding | { kind: string } | null;

export interface FederatedSearchResult {
  title: string;
  link: string;
  snippet: string;
  date: string;
  tier: EvidenceTier;
}

export interface MergeSearchResultsOptions {
  asksStats?: boolean;
  maxResults?: number;
}

const TIER_RANK_STATS_FIRST: Record<EvidenceTier, number> = {
  official: 0,
  analytics: 1,
  news: 2,
  other: 3,
};

function currentFootballSeasonLabel(now: Date): string {
  const year = now.getUTCFullYear();
  const startYear = now.getUTCMonth() >= 7 ? year : year - 1;
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function asksPerformedThisSeason(question: string, now: Date): boolean {
  if (!/\bperformed\b/i.test(question)) return false;
  if (/\bthis season\b/i.test(question)) return true;
  const label = currentFootballSeasonLabel(now);
  const pattern = label.replace("/", "[/\\-–]");
  return new RegExp(`\\b${pattern}\\b`, "i").test(question);
}

export function asksStatisticalQuestion(question: string, now = new Date()): boolean {
  return STATS_QUESTION.test(question) || asksPerformedThisSeason(question, now);
}

function isMatchGrounding(grounding: FederatedGrounding): grounding is FederatedMatchGrounding {
  return grounding?.kind === "match";
}

/** A club fact is not a fact about its pinned opponent. Never infer a new club. */
export function singleClubCurrentFactScope(
  question: string,
  grounding: FederatedGrounding,
  explicitClubs: readonly string[] = []
): { kind: "manager" | "result"; club: string } | null {
  if ((!isMatchGrounding(grounding) && !explicitClubs.length)
    || /\b(?:vs\.?|versus|against)\b|\s+v\s+|\b(?:away|home)\s+to\b/i.test(question)) return null;
  const q = question.trim().replace(/^who['’]s\b/i, "who is").replace(/^what['’]s\b/i, "what is");
  const manager = (/^(?:who|what)\s+is\b[^?\n]{0,100}\b(?:manager|head coach|coach)\b/i.test(q)
    || /^who\s+(?:manages|coaches)\b/i.test(q))
    && !/\b(?:space|shape|press|pressing|zones?|width|midfield|defence|defense)\b/i.test(q);
  const result = /^what\s+(?:is|was)\b[^?\n]{0,100}\b(?:latest|last|most recent|final)\s+(?:result|score)\b/i.test(q);
  if (!manager && !result) return null;
  if (/\b(?:19|20)\d{2}\b|\b(?:formerly|former|previous|used to|tomorrow|next (?:week|month|year|season)|last (?:year|season))\b/i.test(q)) return null;
  // Keep compound requests on the normal evidence path, rather than silently
  // narrowing a second club/fact to the first club named on the selected card.
  if (/\band\s+(?!why\b|how\b)/i.test(q)) return null;
  const reasonMatch = /\band\s+((?:why|how)\b.*)$/i.exec(q);
  const reasonTail = reasonMatch?.[1];
  if (reasonTail) {
    // A reason for this appointment/result is useful; a new club or topic is
    // a compound request and must keep the normal, wider evidence path.
    const grammar = "why how was were is are did does has have he she they him her them it this that the a an club manager coach team we his their our for to of in by be been being still";
    const topic = manager
      ? "appoint appointed appointment choose chose chosen hire hired hiring select selected selection retain retained keep kept remain remains continuing tenure job role charge"
      : "win won lose lost draw drew result score match game happen happened finish finished";
    const allowed = new Set(`${grammar} ${topic}`.split(" "));
    const words = normalizeTeamText(reasonTail.replace(/[?!.]+$/g, "")).split(" ").filter(Boolean);
    if (words.some((word) => !allowed.has(word))
      || (words.length > 1 && !words.some((word) => topic.split(" ").includes(word)))) return null;
  }
  const primaryQuestion = reasonMatch ? q.slice(0, reasonMatch.index).trim() : q;
  const folded = normalizeTeamText(primaryQuestion.replace(/['’]s\b/g, ""));
  const clubs = (isMatchGrounding(grounding) ? [grounding.home, grounding.away] : explicitClubs).filter((club) => {
    const canonical = normalizeTeamName(club);
    const names = [club, ...getTeamNameAliases().filter(([, name]) => normalizeTeamName(name) === canonical).map(([alias]) => alias)];
    return names.some((name) => {
      const escaped = normalizeTeamText(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const role = manager ? "(?:current )?(?:manager|head coach|coach)" : "(?:latest|last|most recent|final) (?:result|score)";
      const tense = manager ? "is" : "(?:is|was)";
      const currentTime = "(?: (?:today|now|currently|this season))?[?!.]*";
      return new RegExp(`^(?:(?:who|what) ${tense} ${escaped} ${role}|(?:who|what) ${tense} (?:the |current )?${role} (?:of|for) ${escaped}|who (?:manages|coaches) ${escaped})${currentTime}$`).test(folded);
    });
  });
  return clubs.length === 1 ? { kind: manager ? "manager" : "result", club: clubs[0] } : null;
}

export function skipFormQueriesWhenGrounded(grounding: FederatedGrounding): boolean {
  if (!isMatchGrounding(grounding)) return false;
  const hasForm =
    (grounding.homeForm?.length ?? 0) > 0
    || (grounding.awayForm?.length ?? 0) > 0;
  const tier = grounding.freshness?.tier;
  return hasForm && (tier === "matchday" || tier === "live");
}

function analyticsFanOutQueries(
  question: string,
  grounding: FederatedGrounding,
  slice: string,
  season: string
): string[] {
  if (!asksStatisticalQuestion(question)) return [];
  const hints = ANALYTICS_SOURCE_HINTS.join(" ");
  if (isMatchGrounding(grounding)) {
    const fixture = `${grounding.home} vs ${grounding.away}`;
    return [
      `${fixture} xG advanced stats ${hints} ${season}`,
      `${grounding.home} ${grounding.away} player ratings form ${hints}`,
    ];
  }
  if (slice.length >= 3) {
    return [`${slice} stats ${hints} ${season}`];
  }
  return [];
}

const LEAGUE_NAME =
  /\b(serie a|la ?liga|bundesliga|ligue 1|eredivisie|primeira liga|premier league|championship|champions league|europa league)\b/i;
const WINNER_QUESTION = /\b(?:who(?:'s| is| will| would| could)?\b[^?]{0,30}\bwin|title race|title odds|champions?|favou?rites?|outright)\b/i;

/**
 * "Who will win Serie A?" is answered by a table and an outright board, and the
 * single "<question> football latest" lookup finds neither. Two season-pinned
 * searches target them.
 */
function leagueWinnerQueries(question: string, season: string): string[] {
  const league = LEAGUE_NAME.exec(question)?.[1];
  if (!league || !WINNER_QUESTION.test(question)) return [];
  const label = season.replace("/", "-");
  return [`${league} ${label} standings table points`, `${league} ${label} title odds favourites`];
}

function newsFanOutQueries(
  question: string,
  grounding: FederatedGrounding,
  slice: string,
  season: string,
  now: Date
): string[] {
  const planned: string[] = [];
  if (CURRENT_NEWS_QUESTION.test(question) && grounding?.kind !== "match" && slice.length >= 3) {
    planned.push(`${slice} recent form ${season}`);
  }
  if (!isMatchGrounding(grounding)) return planned;

  const match = grounding;
  const fixture = `${match.home} vs ${match.away}`;
  const mode = planResponse(question, { groundingKind: "match", hasHistory: true }).mode;
  const skipForm = skipFormQueriesWhenGrounded(match);

  if (mode === "player-or-scorer") {
    planned.push(`${fixture} anytime goalscorer first scorer odds`);
    planned.push(`${fixture} predicted lineup confirmed starting xi`);
    planned.push(`${fixture} team news injuries suspensions availability`);
    planned.push(`${match.home} ${match.away} attacking form goals shots`);
  } else if (mode === "team-news") {
    // A future matchup query predominantly finds its last meeting. Current
    // club updates can exist before a fixture-specific preview is published.
    const day = now.toISOString().slice(0, 10);
    planned.push(`${match.home} latest injury update team news official club ${day}`);
    planned.push(`${match.away} latest injury update team news official club ${day}`);
    planned.push(`${fixture} team news injuries suspensions predicted lineup`);
    planned.push(`${fixture} confirmed starting xi availability`);
  } else if (mode === "market-comparison") {
    planned.push(`${fixture} betting odds decimal over 2.5 goals both teams to score`);
    planned.push(`${fixture} odds movement line move opening price`);
  } else if (isSchematicMatchTake(question)) {
    // Strength-and-shape take from the match card. Form/news packets collide
    // and append a conflict notice onto an otherwise complete briefing.
  } else if (mode === "match-follow-up"
    && !CURRENT_NEWS_QUESTION.test(question)
    && !AMBIGUOUS_CURRENT_QUESTION.test(question)) {
    // "Why is the draw so likely?" asks about the numbers already on the card.
    // A team-news search for it fetched nothing that answered it, cost 20-40s,
    // and left a "no verified team news" line on an answer that never asked.
  } else {
    planned.push(`${fixture} team news injuries suspensions predicted lineup`);
    if (!skipForm) {
      planned.push(`${match.home} ${match.away} recent form last 5 matches results`);
    }
    if (PLAYER_MARKET_QUESTION.test(question)) {
      planned.push(`${fixture} anytime goalscorer odds player props`);
    }
  }

  return planned;
}

/**
 * Plans up to six federated MiniMax searches for a turn: raw question, fixture
 * context, analytics fan-out with embedded source hints, and news fan-out when
 * team news or managers are in scope.
 */
export function planFederatedQueries(
  question: string,
  grounding: FederatedGrounding,
  baseQuery: string | null,
  now = new Date()
): string[] {
  const planned: string[] = [];
  const raw = question.replace(/\s+/g, " ").trim().slice(0, 220);
  const asksStats = asksStatisticalQuestion(question, now);
  if (raw.length >= 3 && (baseQuery || asksStats)) planned.push(raw);
  if (baseQuery) planned.push(baseQuery);
  const slice = raw.replace(/[?!.]+$/g, "").slice(0, 100).trim();
  const season = currentFootballSeasonLabel(now);
  const clubFact = singleClubCurrentFactScope(question, grounding);
  if (isMatchGrounding(grounding)
    && planResponse(question, { groundingKind: "match", hasHistory: true }).mode === "team-news") {
    // Keep club reports ahead of generic fixture hits at the merged-result cap.
    return [...new Set([...newsFanOutQueries(question, grounding, slice, season, now), ...planned])]
      .slice(0, MAX_FEDERATED_QUERIES);
  }
  if (clubFact && baseQuery) {
    const day = now.toISOString().slice(0, 10);
    const monthLabel = (date: Date) => date.toLocaleDateString("en-GB", {
      month: "long", year: "numeric", timeZone: "UTC",
    });
    const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const targeted = clubFact.kind === "manager"
      ? [`${clubFact.club} current manager head coach official club ${day}`,
        `${clubFact.club} manager head coach latest appointment contract news ${monthLabel(previousMonth)} ${monthLabel(now)} BBC Sky Sports official`]
      : [`${clubFact.club} latest completed match result official report ${season} ${day}`,
        `${clubFact.club} latest match final score post match report ${day}`];
    return [...new Set([...targeted, ...planned])].slice(0, MAX_FEDERATED_QUERIES);
  }
  if (asksStats && slice.length >= 3) {
    planned.push(`${slice} stats ${season}`);
  }
  planned.push(...analyticsFanOutQueries(question, grounding, slice, season));
  planned.push(...newsFanOutQueries(question, grounding, slice, season, now));
  if (!isMatchGrounding(grounding)) planned.push(...leagueWinnerQueries(question, season));

  const unique = new Map<string, string>();
  for (const entry of planned) {
    const query = entry.replace(/\s+/g, " ").trim();
    if (query.length >= 3) unique.set(query.toLocaleLowerCase(), query);
  }
  return [...unique.values()].slice(0, MAX_FEDERATED_QUERIES);
}

/** Dedupe search hits by URL, tag authority tier, and rank analytics/official first for stats turns. */
export function mergeSearchResults(
  outcomes: readonly WebSearchOutcome[],
  options: MergeSearchResultsOptions = {}
): FederatedSearchResult[] {
  const maxResults = options.maxResults ?? 30;
  const seen = new Set<string>();
  const merged: FederatedSearchResult[] = [];

  for (const outcome of outcomes) {
    if (outcome.status !== "ok") continue;
    for (const result of outcome.results) {
      const url = result.link?.trim();
      if (!url) continue;
      const key = url.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({
        title: result.title,
        link: url,
        snippet: result.snippet,
        date: result.date,
        tier: evidenceTier(url),
      });
    }
  }

  if (options.asksStats) {
    merged.sort((left, right) => TIER_RANK_STATS_FIRST[left.tier] - TIER_RANK_STATS_FIRST[right.tier]);
  }

  return merged.slice(0, maxResults);
}

export function isRecentFormQuery(query: string): boolean {
  return RECENT_FORM_QUERY.test(query);
}

/** Queries omitted because match form and freshness are already on the card. */
export function groundedSkippedQueries(grounding: FederatedGrounding): string[] {
  if (!skipFormQueriesWhenGrounded(grounding) || !isMatchGrounding(grounding)) return [];
  const match = grounding;
  return [`${match.home} ${match.away} recent form last 5 matches results`];
}
