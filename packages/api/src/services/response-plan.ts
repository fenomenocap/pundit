export type ResponseMode =
  | "match-preview"
  | "match-follow-up"
  | "pricing-desk"
  | "totals"
  | "btts"
  | "exact-score"
  | "fair-price"
  | "market-comparison"
  | "odds-provenance"
  | "user-line"
  | "stake-refusal"
  | "player-or-scorer"
  | "team-news"
  | "lineup-counterfactual"
  | "table"
  | "season"
  | "coverage"
  | "slate-best-gap"
  | "winner-guarantee-honesty"
  | "priced-why"
  | "general";

const ASKS_MATCH_PREVIEW =
  /\b(?:preview|briefing|analyse|analyze|analysis|break down|thoughts(?:\s+on)?|full (?:read|preview|analysis|briefing))\b/i;
// Betting shorthand is first-class: o2.5 / u2.5 / ou 2.5 / o/u 2.5. Keep the
// letter+line forms tight so "to 2.5" or a stray "o" in "over" cannot match.
const ASKS_TOTALS =
  /\b(?:over|under)\s*2\.5\b|\btotals\b|\bover\s*\/\s*under\b|\bo\s*\/\s*u\b|\bou\s*2\.5\b|\b[ou]\s*2\.5\b/i;
const ASKS_OVER_25 = /\bover\s*2\.5\b|\bo\s*2\.5\b/i;
const ASKS_UNDER_25 = /\bunder\s*2\.5\b|\bu\s*2\.5\b/i;
const ASKS_SCORELINE_BOARD =
  /\b(?:possible|likely|top|correct|exact)\s+(?:scores?|scorelines?)\b|\bscorelines?\b|\bscore\s+probabilit/i;
const ASKS_BTTS = /\bbtts\b|\bboth teams (?:to )?score\b|\bboth sides (?:to )?score\b|\bwill both (?:teams |sides )?score\b/i;
const ASKS_PROJECTED_SCORE =
  /\b(?:projected|predicted|likely|correct|most likely)\s+score\b|\bcorrect score\b|\bscore\s+(?:prediction|forecast|projection)\b|\bpredict\w*\s+(?:the\s+)?(?:final\s+)?score\b|\bwhat(?:'s| is| will)\s+(?:the\s+)?(?:final\s+)?score\b/i;
const ASKS_TACTICAL_TAKE =
  /\btactical matchup\b|\bwho decides\b|\bhow do .{1,60} win (?:this|it)\b/i;
const ASKS_ODDS_BOARD =
  /\bwhat(?:'s| is| are) (?:the )?(?:odds|line)\b|\bshow me the board\b|\bthe board\b|\bmatch odds\b/i;
const ASKS_ODDS_PROVENANCE =
  /\bwhere do (?:your )?(?:odds|numbers|probabilities)(?:\s+for\b[^?]{0,160})?\s+come from\b|\bwhere do (?:your )?odds come from\b|\bhow fresh\b|\bhow old\b|\b(?:what|which) (?:feed|source)s?\b.{0,40}\b(?:odds|market|line)\b|\b(?:odds|market) (?:source|sources|feed|feeds)\b|\bwhere(?:'s| is) (?:the )?(?:market|line) from\b/i;
const ASKS_EXPECTED_VALUE =
  /\+ev\b|\bev%\b|\bexpected value\b|\bplus[\s-]?ev\b|\ba \+ev bet\b|\bedge vs(?:\s+the)?\s+(?:book|market|line)\b/i;
const ASKS_RESULT_CUE = /\b(?:win|wins|beat|beats|winner|to win)\b/i;
const ASKS_1X2 = /\b1x2\b|\bmatch odds\b/i;
const ASKS_UNPRICED_MARKET =
  /\b(?:draw no bet|\bdnb\b|asian(?:\s+handicap)?|\bhandicap\b|\bcorners?\b|next goal|first goal|clean sheet)\b/i;

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

export function asksBttsQuestion(question: string): boolean {
  return ASKS_BTTS.test(question);
}

export type PricedGridMarket = "1x2" | "totals" | "btts" | "scorelines";

/** Markets this fixture already prices. A named market not in this set must abstain, not dump 1X2. */
export function pricedGridMarketsAsked(question: string): PricedGridMarket[] {
  const asked: PricedGridMarket[] = [];
  const totals = asksTotalsQuestion(question);
  const btts = asksBttsQuestion(question);
  // A compound ask ("will X beat Y, and over 2.5?") owes the result market too.
  if (ASKS_1X2.test(question) || ((totals || btts) && ASKS_RESULT_CUE.test(question))) asked.push("1x2");
  if (totals) asked.push("totals");
  if (btts) asked.push("btts");
  if (asksScorelineBoard(question)) asked.push("scorelines");
  return asked;
}

export function asksUnpricedMarket(question: string): boolean {
  return ASKS_UNPRICED_MARKET.test(question);
}

export function asksProjectedScore(question: string): boolean {
  return ASKS_PROJECTED_SCORE.test(question);
}

export function asksTacticalTake(question: string): boolean {
  return ASKS_TACTICAL_TAKE.test(question);
}

export function asksMatchPreview(question: string): boolean {
  return ASKS_MATCH_PREVIEW.test(question);
}

/**
 * Desk briefing / tactical chips: a strength-and-shape take from the match
 * card, not a team-news packet. Injury and manager searches on these turns
 * collide and wipe the football take.
 */
export function isSchematicMatchTake(question: string): boolean {
  const mode = planResponse(question, { groundingKind: "match", hasHistory: true }).mode;
  return mode === "match-preview" || (mode === "match-follow-up" && asksTacticalTake(question));
}

export function asksOddsBoard(question: string): boolean {
  return ASKS_ODDS_BOARD.test(question);
}

export function asksOddsProvenance(question: string): boolean {
  return ASKS_ODDS_PROVENANCE.test(question);
}

export function asksBestValueToday(question: string): boolean {
  return /\bbest value(?:\s+today|\s+on the slate|\s+this weekend)?\b/i.test(question)
    || /\b(?:biggest|largest)\b.{0,30}\b(?:gap|disagreement)\b.{0,30}\b(?:today|slate|weekend|fixtures)\b/i.test(question);
}

export function asksHonestWinnerGuarantee(question: string): boolean {
  if (/\b(?:acca|accumulator|parlay)\b/i.test(question)) return false;
  return /\bguarantee me (?:a )?winner\b/i.test(question)
    || /\b(?:a )?guaranteed win\b/i.test(question)
    || (/\b(?:guarantee\w*|certain|100%|promise)\b/i.test(question)
      && /\b(?:win|winner)\b/i.test(question));
}

export function asksParlayQuestion(question: string): boolean {
  return /\b(?:acca|accumulator|parlay)\b/i.test(question);
}

/** Numeric follow-ups after an earlier priced turn (draw, totals, market gap, etc.). */
export function asksPricingFollowUp(question: string): boolean {
  return /\b(?:what about|how about)\b.{0,60}\b(?:the )?(?:draw|home|away|1x2|odds|price|market|fair|edge|gap|over|under|btts|both teams)\b/i.test(question)
    || (/\b(?:what about|how about)\b/i.test(question) && /\b(?:draw|the draw)\b/i.test(question));
}

export function asksExpectedValueQuestion(question: string): boolean {
  return ASKS_EXPECTED_VALUE.test(question);
}

export function asksPassOrPlayQuestion(question: string, v2PlayPassResolver = false): boolean {
  if (v2PlayPassResolver) return /\b(?:pass or play|play or pass)\b/i.test(question);
  return /\bpass or play\b/i.test(question);
}

/** Structured `userLine` is only consumed on +EV / pass-or-play turns. */
export function questionAcceptsUserLine(question: string, v2PlayPassResolver = false): boolean {
  return asksExpectedValueQuestion(question) || asksPassOrPlayQuestion(question, v2PlayPassResolver);
}

/** Desk numeric questions the server already composes. MiniMax must not narrate these. */
export const DESK_COMPOSER_MODES: ReadonlySet<ResponseMode> = new Set([
  "exact-score",
  "fair-price",
  "market-comparison",
  "user-line",
  "stake-refusal",
  "lineup-counterfactual",
  "totals",
  "btts",
  "pricing-desk",
  "odds-provenance",
  "slate-best-gap",
  "winner-guarantee-honesty",
  "priced-why",
]);

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

export function mentionsBankroll(question: string): boolean {
  const q = question.trim();
  if (/\b(?:bankroll|bank roll)\b/i.test(q)) return true;
  if (/\$\s*[\d,]+(?:\.\d{2})?/.test(q) || /£\s*[\d,]+(?:\.\d{2})?/.test(q)) return true;
  return /\b(?:i have|i've got|with)\s+(?:a\s+)?(?:\$|£|usd|gbp)?\s*[\d,]+(?:\.\d{2})?\b/i.test(q);
}

export const BANKROLL_UNIT_GUIDANCE =
  "I hear the bankroll. As generic unit guidance only — not a bet recommendation — use flat stakes around 1–2% of that bankroll per bet, smaller on accas, and never chase losses.";

/** Complete same-source 1X2 divergence rows — required for market-comparison composer. */
export function hasCompleteMarket1x2ForComparison(grounding: {
  marketDivergence?: readonly unknown[];
}): boolean {
  return Boolean(grounding.marketDivergence?.length);
}

export function parseBankrollAmount(question: string): number | null {
  const q = question.trim();
  const dollar = /\$\s*([\d,]+(?:\.\d{1,2})?)/.exec(q);
  if (dollar) {
    const value = Number(dollar[1].replace(/,/g, ""));
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  const pounds = /£\s*([\d,]+(?:\.\d{1,2})?)/.exec(q);
  if (pounds) {
    const value = Number(pounds[1].replace(/,/g, ""));
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  return null;
}

function formatBankrollCurrency(amount: number, symbol: "$" | "£"): string {
  const rounded = Math.round(amount);
  return `${symbol}${rounded.toLocaleString("en-US")}`;
}

/** CTO policy copy appended after numeric traceability — not model probabilities. */
export function bankrollStakePolicyAppendix(question: string): string {
  const amount = parseBankrollAmount(question);
  const symbol = /£/.test(question) ? "£" as const : "$" as const;
  if (amount != null) {
    const low = Math.max(1, Math.round(amount * 0.01));
    const high = Math.max(low + 1, Math.round(amount * 0.02));
    const bankrollLabel = formatBankrollCurrency(amount, symbol);
    const stakeRange = `${formatBankrollCurrency(low, symbol)}–${formatBankrollCurrency(high, symbol)} on ${bankrollLabel}`;
    return `I hear the ${bankrollLabel} bankroll. As generic unit guidance only — not a bet recommendation — use flat stakes around 1–2% per bet (${stakeRange}), smaller on accas, and never chase losses; I do not Kelly-size.`;
  }
  return `${BANKROLL_UNIT_GUIDANCE} I do not Kelly-size.`;
}

export function deliveryPolicyLinesAfterTrace(question: string, mode: ResponseMode): string[] {
  if (mode !== "stake-refusal" || !mentionsBankroll(question)) return [];
  return [bankrollStakePolicyAppendix(question)];
}

/** Bare priced-turn follow-ups that must settle on the composer (legacy + V2). */
export function isPricedComposerFollowUp(
  question: string,
  hasHistory: boolean,
  hasCompleteMarket1x2: boolean,
): boolean {
  if (!hasHistory) return false;
  const q = question.trim();
  if (/^why\??[.!]*$/i.test(q)) return true;
  if (hasCompleteMarket1x2 && /^and the (?:away|home) side\??[.!]*$/i.test(q)) return true;
  if (/\b(?:what about|how about)\b/i.test(q) && /\b(?:the )?draw\b/i.test(q)) return true;
  return false;
}

/** Fixture winner ask on an active match (not a season/title outlook). */
export function asksMatchWinnerQuestion(question: string): boolean {
  const q = question.trim();
  if (!/\bwho\b/i.test(q) || !ASKS_RESULT_CUE.test(q)) return false;
  return !/\b(?:league|season|title|top[- ]four|champion|premier league title)\b/i.test(q);
}

/** Desk phrasing for a full priced 1X2 read without naming Kalshi/Polymarket explicitly. */
export function asksFixturePriceBoard(question: string): boolean {
  const q = question.trim();
  return /\bprice(?:\s+tonight'?s?|\s+this\s+evening)?\s+(?:the\s+)?match\b/i.test(q)
    || /\bprice\s+tonight(?:'s)?\s+(?:fixture|game|match)\b/i.test(q)
    || /\b(?:print|show)\s+(?:me\s+)?(?:tonight'?s?\s+)?(?:match\s+)?(?:odds|prices?|1x2)\b/i.test(q);
}

export function matchPlanContext(
  grounding: { kind?: string; marketDivergence?: readonly unknown[]; pricing?: { userLine?: unknown } } | null | undefined,
  hasHistory = false,
  v2PlayPassResolver = false,
): {
  hasHistory: boolean;
  groundingKind: string | null;
  hasUserLine: boolean;
  hasCompleteMarket1x2: boolean;
  v2PlayPassResolver: boolean;
} {
  const match = grounding?.kind === "match";
  return {
    hasHistory,
    groundingKind: match ? "match" : grounding?.kind ?? null,
    hasUserLine: match && Boolean(grounding.pricing?.userLine),
    hasCompleteMarket1x2: match && hasCompleteMarket1x2ForComparison(grounding),
    v2PlayPassResolver,
  };
}

export function planResponse(
  question: string,
  context: {
    hasHistory?: boolean;
    groundingKind?: string | null;
    hasUserLine?: boolean;
    hasCompleteMarket1x2?: boolean;
    v2PlayPassResolver?: boolean;
  } = {}
): ResponsePlan {
  const v2PlayPassResolver = Boolean(context.v2PlayPassResolver);
  const q = question.trim();
  const match = context.groundingKind === "match";
  const hasHistory = Boolean(context.hasHistory);
  const hasUserLine = Boolean(context.hasUserLine);
  let mode: ResponseMode;

  if (context.groundingKind === "fixture") mode = "coverage";
  else if (match && !hasUserLine && !asksStakeSizeQuestion(q) && ASKS_MATCH_PREVIEW.test(q)) {
    mode = "match-preview";
  } else if (/\b(?:if|suppose|assuming|without)\b.{0,80}\b(?:line-?up|starts?|benched|absent|missing|misses? out|ruled out|available)\b|\bwith\s+(?:a |the )?(?:changed|different|weakened|rotated|confirmed)\s+line-?up\b|\b(?:line-?up|starting xi)\b.{0,80}\b(?:change|shift|swing|reprice|probabilit)/i.test(q)) {
    mode = "lineup-counterfactual";
  } else if (/\b(?:goalscorer|goal scorer|anytime scorer|first scorer|top scorer|leading scorer|who scores|who (?:will|might|could) score|who (?:will|might|could) (?:most )?likely score|who (?:will|might|could) be (?:most )?likely to score|who is (?:the )?(?:most )?likely to score|who is the scorer|player prop|assists?|cards?)\b/i.test(q)) {
    mode = "player-or-scorer";
  } else if (match && /\bwho(?:'s| is| are)\s+missing\b/i.test(q)) {
    mode = "team-news";
  } else if (/\b(?:injur(?:y|ies|ed)|suspension|availability|team news|(?:predicted|probable|expected|likely|confirmed|official|starting)\s+line-?ups?|line-?ups?\s+(?:news|updates?|reports?)|starting (?:xi|eleven))\b/i.test(q)) {
    mode = "team-news";
  } else if (/\b(?:table|standings?)\b/i.test(q)) mode = "table";
  else if (/\b(?:title race|top[- ]four|season outlook|champion)\b/i.test(q)) mode = "season";
  else if (match && asksTotalsQuestion(q)) mode = "totals";
  else if (match && asksBttsQuestion(q)) mode = "btts";
  else if (match && /\b(?:which|what)\b.{0,40}\b(?:input|factor|driver)\b.{0,30}\b(?:matters? most|most important|drives?|explains?)\b|\b(?:most important|main)\b.{0,20}\b(?:input|factor|driver)\b/i.test(q)) mode = "match-follow-up";
  else if (match && asksStakeSizeQuestion(q)) mode = "stake-refusal";
  else if (match && asksPassOrPlayQuestion(q, v2PlayPassResolver)) mode = "user-line";
  else if (match && hasUserLine && asksExpectedValueQuestion(q)) mode = "user-line";
  else if (match && asksExpectedValueQuestion(q)) mode = "pricing-desk";
  else if (match && SCORELINE.test(q) && /\b(?:fair|price|odds?|decimal|implied)\b/i.test(q)) mode = "fair-price";
  else if (match && SCORELINE.test(q)) mode = "exact-score";
  else if (match && asksProjectedScore(q)) mode = "exact-score";
  else if (match && asksScorelineBoard(q)) mode = "exact-score";
  else if (match && asksTacticalTake(q)) mode = "match-follow-up";
  else if (match && asksOddsProvenance(q)) mode = "odds-provenance";
  else if (match && asksBestValueToday(q)) mode = "slate-best-gap";
  else if (match && asksHonestWinnerGuarantee(q)) mode = "winner-guarantee-honesty";
  else if (match && /\b(?:market|kalshi|polymarket|divergen|disagree|gap|value|edge|priced)\b/i.test(q)) mode = "market-comparison";
  else if (match && asksOddsBoard(q)) mode = "pricing-desk";
  else if (match && context.hasCompleteMarket1x2 && (asksMatchWinnerQuestion(q) || asksFixturePriceBoard(q))) {
    mode = "market-comparison";
  } else if (match && hasHistory && context.hasCompleteMarket1x2
    && /^and the (?:away|home) side\??[.!]*$/i.test(q)) {
    mode = "market-comparison";
  } else if (match && hasHistory && /^why\??[.!]*$/i.test(q)) {
    mode = "priced-why";
  } else if (match && hasHistory && context.hasCompleteMarket1x2
    && /\b(?:what about|how about)\b/i.test(q) && /\b(?:the )?draw\b/i.test(q)) {
    mode = "market-comparison";
  } else if (match && hasHistory && asksPricingFollowUp(q)) {
    if (asksTotalsQuestion(q)) mode = "totals";
    else if (asksBttsQuestion(q)) mode = "btts";
    else if (/\b(?:market|kalshi|polymarket|divergen|disagree|gap|value|edge|priced)\b/i.test(q)) mode = "market-comparison";
    else mode = "pricing-desk";
  } else if (match && !hasHistory) mode = "pricing-desk";
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
