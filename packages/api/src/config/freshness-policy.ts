import type { FootballMatch } from "../services/football-data";

/** Default schedule/standings poll when no live or imminent fixtures. */
export const FOOTBALL_REFRESH_NORMAL_MS = 30 * 60 * 1000;
/** Faster ESPN poll while any enabled fixture is in play. */
export const FOOTBALL_REFRESH_LIVE_MS = 2 * 60 * 1000;
/** Faster poll on match day before kickoff (fixtures starting within 24h). */
export const FOOTBALL_REFRESH_MATCHDAY_MS = 10 * 60 * 1000;

export const MARKET_ODDS_REFRESH_NORMAL_MS = 30 * 60 * 1000;
export const MARKET_ODDS_REFRESH_LIVE_MS = 5 * 60 * 1000;
export const MARKET_ODDS_REFRESH_MATCHDAY_MS = 10 * 60 * 1000;

export const MODEL_REFRESH_NORMAL_MS = 60 * 60 * 1000;
export const MODEL_REFRESH_LIVE_MS = 15 * 60 * 1000;
export const MODEL_REFRESH_MATCHDAY_MS = 30 * 60 * 1000;

export const MATCHDAY_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;

export type FreshnessTier = "live" | "matchday" | "normal";

export interface FreshnessSnapshot {
  tier: FreshnessTier;
  /** Why this tier was chosen — for /ready and agent grounding. */
  reason: string;
  inPlayCount: number;
  matchdayCount: number;
  /** Recommended refresh interval for schedule/state given current fixtures. */
  footballRefreshMs: number;
  marketOddsRefreshMs: number;
  modelRefreshMs: number;
}

function isImminentKickoff(match: FootballMatch, now: number): boolean {
  if (match.status !== "SCHEDULED") return false;
  const kickoff = Date.parse(match.utcDate);
  if (!Number.isFinite(kickoff)) return false;
  return kickoff >= now && kickoff <= now + MATCHDAY_LOOKAHEAD_MS;
}

export function classifyFixtureFreshness(
  matches: readonly FootballMatch[],
  now = Date.now()
): Pick<FreshnessSnapshot, "tier" | "reason" | "inPlayCount" | "matchdayCount"> {
  const inPlayCount = matches.filter((match) => match.status === "IN_PLAY").length;
  if (inPlayCount > 0) {
    return {
      tier: "live",
      reason: `${inPlayCount} fixture(s) in play`,
      inPlayCount,
      matchdayCount: 0,
    };
  }
  const matchdayCount = matches.filter((match) => isImminentKickoff(match, now)).length;
  if (matchdayCount > 0) {
    return {
      tier: "matchday",
      reason: `${matchdayCount} fixture(s) kick off within 24 hours`,
      inPlayCount: 0,
      matchdayCount,
    };
  }
  return {
    tier: "normal",
    reason: "no in-play or imminent fixtures",
    inPlayCount: 0,
    matchdayCount: 0,
  };
}

function tierIntervals(tier: FreshnessTier): {
  footballRefreshMs: number;
  marketOddsRefreshMs: number;
  modelRefreshMs: number;
} {
  switch (tier) {
    case "live":
      return {
        footballRefreshMs: FOOTBALL_REFRESH_LIVE_MS,
        marketOddsRefreshMs: MARKET_ODDS_REFRESH_LIVE_MS,
        modelRefreshMs: MODEL_REFRESH_LIVE_MS,
      };
    case "matchday":
      return {
        footballRefreshMs: FOOTBALL_REFRESH_MATCHDAY_MS,
        marketOddsRefreshMs: MARKET_ODDS_REFRESH_MATCHDAY_MS,
        modelRefreshMs: MODEL_REFRESH_MATCHDAY_MS,
      };
    default:
      return {
        footballRefreshMs: FOOTBALL_REFRESH_NORMAL_MS,
        marketOddsRefreshMs: MARKET_ODDS_REFRESH_NORMAL_MS,
        modelRefreshMs: MODEL_REFRESH_NORMAL_MS,
      };
  }
}

export function buildFreshnessSnapshot(
  matches: readonly FootballMatch[],
  now = Date.now()
): FreshnessSnapshot {
  const classified = classifyFixtureFreshness(matches, now);
  const intervals = tierIntervals(classified.tier);
  return { ...classified, ...intervals };
}

export interface AgentFreshnessMetadata {
  tier: FreshnessTier;
  reason: string;
  espnLastUpdated: string | null;
  modelLastUpdated: string | null;
  marketOddsLastUpdated: string | null;
  ratingsAsOf: string | null;
  /** ISO timestamp when this metadata block was assembled for the agent. */
  generatedAt: string;
}

export function buildAgentFreshnessMetadata(input: {
  matches: readonly FootballMatch[];
  espnLastUpdated: Date | null;
  modelLastUpdated: Date | null;
  marketOddsLastUpdated: Date | null;
  ratingsAsOf: Date | null;
  now?: Date;
}): AgentFreshnessMetadata {
  const snapshot = buildFreshnessSnapshot(input.matches, input.now?.getTime() ?? Date.now());
  const generatedAt = (input.now ?? new Date()).toISOString();
  return {
    tier: snapshot.tier,
    reason: snapshot.reason,
    espnLastUpdated: input.espnLastUpdated?.toISOString() ?? null,
    modelLastUpdated: input.modelLastUpdated?.toISOString() ?? null,
    marketOddsLastUpdated: input.marketOddsLastUpdated?.toISOString() ?? null,
    ratingsAsOf: input.ratingsAsOf?.toISOString() ?? null,
    generatedAt,
  };
}

/** Stable sample metadata for tests and hand-built fixtures. */
export function sampleAgentFreshness(
  over: Partial<AgentFreshnessMetadata> = {}
): AgentFreshnessMetadata {
  return {
    tier: "normal",
    reason: "no in-play or imminent fixtures",
    espnLastUpdated: "2026-09-09T12:00:00.000Z",
    modelLastUpdated: "2026-09-09T12:00:00.000Z",
    marketOddsLastUpdated: "2026-09-09T12:00:00.000Z",
    ratingsAsOf: "2026-08-12T00:00:00.000Z",
    generatedAt: "2026-09-09T12:00:00.000Z",
    ...over,
  };
}
