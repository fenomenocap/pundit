export type ResponseMode =
  | "match-preview"
  | "match-follow-up"
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
  else if (match && !hasUserLine && !asksStakeSizeQuestion(q)
    && /\b(?:full (?:read|preview|analysis)|preview of|analyse|analyze|break down)\b/i.test(q)) mode = "match-preview";
  else if (/\b(?:if|suppose|assuming|without)\b.{0,80}\b(?:line-?up|starts?|benched|absent|missing|misses? out|ruled out|available)\b|\bwith\s+(?:a |the )?(?:changed|different|weakened|rotated|confirmed)\s+line-?up\b|\b(?:line-?up|starting xi)\b.{0,80}\b(?:change|shift|swing|reprice|probabilit)/i.test(q)) {
    mode = "lineup-counterfactual";
  } else if (/\b(?:goalscorer|goal scorer|anytime scorer|first scorer|who scores|who (?:will|might|could) score|who (?:will|might|could) (?:most )?likely score|who (?:will|might|could) be (?:most )?likely to score|who is (?:most )?likely to score|player prop|assists?|cards?)\b/i.test(q)) {
    mode = "player-or-scorer";
  } else if (/\b(?:injur(?:y|ies|ed)|suspension|availability|team news|confirmed line-?up|starting xi)\b/i.test(q)) {
    mode = "team-news";
  } else if (/\b(?:table|standings?)\b/i.test(q)) mode = "table";
  else if (/\b(?:title race|top[- ]four|season outlook|champion)\b/i.test(q)) mode = "season";
  else if (match && /\b(?:which|what)\b.{0,40}\b(?:input|factor|driver)\b.{0,30}\b(?:matters? most|most important|drives?|explains?)\b|\b(?:most important|main)\b.{0,20}\b(?:input|factor|driver)\b/i.test(q)) mode = "match-follow-up";
  else if (match && asksStakeSizeQuestion(q)) mode = "stake-refusal";
  else if (match && (hasUserLine || /\bpass or play\b/i.test(q))) mode = "user-line";
  else if (match && SCORELINE.test(q) && /\b(?:fair|price|odds?|decimal|implied)\b/i.test(q)) mode = "fair-price";
  else if (match && SCORELINE.test(q)) mode = "exact-score";
  else if (match && /\b(?:market|kalshi|polymarket|divergen|disagree|gap|value|edge|priced)\b/i.test(q)) mode = "market-comparison";
  else if (match && (!hasHistory || /\b(?:preview|analyse|analyze|full (?:read|preview)|thoughts on|break down)\b/i.test(q))) mode = "match-preview";
  else if (match) mode = "match-follow-up";
  else mode = "general";

  const full = mode === "match-preview";
  return {
    mode,
    directAnswerRequired: true,
    includeMatchCard: full ? "new-fixture" : match ? "compact-reference" : "none",
    // Player prices and lineup counterfactual deltas are unsupported
    // capabilities, so their correct answer is a deterministic abstention.
    // Only current team news requires external evidence in these match modes.
    evidenceRequired: mode === "team-news",
    maxSections: full ? 4 : 1,
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
