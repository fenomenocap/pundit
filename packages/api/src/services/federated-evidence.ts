import type { AgentFreshnessMetadata } from "../config/freshness-policy";
import type { ResultMark } from "./club-form";
import { evidenceTier, type EvidenceTier } from "./evidence-authority";
import { isSchematicMatchTake, planResponse } from "./response-plan";
import type { WebSearchOutcome } from "./web-search";

export const MAX_FEDERATED_QUERIES = 6;

const CURRENT_NEWS_QUESTION =
  /\b(latest|current|today|tomorrow|this weekend|next (?:match|fixture|game)|recent(?:ly| form)?|dated?|when (?:is|does)|kickoff|kick-off|schedule|injur(?:y|ies|ed)|suspension|availability|available|unavailable|lineup|line-up|team news|transfer|manager|coach|odds|price|market|last (?:five|six|\d+) (?:games|matches)|form)\b/i;

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

function newsFanOutQueries(
  question: string,
  grounding: FederatedGrounding,
  slice: string,
  season: string
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
    planned.push(`${fixture} team news injuries suspensions predicted lineup`);
    planned.push(`${fixture} confirmed starting xi availability`);
  } else if (mode === "market-comparison") {
    planned.push(`${fixture} betting odds decimal over 2.5 goals both teams to score`);
    planned.push(`${fixture} odds movement line move opening price`);
  } else if (isSchematicMatchTake(question)) {
    if (!skipForm) {
      planned.push(`${match.home} ${match.away} recent form last 5 matches results`);
    }
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
  if (asksStats && slice.length >= 3) {
    planned.push(`${slice} stats ${season}`);
  }
  planned.push(...analyticsFanOutQueries(question, grounding, slice, season));
  planned.push(...newsFanOutQueries(question, grounding, slice, season));

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
