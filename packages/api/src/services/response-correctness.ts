export type OneXTwoOutcome = "home" | "draw" | "away";

export interface OneXTwoMarketLeg {
  outcome: OneXTwoOutcome;
  decimalOdds: number;
  source: string;
  observedAt: string;
}

export interface ValidatedOneXTwoMarket {
  source: string;
  observedAt: string;
  decimalOdds: Record<OneXTwoOutcome, number>;
  impliedProbabilities: Record<OneXTwoOutcome, number>;
  noVigProbabilities: Record<OneXTwoOutcome, number>;
  overround: number;
}

export type OneXTwoValidation =
  | { valid: true; market: ValidatedOneXTwoMarket }
  | {
      valid: false;
      reason: "missing-leg" | "duplicate-leg" | "mixed-source" | "mixed-observation-time" | "invalid-odds";
    };

const OUTCOMES: OneXTwoOutcome[] = ["home", "draw", "away"];

/** Decimal odds have one and only one deterministic implied probability. */
export function decimalImpliedProbability(decimalOdds: number): number | null {
  return Number.isFinite(decimalOdds) && decimalOdds > 1 ? 1 / decimalOdds : null;
}

export function probabilityTotalWithinTolerance(
  probabilities: Iterable<number>,
  target = 1,
  tolerancePercentagePoints = 0.2
): boolean {
  const values = [...probabilities];
  if (!values.length || values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    return false;
  }
  const tolerance = tolerancePercentagePoints / 100;
  return Math.abs(values.reduce((sum, value) => sum + value, 0) - target) <= tolerance + Number.EPSILON;
}

/**
 * Accepts only a complete market captured from one named source at one instant.
 * A partial market is not normalized: guessing the absent leg would manufacture
 * evidence, so the function fails closed instead.
 */
export function validateCompleteOneXTwoMarket(legs: readonly OneXTwoMarketLeg[]): OneXTwoValidation {
  if (legs.length < OUTCOMES.length) return { valid: false, reason: "missing-leg" };
  if (legs.length > OUTCOMES.length) return { valid: false, reason: "duplicate-leg" };

  const byOutcome = new Map(legs.map((leg) => [leg.outcome, leg]));
  if (byOutcome.size !== OUTCOMES.length) return { valid: false, reason: "duplicate-leg" };
  if (OUTCOMES.some((outcome) => !byOutcome.has(outcome))) return { valid: false, reason: "missing-leg" };

  const sources = new Set(legs.map((leg) => leg.source.trim()).filter(Boolean));
  if (sources.size !== 1) return { valid: false, reason: "mixed-source" };
  const observedTimes = new Set(legs.map((leg) => leg.observedAt.trim()).filter(Boolean));
  if (observedTimes.size !== 1) return { valid: false, reason: "mixed-observation-time" };

  const implied = {} as Record<OneXTwoOutcome, number>;
  const odds = {} as Record<OneXTwoOutcome, number>;
  for (const outcome of OUTCOMES) {
    const leg = byOutcome.get(outcome)!;
    const probability = decimalImpliedProbability(leg.decimalOdds);
    if (probability === null) return { valid: false, reason: "invalid-odds" };
    odds[outcome] = leg.decimalOdds;
    implied[outcome] = probability;
  }
  const overround = OUTCOMES.reduce((sum, outcome) => sum + implied[outcome], 0);
  if (!Number.isFinite(overround) || overround <= 0) return { valid: false, reason: "invalid-odds" };
  const noVig = Object.fromEntries(
    OUTCOMES.map((outcome) => [outcome, implied[outcome] / overround])
  ) as Record<OneXTwoOutcome, number>;
  if (!probabilityTotalWithinTolerance(Object.values(noVig))) {
    return { valid: false, reason: "invalid-odds" };
  }
  return {
    valid: true,
    market: {
      source: [...sources][0],
      observedAt: [...observedTimes][0],
      decimalOdds: odds,
      impliedProbabilities: implied,
      noVigProbabilities: noVig,
      overround,
    },
  };
}

export interface TraceableMatchNumbers {
  probabilities: readonly number[];
  percentagePointGaps?: readonly number[];
  fairDecimalOdds?: readonly number[];
}

/**
 * Removes generated percentage claims that cannot be traced to a typed match
 * fact. Evidence-marked sentences are deferred to citation verification; all
 * other numeric match prose must resolve to the server contract at the same
 * one-decimal display precision.
 */
export function stripUntraceableMatchPercentages(
  answer: string,
  trace: TraceableMatchNumbers
): string {
  const allowedProbabilities = new Set(trace.probabilities
    .filter(Number.isFinite).flatMap((value) => [(value * 100).toFixed(1), (value * 100).toFixed(0) + ".0"]));
  const allowedGaps = new Set((trace.percentagePointGaps ?? [])
    .filter(Number.isFinite).flatMap((value) => [Math.abs(value).toFixed(1), Math.abs(value).toFixed(0) + ".0"]));
  const allowedFairOdds = new Set((trace.fairDecimalOdds ?? [])
    .filter(Number.isFinite).map((value) => value.toFixed(2)));
  return answer.split("\n").map((line) => {
    if (/\[\[\s*S?\d{1,3}\s*\]\]/i.test(line) || /\]\(https?:\/\//i.test(line)) return line;
    const numbers = [...line.matchAll(/(?<![\d.])(\d{1,3}(?:\.\d+)?)\s*(%|percentage points?)/gi)];
    const fairOdds = [
      ...line.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s+(?:in\s+)?fair decimal odds\b/gi),
      ...line.matchAll(/\bfair decimal odds(?:\s+of|\s+are|\s+is|:)?\s+(\d+(?:\.\d+)?)/gi),
    ];
    if (!numbers.length && !fairOdds.length) return line;
    const supported = numbers.every((match) => {
      const normalized = Number(match[1]).toFixed(1);
      return /^%$/.test(match[2])
        ? allowedProbabilities.has(normalized)
        : allowedGaps.has(normalized);
    });
    const fairSupported = fairOdds.every((match) => allowedFairOdds.has(Number(match[1]).toFixed(2)));
    return supported && fairSupported ? line : "";
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export type ProbabilityOrigin =
  | { kind: "pundit-model" }
  | { kind: "external-market"; source: string; observedAt: string };

export function probabilityAttributionLabel(origin: ProbabilityOrigin): string {
  if (origin.kind === "pundit-model") return "Pundit model probabilities";
  const source = origin.source.trim();
  return `${source || "Third-party"} market-implied probabilities (third-party data, not a Pundit forecast)`;
}

export function hasValidProbabilityAttribution(label: string, origin: ProbabilityOrigin): boolean {
  if (origin.kind === "pundit-model") return /\bpundit\b/i.test(label);
  const source = origin.source.trim();
  const explicitDisclaimer = /\bnot\s+(?:a\s+)?pundit(?:'s)?(?:\s+model)?\b/i.test(label);
  const misattributed = /\bpundit(?:'s)?\s+(?:model\s+)?(?:forecast|prediction|probabilit)/i.test(label);
  return Boolean(source)
    && label.toLocaleLowerCase().includes(source.toLocaleLowerCase())
    && (!misattributed || explicitDisclaimer);
}

export type TotalSelection = "over" | "under";
export type TotalSettlement = "win" | "lose" | "push" | "invalid";

export function parseScoreline(scoreline: string): { home: number; away: number } | null {
  const match = /^\s*(\d{1,2})\s*[-–—:]\s*(\d{1,2})\s*$/.exec(scoreline);
  if (!match) return null;
  return { home: Number(match[1]), away: Number(match[2]) };
}

export function settleScorelineTotal(
  scoreline: string,
  line: number,
  selection: TotalSelection
): TotalSettlement {
  const score = parseScoreline(scoreline);
  if (!score || !Number.isFinite(line) || line < 0) return "invalid";
  const total = score.home + score.away;
  if (total === line) return "push";
  const over = total > line;
  return (selection === "over") === over ? "win" : "lose";
}

export interface ManagerTenure {
  manager: string;
  startedAt: string;
  endedAt?: string | null;
}

export type ManagerAttribution =
  | { status: "supported"; manager: string }
  | { status: "conflict"; manager: string; assertedManager: string }
  | { status: "unknown" };

function validInstant(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function attributeManagerEra(
  eventAt: string,
  tenures: readonly ManagerTenure[],
  assertedManager?: string
): ManagerAttribution {
  const event = validInstant(eventAt);
  if (event === null) return { status: "unknown" };
  const matching = tenures.filter((tenure) => {
    const start = validInstant(tenure.startedAt);
    const end = tenure.endedAt ? validInstant(tenure.endedAt) : Number.POSITIVE_INFINITY;
    return start !== null && end !== null && event >= start && event <= end;
  });
  if (matching.length !== 1 || !matching[0].manager.trim()) return { status: "unknown" };
  const manager = matching[0].manager.trim();
  if (assertedManager && manager.toLocaleLowerCase() !== assertedManager.trim().toLocaleLowerCase()) {
    return { status: "conflict", manager, assertedManager: assertedManager.trim() };
  }
  return { status: "supported", manager };
}

export interface DirectionalRationale {
  topic: string;
  direction: "home" | "away" | "neutral";
  text: string;
}

export function reconcileContradictoryRationales(rationales: readonly DirectionalRationale[]): {
  retained: DirectionalRationale[];
  conflictingTopics: string[];
} {
  const directions = new Map<string, Set<string>>();
  for (const rationale of rationales) {
    const topic = rationale.topic.trim().toLocaleLowerCase();
    if (!topic || rationale.direction === "neutral") continue;
    const entries = directions.get(topic) ?? new Set<string>();
    entries.add(rationale.direction);
    directions.set(topic, entries);
  }
  const conflicts = new Set([...directions].filter(([, values]) => values.size > 1).map(([topic]) => topic));
  return {
    retained: rationales.filter((rationale) =>
      rationale.direction === "neutral" || !conflicts.has(rationale.topic.trim().toLocaleLowerCase())
    ),
    conflictingTopics: [...conflicts],
  };
}

const CORRECTION_CUE = /\b(?:actually|correction|correct that|that(?:'s| is) (?:wrong|incorrect)|you(?:'re| are) wrong|not (?:the|their) (?:current )?manager|re-?check|verify again|fact[- ]check)\b/i;

export function containsCorrectionCue(text: string): boolean {
  return CORRECTION_CUE.test(text);
}

export interface VerifiableClaim {
  id: string;
  text: string;
}

export interface ClaimDecision {
  claimId: string;
  outcome: "supported" | "unsupported" | "conflict";
  evidenceIds: string[];
  explanation?: string;
}

const CONFLICT_ABSTENTION =
  "Current reports conflict on one or more requested facts, so I’ve left those claims out.";

export function applyClaimDecisions(
  claims: readonly VerifiableClaim[],
  decisions: readonly ClaimDecision[]
): {
  answer: string;
  supported: VerifiableClaim[];
  removedClaimIds: string[];
  conflictClaimIds: string[];
} {
  const decisionById = new Map(decisions.map((decision) => [decision.claimId, decision]));
  const supported = claims.filter((claim) => {
    const decision = decisionById.get(claim.id);
    return decision?.outcome === "supported" && decision.evidenceIds.length > 0;
  }).map((claim) => {
    const decision = decisionById.get(claim.id)!;
    // The verifier's server-validated evidence selection is authoritative.
    // Remove the generator's proposed markers and bind the claim to the one
    // primary ID accepted by verification.
    const text = claim.text.replace(/\s*\[\[S\d+\]\]/g, "").trim();
    const marker = `[[${decision.evidenceIds[0]}]]`;
    const marked = /[.!?]+$/.test(text)
      ? text.replace(/([.!?]+)$/, ` ${marker}$1`)
      : `${text} ${marker}`;
    return { ...claim, text: marked };
  });
  const conflictClaimIds = claims
    .filter((claim) => decisionById.get(claim.id)?.outcome === "conflict")
    .map((claim) => claim.id);
  const supportedIds = new Set(supported.map((claim) => claim.id));
  const removedClaimIds = claims.filter((claim) => !supportedIds.has(claim.id)).map((claim) => claim.id);
  const conflictNotice = conflictClaimIds.length
    ? CONFLICT_ABSTENTION
    : "";
  const answer = supported.length
    ? [...supported.map((claim) => claim.text.trim()).filter(Boolean), conflictNotice].filter(Boolean).join(" ")
    : conflictNotice || "I could not verify a reliable answer to that question.";
  return { answer, supported, removedClaimIds, conflictClaimIds };
}

/**
 * The same claim bookkeeping as `applyClaimDecisions`, but the answer is
 * *revised* rather than *rebuilt*.
 *
 * `applyClaimDecisions` composes its answer out of the supported claims alone,
 * which is right when the claims are the whole answer and destructive when they
 * are not: everything the generator wrote from Pundit's own grounding --
 * probabilities, reasoning, the verdict -- carries no citation marker, was never
 * a claim, and is discarded along with the unsupported ones. This walks the
 * original text instead. Each claim's span is replaced by its re-marked
 * supported text, or by nothing if the verifier did not support it, and every
 * other character is left exactly as written.
 *
 * `applyClaimDecisions` is deliberately untouched: callers that genuinely want
 * an evidence-only answer still have it.
 */
export function reviseAnswerWithClaimDecisions(
  answer: string,
  claims: readonly VerifiableClaim[],
  decisions: readonly ClaimDecision[]
): {
  answer: string;
  supported: VerifiableClaim[];
  removedClaimIds: string[];
  conflictClaimIds: string[];
} {
  const applied = applyClaimDecisions(claims, decisions);
  const supportedTextById = new Map(applied.supported.map((claim) => [claim.id, claim.text]));

  let cursor = 0;
  let revised = "";
  for (const claim of claims) {
    // Claim text is verbatim from the answer, so placing a claim is a search
    // rather than a reconstruction. Claims are located in order from a moving
    // cursor, so two identical sentences resolve to their own spans. A claim
    // that cannot be located is left alone: deleting text that failed to match
    // would be exactly the failure this function exists to remove.
    const index = answer.indexOf(claim.text, cursor);
    if (index < 0) continue;
    revised += answer.slice(cursor, index) + (supportedTextById.get(claim.id) ?? "");
    cursor = index + claim.text.length;
  }
  revised += answer.slice(cursor);

  const conflictNotice = applied.conflictClaimIds.length
    ? CONFLICT_ABSTENTION
    : "";
  const withNotice = conflictNotice
    ? (revised.trim() ? `${revised.trimEnd()} ${conflictNotice}` : conflictNotice)
    : revised;

  return {
    answer: withNotice,
    supported: applied.supported,
    removedClaimIds: applied.removedClaimIds,
    conflictClaimIds: applied.conflictClaimIds,
  };
}
