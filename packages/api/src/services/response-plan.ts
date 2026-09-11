export type ResponseMode =
  | "match-preview"
  | "match-follow-up"
  | "pricing-desk"
  | "totals"
  | "btts"
  | "exact-score"
  | "fair-price"
  | "market-comparison"
  | "user-line"
  | "stake-refusal"
  | "player-or-scorer"
  | "team-news"
  | "lineup-counterfactual"
  | "table"
  | "season"
  | "coverage"
  | "general";

const ASKS_MATCH_PREVIEW =
  /\b(?:preview|analyse|analyze|analysis|break down|thoughts(?:\s+on)?|full (?:read|preview|analysis))\b/i;
// Betting shorthand is first-class: o2.5 / u2.5 / ou 2.5 / o/u 2.5. Keep the
// letter+line forms tight so "to 2.5" or a stray "o" in "over" cannot match.
const ASKS_TOTALS =
  /\b(?:over|under)\s*2\.5\b|\btotals\b|\bover\s*\/\s*under\b|\bo\s*\/\s*u\b|\bou\s*2\.5\b|\b[ou]\s*2\.5\b/i;
const ASKS_OVER_25 = /\bover\s*2\.5\b|\bo\s*2\.5\b/i;
const ASKS_UNDER_25 = /\bunder\s*2\.5\b|\bu\s*2\.5\b/i;
const ASKS_SCORELINE_BOARD =
  /\b(?:possible|likely|top|correct|projected|predicted)\s+(?:scores?|scorelines?)\b|\bscorelines?\b|\bcorrect score\b/i;
const ASKS_BTTS = /\bbtts\b|both teams to score/i;
const ASKS_1X2 = /\b1x2\b|\bmatch odds\b/i;
const ASKS_ODDS_OR_BOARD =
  /\b1x2\b|\bmatch odds\b|\bthe odds\b|\bthe line\b|\bthe board\b|\bodds\b/i;
const ASKS_EXPECTED_VALUE =
  /\+ev\b|\bev%\b|\bexpected value\b|\bplus[\s-]?ev\b|\ba \+ev bet\b|\bedge vs(?:\s+the)?\s+(?:book|market|line)\b/i;
const ASKS_QUALITATIVE_TAKE =
  /\btactical(?:\s+matchup)?\b|\btactics\b|\bwho decides\b|\bhow they win\b|\bhow (?:do|does|can|will)\b.{0,40}\bwin this\b|\bhow (?:the |this )?favourite wins\b|\bwhy (?:it |this )?(?:is )?low[- ]event\b/i;
const ASKS_UNPRICED_MARKET =
  /\b(?:draw no bet|\bdnb\b|asian(?:\s+handicap)?|\bhandicap\b|\bcorners?\b|next goal|first goal|clean sheet)\b/i;

/** Modes the match composer can settle without MiniMax. */
export const SETTLED_MATCH_MODES: readonly ResponseMode[] = [
  "exact-score",
  "fair-price",
  "market-comparison",
  "user-line",
  "stake-refusal",
  "lineup-counterfactual",
  "totals",
  "btts",
  "pricing-desk",
];

export interface ResponsePlan {
  mode: ResponseMode;
  directAnswerRequired: boolean;
  includeMatchCard: "new-fixture" | "compact-reference" | "none";
  evidenceRequired: boolean;
  maxSections: number;
}

export interface ResponsePresentation {
  responseMode: ResponseMode;
  fixtureCard: "expanded" | "compact" | "none";
}

export function responsePresentation(plan: ResponsePlan): ResponsePresentation {
  return {
    responseMode: plan.mode,
    fixtureCard: plan.includeMatchCard === "new-fixture"
      ? "expanded"
      : plan.includeMatchCard === "compact-reference" ? "compact" : "none",
  };
}

const SCORELINE = /\b\d{1,2}\s*[-–—:]\s*\d{1,2}\b/;

/**
 * Classifies the shape of the answer, not the authority of its facts. Routing
 * and search remain owned by ask.ts; this planner only prevents a narrow turn
 * from being composed as another full match report.
 */
export function asksTotalsQuestion(question: string): boolean {
  return ASKS_TOTALS.test(question);
}

export function asksScorelineBoard(question: string): boolean {
  return ASKS_SCORELINE_BOARD.test(question);
}

export function asksOddsOrBoardQuestion(question: string): boolean {
  return ASKS_1X2.test(question) || ASKS_ODDS_OR_BOARD.test(question);
}

export function asksExpectedValueQuestion(question: string): boolean {
  return ASKS_EXPECTED_VALUE.test(question);
}

/** Structured `userLine` is only consumed on +EV / pass-or-play turns. */
export function questionAcceptsUserLine(question: string): boolean {
  return asksExpectedValueQuestion(question) || /\bpass or play\b/i.test(question);
}

export function asksQualitativeMatchTake(question: string): boolean {
  return ASKS_QUALITATIVE_TAKE.test(question);
}

export function isSettledMatchMode(mode: ResponseMode): boolean {
  return (SETTLED_MATCH_MODES as readonly ResponseMode[]).includes(mode);
}

export function asksBttsQuestion(question: string): boolean {
  return ASKS_BTTS.test(question);
}

export type PricedGridMarket = "1x2" | "totals" | "btts" | "scorelines";

/** Markets this fixture already prices. A named market not in this set must abstain, not dump 1X2. */
export function pricedGridMarketsAsked(question: string): PricedGridMarket[] {
  const asked: PricedGridMarket[] = [];
  if (ASKS_1X2.test(question)) asked.push("1x2");
  if (asksTotalsQuestion(question)) asked.push("totals");
  if (asksBttsQuestion(question)) asked.push("btts");
  if (asksScorelineBoard(question)) asked.push("scorelines");
  return asked;
}

export function asksUnpricedMarket(question: string): boolean {
  return ASKS_UNPRICED_MARKET.test(question);
}

/** True when the user named the over side of 2.5 without also naming under. */
export function asksOver25Only(question: string): boolean {
  if (/\bunder\b/i.test(question) || ASKS_UNDER_25.test(question)) return false;
  return ASKS_OVER_25.test(question);
}

/** True when the user named the under side of 2.5 without also naming over. */
export function asksUnder25Only(question: string): boolean {
  if (/\bover\b/i.test(question) || ASKS_OVER_25.test(question)) return false;
  return ASKS_UNDER_25.test(question);
}

export function asksStakeSizeQuestion(question: string): boolean {
  const q = question.trim();
  // "Three points are at stake" is an idiom, not a bankroll question.
  if (/\bat stake\b/i.test(q)) return false;
  return (
    /\bhow much\b.{0,50}\b(?:to\s+)?(?:stake|wager|bet)\b/i.test(q)
    || /\b(?:what|which)\b.{0,30}\b(?:stake (?:size|amount|unit|fraction)|unit size|kelly)\b/i.test(q)
    || /\bstake\s+(?:size|amount|unit|fraction)\b/i.test(q)
    || /\b(?:size|amount)\s+(?:of\s+)?(?:the\s+)?(?:stake|wager)\b/i.test(q)
  );
}

export function planResponse(
  question: string,
  context: { hasHistory?: boolean; groundingKind?: string | null; hasUserLine?: boolean } = {}
): ResponsePlan {
  const q = question.trim();
  const match = context.groundingKind === "match";
  const hasHistory = Boolean(context.hasHistory);
  const hasUserLine = Boolean(context.hasUserLine);
  let mode: ResponseMode;

  if (context.groundingKind === "fixture") mode = "coverage";
  else if (match && !asksStakeSizeQuestion(q) && ASKS_MATCH_PREVIEW.test(q)) {
    mode = "match-preview";
  } else if (/\b(?:if|suppose|assuming|without)\b.{0,80}\b(?:line-?up|starts?|benched|absent|missing|misses? out|ruled out|available)\b|\bwith\s+(?:a |the )?(?:changed|different|weakened|rotated|confirmed)\s+line-?up\b|\b(?:line-?up|starting xi)\b.{0,80}\b(?:change|shift|swing|reprice|probabilit)/i.test(q)) {
    mode = "lineup-counterfactual";
  } else if (/\b(?:goalscorer|goal scorer|anytime scorer|first scorer|top scorer|leading scorer|who scores|who (?:will|might|could) score|who (?:will|might|could) (?:most )?likely score|who (?:will|might|could) be (?:most )?likely to score|who is (?:the )?(?:most )?likely to score|who is the scorer|player prop|assists?|cards?)\b/i.test(q)) {
    mode = "player-or-scorer";
  } else if (/\b(?:injur(?:y|ies|ed)|suspension|availability|team news|confirmed line-?up|starting xi)\b/i.test(q)) {
    mode = "team-news";
  } else if (/\b(?:table|standings?)\b/i.test(q)) mode = "table";
  else if (/\b(?:title race|top[- ]four|season outlook|champion)\b/i.test(q)) mode = "season";
  else if (match && asksTotalsQuestion(q)) mode = "totals";
  else if (match && asksBttsQuestion(q)) mode = "btts";
  else if (match && /\b(?:which|what)\b.{0,40}\b(?:input|factor|driver)\b.{0,30}\b(?:matters? most|most important|drives?|explains?)\b|\b(?:most important|main)\b.{0,20}\b(?:input|factor|driver)\b/i.test(q)) mode = "match-follow-up";
  else if (match && asksStakeSizeQuestion(q)) mode = "stake-refusal";
  else if (match && /\bpass or play\b/i.test(q)) mode = "user-line";
  else if (match && hasUserLine && asksExpectedValueQuestion(q)) mode = "user-line";
  else if (match && asksExpectedValueQuestion(q)) mode = "pricing-desk";
  else if (match && SCORELINE.test(q) && /\b(?:fair|price|odds?|decimal|implied)\b/i.test(q)) mode = "fair-price";
  else if (match && SCORELINE.test(q)) mode = "exact-score";
  else if (match && asksScorelineBoard(q)) mode = "exact-score";
  else if (match && /\b(?:market|kalshi|polymarket|divergen|disagree|gap|value|edge|priced)\b/i.test(q)) mode = "market-comparison";
  else if (match && asksOddsOrBoardQuestion(q)) mode = "pricing-desk";
  else if (match && asksQualitativeMatchTake(q)) mode = "match-follow-up";
  else if (match && !hasHistory) mode = "pricing-desk";
  else if (match) mode = "match-follow-up";
  else mode = "general";

  const expanded = mode === "match-preview" || mode === "pricing-desk";
  return {
    mode,
    directAnswerRequired: true,
    includeMatchCard: expanded ? "new-fixture" : match ? "compact-reference" : "none",
    // Lineup counterfactual deltas stay a typed limitation. Scorer and team
    // news retrieve public evidence; they still cannot invent a Pundit price.
    evidenceRequired: mode === "team-news" || mode === "player-or-scorer",
    maxSections: mode === "match-preview" ? 4 : 1,
  };
}

export function requestedScoreline(question: string): string | null {
  const found = SCORELINE.exec(question);
  return found ? found[0].replace(/[\s–—:]/g, "-").replace(/-+/g, "-") : null;
}

export interface ScorelineResolution {
  /** Canonical home-away scoreline used by Grounding.scorelines. */
  score: string;
  orientation: "named-home" | "named-away" | "home-away-default";
}

/**
 * Resolves user-facing team-first score syntax into the grounding's canonical
 * home-away orientation. "Chelsea to win 2-0" on Arsenal-Chelsea is 0-2;
 * a bare "2-0" remains deterministic but is explicitly marked as the default.
 */
export function resolveRequestedScoreline(
  question: string,
  fixture: { home: string; away: string }
): ScorelineResolution | null {
  const score = requestedScoreline(question);
  if (!score) return null;
  const [first, second] = score.split("-").map(Number);
  const lower = question.toLocaleLowerCase();
  const homeNamed = lower.includes(fixture.home.toLocaleLowerCase());
  const awayNamed = lower.includes(fixture.away.toLocaleLowerCase());
  if (awayNamed && !homeNamed) {
    return { score: `${second}-${first}`, orientation: "named-away" };
  }
  if (homeNamed && !awayNamed) return { score, orientation: "named-home" };
  return { score, orientation: "home-away-default" };
}
